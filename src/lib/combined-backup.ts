import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { createClient } from "@libsql/client";

const execFileAsync = promisify(execFile);
export const combinedBackupFormatVersion = 3 as const;
export const legacyCombinedBackupFormatVersion = 4 as const;
export const combinedBackupProfiles = {
  modern: "MODERN_UNIFIED",
  legacyPreEnablement: "LEGACY_PRE_ENABLEMENT",
} as const;
export type CombinedBackupProfile = typeof combinedBackupProfiles[keyof typeof combinedBackupProfiles];
export const combinedBackupCompletionFilename = "COMPLETED.json";
const manifestFilename = "manifest.json";
const databaseFilename = "database.sqlite";

export const protectedBusinessTables = [
  "Competition",
  "Team",
  "Match",
  "Referee",
  "RefereeApplication",
  "RefereeAppointment",
  "AppointmentVersion",
  "RefereeAvailability",
  "RefereePositionCapability",
  "RefereeAdmissionApplication",
  "ContentPost",
  "MediaAsset",
  "AdminAccount",
  "AuditLog",
] as const;

type ProtectedBusinessTable = typeof protectedBusinessTables[number];

const legacyRequiredProtectedTables = [
  "Competition",
  "Team",
  "Match",
  "Referee",
  "RefereeApplication",
  "RefereeAppointment",
  "AppointmentVersion",
  "AuditLog",
] as const satisfies readonly ProtectedBusinessTable[];

const legacyExpectedMigrationNames = [
  "20260722013757_init_referee_center",
  "20260723124500_add_referee_sessions",
  "20260730090000_referee_operations_v24",
] as const;

const legacyPermittedAbsentProtectedTables = protectedBusinessTables.filter(
  (table) => !legacyRequiredProtectedTables.includes(table as typeof legacyRequiredProtectedTables[number]),
);

export type CombinedBackupSchemaCapabilities = {
  protectedTablesPresent: ProtectedBusinessTable[];
  protectedTablesAbsent: ProtectedBusinessTable[];
  managedUploadsState: "PRESENT" | "PRESENT_EMPTY" | "ABSENT";
  protectedRowCounts?: Partial<Record<ProtectedBusinessTable, number>>;
};

type CombinedBackupManifestBase = {
  backupId: string;
  generatedAtUtc: string;
  applicationSha: string;
  schemaVersion: string;
  migrations: string[];
  database: { filename: "database.sqlite"; bytes: number; sha256: string };
  uploads: {
    fileCount: number;
    totalBytes: number;
    mediaAssetCount: number;
    files: Array<{ storageKey: string; bytes: number; sha256: string }>;
  };
  checksums: Record<string, string>;
};

export type ModernCombinedBackupManifest = CombinedBackupManifestBase & {
  formatVersion: 3;
  backupProfile: "MODERN_UNIFIED";
  schemaCapabilities: CombinedBackupSchemaCapabilities;
};

export type LegacyPreEnablementBackupManifest = CombinedBackupManifestBase & {
  formatVersion: 4;
  backupProfile: "LEGACY_PRE_ENABLEMENT";
  schemaCapabilities: CombinedBackupSchemaCapabilities;
};

export type CombinedBackupManifest = ModernCombinedBackupManifest | LegacyPreEnablementBackupManifest;

export type CombinedBackupCompletion = {
  formatVersion: 1;
  backupId: string;
  completedAtUtc: string;
  manifestSha256: string;
};

export type CombinedBackupPhase =
  | "database-snapshot-complete"
  | "uploads-copy-complete"
  | "manifest-complete"
  | "completion-publish";

export type CombinedRestorePhase = "uploads-copy-complete";

const storageKeyPattern = /^[0-9]{4}\/[0-9]{2}\/[0-9a-f-]+\.(?:jpg|jpeg|png|webp|pdf)$/;
const sha256Pattern = /^[0-9a-f]{64}$/i;
const backupIdPattern = /^nuaafa-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$/;

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeArtifactPath(root: string, relative: string) {
  if (!relative || relative.includes("\\") || path.posix.isAbsolute(relative)) {
    throw new Error("Backup manifest contains an unsafe path.");
  }
  const segments = relative.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Backup manifest contains an unsafe path.");
  }
  const target = path.resolve(root, ...segments);
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw new Error("Backup manifest contains an unsafe path.");
  }
  return target;
}

