import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClient } from "@libsql/client";

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "nuaafa-student-id-compatibility-"));
  process.env.DATABASE_URL = `file:${path.join(root, "fixture.db")}`;
  const sql = createClient({ url: process.env.DATABASE_URL });
  let disconnect: (() => Promise<void>) | undefined;
  try {
    const entries = (await readdir(path.resolve("prisma/migrations"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      await sql.executeMultiple(await readFile(path.resolve("prisma/migrations", entry.name, "migration.sql"), "utf8"));
    }
    const { prisma } = await import("../src/lib/prisma");
    disconnect = () => prisma.$disconnect();
    const { getRefereeStudentIdCompatibility } = await import("../src/lib/student-id");
    const { authenticateRefereeCredentials } = await import("../src/lib/referee-credentials");
    const { hashPassword } = await import("../src/lib/referee-security");
    const password = "Disposable-Compatibility-2026!";
    const passwordHash = await hashPassword(password);
    let sequence = 0;
    const create = (studentId: string | null, status: "ACTIVE" | "INACTIVE" = "ACTIVE") =>
      prisma.referee.create({ data: {
        publicCode: `COMPAT-${++sequence}`, name: "Synthetic compatibility fixture",
        studentId, status, passwordHash, mustChangePassword: false,
      } });
    const canonical = await create("CG20990001");
    assert.equal((await authenticateRefereeCredentials(" ｃｇ２０９９０００１ ", password))?.id, canonical.id);
    assert.equal(await authenticateRefereeCredentials("CG20990001", "wrong password"), null);
    assert.equal((await getRefereeStudentIdCompatibility()).unsafeLoginMigrationBlockers, 0);

    const whitespace = await create(" CG20990002 ");
    assert.equal(await authenticateRefereeCredentials("CG20990002", password), null);
    let report = await getRefereeStudentIdCompatibility();
    assert.equal(report.activeNonNormalizedStudentId, 1);
    assert.equal(report.unsafeLoginMigrationBlockers, 1);
    await create("cg20990003");
    await create("ＣＧ２０９９０００４");
    report = await getRefereeStudentIdCompatibility();
    assert.equal(report.activeNonNormalizedStudentId, 3);
    assert.equal(report.unsafeLoginMigrationBlockers, 3);

    await create(" CG20990001 ");
    report = await getRefereeStudentIdCompatibility();
    assert.equal(report.duplicateStudentIdGroups, 1);
    assert.equal(report.activeNonNormalizedStudentId, 4);
    assert.equal(report.unsafeLoginMigrationBlockers, 5);
    await create(null);
    await create("   ");
    await create(null, "INACTIVE");
    const inactive = await create(" cg20990005 ", "INACTIVE");
    assert.equal(await authenticateRefereeCredentials("CG20990005", password), null);
    report = await getRefereeStudentIdCompatibility();
    assert.equal(report.missingStudentId, 3);
    assert.equal(report.activeMissingStudentId, 2);
    assert.equal(report.activeNonNormalizedStudentId, 4);
    assert.equal(report.unsafeLoginMigrationBlockers, 7);

    await create("CG20990005", "INACTIVE");
    const before = await prisma.referee.findMany({ orderBy: { id: "asc" } });
    report = await getRefereeStudentIdCompatibility();
    assert.equal(report.duplicateStudentIdGroups, 2);
    assert.equal(report.unsafeLoginMigrationBlockers, 8);
    assert.deepEqual(await prisma.referee.findMany({ orderBy: { id: "asc" } }), before);
    assert.equal((await prisma.referee.findUniqueOrThrow({ where: { id: whitespace.id } })).studentId, " CG20990002 ");
    assert.equal((await prisma.referee.findUniqueOrThrow({ where: { id: inactive.id } })).studentId, " cg20990005 ");
    assert(Object.values(report).every((value) => typeof value === "number"), "Diagnostics must contain counts only.");
    console.log("PASS: canonical login, password verification, whitespace/case/NFKC blockers, normalized collisions, missing active IDs, inactive records, count-only diagnostics and zero scan mutations.");
  } finally {
    sql.close();
    await disconnect?.();
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
