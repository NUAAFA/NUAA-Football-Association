import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClient } from "@libsql/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../src/generated/prisma-v29/client";

import {
  applyBackupRetention,
  assertMinimumFreeSpace,
  calculateBackupCapacity,
  planBackupRetention,
} from "../src/lib/backup-operations";
import {
  combinedBackupCompletionFilename,
  combinedBackupProfiles,
  createCombinedBackup,
  readAndVerifyCombinedBackup,
  restoreCombinedBackup,
} from "../src/lib/combined-backup";
import { scanMediaStorage } from "../src/lib/media-orphan-monitor";
import { validateUploadPathBoundary, verifyUploadProvisioning } from "../src/lib/upload-provisioning";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function rejects(operation: () => Promise<unknown>, message: string) {
  try {
    await operation();
  } catch {
    return;
  }
  throw new Error(message);
}

async function runPrisma(databaseUrl: string) {
  const code = await new Promise<number>((resolve, reject) => {
    const command = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : process.execPath;
    const args = process.platform === "win32"
      ? ["/d", "/s", "/c", "npx.cmd prisma migrate deploy"]
      : [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"];
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: "trace" },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (exitCode) => resolve(exitCode ?? 1));
  });
  if (code !== 0) throw new Error(`Prisma migrate deploy exited ${code}.`);
}

const legacyMigrations = [
  "20260722013757_init_referee_center",
  "20260723124500_add_referee_sessions",
  "20260730090000_referee_operations_v24",
] as const;

async function createLegacyDatabase(databasePath: string) {
  const client = createClient({ url: `file:${databasePath.replaceAll("\\", "/")}` });
  try {
    await client.executeMultiple(`
      CREATE TABLE "_prisma_migrations" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "checksum" TEXT NOT NULL,
        "finished_at" DATETIME,
        "migration_name" TEXT NOT NULL,
        "logs" TEXT,
        "rolled_back_at" DATETIME,
        "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "applied_steps_count" INTEGER NOT NULL DEFAULT 0
      );
    `);
    for (let index = 0; index < legacyMigrations.length; index += 1) {
      const migration = legacyMigrations[index];
      await client.executeMultiple(await readFile(path.resolve("prisma/migrations", migration, "migration.sql"), "utf8"));
      await client.execute({
        sql: 'INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "started_at", "applied_steps_count") VALUES (?, ?, ?, ?, ?, 1)',
        args: [`legacy-${index + 1}`, "0".repeat(64), `2026-07-${String(22 + index).padStart(2, "0")}T00:01:00.000Z`, migration, `2026-07-${String(22 + index).padStart(2, "0")}T00:00:00.000Z`],
      });
    }
    await client.executeMultiple(`
      INSERT INTO "Competition" ("id", "slug", "name", "campus", "format", "status", "updatedAt") VALUES ('legacy-competition', 'legacy-cup', 'Legacy Cup', 'TIANMUHU', 'ELEVEN_A_SIDE', 'ACTIVE', CURRENT_TIMESTAMP);
      INSERT INTO "Team" ("id", "competitionId", "name") VALUES ('legacy-team-home', 'legacy-competition', 'Home'), ('legacy-team-away', 'legacy-competition', 'Away');
      INSERT INTO "Match" ("id", "slug", "competitionId", "stage", "kickoff", "venue", "homeTeamId", "awayTeamId", "status", "updatedAt") VALUES ('legacy-match', 'legacy-match', 'legacy-competition', 'GROUP', '2026-09-01T10:00:00.000Z', 'Pitch 1', 'legacy-team-home', 'legacy-team-away', 'SCHEDULED', CURRENT_TIMESTAMP);
      INSERT INTO "Referee" ("id", "publicCode", "name", "updatedAt") VALUES ('legacy-referee', 'LEGACY001', 'Legacy Referee', CURRENT_TIMESTAMP);
      INSERT INTO "RefereeApplication" ("id", "matchId", "refereeId", "preferredPositions", "updatedAt") VALUES ('legacy-application', 'legacy-match', 'legacy-referee', '["REFEREE"]', CURRENT_TIMESTAMP);
      INSERT INTO "RefereeAppointment" ("id", "matchId", "updatedAt") VALUES ('legacy-appointment', 'legacy-match', CURRENT_TIMESTAMP);
      INSERT INTO "AppointmentVersion" ("id", "appointmentId", "revision", "status", "snapshot") VALUES ('legacy-version', 'legacy-appointment', 0, 'DRAFT', '{}');
      INSERT INTO "AuditLog" ("id", "actorType", "action", "entityType", "entityId", "summary") VALUES ('legacy-audit', 'SYSTEM', 'LEGACY_FIXTURE', 'Match', 'legacy-match', 'Legacy fixture');
    `);
  } finally {
    client.close();
  }
}

