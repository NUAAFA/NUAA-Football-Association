import { randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../src/generated/prisma-v29/client";

import { assertMinimumFreeSpace, calculateBackupCapacity } from "../src/lib/backup-operations";
import { createCombinedBackup, protectedBusinessTables, restoreCombinedBackup } from "../src/lib/combined-backup";
import { scanMediaStorage } from "../src/lib/media-orphan-monitor";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function diagnostic(event: string, details: Record<string, unknown> = {}) {
  console.error(JSON.stringify({ restoreDiagnostic: { event, monotonicMs: performance.now(), pid: process.pid, ...details } }));
}

function childExited(child: ChildProcess) {
  return child.exitCode !== null || child.signalCode !== null;
}

async function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  diagnostic("migration_process_start", {
    command, args, cwd: process.cwd(), syntheticDatabaseUrl: env.DATABASE_URL,
    environment: Object.fromEntries(["NODE_ENV", "NODE_OPTIONS", "RUST_LOG", "JITI_FS_CACHE", "PATH", "TMPDIR"]
      .map((key) => [key, env[key] ?? null])),
  });
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => {
      diagnostic("migration_process_exit", { childPid: child.pid, exitCode, signal });
      resolve(exitCode ?? 1);
    });
  });
  if (code !== 0) throw new Error(`${path.basename(command)} ${args.join(" ")} exited ${code}.`);
}

async function runPrismaDeploy(databaseUrl: string) {
  if (process.platform === "win32") {
    await run(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npx.cmd prisma migrate deploy"], {
      ...process.env,
      DATABASE_URL: databaseUrl,
      RUST_LOG: "trace",
    });
    return;
  }
  await run(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], {
    ...process.env,
    DATABASE_URL: databaseUrl,
  });
}

async function availablePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function stopChild(child: ChildProcess) {
  if (childExited(child)) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (!childExited(child)) child.kill("SIGKILL");
}

async function rowCounts(client: PrismaClient) {
  const counts: Record<string, number> = {};
  for (const table of protectedBusinessTables) {
    const rows = await client.$queryRawUnsafe<Array<{ count: bigint | number }>>(`SELECT COUNT(*) AS count FROM "${table}"`);
    counts[table] = Number(rows[0]?.count ?? 0);
  }
  return counts;
}

