import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../src/generated/prisma-v29/client";
import { comparePublicMatches, normalizeCompetitionLines, publicMatchProgress, splitCompetitionLines } from "../src/lib/competition-presentation";
import { readCompetitionCreateInput } from "../src/lib/referee-competition-input";
import { hashPassword } from "../src/lib/referee-security";
import type { PublicCompetitionMatch } from "../src/types/competition-center";

function verifyPresentation() {
  assert.deepEqual(splitCompetitionLines("天目湖校区、将军路校区"), ["天目湖校区", "将军路校区"]);
  assert.deepEqual(splitCompetitionLines("西操（东操、南操备用）；将军路西操（慧园、东操备用）"), ["西操（东操、南操备用）", "将军路西操（慧园、东操备用）"]);
  assert.equal(normalizeCompetitionLines(" 单位一\r\n\n单位二；单位三 "), "单位一\n单位二\n单位三");
  const input = readCompetitionCreateInput({ slug: "multiline", name: "分行赛事", campus: "天目湖校区、将军路校区", venue: "西操场；东操场", host: "主办一\r\n主办二", organizer: "承办一、承办二", format: "ELEVEN_A_SIDE", playingFormat: "十一人制", status: "ONGOING" });
  assert.equal(input.campus, "天目湖校区\n将军路校区");
  assert.equal(input.host, "主办一\n主办二");
  assert.equal(input.organizer, "承办一\n承办二");
  assert.throws(() => readCompetitionCreateInput({ ...input, slug: "empty-campus", campus: "、；" }), /请填写校区/);
  const now = Date.parse("2026-10-23T00:00:00Z");
  const match = (id: string, kickoff: string | null, status: PublicCompetitionMatch["status"] = "scheduled") => ({ id, kickoff: kickoff ? new Date(kickoff) : null, status } as PublicCompetitionMatch);
  const matches = [match("pending", null), match("completed", "2026-10-09T10:00:00Z", "completed"), match("later", "2026-10-25T10:00:00Z"), match("next", "2026-10-24T10:00:00Z"), match("cancelled", "2026-10-24T09:00:00Z", "cancelled"), match("unconfirmed", "2026-10-22T10:00:00Z")];
  assert.deepEqual(matches.sort((a, b) => comparePublicMatches(a, b, now)).map((m) => m.id), ["next", "later", "unconfirmed", "completed", "pending", "cancelled"]);
  assert.equal(publicMatchProgress(matches[2], now), "赛果待确认");
  assert.equal(publicMatchProgress(match("future-completed", "2027-01-01T00:00:00Z", "completed"), now), "已完成");
  console.log("PASS: multiline fields, chronological priority, explicit completion");
}

