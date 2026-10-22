import { createClient } from "@libsql/client";
import { mkdtemp, readdir, readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function check(ok: unknown, label: string): asserts ok { if (!ok) throw new Error(label); }
async function main() {
  const folder = await realpath(await mkdtemp(path.join(os.tmpdir(), "nuaafa-legacy-retirement-fictional-")));
  const url = `file:${folder}/fictional.sqlite`;
  process.env.DATABASE_URL = url;
  delete process.env.REFEREE_ADMIN_PASSWORD_HASH;
  const client = createClient({ url });
  try {
    for (const name of (await readdir("prisma/migrations")).sort()) {
      if (name === "migration_lock.toml") continue;
      await client.executeMultiple(await readFile(path.join("prisma/migrations", name, "migration.sql"), "utf8"));
    }
  } finally { client.close(); }
  const security = await import("../src/lib/referee-security");
  const credentials = await import("../src/lib/referee-credentials");
  const { prisma } = await import("../src/lib/prisma");
  const password = "FICTIONAL-Retirement-Password-Only-2026!";
  try {
    const hash = await security.hashPassword(password);
    await prisma.adminAccount.create({ data: { username: "fictional-retirement-admin", displayName: "Fictional Only", passwordHash: hash, role: "SUPER_ADMIN", isActive: true } });
    process.env.REFEREE_ADMIN_PASSWORD_HASH = hash;
    check(await credentials.verifyAdminCredentials(password), "fictional baseline legacy credential failed");
    const before = await credentials.authenticateAdminCredentials("fictional-retirement-admin", password);
    check(before?.role === "SUPER_ADMIN", "fictional named admin baseline failed");
    delete process.env.REFEREE_ADMIN_PASSWORD_HASH;
    check(!(await credentials.verifyAdminCredentials(password)), "retired fallback accepted password");
    let calls = 0;
    check(!(await credentials.verifyAdminCredentials(password, async (_submitted, stored) => { calls++; check(stored === security.DUMMY_PASSWORD_HASH, "missing fallback used real hash"); return true; })), "missing fallback bypassed eligibility");
    check(calls === 1, "retirement changed equivalent KDF invocation");
    const after = await credentials.authenticateAdminCredentials("fictional-retirement-admin", password);
    check(after?.id === before.id && after.role === "SUPER_ADMIN", "named admin changed after retirement");
    check(!(await credentials.authenticateAdminCredentials("", password)), "blank named identity accepted");
    check(!(await credentials.authenticateAdminCredentials("fictional-retirement-admin", "wrong-fictional-password")), "wrong named password accepted");
    check(await prisma.adminSession.count() === 0, "credential checks created a session");
    console.log(JSON.stringify({ status: "PASS", fictionalOnly: true, legacyBefore: true, legacyAfter: false, namedSuperAdminPreserved: true, missingFallbackKdfCalls: calls, sessionsCreated: 0, productionRead: false, applicationSourceChanged: false }));
  } finally { await prisma.$disconnect(); }
}
main().catch(() => { console.error("Legacy retirement fictional regression FAILED"); process.exitCode = 1; });