async function rebindCompletionToManifest(backupDirectory: string) {
  const manifestBytes = await readFile(path.join(backupDirectory, "manifest.json"));
  const completionPath = path.join(backupDirectory, combinedBackupCompletionFilename);
  const completion = JSON.parse(await readFile(completionPath, "utf8")) as Record<string, unknown>;
  completion.manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
  await writeFile(completionPath, `${JSON.stringify(completion, null, 2)}\n`);
}

async function exerciseLegacyBackupBridge(root: string) {
  const databasePath = path.join(root, "legacy-source.sqlite");
  const absentUploads = path.join(root, "legacy-uploads-absent");
  const backupDirectory = path.join(root, "legacy-backup");
  await createLegacyDatabase(databasePath);
  const manifest = await createCombinedBackup({
    databaseUrl: `file:${databasePath.replaceAll("\\", "/")}`,
    uploadRoot: absentUploads,
    outputDirectory: backupDirectory,
    profile: combinedBackupProfiles.legacyPreEnablement,
  });
  assert(manifest.formatVersion === 4 && manifest.backupProfile === "LEGACY_PRE_ENABLEMENT", "Explicit legacy backup profile was not emitted.");
  assert(manifest.schemaCapabilities.managedUploadsState === "ABSENT", "Absent legacy upload state was not explicit.");
  assert(manifest.uploads.fileCount === 0 && manifest.uploads.mediaAssetCount === 0, "Legacy backup invented managed upload records.");
  const verified = await readAndVerifyCombinedBackup(backupDirectory);
  assert(verified.database.integrityCheck === "ok" && verified.database.foreignKeyViolations === 0, "Legacy backup database validation failed.");
  assert(Object.values(verified.database.rowCounts).every((count) => count > 0), "Representative legacy protected counts were not preserved.");

  const restoreDatabase = path.join(root, "legacy-restore", "restored.sqlite");
  const restoreUploads = path.join(root, "legacy-restore", "uploads");
  const restored = await restoreCombinedBackup({
    backupDirectory,
    databasePath: restoreDatabase,
    uploadRoot: restoreUploads,
    allowedTargetRoot: path.join(root, "legacy-restore"),
  });
  assert(restored.backupProfile === "LEGACY_PRE_ENABLEMENT" && restored.sourceManagedUploadsState === "ABSENT", "Legacy restore lost source capability metadata.");
  const restoredVerification = await readAndVerifyCombinedBackup(backupDirectory);
  assert(JSON.stringify(restoredVerification.database.rowCounts) === JSON.stringify(verified.database.rowCounts), "Legacy restore source counts changed during rehearsal.");

  const emptyUploads = path.join(root, "legacy-uploads-empty");
  await mkdir(emptyUploads);
  const emptyBackup = path.join(root, "legacy-backup-empty-uploads");
  const emptyManifest = await createCombinedBackup({
    databaseUrl: `file:${databasePath.replaceAll("\\", "/")}`,
    uploadRoot: emptyUploads,
    outputDirectory: emptyBackup,
    profile: combinedBackupProfiles.legacyPreEnablement,
  });
  assert(emptyManifest.schemaCapabilities.managedUploadsState === "PRESENT_EMPTY", "Empty legacy upload state was not explicit.");

  await writeFile(path.join(emptyUploads, "unexpected.txt"), "unexpected");
  await rejects(() => createCombinedBackup({
    databaseUrl: `file:${databasePath.replaceAll("\\", "/")}`,
    uploadRoot: emptyUploads,
    outputDirectory: path.join(root, "legacy-unexpected-upload"),
    profile: combinedBackupProfiles.legacyPreEnablement,
  }), "Legacy backup accepted a non-empty upload root.");
  await rm(path.join(emptyUploads, "unexpected.txt"));
  await rejects(() => createCombinedBackup({
    databaseUrl: `file:${databasePath.replaceAll("\\", "/")}`,
    uploadRoot: emptyUploads,
    outputDirectory: path.join(root, "legacy-modern-default"),
  }), "Modern default silently inferred the legacy backup profile.");

  const corruptDatabase = path.join(root, "legacy-corrupt-database");
  await cp(backupDirectory, corruptDatabase, { recursive: true });
  await writeFile(path.join(corruptDatabase, "database.sqlite"), "corrupt");
  await rejects(() => readAndVerifyCombinedBackup(corruptDatabase), "Legacy database corruption was accepted.");

  const invalidManifest = path.join(root, "legacy-invalid-manifest");
  await cp(backupDirectory, invalidManifest, { recursive: true });
  const invalidManifestPath = path.join(invalidManifest, "manifest.json");
  const invalidManifestJson = JSON.parse(await readFile(invalidManifestPath, "utf8"));
  invalidManifestJson.backupProfile = "MODERN_UNIFIED";
  await writeFile(invalidManifestPath, `${JSON.stringify(invalidManifestJson, null, 2)}\n`);
  await rebindCompletionToManifest(invalidManifest);
  await rejects(() => readAndVerifyCombinedBackup(invalidManifest), "Legacy manifest profile corruption was accepted.");

  const missingCompletion = path.join(root, "legacy-missing-completion");
  await cp(backupDirectory, missingCompletion, { recursive: true });
  await rm(path.join(missingCompletion, combinedBackupCompletionFilename));
  await rejects(() => readAndVerifyCombinedBackup(missingCompletion), "Legacy backup without COMPLETED was accepted.");

  const capabilityMismatch = path.join(root, "legacy-capability-mismatch");
  await cp(backupDirectory, capabilityMismatch, { recursive: true });
  const capabilityManifestPath = path.join(capabilityMismatch, "manifest.json");
  const capabilityManifest = JSON.parse(await readFile(capabilityManifestPath, "utf8"));
  capabilityManifest.schemaCapabilities.protectedTablesAbsent = capabilityManifest.schemaCapabilities.protectedTablesAbsent.filter((table: string) => table !== "RefereeAvailability");
  capabilityManifest.schemaCapabilities.protectedTablesPresent.push("RefereeAvailability");
  await writeFile(capabilityManifestPath, `${JSON.stringify(capabilityManifest, null, 2)}\n`);
  await rebindCompletionToManifest(capabilityMismatch);
  await rejects(() => readAndVerifyCombinedBackup(capabilityMismatch), "Legacy schema capability mismatch was accepted.");

  return {
    formatVersion: manifest.formatVersion,
    profile: manifest.backupProfile,
    migrations: manifest.migrations,
    schemaCapabilities: manifest.schemaCapabilities,
    verifiedCounts: verified.database.rowCounts,
    restoreVerified: true,
    absentAndEmptyUploadsExplicit: true,
    corruptDatabaseRejected: true,
    invalidManifestRejected: true,
    missingCompletionRejected: true,
    capabilityMismatchRejected: true,
    modernDefaultRemainedStrict: true,
  };
}