async function prepare() {
  const root = await mkdtemp(path.join(os.tmpdir(), "nuaafa-competition-presentation-"));
  await mkdir(path.join(root, "uploads"));
  const url = `file:${path.join(root, "smoke.db")}`;
  const raw = createClient({ url });
  for (const entry of (await readdir("prisma/migrations", { withFileTypes: true })).filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) await raw.executeMultiple(await readFile(path.join("prisma/migrations", entry.name, "migration.sql"), "utf8"));
  raw.close();
  const prisma = new PrismaClient({ adapter: new PrismaLibSql({ url }) });
  try {
    const password = "Presentation-Smoke-2026!";
    const passwordHash = await hashPassword(password);
    const admin = await prisma.adminAccount.create({ data: { username: "presentation-admin", displayName: "本地验收管理员", passwordHash, role: "SUPER_ADMIN" } });
    await prisma.adminRoleAssignment.create({ data: { adminAccountId: admin.id, role: "SUPER_ADMIN" } });
    const first = await prisma.competition.create({ data: { slug: "presentation-cup", name: "南京航空航天大学2026年足球新生杯", shortName: "2026南航新生杯", year: 2026, status: "ONGOING", format: "ELEVEN_A_SIDE", playingFormat: "十一人制", campus: "天目湖校区、将军路校区", teamFormation: "院系组队", publicPublished: true, publicOrder: 1, host: "南京航空航天大学体育部", organizer: "南京航空航天大学天目湖学生足球协会、南京航空航天大学将军路学生足球协会", venue: "天目湖校区西操场（东操场备用）；将军路校区西操场（慧园足球场、东操场备用）", summary: "本届赛事旨在提高校园足球水平与影响力，引领新生融入南航校园，推动学生综合素质发展。", notice: "本地隔离验收数据，用于检查赛事布局与显示顺序。", matchStartAt: new Date("2026-10-09T07:30:00Z"), matchEndAt: new Date("2027-01-01T07:30:00Z") } });
    await prisma.competition.create({ data: { slug: "presentation-futsal", name: "南京航空航天大学2026年“跃动牧星·活力青年”男子足球联赛（天目湖五人制）", shortName: "2026天目湖五人制联赛", year: 2026, status: "ONGOING", format: "FUTSAL", playingFormat: "五人制", campus: "天目湖校区", teamFormation: "自由组队", publicPublished: true, publicOrder: 2, summary: "本次赛事旨在提高校园足球水平与影响力，引领校园全民健身，推动学生综合素质发展。", matchStartAt: new Date("2026-10-12T04:00:00Z"), matchEndAt: new Date("2026-12-31T04:00:00Z") } });
    const stage = await prisma.competitionStage.create({ data: { competitionId: first.id, name: "小组赛", type: "GROUP" } });
    const group = await prisma.competitionGroup.create({ data: { stageId: stage.id, name: "A组" } });
    const round = await prisma.competitionRound.create({ data: { stageId: stage.id, groupId: group.id, name: "第3轮", sortOrder: 3 } });
    const teams = await Promise.all(["致慧书院一队", "致慧书院二队", "致元书院", "致和书院", "航空能动联队", "伦敦国际学院"].map((name) => prisma.team.create({ data: { competitionId: first.id, name } })));
    await prisma.teamGroupMembership.createMany({ data: teams.map((team) => ({ teamId: team.id, stageId: stage.id, groupId: group.id })) });
    const referees = await Promise.all(["验收裁判甲", "验收助理乙", "验收助理丙", "验收官员丁"].map((name, i) => prisma.referee.create({ data: { publicCode: `PRESENTATION-${i}`, name } })));
    const future = new Date(); future.setUTCDate(future.getUTCDate() + 1); future.setUTCHours(11, 0, 0, 0);
    const ids: Record<string, string> = {};
    // Insert unscheduled records before the fixed fixtures to expose SQLite null ordering.
    for (let i = 0; i < 20; i++) {
      const kind = i < 5 ? "pending" : i < 12 ? "future" : i < 16 ? "completed" : i < 18 ? "unconfirmed" : i === 18 ? "cancelled" : "draft";
      const kickoff = kind === "pending" ? null : new Date(future.getTime() + (kind === "completed" ? i - 30 : kind === "unconfirmed" ? i - 20 : i - 5) * 86400000);
      const m = await prisma.match.create({ data: {
        slug: `presentation-${kind}-${i}`, competitionId: first.id,
        stage: stage.name, stageId: stage.id, groupId: group.id, roundId: round.id,
        matchNumber: i + 1, round: round.name, kickoff,
        venue: kind === "pending" ? null : "天目湖校区西操场",
        homeTeamId: teams[i % teams.length].id, awayTeamId: teams[(i + 1) % teams.length].id,
        status: kind === "completed" ? "COMPLETED" : kind === "cancelled" ? "CANCELLED" : "SCHEDULED",
        homeScore: kind === "completed" ? 2 : null, awayScore: kind === "completed" ? 1 : null,
        ...(process.argv.includes("--with-referee-lists") && kind === "future" ? { applicationWindowStatus: "OPEN" as const, applicationDeadline: new Date(kickoff!.getTime() - 3600000), positionRequirements: { create: { key: "REFEREE" as const, label: "裁判员", count: 1, sortOrder: 1 } } } : {}),
      } });
      if (kind !== "pending" && kind !== "cancelled") await prisma.refereeAppointment.create({ data: {
        matchId: m.id,
        status: kind === "draft" ? "DRAFT" : kind === "completed" ? "COMPLETED" : "PUBLISHED",
        publishedAt: new Date(), positions: { create: referees.map((referee, j) => ({
          refereeId: referee.id,
          key: (["REFEREE", "ASSISTANT_REFEREE_1", "ASSISTANT_REFEREE_2", "FOURTH_OFFICIAL"] as const)[j],
          label: ["裁判员", "第一助理裁判员", "第二助理裁判员", "第四官员"][j], sortOrder: j,
        })) },
      } });
      ids[`${kind}-${i}`] = m.id;
    }
    if (process.argv.includes("--with-referee-lists")) {
      const groupB = await prisma.competitionGroup.create({ data: { stageId: stage.id, name: "B组", sortOrder: 2 } });
      for (const name of ["B组机械学院", "B组民航学院"]) {
        const team = await prisma.team.create({ data: { competitionId: first.id, name } });
        await prisma.teamGroupMembership.create({ data: { teamId: team.id, stageId: stage.id, groupId: groupB.id } });
      }
      for (const [index, name] of ["五人制男子联赛", "女子足球联赛"].entries()) {
        const competition = await prisma.competition.create({ data: { slug: `referee-league-${index}`, name: `2026${name}`, shortName: name, year: 2026, format: "FUTSAL", playingFormat: "五人制", campus: "天目湖校区", status: "ONGOING", publicPublished: true, publicOrder: index + 10 } });
        const [home, away] = await Promise.all(["主队", "客队"].map((side) => prisma.team.create({ data: { competitionId: competition.id, name: `${name}${side}` } })));
        for (let n = 0; n < 5 - index; n++) {
          const kickoff = new Date(future.getTime() + n * 86400000 + (index === 0 ? -2 : 2) * 3600000);
          const match = await prisma.match.create({ data: { competitionId: competition.id, slug: `referee-league-${index}-match-${n}`, stage: "联赛", round: `第${n + 1}轮`, kickoff, venue: "天目湖校区东操场", homeTeamId: home.id, awayTeamId: away.id, status: "SCHEDULED", applicationWindowStatus: "OPEN", applicationDeadline: new Date(kickoff.getTime() - 3600000), positionRequirements: { create: { key: "REFEREE", label: "裁判员", count: 1, sortOrder: 1 } } } });
          await prisma.refereeAppointment.create({ data: { matchId: match.id, status: "PUBLISHED", publishedAt: new Date(), positions: { create: { refereeId: referees[index].id, key: "REFEREE", label: "裁判员", sortOrder: 1 } } } });
        }
      }
    }
    const assignments = await prisma.refereeAppointment.findMany({ where: { status: "PUBLISHED", match: { status: "SCHEDULED" } }, select: { id: true, match: { select: { kickoff: true } } } });
    const assignmentOrder = assignments.sort((a, b) => Number(a.match.kickoff!.getTime() < Date.now()) - Number(b.match.kickoff!.getTime() < Date.now()) || a.match.kickoff!.getTime() - b.match.kickoff!.getTime() || a.id.localeCompare(b.id)).map((a) => a.id);
    const open = await prisma.match.findMany({ where: { applicationWindowStatus: "OPEN" }, select: { id: true, slug: true, kickoff: true } });
    const openOrder = open.sort((a, b) => a.kickoff!.getTime() - b.kickoff!.getTime() || a.id.localeCompare(b.id)).map((m) => m.slug);
    const refereeCompetitions = await prisma.competition.findMany({ where: { matches: { some: { applicationWindowStatus: "OPEN" } } }, select: { id: true, name: true, shortName: true } });
    const metadata = { assignmentOrder, openOrder, refereeCompetitions, root, competitionId: first.id, username: admin.username, password, ids, firstKickoff: future.toISOString(), adminPath: `/admin/competitions/${first.id}/edit` };
    await writeFile(path.join(root, "fixture.json"), JSON.stringify(metadata, null, 2));
    console.log(JSON.stringify({ root, metadataPath: path.join(root, "fixture.json") }));
  } finally { await prisma.$disconnect(); }
}

async function main() {
  verifyPresentation();
  if (process.argv.includes("--prepare")) await prepare();
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