function createBackupId(generatedAt: Date) {
  const timestamp = generatedAt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `nuaafa-${timestamp}-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

export function sqlitePathFromUrl(databaseUrl: string) {
  if (!databaseUrl.startsWith("file:")) {
    throw new Error("DATABASE_URL must be an explicit file: SQLite URL.");
  }
  const value = databaseUrl.slice("file:".length);
  if (!value || value.includes("?") || value.includes("#")) {
    throw new Error("SQLite URL must identify one plain database file.");
  }
  return path.resolve(value.replaceAll("/", path.sep));
}

async function listFiles(
  root: string,
  current = root,
  options: { allowStaging?: boolean } = {},
): Promise<Array<{ storageKey: string; diskPath: string; bytes: number }>> {
  const entries = await readdir(current, { withFileTypes: true });
  const result: Array<{ storageKey: string; diskPath: string; bytes: number }> = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new Error(`Symbolic links are not allowed in backup artifacts: ${entry.name}`);
    }
    if (entry.name === ".staging" && current === root && options.allowStaging) continue;
    const target = path.join(current, entry.name);
    if (entry.isDirectory()) {
      result.push(...await listFiles(root, target, options));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Unexpected filesystem entry in backup artifacts: ${entry.name}`);
    }
    const file = await stat(target);
    result.push({
      storageKey: path.relative(root, target).split(path.sep).join("/"),
      diskPath: target,
      bytes: file.size,
    });
  }
  return result;
}

