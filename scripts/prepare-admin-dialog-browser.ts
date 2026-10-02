import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function main() {
  const root = await realpath(process.env.OPS_R313_ROOT!);
  assert.equal(path.dirname(root), await realpath(os.tmpdir()));
  assert(path.basename(root).startsWith("nuaafa-ops-r313-"));
  const info = JSON.parse(await readFile(path.join(root, "fixture.json"), "utf8"));
  process.env.DATABASE_URL = info.databaseUrl;
  const { prisma } = await import("../src/lib/prisma");
  try {
    await prisma.affiliationUnit.createMany({ data: Array.from({ length: 40 }, (_, i) => ({ name: `弹窗验收学院${String(i + 1).padStart(2, "0")}`, type: "COLLEGE" as const })) });
    await prisma.competitionRound.createMany({ data: Array.from({ length: 40 }, (_, i) => ({ stageId: info.stageId, name: `维护轮次${i + 1}`, sortOrder: i + 1 })) });
    await prisma.team.createMany({ data: Array.from({ length: 30 }, (_, i) => ({ competitionId: info.competitionId, name: `弹窗移除验收${i + 1}` })) });
    console.log("Prepared isolated long dialog fixtures (40 units, 40 rounds, 30 safe teams).");
  } finally { await prisma.$disconnect(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
