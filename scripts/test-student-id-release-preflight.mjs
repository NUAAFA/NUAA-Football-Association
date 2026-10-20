import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, realpath, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

async function main() {
  const root = await mkdtemp(path.join(await realpath(os.tmpdir()), "nuaafa-readonly-preflight-"));
  const databasePath = path.join(root, "synthetic.db");
  process.env.DATABASE_URL = `file:${databasePath}`;
  const db = new DatabaseSync(databasePath);
  const script = path.resolve("scripts/student-id-release-preflight.mjs");
  const { getRefereeStudentIdCompatibility } = await import("../src/lib/student-id.ts");
  const { prisma } = await import("../src/lib/prisma.ts");
  const { runPreflight } = await import("./student-id-release-preflight.mjs");
  const digest = async () => createHash("sha256").update(await readFile(databasePath)).digest("hex");
  const run = (file = databasePath, args = [`--database=${file}`]) => {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 35_000 });
    assert.equal(result.error, undefined);
    const report = JSON.parse(result.stdout);
    assert(Object.values(report).every((value) => typeof value === "number"), "Output must contain counts/flags only.");
    assert(!`${result.stdout}${result.stderr}`.includes(root), "Diagnostics leaked a database path.");
    assert(!`${result.stdout}${result.stderr}`.includes("SYNTHETIC"), "Diagnostics leaked a student ID.");
    return { ...result, report };
  };
  try {
    const migrations = (await readdir("prisma/migrations", { withFileTypes: true }))
      .filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
    assert.equal(migrations.length, 17);
    for (const entry of migrations) db.exec(await readFile(path.join("prisma/migrations", entry.name, "migration.sql"), "utf8"));
    const insert = db.prepare('INSERT INTO "Referee" (id, publicCode, name, status, studentId, updatedAt) VALUES (?, ?, ?, ?, ?, ?)');
    const fixtures = [
      ["SYNTHETIC001", "ACTIVE"], [" SYNTHETIC002 ", "ACTIVE"],
      ["synthetic003", "ACTIVE"], ["ＳＹＮＴＨＥＴＩＣ００４", "ACTIVE"],
      [" SYNTHETIC001 ", "INACTIVE"], [null, "ACTIVE"], ["   ", "ACTIVE"],
      [null, "INACTIVE"], [" synthetic005 ", "INACTIVE"], ["SYNTHETIC005", "ARCHIVED"],
      ["synthetic006", "PENDING_ACTIVATION"],
    ];
    for (let index = 0; index <= fixtures.length; index++) {
      const before = await digest();
      const expected = await getRefereeStudentIdCompatibility();
      const result = run();
      assert.deepEqual(result.report, { ...expected, scanComplete: 1, readOnlyVerified: 1, releaseAllowed: Number(expected.unsafeLoginMigrationBlockers === 0) });
      assert.equal(result.status, expected.unsafeLoginMigrationBlockers === 0 ? 0 : 1);
      assert.equal(await digest(), before, "Read-only scan changed the synthetic database.");
      if (index < fixtures.length) {
        const [studentId, status] = fixtures[index];
        insert.run(`fixture-${index}`, `PREFLIGHT-${index}`, "Synthetic fixture", status, studentId, "2026-10-09T00:00:00Z");
      }
    }
    const readonly = new DatabaseSync(databasePath, { readOnly: true });
    assert.throws(() => readonly.exec('UPDATE "Referee" SET studentId = NULL'), /readonly/i);
    readonly.close();
    const missing = path.join(root, "missing.db");
    assert.equal(run(missing).status, 2);
    await assert.rejects(readFile(missing), /ENOENT/);
    const linked = path.join(root, "linked.db");
    await symlink(databasePath, linked);
    assert.equal(run(linked).status, 2);
    for (const args of [[], ["--database=relative.db"], [`--database=${databasePath}`, "--unknown"], ["--database=:memory:"]]) {
      assert.equal(run(databasePath, args).status, 2);
    }
    const malformed = path.join(root, "malformed.db");
    const bad = new DatabaseSync(malformed);
    bad.exec('CREATE TABLE "Referee" (status TEXT, studentId TEXT); INSERT INTO "Referee" VALUES (\'UNKNOWN\', \'SYNTHETIC007\')');
    assert.equal(run(malformed).status, 2);
    bad.exec('DELETE FROM "Referee"; INSERT INTO "Referee" VALUES (\'ACTIVE\', zeroblob(20))');
    assert.equal(run(malformed).status, 2);
    bad.exec('DELETE FROM "Referee"; WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x < 250001) INSERT INTO "Referee" SELECT \'ACTIVE\', \'SYNTHETIC\' || x FROM n');
    assert.equal(run(malformed).status, 2);
    bad.close();
    const schemaMissing = path.join(root, "missing-schema.db");
    new DatabaseSync(schemaMissing).close();
    assert.equal(run(schemaMissing).status, 2);
    db.exec("BEGIN EXCLUSIVE");
    try {
      const blocked = run();
      assert.equal(blocked.status, 2);
      assert.deepEqual(blocked.report, { scanComplete: 0, readOnlyVerified: 0, releaseAllowed: 0 });
    } finally { db.exec("ROLLBACK"); }
    assert.equal((await runPreflight(databasePath, 1)).releaseAllowed, 0, "Timeout must fail closed.");
    // WAL rows must be scanned without checkpointing or ignoring the live journal.
    db.exec('PRAGMA journal_mode = WAL; INSERT INTO "Referee" (id, publicCode, name, status, studentId, updatedAt) VALUES (\'wal\', \'WAL\', \'Synthetic\', \'ACTIVE\', NULL, \'2026-10-09T00:00:00Z\')');
    const walBefore = await readFile(`${databasePath}-wal`);
    assert.equal(run().report.activeMissingStudentId, 3);
    assert.deepEqual(await readFile(`${databasePath}-wal`), walBefore);
    console.log("PASS: 17-migration fixtures; corrected semantics parity; no database/WAL changes; read-only write rejection; count-only output; blockers, missing/schema/type/path/bound/timeout failures block release.");
  } finally {
    await prisma.$disconnect();
    db.close();
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