async function seedIsolatedDataset(databaseUrl: string, uploadRoot: string) {
  const client = new PrismaClient({ adapter: new PrismaLibSql({ url: databaseUrl }) });
  const mediaBytes = Buffer.from("%PDF-1.4\n% isolated R1-3C restore rehearsal\n", "utf8");
  const storageKey = "2026/08/00000000-0000-0000-0000-000000000001.pdf";
  try {
    const admin = await client.adminAccount.create({
      data: {
        username: "r1-3c-rehearsal",
        displayName: "R1-3C Isolated Rehearsal",
        passwordHash: "PLACEHOLDER_NOT_A_REAL_SECRET",
        role: "SUPER_ADMIN",
      },
    });
    const competition = await client.competition.create({
      data: { slug: "r1-3c-rehearsal-cup", name: "R1-3C Rehearsal Cup", campus: "ISOLATED", format: "FUTSAL", status: "PREPARING", isTestData: true },
    });
    const [homeTeam, awayTeam] = await Promise.all([
      client.team.create({ data: { competitionId: competition.id, name: "Rehearsal Home" } }),
      client.team.create({ data: { competitionId: competition.id, name: "Rehearsal Away" } }),
    ]);
    const match = await client.match.create({
      data: {
        slug: "r1-3c-rehearsal-match",
        competitionId: competition.id,
        stage: "REHEARSAL",
        kickoff: new Date("2026-08-24T08:00:00.000Z"),
        venue: "ISOLATED",
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        status: "SCHEDULED",
        applicationWindowStatus: "CLOSED",
        isTestData: true,
      },
    });
    const referee = await client.referee.create({ data: { publicCode: "R1-3C-REF-001", name: "Restore Rehearsal Referee" } });
    await Promise.all([
      client.refereePositionCapability.create({ data: { refereeId: referee.id, format: "FUTSAL", positionKey: "REFEREE", status: "READY" } }),
      client.refereeAvailability.create({ data: { refereeId: referee.id, startAt: new Date("2026-08-24T00:00:00.000Z"), endAt: new Date("2026-08-25T00:00:00.000Z"), kind: "AVAILABLE" } }),
      client.refereeAdmissionApplication.create({ data: { name: "Restore Rehearsal Admission", studentId: "R13C0001", status: "PENDING" } }),
      client.refereeApplication.create({ data: { matchId: match.id, refereeId: referee.id, preferredPositions: "[\"REFEREE\"]" } }),
    ]);
    const appointment = await client.refereeAppointment.create({ data: { matchId: match.id, status: "DRAFT" } });
    await client.appointmentVersion.create({
      data: { appointmentId: appointment.id, revision: 0, status: "DRAFT", snapshot: "{}", createdByAdminId: admin.id },
    });
    await client.auditLog.create({
      data: { actorType: "SYSTEM", action: "R1_3C_RESTORE_REHEARSAL", entityType: "Backup", summary: "Isolated restore rehearsal seed" },
    });
    const media = await client.mediaAsset.create({
      data: {
        storageKey,
        originalFilename: "restore-rehearsal.pdf",
        storedFilename: "00000000-0000-0000-0000-000000000001.pdf",
        mimeType: "application/pdf",
        size: mediaBytes.length,
        visibility: "PUBLIC",
        metadata: { rehearsal: true },
      },
    });
    const post = await client.contentPost.create({
      data: {
        type: "NEWS",
        slug: "r1-3c-restored-news",
        title: "R1-3C Restored News",
        summary: "Isolated restore rehearsal content.",
        content: { schemaVersion: 1, document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Restore rehearsal passed." }] }] } },
        status: "PUBLISHED",
        authorAdminId: admin.id,
        source: "R1-3C isolated rehearsal",
        publishedAt: new Date("2026-08-20T08:30:00.000Z"),
      },
    });
    const target = path.join(uploadRoot, ...storageKey.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, mediaBytes, { flag: "wx", mode: 0o600 });
    await mkdir(path.join(uploadRoot, ".staging"), { recursive: true });
    return { client, mediaId: media.id, postSlug: post.slug, beforeCounts: await rowCounts(client) };
  } catch (error) {
    await client.$disconnect();
    throw error;
  }
}

async function main() {
  const buildIdPath = path.resolve(".next/BUILD_ID");
  if (!(await stat(buildIdPath)).isFile()) throw new Error("Run the production build before the restore application rehearsal.");
  const root = process.env.R1_3C_RESTORE_ROOT;
  const sourceDatabase = process.env.R1_3C_RESTORE_DATABASE_PATH;
  if (!root || !sourceDatabase || !path.isAbsolute(root) || !path.isAbsolute(sourceDatabase)) {
    throw new Error("R1-3C restore worker requires absolute isolated paths.");
  }
  const sourceUploads = path.join(root, "source-uploads");
  const backupDirectory = path.join(root, "backups", "rehearsal-backup");
  const restoreRoot = path.join(root, "restored");
  const restoredDatabase = path.join(restoreRoot, "data", "restored.sqlite");
  const restoredUploads = path.join(restoreRoot, "uploads");
  const databaseUrl = `file:${sourceDatabase.replaceAll("\\", "/")}`;
  let server: ChildProcess | null = null;
  let sourceClient: PrismaClient | null = null;
  let phase = "migrations";
  let shutdownRequested = false;
  diagnostic("runtime_identity", { node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch });
  try {
    await mkdir(sourceUploads, { recursive: true });
    await mkdir(path.dirname(backupDirectory), { recursive: true });
    await mkdir(restoreRoot, { recursive: true });
    await writeFile(sourceDatabase, "", { flag: "wx", mode: 0o600 });
    await runPrismaDeploy(databaseUrl);
    diagnostic("migrations_complete");
    phase = "seed_and_backup";
    const seeded = await seedIsolatedDataset(databaseUrl, sourceUploads);
    sourceClient = seeded.client;
    const cleanOrphanReport = await scanMediaStorage({ databaseUrl, uploadRoot: sourceUploads });
    assert(cleanOrphanReport.anomalyCount === 0, "Source dataset orphan preflight was not clean.");
    const capacity = await calculateBackupCapacity({ databasePath: sourceDatabase, uploadRoot: sourceUploads, retentionCount: 2 });
    const backupDisk = await assertMinimumFreeSpace(path.dirname(backupDirectory), capacity.backupStagingOverhead);

    const backupStarted = performance.now();
    const manifest = await createCombinedBackup({ databaseUrl, uploadRoot: sourceUploads, outputDirectory: backupDirectory });
    diagnostic("backup_complete");
    const backupDurationMs = Math.round(performance.now() - backupStarted);
    const restoreRequired = Math.ceil((manifest.database.bytes + manifest.uploads.totalBytes) * 1.1) + 1024 * 1024;
    const restoreDisk = await assertMinimumFreeSpace(restoreRoot, restoreRequired);
    const restoreStarted = performance.now();
    phase = "restore";
    const restored = await restoreCombinedBackup({ backupDirectory, databasePath: restoredDatabase, uploadRoot: restoredUploads, allowedTargetRoot: restoreRoot });
    diagnostic("restore_complete");
    const restoreDurationMs = Math.round(performance.now() - restoreStarted);
    assert(JSON.stringify(seeded.beforeCounts) === JSON.stringify(restored.rowCounts), "Protected table row counts changed after restore.");
    assert(JSON.stringify(restored.sourceRowCounts) === JSON.stringify(restored.rowCounts), "Source and restored database row counts differ.");
    const restoredMedia = await readFile(path.join(restoredUploads, "2026", "08", "00000000-0000-0000-0000-000000000001.pdf"));
    assert(restoredMedia.length === manifest.uploads.totalBytes, "Restored media bytes do not reconcile.");

    const port = await availablePort();
    const origin = `http://127.0.0.1:${port}`;
    const serverStarted = performance.now();
    phase = "application_startup";
    server = spawn(process.execPath, [path.resolve("node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "-p", String(port)], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: `file:${restoredDatabase.replaceAll("\\", "/")}`,
        NUAAFA_UPLOAD_DIR: restoredUploads,
        NUAAFA_CONTENT_SOURCE: "database",
        REFEREE_ADMIN_SESSION_SECRET: randomBytes(32).toString("base64url"),
        REFEREE_MEMBER_SESSION_SECRET: randomBytes(32).toString("base64url"),
        APP_BASE_URL: origin,
      },
      stdio: "inherit",
    });
    let serverError: Error | null = null;
    server.once("error", (error) => {
      serverError = error;
      diagnostic("server_spawn_error", { phase, errorClass: error.name });
    });
    server.once("exit", (exitCode, signal) => diagnostic("server_exit", { childPid: server?.pid, phase, exitCode, signal, shutdownRequested }));
    diagnostic("server_spawned", { childPid: server.pid });
    let applicationStartupDurationMs: number | null = null;
    let healthReadyDurationMs: number | null = null;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (serverError) throw serverError;
      if (childExited(server)) throw new Error(`Restored application exited ${server.exitCode ?? "by signal"} (${server.signalCode ?? "none"}) before health was ready.`);
      try {
        const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(2_000) });
        applicationStartupDurationMs ??= Math.round(performance.now() - serverStarted);
        const payload = await response.json() as { status?: string };
        if (response.status === 200 && payload.status === "ok") {
          healthReadyDurationMs = Math.round(performance.now() - serverStarted);
          break;
        }
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    assert(applicationStartupDurationMs !== null, "Restored application never accepted HTTP requests.");
    assert(healthReadyDurationMs !== null, "Restored application health never became ready.");
    phase = "http_checks";
    diagnostic("health_ready");
    const probes = [
      ["api_health", `${origin}/api/health`],
      ["news", `${origin}/news`],
      ["news_detail", `${origin}/news/${seeded.postSlug}`],
      ["content_detail", `${origin}/api/content/posts/${seeded.postSlug}`],
      ["media", `${origin}/media/${seeded.mediaId}`],
    ] as const;
    const checks = await Promise.all(probes.map(async ([probe, url]) => {
      diagnostic("http_probe_start", { probe });
      try {
        const response = await fetch(url);
        diagnostic("http_probe_complete", { probe, status: response.status });
        return response;
      } catch (error) {
        diagnostic("http_probe_failed", { probe, errorClass: error instanceof Error ? error.name : "unknown" });
        throw error;
      }
    }));
    const [apiHealth, news, newsDetail, contentDetail, media] = checks.map((response) => response.status);
    console.log(JSON.stringify({ rehearsalHttpProbe: { apiHealth, news, newsDetail, contentDetail, media } }));
    assert(apiHealth === 200, `/api/health returned ${apiHealth}.`);
    assert(news === 200, `/news returned ${news}.`);
    assert(newsDetail === 200, `DB-backed news detail returned ${newsDetail}.`);
    assert(contentDetail === 200, `DB-backed content API detail returned ${contentDetail}.`);
    assert(media === 200, `Restored media read returned ${media}.`);
    console.log(JSON.stringify({
      measuredRtoRehearsal: {
        backupDurationMs,
        restoreDurationMs,
        applicationStartupDurationMs,
        healthReadyDurationMs,
        totalRecoveryToHealthMs: restoreDurationMs + healthReadyDurationMs,
      },
      backupId: manifest.backupId,
      manifestVerified: true,
      checksumVerified: true,
      completionMarkerVerified: true,
      diskPreflight: { backup: backupDisk, restore: restoreDisk },
      databaseIntegrity: restored.integrityCheck,
      foreignKeyViolations: restored.foreignKeyViolations,
      protectedTableRowCountsBefore: seeded.beforeCounts,
      protectedTableRowCountsAfter: restored.rowCounts,
      applicationVerification: { health: 200, apiHealth, news, newsDetail, contentDetail, media },
    }, null, 2));
  } finally {
    phase = "cleanup";
    if (server) {
      shutdownRequested = !childExited(server);
      await stopChild(server);
    }
    await sourceClient?.$disconnect();
    diagnostic("worker_cleanup_complete");
  }
}