async function main() {
  const root = process.env.R1_3C_OPS_ROOT;
  if (!root || !path.isAbsolute(root)) throw new Error("R1-3C ops worker requires an absolute temporary root.");
  const databasePath = process.env.R1_3C_OPS_DATABASE_PATH;
  if (!databasePath || !path.isAbsolute(databasePath)) throw new Error("R1-3C ops worker requires an absolute database path.");
  const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
  const prismaDatabaseUrl = `file:./prisma/${path.basename(databasePath)}`;
  const uploadRoot = path.join(root, "uploads");
  const retentionRoot = path.join(root, "retention");
  let client: PrismaClient | null = null;
  try {
    await mkdir(uploadRoot, { recursive: true });
    await mkdir(path.join(uploadRoot, ".staging"), { recursive: true });
    await mkdir(retentionRoot, { recursive: true });
    await runPrisma(prismaDatabaseUrl);
    client = new PrismaClient({ adapter: new PrismaLibSql({ url: databaseUrl }) });
    const validBytes = Buffer.from("%PDF-1.4\nvalid\n", "utf8");
    const validKey = "2026/08/10000000-0000-0000-0000-000000000001.pdf";
    await client.mediaAsset.create({
      data: {
        storageKey: validKey,
        originalFilename: "valid.pdf",
        storedFilename: "10000000-0000-0000-0000-000000000001.pdf",
        mimeType: "application/pdf",
        size: validBytes.length,
        visibility: "PUBLIC",
      },
    });
    const validTarget = path.join(uploadRoot, ...validKey.split("/"));
    await mkdir(path.dirname(validTarget), { recursive: true });
    await writeFile(validTarget, validBytes, { flag: "wx", mode: 0o600 });

    const incompleteAfterDatabase = path.join(retentionRoot, "incomplete-after-database");
    await rejects(
      () => createCombinedBackup({
        databaseUrl,
        uploadRoot,
        outputDirectory: incompleteAfterDatabase,
        onPhase: (phase) => {
          if (phase === "database-snapshot-complete") throw new Error("Injected upload packaging failure.");
        },
      }),
      "Injected post-database failure did not fail backup.",
    );
    await rejects(() => readAndVerifyCombinedBackup(incompleteAfterDatabase), "Incomplete post-database backup was accepted.");

    const incompleteBeforeCompletion = path.join(retentionRoot, "incomplete-before-completion");
    await rejects(
      () => createCombinedBackup({
        databaseUrl,
        uploadRoot,
        outputDirectory: incompleteBeforeCompletion,
        onPhase: (phase) => {
          if (phase === "completion-publish") throw new Error("Injected completion publish failure.");
        },
      }),
      "Injected completion failure did not fail backup.",
    );
    await rejects(() => readAndVerifyCombinedBackup(incompleteBeforeCompletion), "Backup without final completion marker was accepted.");

    const generatedDates = [
      new Date("2026-08-21T01:00:00.000Z"),
      new Date("2026-08-22T01:00:00.000Z"),
      new Date("2026-08-23T01:00:00.000Z"),
    ];
    const validBackups: string[] = [];
    for (let index = 0; index < generatedDates.length; index += 1) {
      const target = path.join(retentionRoot, `valid-${index + 1}`);
      await createCombinedBackup({ databaseUrl, uploadRoot, outputDirectory: target, generatedAt: generatedDates[index] });
      validBackups.push(target);
    }
    const verified = await readAndVerifyCombinedBackup(validBackups[2]);
    assert(verified.manifest.formatVersion === 3, "Hardened backup manifest version was not emitted.");
    assert(verified.completion.backupId === verified.manifest.backupId, "Completion marker did not bind to manifest backup ID.");
    assert(verified.database.integrityCheck === "ok" && verified.database.foreignKeyViolations === 0, "Backup database validation failed.");

    const corruptBackup = path.join(root, "corrupt-backup");
    await createCombinedBackup({ databaseUrl, uploadRoot, outputDirectory: corruptBackup });
    await writeFile(path.join(corruptBackup, "database.sqlite"), Buffer.from("corrupt"));
    await rejects(() => readAndVerifyCombinedBackup(corruptBackup), "Corrupted backup checksum was accepted.");
    const legacyBackupBridge = await exerciseLegacyBackupBridge(root);

    const restoreTestsRoot = path.join(root, "restore-tests");
    await mkdir(restoreTestsRoot);
    const existingDatabase = path.join(restoreTestsRoot, "existing-restore.sqlite");
    const existingUploads = path.join(restoreTestsRoot, "existing-restore-uploads");
    await writeFile(existingDatabase, "DO_NOT_OVERWRITE");
    await mkdir(existingUploads);
    await rejects(
      () => restoreCombinedBackup({
        backupDirectory: validBackups[2],
        databasePath: existingDatabase,
        uploadRoot: existingUploads,
        allowedTargetRoot: restoreTestsRoot,
      }),
      "Restore overwrote an existing destination.",
    );
    assert((await readFile(existingDatabase, "utf8")) === "DO_NOT_OVERWRITE", "Existing restore destination was modified.");

    const stagedAllowRoot = path.join(root, "staged-allow-root");
    const outsideStagedDatabase = path.join(root, "outside-staged-database.sqlite");
    const insideStagedUploads = path.join(stagedAllowRoot, "uploads");
    await rejects(
      () => restoreCombinedBackup({
        backupDirectory: validBackups[2],
        databasePath: outsideStagedDatabase,
        uploadRoot: insideStagedUploads,
        allowedTargetRoot: stagedAllowRoot,
      }),
      "Restore accepted a database target outside the explicit staging root.",
    );
    await rejects(() => access(outsideStagedDatabase), "Outside staging target was written before rejection.");
    await rejects(() => access(insideStagedUploads), "Inside staging upload target was written after paired target rejection.");

    const overlappingRoot = path.join(root, "overlapping-restore-targets");
    await rejects(
      () => restoreCombinedBackup({
        backupDirectory: validBackups[2],
        databasePath: path.join(overlappingRoot, "database.sqlite"),
        uploadRoot: overlappingRoot,
        allowedTargetRoot: root,
      }),
      "Restore accepted overlapping database and upload targets.",
    );
    await rejects(() => access(overlappingRoot), "Overlapping restore target was written before rejection.");

    const sourceOverlapDatabase = path.join(validBackups[2], "restore-target.sqlite");
    const sourceOverlapUploads = path.join(root, "source-overlap-uploads");
    await rejects(
      () => restoreCombinedBackup({
        backupDirectory: validBackups[2],
        databasePath: sourceOverlapDatabase,
        uploadRoot: sourceOverlapUploads,
        allowedTargetRoot: root,
      }),
      "Restore accepted a target inside its source backup.",
    );
    await rejects(() => access(sourceOverlapDatabase), "Source-overlap restore target was written before rejection.");
    await rejects(() => access(sourceOverlapUploads), "Source-overlap upload target was written before rejection.");

    const restoreSymlinkReal = path.join(restoreTestsRoot, "restore-symlink-real");
    const restoreSymlinkTarget = path.join(restoreTestsRoot, "restore-symlink-target");
    const restoreSymlinkDatabase = path.join(restoreTestsRoot, "restore-symlink-database.sqlite");
    await mkdir(restoreSymlinkReal);
    await symlink(restoreSymlinkReal, restoreSymlinkTarget, process.platform === "win32" ? "junction" : "dir");
    await rejects(
      () => restoreCombinedBackup({
        backupDirectory: validBackups[2],
        databasePath: restoreSymlinkDatabase,
        uploadRoot: restoreSymlinkTarget,
        allowedTargetRoot: restoreTestsRoot,
      }),
      "Restore accepted an existing symlink destination.",
    );
    await rejects(() => access(restoreSymlinkDatabase), "Restore wrote its database before rejecting a symlink destination.");

    const corruptStagedDatabase = path.join(restoreTestsRoot, "corrupt-staged-restore.sqlite");
    const corruptStagedUploads = path.join(restoreTestsRoot, "corrupt-staged-restore-uploads");
    await rejects(
      () => restoreCombinedBackup({
        backupDirectory: validBackups[2],
        databasePath: corruptStagedDatabase,
        uploadRoot: corruptStagedUploads,
        allowedTargetRoot: restoreTestsRoot,
        onPhase: async (phase, staging) => {
          if (phase !== "uploads-copy-complete") return;
          const stagedUpload = path.join(staging.uploadRoot, ...validKey.split("/"));
          await writeFile(stagedUpload, Buffer.alloc(validBytes.length, 0x58));
        },
      }),
      "Corrupted staged restore upload was accepted.",
    );
    await rejects(() => access(corruptStagedDatabase), "Corrupted staged restore published the database destination.");
    await rejects(() => access(corruptStagedUploads), "Corrupted staged restore published the upload destination.");

    const malformed = path.join(retentionRoot, "malformed-backup");
    await mkdir(malformed);
    await writeFile(path.join(malformed, "manifest.json"), "not-json");
    const unknownFile = path.join(retentionRoot, "README-unrelated.txt");
    await writeFile(unknownFile, "unrelated");
    const symlinkTarget = path.join(root, "symlink-target");
    const symlinkEntry = path.join(retentionRoot, "symlink-backup");
    await mkdir(symlinkTarget);
    await symlink(symlinkTarget, symlinkEntry, process.platform === "win32" ? "junction" : "dir");
    const retentionPlan = await planBackupRetention({ backupRoot: retentionRoot, keepCount: 1 });
    assert(retentionPlan.keep.length === 1 && retentionPlan.deleteCandidates.length === 2, "Retention did not classify valid backups by age.");
    assert(retentionPlan.anomalies.some((item) => item.classification === "SYMLINK"), "Retention did not reject symlink entry.");
    assert(retentionPlan.anomalies.some((item) => item.classification === "UNKNOWN_ENTRY"), "Retention did not preserve unknown file.");
    assert(retentionPlan.anomalies.filter((item) => item.classification === "INCOMPLETE_OR_INVALID_BACKUP").length >= 3, "Retention did not reject incomplete and malformed entries.");
    await rejects(
      () => applyBackupRetention({ backupRoot: retentionRoot, keepCount: 1, confirmApply: true }),
      "Retention apply proceeded with unsafe entries.",
    );
    await access(unknownFile);
    const cleanRetentionRoot = path.join(root, "clean-retention");
    await mkdir(cleanRetentionRoot);
    for (let index = 0; index < validBackups.length; index += 1) {
      await cp(validBackups[index], path.join(cleanRetentionRoot, `valid-copy-${index + 1}`), { recursive: true });
    }
    const appliedRetention = await applyBackupRetention({ backupRoot: cleanRetentionRoot, keepCount: 1, confirmApply: true });
    if (!("deleted" in appliedRetention)) throw new Error("Retention apply unexpectedly returned a dry-run plan.");
    assert(appliedRetention.deleted.length === 2, "Retention did not delete exactly the approved isolated candidates.");
    assert((await planBackupRetention({ backupRoot: cleanRetentionRoot, keepCount: 1 })).keep.length === 1, "Retention did not preserve newest backup.");

    const missingKey = "2026/08/20000000-0000-0000-0000-000000000002.pdf";
    await client.mediaAsset.create({
      data: {
        storageKey: missingKey,
        originalFilename: "missing.pdf",
        storedFilename: "20000000-0000-0000-0000-000000000002.pdf",
        mimeType: "application/pdf",
        size: 9,
      },
    });
    const orphanKey = "2026/08/30000000-0000-0000-0000-000000000003.pdf";
    const orphanTarget = path.join(uploadRoot, ...orphanKey.split("/"));
    await mkdir(path.dirname(orphanTarget), { recursive: true });
    await writeFile(orphanTarget, "%PDF-orphan");
    const staleStaging = path.join(uploadRoot, ".staging", "stale.upload");
    await writeFile(staleStaging, "stale");
    await utimes(staleStaging, new Date("2026-08-20T00:00:00.000Z"), new Date("2026-08-20T00:00:00.000Z"));
    const invalidTarget = path.join(uploadRoot, "unexpected.txt");
    await writeFile(invalidTarget, "unexpected");
    const invalidSymlink = path.join(uploadRoot, "unsafe-link");
    await symlink(path.dirname(validTarget), invalidSymlink, process.platform === "win32" ? "junction" : "dir");
    const orphanReport = await scanMediaStorage({
      databaseUrl,
      uploadRoot,
      now: new Date("2026-08-24T00:00:00.000Z"),
      staleStagingAgeMs: 60 * 60 * 1_000,
    });
    assert(orphanReport.counts.DB_RECORD_MISSING_FILE === 1, "Missing physical file was not classified.");
    assert(orphanReport.counts.FILE_WITHOUT_DB_RECORD === 1, "Physical orphan was not classified.");
    assert(orphanReport.counts.STALE_STAGING_FILE === 1, "Stale staging file was not classified.");
    assert(orphanReport.counts.INVALID_STORAGE_PATH === 2, "Invalid storage entries were not classified.");
    await Promise.all([access(orphanTarget), access(staleStaging), access(invalidTarget), access(invalidSymlink)]);

    await rejects(
      () => calculateBackupCapacity({ databasePath, uploadRoot, retentionCount: 14 }),
      "Capacity scan followed an unsafe media symlink.",
    );
    const capacity = await calculateBackupCapacity({
      databaseBytes: (await stat(databasePath)).size,
      uploadBytes: validBytes.length,
      retentionCount: 14,
      thresholds: { warningPercent: 20, criticalPercent: 10 },
    });
    assert(capacity.currentDatasetEstimate > 0 && capacity.recommendedMinimumFreeSpace > capacity.retentionEstimate, "Capacity formula omitted temporary or reserve overhead.");
    const disk = await assertMinimumFreeSpace(root, 1);
    assert(disk.freeBytes > 0, "Disk free-space preflight failed.");
    assert(validateUploadPathBoundary(uploadRoot, validKey), "Valid storage key escaped upload root.");
    assert(!validateUploadPathBoundary(uploadRoot, "../../escape.pdf"), "Traversal storage key was accepted.");
    let provisioning: Awaited<ReturnType<typeof verifyUploadProvisioning>> | null = null;
    if (process.platform !== "linux") {
      provisioning = await verifyUploadProvisioning({
        configuredPath: uploadRoot,
        expectedPath: uploadRoot,
        expectedOwner: "nuaafa",
        expectedGroup: "nuaafa",
        expectedMode: "0700",
        minimumFreeBytes: 1,
      });
      assert(!provisioning.ownership.enforced, "Non-Linux rehearsal incorrectly claimed POSIX ownership enforcement.");
    }

    const [backupUnit, retentionUnit, timerUnit] = await Promise.all([
      readFile(path.resolve("ops/systemd/nuaafa-unified-backup.service"), "utf8"),
      readFile(path.resolve("ops/systemd/nuaafa-unified-retention-dry-run.service"), "utf8"),
      readFile(path.resolve("ops/systemd/nuaafa-unified-backup.timer"), "utf8"),
    ]);
    for (const unit of [backupUnit, retentionUnit]) {
      assert(unit.includes("NUAAFA_BACKUP_ROOT=/srv/nuaafa/shared/backups/unified"), "Combined backup unit did not use the dedicated unified root.");
      assert(unit.includes("EnvironmentFile=/srv/nuaafa/shared/.env.production"), "Combined backup unit did not use the reviewed production environment file.");
      assert(!/NUAAFA_BACKUP_ROOT=\/srv\/nuaafa\/shared\/backups(?:\r?\n|$)/.test(unit), "Combined backup unit could scan the parent DB-only backup root.");
    }
    assert(timerUnit.includes("Description=PROPOSED") && timerUnit.includes("OnCalendar=*-*-* 03:00:00 Asia/Shanghai"), "Timer template did not remain an explicit Asia/Shanghai proposal.");
    assert(timerUnit.includes("RandomizedDelaySec=30m") && timerUnit.includes("Persistent=true"), "Timer proposal contract changed.");

    console.log(JSON.stringify({
      combinedBackup: {
        formatVersion: verified.manifest.formatVersion,
        backupId: verified.manifest.backupId,
        completionMarker: true,
        manifestChecksumBinding: true,
        databaseIntegrity: verified.database.integrityCheck,
        foreignKeyViolations: verified.database.foreignKeyViolations,
        postDatabaseFailureRejected: true,
        preCompletionFailureRejected: true,
        corruptionRejected: true,
        existingRestoreDestinationRejected: true,
        stagedUploadCorruptionRejectedBeforePublish: true,
        stagingOutsideAllowlistRejected: true,
        databaseUploadsOverlapRejected: true,
        sourceTargetOverlapRejected: true,
        symlinkDestinationRejected: true,
      },
      legacyBackupBridge,
      retention: {
        dryRun: true,
        malformedRejected: true,
        unknownPreserved: true,
        symlinkRejected: true,
        incompleteRejected: true,
        isolatedApplyDeleted: appliedRetention.deleted.length,
      },
      orphanMonitoring: {
        exitCodeContract: { clean: 0, anomaly: 2, scannerFailure: 3 },
        report: orphanReport,
        automaticDeletion: false,
      },
      capacity,
      diskPreflight: disk,
      uploadProvisioning: {
        frozenContract: { path: "/srv/nuaafa/shared/uploads", owner: "nuaafa", group: "nuaafa", mode: "0700" },
        pathTraversalRejected: true,
        localReadOnlyVerification: provisioning,
      },
      operationalTemplates: {
        combinedRoot: "/srv/nuaafa/shared/backups/unified",
        parentDbOnlyBackupRootExcluded: true,
        retentionCountProposed: 14,
        timerProposed: { onCalendar: "03:00 Asia/Shanghai", randomizedDelay: "30m", persistent: true },
      },
    }, null, 2));
  } finally {
    await client?.$disconnect();
  }
}

async function entry() {
  if (process.env.R1_3C_OPS_WORKER === "1") {
    await main();
    return;
  }
  const databasePath = path.resolve("prisma", `r1-3c-ops-${randomUUID()}.db`);
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "nuaafa-r1-3c-ops-")));
  const prismaRoot = `${path.resolve("prisma")}${path.sep}`;
  if (!databasePath.startsWith(prismaRoot)) throw new Error("R1-3C ops database escaped the workspace prisma directory.");
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), path.resolve("scripts/test-production-hardening.ts")], {
      cwd: process.cwd(),
      env: { ...process.env, R1_3C_OPS_WORKER: "1", R1_3C_OPS_DATABASE_PATH: databasePath, R1_3C_OPS_ROOT: root },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (exitCode) => resolve(exitCode ?? 1));
  });
  await Promise.all([
    ...[databasePath, `${databasePath}-wal`, `${databasePath}-shm`].map((target) => rm(target, { force: true, maxRetries: 10, retryDelay: 100 })),
    rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  ]);
  if (code !== 0) process.exitCode = code;
}

entry().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : "Production hardening tests failed.");
  process.exitCode = 1;
});
