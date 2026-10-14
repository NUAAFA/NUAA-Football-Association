import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { createCombinedBackup, readAndVerifyCombinedBackup, restoreCombinedBackup } from "../src/lib/combined-backup";

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const cases: Array<{ name: string; status: "PASS" | "FAIL"; detail?: string }> = [];
async function missing(target: string) {
  await assert.rejects(access(target), { code: "ENOENT" });
}
async function main() {
  const supplied = process.env.NUAAFA_P2_TEST_ROOT;
  if (supplied) await mkdir(supplied, { recursive: true });
  const root = await realpath(supplied ?? await mkdtemp(path.join(os.tmpdir(), "nuaafa-p2-restore-")));
  assert(!root.startsWith("/srv/") && !root.startsWith("/etc/"), "Production targets forbidden");
  const source = path.join(root, "source.sqlite");
  const client = createClient({ url: `file:${source}` });
  const uploadKey = "2026/10/00000000-0000-0000-0000-000000000001.pdf";
  const uploadBytes = Buffer.from("%PDF-1.7\nSynthetic P2 preservation fixture\n");
  const uploads = path.join(root, "source-uploads");
  try {
    for (const migration of (await readdir("prisma/migrations")).filter((name) => /^\d/.test(name)).sort()) {
      await client.executeMultiple(await readFile(path.join("prisma/migrations", migration, "migration.sql"), "utf8"));
    }
    await client.execute("INSERT INTO Referee (id,publicCode,name,updatedAt) VALUES ('p2-ref','P2REF','Synthetic P2 Referee',CURRENT_TIMESTAMP)");
    await client.execute({
      sql: "INSERT INTO MediaAsset (id,storageKey,originalFilename,storedFilename,mimeType,size,updatedAt) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)",
      args: ["p2-media", uploadKey, "synthetic.pdf", path.basename(uploadKey), "application/pdf", uploadBytes.length],
    });
  } finally {
    client.close();
  }
  await mkdir(path.dirname(path.join(uploads, uploadKey)), { recursive: true });
  await writeFile(path.join(uploads, uploadKey), uploadBytes);
  const backup = path.join(root, "backup");
  await createCombinedBackup({ databaseUrl: `file:${source}`, uploadRoot: uploads, outputDirectory: backup });
  const verified = await readAndVerifyCombinedBackup(backup);
  const sourceHash = digest(await readFile(path.join(backup, "database.sqlite")));
  async function inventory(directory: string): Promise<Record<string, unknown>> {
    const entries: Record<string, unknown> = {};
    for (const name of (await readdir(directory)).sort()) {
      const target = path.join(directory, name);
      const info = await lstat(target);
      entries[name] = {
        dev: info.dev, ino: info.ino, mode: info.mode,
        content: info.isDirectory() ? await inventory(target) : digest(await readFile(target)),
      };
    }
    return entries;
  }
  const input = (allowed: string) => ({
    backupDirectory: backup, allowedTargetRoot: allowed,
    databasePath: path.join(allowed, "data", "db.sqlite"), uploadRoot: path.join(allowed, "files", "uploads"),
  });
  async function run(name: string, test: (allowed: string) => Promise<void>) {
    const allowed = path.join(root, name);
    try {
      await test(allowed);
      assert.equal(digest(await readFile(path.join(backup, "database.sqlite"))), sourceHash);
      assert.equal(digest(await readFile(path.join(backup, "uploads", uploadKey))), digest(uploadBytes));
      cases.push({ name, status: "PASS" });
      console.log(`P2 restore ${name}: PASS`);
    } catch (error) {
      cases.push({ name, status: "FAIL", detail: String(error) });
      console.error(`P2 restore ${name}: FAIL ${String(error)}`);
    }
  }
  await run("normal", async (allowed) => {
    const result = await restoreCombinedBackup(input(allowed));
    assert.equal(result.integrityCheck, "ok");
    assert.equal(result.foreignKeyViolations, 0);
    assert.deepEqual(result.rowCounts, verified.database.rowCounts);
    assert.equal(result.rowCounts.Referee, 1);
    assert.equal(result.rowCounts.MediaAsset, 1);
    assert.equal(digest(await readFile(input(allowed).databasePath)), sourceHash);
    assert.equal(digest(await readFile(path.join(input(allowed).uploadRoot, uploadKey))), digest(uploadBytes));
    const restoredClient = createClient({ url: `file:${input(allowed).databasePath}` });
    try {
      assert.equal(Object.values((await restoredClient.execute("PRAGMA integrity_check")).rows[0])[0], "ok");
      assert.equal((await restoredClient.execute("PRAGMA foreign_key_check")).rows.length, 0);
      assert.equal(Number((await restoredClient.execute("SELECT COUNT(*) AS n FROM Referee")).rows[0].n), 1);
    } finally {
      restoredClient.close();
    }
  });
  // Real CLI regression on an actual case-insensitive filesystem. Linux's
  // case-sensitive directories cannot stand in for this OS behavior.
  const caseAlias = path.join(root, "BACKUP");
  const aliasInfo = await stat(caseAlias).catch(() => undefined);
  const backupInfo = await stat(backup);
  const caseInsensitive = aliasInfo?.dev === backupInfo.dev && aliasInfo.ino === backupInfo.ino;
  if (caseInsensitive) {
    for (const kind of ["same-inode", "missing-descendant", "source-ancestor"] as const) {
      await run("case-alias-cli-" + kind, async () => {
        const before = await inventory(root);
        const allowed = kind === "same-inode" ? caseAlias
          : kind === "missing-descendant" ? path.join(caseAlias, "never-created")
          : root;
        const database = path.join(allowed, "uploads", "unexpected.sqlite");
        const result = await new Promise<{ code: number | null; signal: string | null; stdout: string; stderr: string }>((resolve, reject) => {
          const child = spawn(process.execPath, ["--import", "tsx", "scripts/restore-unified-data.ts",
            "--backup=" + backup, "--database=" + database, "--uploads=" + path.join(allowed, "restored-uploads")], {
            env: { ...process.env, NUAAFA_RESTORE_ISOLATED: "1", NUAAFA_RESTORE_TARGET_ROOT: allowed },
            stdio: ["ignore", "pipe", "pipe"],
          });
          let stdout = "", stderr = "";
          child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
          child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
          child.once("error", reject);
          child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
        });
        assert.notEqual(result.code, 0, result.stdout + result.stderr);
        assert.equal(result.signal, null);
        assert.equal(result.stdout.trim(), "", "Rejected CLI must not print success JSON");
        assert.match(result.stderr, /aliases|ancestor|overlap/);
        assert.deepEqual(await inventory(root), before, "Rejection must precede ANY mkdir/lock/staging/probe");
        await readAndVerifyCombinedBackup(backup);
      });
    }
  } else {
    console.log("Case-insensitive CLI alias checks: NOT RUN (filesystem is case-sensitive)");
  }
  for (const kind of ["database", "uploads"] as const) {
    for (const timing of ["existing", "during-staging"] as const) {
      await run(`${kind}-${timing}`, async (allowed) => {
        const request = input(allowed);
        const marker = Buffer.from(`DO_NOT_OVERWRITE_${kind}_${timing}`);
        const target = kind === "database" ? request.databasePath : path.join(request.uploadRoot, "sentinel");
        async function createMarker() {
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, marker, { flag: "wx" });
        }
        if (timing === "existing") await createMarker();
        await assert.rejects(restoreCombinedBackup({
          ...request, onPhase: async (phase) => {
            if (timing === "during-staging" && phase === "uploads-copy-complete") await createMarker();
          },
        }));
        assert.equal(digest(await readFile(target)), digest(marker));
        if (kind === "database") await missing(request.uploadRoot);
      });
    }
  }
  for (const timing of ["existing", "during-staging"] as const) {
    await run(`empty-uploads-${timing}`, async (allowed) => {
      const request = input(allowed);
      let originalIdentity: { dev: number; ino: number } | undefined;
      async function occupy() {
        await mkdir(request.uploadRoot, { recursive: true });
        const info = await stat(request.uploadRoot);
        originalIdentity = { dev: info.dev, ino: info.ino };
      }
      if (timing === "existing") await occupy();
      await assert.rejects(restoreCombinedBackup({ ...request, onPhase: async (phase) => {
        if (timing === "during-staging" && phase === "uploads-copy-complete") await occupy();
      } }));
      const after = await stat(request.uploadRoot);
      assert.deepEqual({ dev: after.dev, ino: after.ino }, originalIdentity);
      assert.deepEqual(await readdir(request.uploadRoot), []);
    });
  }
  for (const kind of ["root", "database-parent", "uploads-parent"] as const) {
    await run(`symlink-${kind}`, async (allowed) => {
      const outside = allowed + "-outside";
      await mkdir(outside);
      const marker = path.join(outside, "marker");
      await writeFile(marker, "UNCHANGED");
      const request = input(allowed);
      if (kind === "root") await symlink(outside, allowed, "dir");
      else {
        await mkdir(allowed);
        await symlink(outside, path.join(allowed, kind === "database-parent" ? "data" : "files"), "dir");
      }
      await assert.rejects(restoreCombinedBackup(request));
      assert.equal(await readFile(marker, "utf8"), "UNCHANGED");
      assert.deepEqual((await readdir(outside)).sort(), ["marker"]);
    });
  }
  for (const kind of ["root", "database-parent", "uploads-parent"] as const) {
    await run(`replace-${kind}`, async (allowed) => {
      const request = input(allowed);
      const outside = allowed + "-outside";
      const displaced = allowed + "-displaced";
      await mkdir(outside);
      await writeFile(path.join(outside, "marker"), "UNCHANGED");
      await assert.rejects(restoreCombinedBackup({
        ...request, onPhase: async (phase) => {
          if (phase !== "uploads-copy-complete") return;
          const target = kind === "root" ? allowed : path.join(allowed, kind === "database-parent" ? "data" : "files");
          await rename(target, displaced);
          await symlink(outside, target, "dir");
        },
      }));
      assert.deepEqual((await readdir(outside)).sort(), ["marker"]);
      await missing(path.join(displaced, kind === "uploads-parent" ? "uploads" : "db.sqlite"));
    });
  }
  await run("untrusted-writable-ancestor", async (allowed) => {
    await mkdir(allowed);
    await chmod(allowed, 0o777);
    const request = input(path.join(allowed, "nested"));
    await assert.rejects(restoreCombinedBackup(request));
    assert.deepEqual(await readdir(allowed), []);
    await chmod(allowed, 0o700);
  });
  await run("source-overlap", async (allowed) => {
    await assert.rejects(restoreCombinedBackup({ ...input(allowed), allowedTargetRoot: root,
      databasePath: path.join(backup, "new.sqlite") }));
    await missing(path.join(backup, "new.sqlite"));
    const alias = path.join(root, "source-alias");
    await symlink(backup, alias, "dir");
    await assert.rejects(restoreCombinedBackup({ ...input(allowed), backupDirectory: alias }));
    await mkdir(path.join(allowed, "data"), { recursive: true });
    await link(path.join(backup, "database.sqlite"), input(allowed).databasePath);
    await assert.rejects(restoreCombinedBackup(input(allowed)));
    assert.equal(digest(await readFile(input(allowed).databasePath)), sourceHash);
  });
  await run("target-overlap", async (allowed) => {
    await assert.rejects(restoreCombinedBackup({ ...input(allowed), uploadRoot: input(allowed).databasePath }));
    await missing(allowed);
  });
  await run("corrupt-stage-cleanup", async (allowed) => {
    const request = input(allowed);
    await assert.rejects(restoreCombinedBackup({
      ...request, onPhase: async (phase, stage) => {
        if (phase === "uploads-copy-complete") await writeFile(path.join(stage.uploadRoot, uploadKey), "CORRUPTED");
      },
    }));
    await missing(request.databasePath);
    await missing(request.uploadRoot);
    assert((await readdir(allowed)).some((name) => name.startsWith(".restore-")), "Failed staging must be retained safely");
  });
  await run("interrupt-before-publication", async (allowed) => {
    const request = input(allowed);
    const controller = new AbortController();
    await assert.rejects(restoreCombinedBackup({
      ...request, signal: controller.signal, onPhase: async (phase) => {
        if (phase === "uploads-copy-complete") controller.abort();
      },
    }));
    await missing(request.databasePath);
    await missing(request.uploadRoot);
  });
  await run("interrupt-after-database", async (allowed) => {
    const request = input(allowed);
    const controller = new AbortController();
    await assert.rejects(restoreCombinedBackup({
      ...request, signal: controller.signal, onPhase: async (phase) => {
        if (phase === "database-published") controller.abort();
      },
    }));
    assert.equal(digest(await readFile(request.databasePath)), sourceHash);
    await missing(request.uploadRoot);
    assert((await readdir(allowed)).some((name) => name.startsWith(".restore-")));
  });
  await run("replaced-publication-not-deleted", async (allowed) => {
    const request = input(allowed);
    const sentinel = Buffer.from("CONCURRENT_OCCUPANT_MUST_SURVIVE");
    await assert.rejects(restoreCombinedBackup({
      ...request, onPhase: async (phase) => {
        if (phase !== "database-published") return;
        await rename(request.databasePath, path.join(allowed, "owned-db-retained"));
        await writeFile(request.databasePath, sentinel, { flag: "wx" });
        await mkdir(request.uploadRoot);
        await writeFile(path.join(request.uploadRoot, "sentinel"), sentinel, { flag: "wx" });
      },
    }));
    assert.equal(digest(await readFile(request.databasePath)), digest(sentinel));
    assert.equal(digest(await readFile(path.join(request.uploadRoot, "sentinel"))), digest(sentinel));
    assert.equal(digest(await readFile(path.join(allowed, "owned-db-retained"))), sourceHash);
  });
  await run("concurrent-same-target", async (allowed) => {
    let release!: () => void;
    let ready!: () => void;
    const staged = new Promise<void>((resolve) => { ready = resolve; });
    const resume = new Promise<void>((resolve) => { release = resolve; });
    const first = restoreCombinedBackup({
      ...input(allowed), onPhase: async (phase) => {
        if (phase === "uploads-copy-complete") { ready(); await resume; }
      },
    });
    await staged;
    try {
      await assert.rejects(restoreCombinedBackup(input(allowed)));
    } finally {
      release();
    }
    await first;
    assert.equal(digest(await readFile(input(allowed).databasePath)), sourceHash);
    assert.equal(digest(await readFile(path.join(input(allowed).uploadRoot, uploadKey))), digest(uploadBytes));
  });
  await readAndVerifyCombinedBackup(backup);
  const result = { platform: process.platform, node: process.version, syntheticOnly: true, productionAccess: false,
    caseInsensitiveCliAliasChecks: caseInsensitive ? "PASS" : "NOT RUN",
    cases, sourceBackupSha256: sourceHash, sourceUploadSha256: digest(uploadBytes),
    stagingPolicy: "private staging and partial publications retained; no race-prone target deletion" };
  await writeFile(path.join(root, "results.json"), JSON.stringify(result, null, 2) + "\n");
  assert(cases.every((entry) => entry.status === "PASS"), "P2 targeted restore tests failed");
  console.log(JSON.stringify({ resultFile: path.join(root, "results.json"), cases: cases.length, status: "PASS" }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