async function entry() {
  if (process.env.R1_3C_RESTORE_WORKER === "1") {
    await main();
    return;
  }
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "nuaafa-r1-3c-restore-")));
  const sourceDatabase = path.join(root, `synthetic-${randomUUID()}.db`);
  if (!sourceDatabase.startsWith(`${root}${path.sep}`)) throw new Error("R1-3C restore database escaped its isolated root.");
  const code = await new Promise<number>((resolve, reject) => {
    diagnostic("restore_worker_start", {
      command: process.execPath,
      args: [path.resolve("node_modules/tsx/dist/cli.mjs"), path.resolve("scripts/rehearse-unified-restore.ts")],
      cwd: process.cwd(), syntheticDatabasePath: sourceDatabase,
    });
    const child = spawn(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), path.resolve("scripts/rehearse-unified-restore.ts")], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        R1_3C_RESTORE_WORKER: "1",
        R1_3C_RESTORE_ROOT: root,
        R1_3C_RESTORE_DATABASE_PATH: sourceDatabase,
      },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => {
      diagnostic("restore_worker_exit", { childPid: child.pid, exitCode, signal });
      resolve(exitCode ?? 1);
    });
  });
  await Promise.all([
    ...[sourceDatabase, `${sourceDatabase}-wal`, `${sourceDatabase}-shm`].map((target) => rm(target, { force: true, maxRetries: 10, retryDelay: 100 })),
    rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  ]);
  if (code !== 0) process.exitCode = code;
}

entry().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : "Unified restore rehearsal failed.");
  process.exitCode = 1;
});