async function migrationNames() {
  return (await readdir(path.resolve("prisma/migrations"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function applicationSha() {
  const cwd = await realpath(process.cwd());
  let trustedRootTree = true;
  for (let parent = cwd; ; parent = path.dirname(parent)) {
    const metadata = await lstat(parent);
    if (metadata.uid !== 0 || (metadata.mode & 0o022) !== 0 || metadata.isSymbolicLink()) trustedRootTree = false;
    if (parent === path.dirname(parent)) break;
  }
  const args = ["--no-replace-objects", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false"];
  if (trustedRootTree) args.push("-c", `safe.directory=${cwd}`);
  args.push("rev-parse", "HEAD");
  return (await execFileAsync("git", args, { cwd })).stdout.trim();
}

async function ensureEmptyDirectory(target: string) {
  await mkdir(target, { recursive: true });
  if ((await readdir(target)).length) {
    throw new Error("Backup output directory must be empty.");
  }
}

function validateSchemaCapabilities(value: unknown, profile: CombinedBackupProfile) {
  if (value === undefined && profile === combinedBackupProfiles.modern) {
    return {
      protectedTablesPresent: [...protectedBusinessTables],
      protectedTablesAbsent: [],
      managedUploadsState: "PRESENT",
    } satisfies CombinedBackupSchemaCapabilities;
  }
  if (!isRecord(value)) throw new Error("Backup schema capability record is invalid.");
  const present = value.protectedTablesPresent;
  const absent = value.protectedTablesAbsent;
  const managedUploadsState = value.managedUploadsState;
  const protectedRowCounts = value.protectedRowCounts;
  if (
    !Array.isArray(present) ||
    !Array.isArray(absent) ||
    !present.every((table) => typeof table === "string" && protectedBusinessTables.includes(table as ProtectedBusinessTable)) ||
    !absent.every((table) => typeof table === "string" && protectedBusinessTables.includes(table as ProtectedBusinessTable)) ||
    new Set(present).size !== present.length ||
    new Set(absent).size !== absent.length ||
    present.some((table) => absent.includes(table))
  ) {
    throw new Error("Backup protected-table capability record is invalid.");
  }
  const partition = new Set([...present, ...absent]);
  if (partition.size !== protectedBusinessTables.length || protectedBusinessTables.some((table) => !partition.has(table))) {
    throw new Error("Backup protected-table capabilities must cover the complete protected table inventory.");
  }
  if (profile === combinedBackupProfiles.modern) {
    if (
      present.length !== protectedBusinessTables.length ||
      absent.length !== 0 ||
      managedUploadsState !== "PRESENT"
    ) {
      throw new Error("Modern backup capabilities must require the complete Unified schema and managed upload root.");
    }
  } else {
    if (
      present.length !== legacyRequiredProtectedTables.length ||
      legacyRequiredProtectedTables.some((table) => !present.includes(table)) ||
      absent.length !== legacyPermittedAbsentProtectedTables.length ||
      legacyPermittedAbsentProtectedTables.some((table) => !absent.includes(table)) ||
      (managedUploadsState !== "ABSENT" && managedUploadsState !== "PRESENT_EMPTY")
    ) {
      throw new Error("Legacy pre-enablement capabilities do not match the reviewed historical schema profile.");
    }
  }
  if (protectedRowCounts !== undefined) {
    if (!isRecord(protectedRowCounts)) throw new Error("Backup protected row counts are invalid.");
    const countKeys = Object.keys(protectedRowCounts);
    if (
      countKeys.sort().join("\n") !== [...present].sort().join("\n") ||
      Object.values(protectedRowCounts).some((count) => !Number.isSafeInteger(count) || Number(count) < 0)
    ) {
      throw new Error("Backup protected row counts must exactly cover the present protected tables.");
    }
  } else if (profile === combinedBackupProfiles.legacyPreEnablement) {
    throw new Error("Legacy pre-enablement backup must record protected row counts.");
  }
  return {
    protectedTablesPresent: present as ProtectedBusinessTable[],
    protectedTablesAbsent: absent as ProtectedBusinessTable[],
    managedUploadsState,
    ...(protectedRowCounts === undefined
      ? {}
      : { protectedRowCounts: protectedRowCounts as Partial<Record<ProtectedBusinessTable, number>> }),
  } as CombinedBackupSchemaCapabilities;
}

function validateManifest(value: unknown): CombinedBackupManifest {
  if (
    !isRecord(value) ||
    (value.formatVersion !== combinedBackupFormatVersion && value.formatVersion !== legacyCombinedBackupFormatVersion)
  ) {
    throw new Error("Backup manifest format is invalid.");
  }
  const declaredProfile = value.formatVersion === combinedBackupFormatVersion
    ? value.backupProfile ?? combinedBackupProfiles.modern
    : value.backupProfile;
  if (
    (value.formatVersion === combinedBackupFormatVersion && declaredProfile !== combinedBackupProfiles.modern) ||
    (value.formatVersion === legacyCombinedBackupFormatVersion && declaredProfile !== combinedBackupProfiles.legacyPreEnablement)
  ) {
    throw new Error("Backup profile does not match its manifest format.");
  }
  const backupProfile: CombinedBackupProfile = value.formatVersion === combinedBackupFormatVersion
    ? combinedBackupProfiles.modern
    : combinedBackupProfiles.legacyPreEnablement;
  const schemaCapabilities = validateSchemaCapabilities(value.schemaCapabilities, backupProfile);
  if (
    typeof value.backupId !== "string" ||
    !backupIdPattern.test(value.backupId) ||
    typeof value.generatedAtUtc !== "string" ||
    Number.isNaN(Date.parse(value.generatedAtUtc)) ||
    typeof value.applicationSha !== "string" ||
    !/^[0-9a-f]{40}$/i.test(value.applicationSha) ||
    typeof value.schemaVersion !== "string" ||
    !Array.isArray(value.migrations) ||
    !value.migrations.every((item) => typeof item === "string" && /^[0-9A-Za-z_-]+$/.test(item)) ||
    new Set(value.migrations).size !== value.migrations.length
  ) {
    throw new Error("Backup manifest metadata is invalid.");
  }
  if (!isRecord(value.database) || value.database.filename !== databaseFilename) {
    throw new Error("Backup manifest database artifact is invalid.");
  }
  if (
    typeof value.database.bytes !== "number" ||
    !Number.isSafeInteger(value.database.bytes) ||
    value.database.bytes <= 0 ||
    typeof value.database.sha256 !== "string" ||
    !sha256Pattern.test(value.database.sha256)
  ) {
    throw new Error("Backup manifest database metadata is invalid.");
  }
  if (!isRecord(value.uploads) || !Array.isArray(value.uploads.files)) {
    throw new Error("Backup manifest upload metadata is invalid.");
  }
  const counters = [value.uploads.fileCount, value.uploads.totalBytes, value.uploads.mediaAssetCount];
  if (counters.some((counter) => typeof counter !== "number" || !Number.isSafeInteger(counter) || counter < 0)) {
    throw new Error("Backup manifest upload counters are invalid.");
  }
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const item of value.uploads.files) {
    if (
      !isRecord(item) ||
      typeof item.storageKey !== "string" ||
      !storageKeyPattern.test(item.storageKey) ||
      seen.has(item.storageKey) ||
      typeof item.bytes !== "number" ||
      !Number.isSafeInteger(item.bytes) ||
      item.bytes < 0 ||
      typeof item.sha256 !== "string" ||
      !sha256Pattern.test(item.sha256)
    ) {
      throw new Error("Backup manifest upload entry is invalid.");
    }
    seen.add(item.storageKey);
    totalBytes += item.bytes;
  }
  if (
    value.uploads.fileCount !== value.uploads.files.length ||
    value.uploads.mediaAssetCount !== value.uploads.files.length ||
    value.uploads.totalBytes !== totalBytes
  ) {
    throw new Error("Backup manifest upload counters do not reconcile.");
  }
  if (
    backupProfile === combinedBackupProfiles.legacyPreEnablement &&
    (value.uploads.fileCount !== 0 || value.uploads.mediaAssetCount !== 0 || value.uploads.totalBytes !== 0)
  ) {
    throw new Error("Legacy pre-enablement backup must represent an empty managed-upload dataset.");
  }
  if (!isRecord(value.checksums)) {
    throw new Error("Backup manifest checksums are invalid.");
  }
  const checksumValues = value.checksums;
  const expectedChecksumNames = new Set([
    databaseFilename,
    ...value.uploads.files.map((file) => `uploads/${file.storageKey}`),
  ]);
  const actualChecksumNames = Object.keys(checksumValues);
  if (
    actualChecksumNames.length !== expectedChecksumNames.size ||
    actualChecksumNames.some((name) => !expectedChecksumNames.has(name))
  ) {
    throw new Error("Backup manifest checksum coverage is incomplete.");
  }
  for (const [name, checksum] of Object.entries(checksumValues)) {
    if (typeof checksum !== "string" || !sha256Pattern.test(checksum)) {
      throw new Error(`Backup manifest checksum is invalid: ${name}`);
    }
  }
  if (
    checksumValues[databaseFilename] !== value.database.sha256 ||
    value.uploads.files.some((file) => checksumValues[`uploads/${file.storageKey}`] !== file.sha256)
  ) {
    throw new Error("Backup manifest checksum metadata does not reconcile.");
  }
  return { ...value, backupProfile, schemaCapabilities } as CombinedBackupManifest;
}

function validateCompletion(value: unknown, manifest: CombinedBackupManifest, manifestBytes: Uint8Array) {
  if (
    !isRecord(value) ||
    value.formatVersion !== 1 ||
    value.backupId !== manifest.backupId ||
    typeof value.completedAtUtc !== "string" ||
    Number.isNaN(Date.parse(value.completedAtUtc)) ||
    typeof value.manifestSha256 !== "string" ||
    value.manifestSha256 !== sha256(manifestBytes)
  ) {
    throw new Error("Backup completion marker is invalid.");
  }
  return value as CombinedBackupCompletion;
}

async function readJsonFile(target: string, label: string) {
  try {
    return JSON.parse(await readFile(target, "utf8")) as unknown;
  } catch {
    throw new Error(`${label} is missing or malformed.`);
  }
}

async function assertRegularFile(target: string, label: string) {
  let info;
  try {
    info = await lstat(target);
  } catch {
    throw new Error(`${label} is missing.`);
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file.`);
  }
  return info;
}

async function appliedMigrationNames(client: ReturnType<typeof createClient>) {
  const tableResult = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_prisma_migrations'");
  if (tableResult.rows.length !== 1) throw new Error("Backup database is missing Prisma migration history.");
  const result = await client.execute(
    'SELECT "migration_name", "finished_at", "rolled_back_at" FROM "_prisma_migrations" ORDER BY "started_at"',
  );
  if (result.rows.some((row) => row.finished_at === null || row.rolled_back_at !== null)) {
    throw new Error("Backup database contains unfinished or rolled-back migration history.");
  }
  const names = result.rows.map((row) => String(row.migration_name));
  if (new Set(names).size !== names.length) throw new Error("Backup database migration history contains duplicates.");
  return names;
}

async function inspectSchemaCapabilities(
  client: ReturnType<typeof createClient>,
  profile: CombinedBackupProfile,
) {
  const tableResult = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table'");
  const tables = new Set(tableResult.rows.map((row) => String(row.name)));
  const protectedTablesPresent = protectedBusinessTables.filter((table) => tables.has(table));
  const protectedTablesAbsent = protectedBusinessTables.filter((table) => !tables.has(table));
  const protectedRowCounts: Partial<Record<ProtectedBusinessTable, number>> = {};
  for (const table of protectedTablesPresent) {
    const result = await client.execute(`SELECT COUNT(*) AS count FROM "${table}"`);
    protectedRowCounts[table] = Number(result.rows[0]?.count ?? 0);
  }
  const expectedMigrations = profile === combinedBackupProfiles.modern
    ? await migrationNames()
    : [...legacyExpectedMigrationNames];
  // Modern v3 historically described the release migration inventory and did not
  // require a Prisma history table in every isolated test snapshot. Preserve that
  // contract; only the explicit legacy bridge binds to reviewed applied history.
  const migrations = profile === combinedBackupProfiles.modern
    ? expectedMigrations
    : await appliedMigrationNames(client);
  if (migrations.join("\n") !== expectedMigrations.join("\n")) {
    throw new Error(`${profile} database migration inventory does not match the reviewed release profile.`);
  }
  const capabilities = {
    protectedTablesPresent,
    protectedTablesAbsent,
    managedUploadsState: profile === combinedBackupProfiles.modern ? "PRESENT" : "ABSENT",
    protectedRowCounts,
  } satisfies CombinedBackupSchemaCapabilities;
  validateSchemaCapabilities(capabilities, profile);
  return { capabilities, migrations };
}

async function databaseValidation(databasePath: string, manifest: CombinedBackupManifest) {
  const url = `file:${databasePath.replaceAll("\\", "/")}`;
  const client = createClient({ url });
  try {
    const integrity = await client.execute("PRAGMA integrity_check");
    if (integrity.rows.length !== 1 || integrity.rows[0]?.integrity_check !== "ok") {
      throw new Error("Backup database integrity_check failed.");
    }
    const foreignKeys = await client.execute("PRAGMA foreign_key_check");
    if (foreignKeys.rows.length) {
      throw new Error("Backup database foreign_key_check failed.");
    }
    const inspected = await inspectSchemaCapabilities(client, manifest.backupProfile);
    const actualCapabilities = {
      ...inspected.capabilities,
      managedUploadsState: manifest.schemaCapabilities.managedUploadsState,
    };
    if (
      actualCapabilities.protectedTablesPresent.join("\n") !== manifest.schemaCapabilities.protectedTablesPresent.join("\n") ||
      actualCapabilities.protectedTablesAbsent.join("\n") !== manifest.schemaCapabilities.protectedTablesAbsent.join("\n") ||
      inspected.migrations.join("\n") !== manifest.migrations.join("\n") ||
      manifest.schemaVersion !== (inspected.migrations.at(-1) ?? "none") ||
      (manifest.schemaCapabilities.protectedRowCounts !== undefined &&
        JSON.stringify(inspected.capabilities.protectedRowCounts) !== JSON.stringify(manifest.schemaCapabilities.protectedRowCounts))
    ) {
      throw new Error("Backup database schema capabilities do not match the manifest.");
    }
    const rowCounts = inspected.capabilities.protectedRowCounts ?? {};
    return {
      integrityCheck: "ok" as const,
      foreignKeyViolations: 0,
      backupProfile: manifest.backupProfile,
      schemaCapabilities: manifest.schemaCapabilities,
      migrations: inspected.migrations,
      rowCounts,
    };
  } finally {
    client.close();
  }
}

export async function createCombinedBackup(input: {
  databaseUrl: string;
  uploadRoot: string;
  outputDirectory: string;
  profile?: CombinedBackupProfile;
  generatedAt?: Date;
  onPhase?: (phase: CombinedBackupPhase) => void | Promise<void>;
}) {
  const profile = input.profile ?? combinedBackupProfiles.modern;
  if (!Object.values(combinedBackupProfiles).includes(profile)) throw new Error("Backup profile is invalid.");
  const databasePath = sqlitePathFromUrl(input.databaseUrl);
  const uploadRoot = path.resolve(input.uploadRoot);
  const outputDirectory = path.resolve(input.outputDirectory);
  if (
    !path.isAbsolute(input.uploadRoot) ||
    outputDirectory === uploadRoot ||
    outputDirectory.startsWith(`${uploadRoot}${path.sep}`)
  ) {
    throw new Error("Backup output must be an absolute directory outside the upload root.");
  }
  const databaseInfo = await stat(databasePath);
  if (!databaseInfo.isFile()) throw new Error("SQLite database file does not exist.");
  let uploadRootExists = true;
  try {
    const uploadInfo = await lstat(uploadRoot);
    if (!uploadInfo.isDirectory() || uploadInfo.isSymbolicLink()) {
      throw new Error("Upload root must be a real directory.");
    }
  } catch (error) {
    if (
      profile === combinedBackupProfiles.legacyPreEnablement &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      uploadRootExists = false;
    } else {
      throw error;
    }
  }
  await ensureEmptyDirectory(outputDirectory);
  const databaseOutput = path.join(outputDirectory, databaseFilename);
  const uploadsOutput = path.join(outputDirectory, "uploads");
  await mkdir(uploadsOutput, { recursive: true });

  const client = createClient({ url: input.databaseUrl });
  try {
    const escaped = databaseOutput.replaceAll("\\", "/").replaceAll("'", "''");
    await client.execute(`VACUUM INTO '${escaped}'`);
  } finally {
    client.close();
  }
  await input.onPhase?.("database-snapshot-complete");

  const snapshotClient = createClient({ url: `file:${databaseOutput.replaceAll("\\", "/")}` });
  let mediaRows: Array<{ storageKey: string }>;
  let migrations: string[];
  let schemaCapabilities: CombinedBackupSchemaCapabilities;
  try {
    const inspected = await inspectSchemaCapabilities(snapshotClient, profile);
    migrations = inspected.migrations;
    schemaCapabilities = {
      ...inspected.capabilities,
      managedUploadsState: profile === combinedBackupProfiles.modern
        ? "PRESENT"
        : uploadRootExists ? "PRESENT_EMPTY" : "ABSENT",
    };
    if (profile === combinedBackupProfiles.modern) {
      const result = await snapshotClient.execute('SELECT "storageKey" FROM "MediaAsset" ORDER BY "storageKey"');
      mediaRows = result.rows.map((row) => ({ storageKey: String(row.storageKey) }));
    } else {
      mediaRows = [];
    }
  } finally {
    snapshotClient.close();
  }
  validateSchemaCapabilities(schemaCapabilities, profile);
  if (mediaRows.some((row) => !storageKeyPattern.test(row.storageKey))) {
    throw new Error("MediaAsset contains an invalid storage key.");
  }

  const sourceFiles = uploadRootExists
    ? await listFiles(uploadRoot, uploadRoot, { allowStaging: profile === combinedBackupProfiles.modern })
    : [];
  if (profile === combinedBackupProfiles.legacyPreEnablement && sourceFiles.length) {
    throw new Error("Legacy pre-enablement upload root must be absent or empty.");
  }
  const expected = new Set(mediaRows.map((row) => row.storageKey));
  const actual = new Set(sourceFiles.map((file) => file.storageKey));
  const orphanFiles = sourceFiles.filter((file) => !expected.has(file.storageKey)).map((file) => file.storageKey);
  const missingFiles = mediaRows.filter((row) => !actual.has(row.storageKey)).map((row) => row.storageKey);
  if (orphanFiles.length || missingFiles.length) {
    throw new Error(`Media reconciliation failed: ${orphanFiles.length} orphan, ${missingFiles.length} missing.`);
  }

  const uploadFiles: CombinedBackupManifest["uploads"]["files"] = [];
  for (const source of sourceFiles.sort((left, right) => left.storageKey.localeCompare(right.storageKey))) {
    const target = path.join(uploadsOutput, ...source.storageKey.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source.diskPath, target);
    const bytes = await readFile(target);
    if (bytes.length !== source.bytes) {
      throw new Error(`Upload changed during backup: ${source.storageKey}`);
    }
    uploadFiles.push({ storageKey: source.storageKey, bytes: bytes.length, sha256: sha256(bytes) });
  }
  await input.onPhase?.("uploads-copy-complete");

  const databaseBytes = await readFile(databaseOutput);
  const checksums: Record<string, string> = { [databaseFilename]: sha256(databaseBytes) };
  for (const file of uploadFiles) checksums[`uploads/${file.storageKey}`] = file.sha256;
  const generatedAt = input.generatedAt ?? new Date();
  const manifestBase: CombinedBackupManifestBase = {
    backupId: createBackupId(generatedAt),
    generatedAtUtc: generatedAt.toISOString(),
    applicationSha: await applicationSha(),
    schemaVersion: migrations.at(-1) ?? "none",
    migrations,
    database: { filename: databaseFilename, bytes: databaseBytes.length, sha256: checksums[databaseFilename] },
    uploads: {
      fileCount: uploadFiles.length,
      totalBytes: uploadFiles.reduce((total, file) => total + file.bytes, 0),
      mediaAssetCount: mediaRows.length,
      files: uploadFiles,
    },
    checksums,
  };
  const manifest: CombinedBackupManifest = profile === combinedBackupProfiles.legacyPreEnablement
    ? {
        ...manifestBase,
        formatVersion: legacyCombinedBackupFormatVersion,
        backupProfile: combinedBackupProfiles.legacyPreEnablement,
        schemaCapabilities,
      }
    : {
        ...manifestBase,
        formatVersion: combinedBackupFormatVersion,
        backupProfile: combinedBackupProfiles.modern,
        schemaCapabilities,
      };
  validateManifest(manifest);
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(path.join(outputDirectory, manifestFilename), manifestBytes, { flag: "wx", mode: 0o600 });
  await input.onPhase?.("manifest-complete");

  const completion: CombinedBackupCompletion = {
    formatVersion: 1,
    backupId: manifest.backupId,
    completedAtUtc: new Date().toISOString(),
    manifestSha256: sha256(manifestBytes),
  };
  const temporaryCompletion = path.join(outputDirectory, ".completion.tmp");
  await writeFile(temporaryCompletion, `${JSON.stringify(completion, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  await input.onPhase?.("completion-publish");
  await rename(temporaryCompletion, path.join(outputDirectory, combinedBackupCompletionFilename));
  return manifest;
}

type DatabaseValidation = Awaited<ReturnType<typeof databaseValidation>>;
type VerifiedBackupBase = {
  root: string;
  manifest: CombinedBackupManifest;
  completion: CombinedBackupCompletion;
};

export function readAndVerifyCombinedBackup(backupDirectory: string): Promise<VerifiedBackupBase & { database: DatabaseValidation }>;
export function readAndVerifyCombinedBackup(backupDirectory: string, options: { validateDatabase: false }): Promise<VerifiedBackupBase & { database: null }>;
export async function readAndVerifyCombinedBackup(backupDirectory: string, options: { validateDatabase?: boolean } = {}) {
  const root = path.resolve(backupDirectory);
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error("Backup root must be a real directory.");
  }
  await assertRegularFile(path.join(root, combinedBackupCompletionFilename), "Backup completion marker");
  await assertRegularFile(path.join(root, manifestFilename), "Backup manifest");
  const manifestBytes = await readFile(path.join(root, manifestFilename));
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw new Error("Backup manifest is missing or malformed.");
  }
  const manifest = validateManifest(manifestJson);
  const completion = validateCompletion(
    await readJsonFile(path.join(root, combinedBackupCompletionFilename), "Backup completion marker"),
    manifest,
    manifestBytes,
  );

  for (const [relative, expected] of Object.entries(manifest.checksums)) {
    const target = safeArtifactPath(root, relative);
    const info = await assertRegularFile(target, `Backup file ${relative}`);
    const bytes = await readFile(target);
    if (sha256(bytes) !== expected) throw new Error(`Backup checksum mismatch: ${relative}`);
    const expectedBytes = relative === databaseFilename
      ? manifest.database.bytes
      : manifest.uploads.files.find((file) => `uploads/${file.storageKey}` === relative)?.bytes;
    if (expectedBytes === undefined || info.size !== expectedBytes || bytes.length !== expectedBytes) {
      throw new Error(`Backup artifact size mismatch: ${relative}`);
    }
  }

  const uploadRoot = path.join(root, "uploads");
  const uploadInfo = await lstat(uploadRoot);
  if (!uploadInfo.isDirectory() || uploadInfo.isSymbolicLink()) {
    throw new Error("Backup uploads artifact must be a real directory.");
  }
  const storedFiles = await listFiles(uploadRoot);
  const expectedFiles = manifest.uploads.files.map((file) => file.storageKey).sort();
  const actualFiles = storedFiles.map((file) => file.storageKey).sort();
  if (expectedFiles.join("\n") !== actualFiles.join("\n")) {
    throw new Error("Backup uploads artifact contains missing or unexpected files.");
  }
  const database = options.validateDatabase === false ? null : await databaseValidation(path.join(root, databaseFilename), manifest);
  return { root, manifest, completion, database };
}

function assertRestoreTarget(target: string, allowedRoot: string) {
  const resolved = path.resolve(target);
  const root = path.resolve(allowedRoot);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Restore target is outside the explicitly allowed isolated root.");
  }
  return resolved;
}

async function targetMustNotExist(target: string, label: string) {
  try {
    await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(`${label} already exists; restore requires a fresh explicit destination.`);
}

export async function restoreCombinedBackup(input: {
  backupDirectory: string;
  databasePath: string;
  uploadRoot: string;
  allowedTargetRoot: string;
  onPhase?: (
    phase: CombinedRestorePhase,
    staging: { uploadRoot: string },
  ) => void | Promise<void>;
}) {
  const { root, manifest, database: sourceDatabase } = await readAndVerifyCombinedBackup(input.backupDirectory);
  const allowedTargetRoot = path.resolve(input.allowedTargetRoot);
  const databasePath = assertRestoreTarget(input.databasePath, allowedTargetRoot);
  const uploadRoot = assertRestoreTarget(input.uploadRoot, allowedTargetRoot);
  if (
    databasePath === uploadRoot ||
    databasePath.startsWith(`${uploadRoot}${path.sep}`) ||
    uploadRoot.startsWith(`${databasePath}${path.sep}`) ||
    databasePath.startsWith(`${root}${path.sep}`) ||
    uploadRoot.startsWith(`${root}${path.sep}`)
  ) {
    throw new Error("Restore targets overlap each other or the source backup.");
  }
  await targetMustNotExist(databasePath, "Restore database destination");
  await targetMustNotExist(uploadRoot, "Restore upload destination");

  await mkdir(allowedTargetRoot, { recursive: true });
  const stagingRoot = path.join(allowedTargetRoot, `.restore-${randomUUID()}`);
  const stagedDatabase = path.join(stagingRoot, databaseFilename);
  const stagedUploads = path.join(stagingRoot, "uploads");
  await mkdir(stagedUploads, { recursive: true });
  try {
    await copyFile(path.join(root, manifest.database.filename), stagedDatabase);
    for (const file of manifest.uploads.files) {
      const target = path.join(stagedUploads, ...file.storageKey.split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(root, "uploads", ...file.storageKey.split("/")), target);
    }
    await input.onPhase?.("uploads-copy-complete", { uploadRoot: stagedUploads });
    const stagedDatabaseBytes = await readFile(stagedDatabase);
    if (stagedDatabaseBytes.length !== manifest.database.bytes || sha256(stagedDatabaseBytes) !== manifest.database.sha256) {
      throw new Error("Staged restore database checksum or size validation failed.");
    }
    const stagedFiles = await listFiles(stagedUploads);
    if (
      manifest.uploads.files.map((file) => file.storageKey).sort().join("\n") !==
        stagedFiles.map((file) => file.storageKey).sort().join("\n")
    ) {
      throw new Error("Staged restore validation failed.");
    }
    for (const file of manifest.uploads.files) {
      const target = safeArtifactPath(stagedUploads, file.storageKey);
      const info = await assertRegularFile(target, `Staged restore upload ${file.storageKey}`);
      const bytes = await readFile(target);
      if (info.size !== file.bytes || bytes.length !== file.bytes || sha256(bytes) !== file.sha256) {
        throw new Error(`Staged restore upload checksum or size validation failed: ${file.storageKey}`);
      }
    }
    await mkdir(path.dirname(databasePath), { recursive: true });
    await mkdir(path.dirname(uploadRoot), { recursive: true });
    await rename(stagedDatabase, databasePath);
    try {
      await rename(stagedUploads, uploadRoot);
    } catch (error) {
      await rm(databasePath, { force: true });
      throw error;
    }
    const restoredDatabaseValidation = await databaseValidation(databasePath, manifest);
    if (JSON.stringify(restoredDatabaseValidation.rowCounts) !== JSON.stringify(sourceDatabase.rowCounts)) {
      throw new Error("Restored protected table row counts do not match the verified source backup.");
    }
    return {
      backupProfile: manifest.backupProfile,
      sourceManagedUploadsState: manifest.schemaCapabilities.managedUploadsState,
      integrityCheck: restoredDatabaseValidation.integrityCheck,
      foreignKeyViolations: restoredDatabaseValidation.foreignKeyViolations,
      mediaAssetCount: manifest.uploads.mediaAssetCount,
      uploadFileCount: stagedFiles.length,
      rowCounts: restoredDatabaseValidation.rowCounts,
      sourceRowCounts: sourceDatabase.rowCounts,
    };
  } finally {
    await rm(stagingRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
