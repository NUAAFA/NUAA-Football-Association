import assert from "node:assert/strict";
import { readFile, readdir, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";

async function main() {
  const root = await realpath(process.env.ADMIN_ACCOUNTS_TEST_ROOT!);
  assert.equal(path.dirname(root), await realpath(os.tmpdir()));
  assert(path.basename(root).startsWith("nuaafa-admin-accounts-"));
  process.env.DATABASE_URL = `file:${path.join(root, "test.db")}`;
  const client = createClient({ url: process.env.DATABASE_URL });
  for (const entry of (await readdir("prisma/migrations", { withFileTypes: true })).filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    await client.executeMultiple(await readFile(path.join("prisma/migrations", entry.name, "migration.sql"), "utf8"));
  }
  client.close();
  const { prisma } = await import("../src/lib/prisma");
  const { hashPassword } = await import("../src/lib/referee-security");
  const passwordHash = await hashPassword("Browser-Isolated-Password-2026!");
  try {
    for (const [username, displayName, roles] of [
      ["nuaafa", "NUAAFA", ["SUPER_ADMIN"]],
      ["hb01", "HB", ["SUPER_ADMIN"]],
      ["wyx01", "WYX", ["CONTENT_EDITOR"]],
      ["ymx001", "YMX", ["COMPETITION_ADMIN", "REFEREE_ADMIN"]],
    ] as const) {
      await prisma.adminAccount.create({ data: { id: `test-${username}`, username, displayName, passwordHash, role: roles.some(role => role === "SUPER_ADMIN") ? "SUPER_ADMIN" : "REFEREE_MANAGER", unifiedRoles: { create: roles.map(role => ({ role })) } } });
    }
    console.log("Prepared disposable admin account fixture.");
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
