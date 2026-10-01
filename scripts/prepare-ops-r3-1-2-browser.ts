import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
async function main() {
  const root = process.env.OPS_R312_ROOT!;
  assert(path.isAbsolute(root) && path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(root).startsWith("nuaafa-ops-r312-"));
  const fixture = JSON.parse(await readFile(path.join(root, "fixture.json"), "utf8"));
  process.env.DATABASE_URL = fixture.databaseUrl;
  const { prisma } = await import("../src/lib/prisma");
  const { hashPassword } = await import("../src/lib/referee-security");
  const { parseCompetitionImportDocx } = await import("../src/lib/competition-import-docx");
  const password = "R312-Isolated-only-verify!";
  const passwordHash = await hashPassword(password);
  try {
    await prisma.adminAccount.create({ data: { username: "r312-super", displayName: "R312隔离验收", passwordHash, role: "SUPER_ADMIN" } });
    await prisma.adminAccount.create({ data: { username: "r312-content", displayName: "R312内容权限隔离", passwordHash, role: "REFEREE_MANAGER", unifiedRoles: { create: { role: "CONTENT_EDITOR" } } } });
    const parsed = parseCompetitionImportDocx(await readFile("scripts/fixtures/ops-r3-1-1/2026-09-29_06.43.05-65a5f60ea71e6a7385071a16fed8e472.docx"));
    const competition = await prisma.competition.create({ data: { slug: "r312-docx-workflow", name: "R312 DOCX分组修复隔离", format: "FUTSAL", campus: "隔离", status: "ONGOING", publicPublished: true, homepageFeatured: true } });
    const stage = await prisma.competitionStage.create({ data: { competitionId: competition.id, name: "小组赛", type: "GROUP" } });
    const groups = [];
    for (let i = 0; i < 12; i++) groups.push(await prisma.competitionGroup.create({ data: { stageId: stage.id, name: `${String.fromCharCode(65 + i)}组`, sortOrder: i } }));
    for (const group of groups.slice(0, 2)) {
      for (let n = 1; n <= 5; n++) await prisma.competitionRound.create({ data: { stageId: stage.id, groupId: group.id, name: `第${n}轮`, sortOrder: n } });
      const names = new Set(parsed.rows.filter((r) => r.values.group === group.name).flatMap((r) => [String(r.values.homeTeam), String(r.values.awayTeam)]));
      for (const name of names) {
        const team = await prisma.team.create({ data: { competitionId: competition.id, name } });
        if (name !== "航空能动联队") await prisma.teamGroupMembership.create({ data: { stageId: stage.id, groupId: group.id, teamId: team.id } });
      }
    }
    fixture.docxCompetitionId = competition.id;
    await writeFile(path.join(root, "fixture.json"), JSON.stringify(fixture, null, 2));
    await writeFile(path.join(root, "accounts.json"), JSON.stringify({ username: "r312-super", password }, null, 2));
    console.log(JSON.stringify({ competitionId: fixture.competitionId, docxCompetitionId: competition.id, root }));
  } finally { await prisma.$disconnect(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
