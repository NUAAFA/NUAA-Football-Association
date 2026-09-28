import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@libsql/client";

async function removeDatabase(databasePath: string) {
  for (const target of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    await rm(target, { force: true, maxRetries: 10, retryDelay: 100 });
  }
}

async function runPrisma(args: string[], databaseUrl: string) {
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.resolve("node_modules/prisma/build/index.js"), ...args],
      {
      env: { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: "trace" },
      stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) throw new Error(`prisma ${args.join(" ")} failed with exit code ${exitCode}.`);
}

async function main() {
  const databasePath = path.resolve("prisma/r13a-fresh2.db");
  const prismaDirectory = `${path.resolve("prisma")}${path.sep}`;
  if (!databasePath.startsWith(prismaDirectory)) {
    throw new Error("Fresh rehearsal database escaped the workspace prisma directory.");
  }
  const earlierProbePath = path.resolve("prisma/r13a-cli-test.db");
  if (!earlierProbePath.startsWith(prismaDirectory)) {
    throw new Error("Earlier probe database escaped the workspace prisma directory.");
  }
  const prismaDatabaseUrl = "file:./prisma/r13a-fresh2.db";
  const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
  await removeDatabase(earlierProbePath);
  await removeDatabase(databasePath);
  try {
    await runPrisma(["migrate", "deploy"], prismaDatabaseUrl);
    await runPrisma(["migrate", "status"], prismaDatabaseUrl);
    const client = createClient({ url: databaseUrl });
    const integrity = await client.execute("PRAGMA integrity_check");
    const foreignKeys = await client.execute("PRAGMA foreign_key_check");
    client.close();
    if (integrity.rows[0].integrity_check !== "ok") throw new Error("Fresh database integrity_check failed.");
    if (foreignKeys.rows.length) throw new Error("Fresh database contains foreign key violations.");
    console.log(JSON.stringify({
      freshMigrationDeploy: true,
      prismaMigrateStatusUpToDate: true,
      integrityCheck: "ok",
      foreignKeyViolations: 0,
    }, null, 2));
  } finally {
    await removeDatabase(databasePath);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Fresh migration rehearsal failed.");
  process.exit(1);
});
