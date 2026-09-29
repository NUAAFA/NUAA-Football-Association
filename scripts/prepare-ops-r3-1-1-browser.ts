import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../src/generated/prisma-v29/client";
import { parseCompetitionImportDocx } from "../src/lib/competition-import-docx";

async function main() {
  const databasePath = process.env.NUAAFA_OPS_BROWSER_DATABASE_PATH;
  if (!databasePath || !path.isAbsolute(databasePath) || !path.resolve(databasePath).startsWith(path.resolve(os.tmpdir()) + path.sep)) {
    throw new Error("NUAAFA_OPS_BROWSER_DATABASE_PATH must point to a disposable database under the system temp directory.");
  }
  const fixture = path.resolve("scripts/fixtures/ops-r3-1-1/2026-09-29_06.43.05-65a5f60ea71e6a7385071a16fed8e472.docx");
  const parsed = parseCompetitionImportDocx(await readFile(fixture));
  const url = `file:${databasePath.replaceAll("\\", "/")}`;
  const prisma = new PrismaClient({ adapter: new PrismaLibSql({ url }) });
  try {
    const competition = await prisma.competition.create({ data: { slug: `ops-r3-1-1-docx-browser-${Date.now()}`, name: "OPS-R3.1.1 DOCX 隔离验收赛事", campus: "隔离", format: "FUTSAL", status: "ONGOING" } });
    const stage = await prisma.competitionStage.create({ data: { competitionId: competition.id, name: "小组赛", type: "GROUP" } });
    for (const [index, groupName] of ["A组", "B组"].entries()) {
      const group = await prisma.competitionGroup.create({ data: { stageId: stage.id, name: groupName, sortOrder: index } });
      for (let round = 1; round <= 5; round += 1) {
        await prisma.competitionRound.create({ data: { stageId: stage.id, groupId: group.id, name: `第${round}轮`, sortOrder: round } });
      }
      const names = new Set(parsed.rows.filter((row) => row.values.group === groupName).flatMap((row) => [String(row.values.homeTeam), String(row.values.awayTeam)]));
      for (const name of names) {
        const team = await prisma.team.create({ data: { competitionId: competition.id, name } });
        await prisma.teamGroupMembership.create({ data: { teamId: team.id, stageId: stage.id, groupId: group.id } });
      }
    }
    const knockout = await prisma.competitionStage.create({ data: { competitionId: competition.id, name: "淘汰赛", type: "KNOCKOUT" } });
    const quarter = await prisma.competitionRound.create({ data: { stageId: knockout.id, name: "1/4决赛", sortOrder: 1 } });
    await prisma.competitionRound.create({ data: { stageId: knockout.id, name: "半决赛", sortOrder: 2 } });
    const teams = await prisma.team.findMany({ where: { competitionId: competition.id }, orderBy: { name: "asc" }, take: 2 });
    await prisma.match.create({ data: { slug: `ops-r3-1-1-manual-result-${Date.now()}`, competitionId: competition.id, stage: knockout.name, stageId: knockout.id, round: quarter.name, roundId: quarter.id, matchNumber: 31, homeTeamId: teams[0].id, awayTeamId: teams[1].id, kickoff: new Date("2030-10-01T10:00:00Z"), venue: "隔离足球场", status: "COMPLETED", homeScore: 2, awayScore: 1 } });
    console.log(JSON.stringify({ competitionId: competition.id, knockoutStageId: knockout.id, groupMatches: parsed.rows.length, referenceRows: parsed.referenceRows.length, manualCompletedMatches: 1 }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
