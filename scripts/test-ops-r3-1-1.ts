import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseCompetitionImportDocx, completeDocxRows } from "../src/lib/competition-import-docx";
import { isKnockoutPlaceholder } from "../src/lib/competition-match-number";

async function main() {
const fixture = "scripts/fixtures/ops-r3-1-1/2026-09-29_06.43.05-65a5f60ea71e6a7385071a16fed8e472.docx";
const root = await mkdtemp(path.join(os.tmpdir(), "nuaafa-ops-r3-1-1-"));
process.env.DATABASE_URL = `file:${path.join(root, "test.db")}`;
await writeFile(path.join(root, "test.db"), "");
process.env.NUAAFA_UPLOAD_DIR = path.join(root, "uploads");
process.env.NUAAFA_ISOLATED_SECURITY_TEST = "1";
process.env.REFEREE_ADMIN_SESSION_SECRET = "isolated-ops-r3-1-1-session";
const cli = spawnSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], { env: process.env, encoding: "utf8" });
assert.equal(cli.status, 0, cli.stdout + cli.stderr);
const { prisma } = await import("../src/lib/prisma");
try {
  const document = await readFile(fixture);
  const parsed = parseCompetitionImportDocx(document);
  assert.equal(parsed.rows.length, 30); assert.equal(parsed.referenceRows.length, 10);
  assert.deepEqual(parsed.rows.map((r) => Number(r.values.matchNumber)), Array.from({ length: 30 }, (_, i) => i + 1));
  assert.deepEqual(parsed.referenceRows.map((r) => Number(r.values.matchNumber)), Array.from({ length: 10 }, (_, i) => i + 31));
  assert.deepEqual(new Set(parsed.rows.map((r) => r.values.group)), new Set(["A组", "B组"]));
  assert.deepEqual(new Set(parsed.rows.map((r) => r.values.round)), new Set(["第1轮", "第2轮", "第3轮", "第4轮", "第5轮"]));
  assert.equal(parsed.rows[0].values.homeTeam, "致慧书院一队"); assert.equal(parsed.rows[0].values.awayTeam, "致慧书院二队");
  assert(parsed.referenceRows.some((r) => isKnockoutPlaceholder(String(r.values.homeTeam))));
  assert.throws(() => parseCompetitionImportDocx(Buffer.from("invalid")));
  const bad = Buffer.from(document); bad.fill(0, bad.length - 22);
  assert.throws(() => parseCompetitionImportDocx(bad));
  const { buildCompetitionImportPreview, commitCompetitionImport } = await import("../src/lib/competition-import-service");
  const { testUnifiedAdminActor, issueTestAdminServiceAuthorization } = await import("./security-r4a-test-capabilities");
  const actor = testUnifiedAdminActor({ roles: ["COMPETITION_ADMIN"] });
  const grant = issueTestAdminServiceAuthorization("competitions:write", actor);
  const competition = await prisma.competition.create({ data: { slug: "docx-fixture", name: "DOCX隔离赛", campus: "隔离", format: "FUTSAL", status: "ONGOING" } });
  const stage = await prisma.competitionStage.create({ data: { competitionId: competition.id, name: "小组赛", type: "GROUP" } });
  const groups = await Promise.all(["A组", "B组"].map((name, i) => prisma.competitionGroup.create({ data: { stageId: stage.id, name, sortOrder: i } })));
  for (const [i, g] of groups.entries()) for (let n = 1; n <= 5; n++) await prisma.competitionRound.create({ data: { stageId: stage.id, groupId: g.id, name: `第${n}轮`, sortOrder: n + i * 5 } });
  for (const g of groups) {
    const names = new Set(parsed.rows.filter((r) => r.values.group === g.name).flatMap((r) => [String(r.values.homeTeam), String(r.values.awayTeam)]));
    for (const name of names) {
      const team = await prisma.team.create({ data: { competitionId: competition.id, name } });
      await prisma.teamGroupMembership.create({ data: { teamId: team.id, stageId: stage.id, groupId: g.id } });
    }
  }
  const input = (rows: typeof parsed.rows, hash: string) => ({ competitionId: competition.id, importType: "MATCH" as const, inputMethod: "DOCX" as const, inputHash: hash, rows, referenceRows: parsed.referenceRows, inputWarnings: parsed.inputWarnings });
  const emptyPreview = await buildCompetitionImportPreview(input(parsed.rows, "original"));
  assert.equal(emptyPreview.summary.errorRows, 30); assert.equal(await prisma.match.count(), 0);
  await assert.rejects(() => commitCompetitionImport({ ...input(parsed.rows, "original"), expectedPlanHash: emptyPreview.planHash }, grant));
  const edits = Object.fromEntries(parsed.rows.map((r, i) => [r.rowNumber, { date: `2030-10-${String(1 + Math.floor(i / 2)).padStart(2, "0")}`, time: i % 2 ? "19:30" : "18:30", venue: "隔离足球场" }]));
  const complete = completeDocxRows(parsed.rows, edits);
  const fullPreview = await buildCompetitionImportPreview(input(complete, "completed"));
  assert.equal(fullPreview.summary.createRows, 30); assert.equal(fullPreview.summary.errorRows, 0);
  const imported = await commitCompetitionImport({ ...input(complete, "completed"), expectedPlanHash: fullPreview.planHash }, grant);
  assert.equal(imported.createdMatches, 30); assert.equal(imported.createdTeams, 0);
  assert.equal(await prisma.match.count(), 30);
  assert.equal(await prisma.team.count({ where: { competitionId: competition.id, name: { contains: "组第" } } }), 0);
  assert.equal((await prisma.match.findFirstOrThrow({ where: { competitionId: competition.id, matchNumber: 1 } })).internalNote, "A组");
  const repeat = await buildCompetitionImportPreview(input(complete, "completed")); assert.equal(repeat.summary.skipRows, 30);
  const again = await commitCompetitionImport({ ...input(complete, "completed"), expectedPlanHash: repeat.planHash }, grant); assert.equal(again.createdMatches, 0);
  const wrongTeam = [{ ...complete[0], values: { ...complete[0].values, homeTeam: "不存在的球队" } }];
  assert.equal((await buildCompetitionImportPreview(input(wrongTeam, "wrong-team"))).summary.errorRows, 1);
  const wrongGroup = [{ ...complete[0], values: { ...complete[0].values, group: "C组" } }];
  assert.equal((await buildCompetitionImportPreview(input(wrongGroup, "wrong-group"))).summary.errorRows, 1);
  const referenceAsCandidate = parsed.referenceRows.map((r) => ({ ...r, values: { ...r.values, kickoff: "2030-11-01 18:30", venue: "隔离足球场" } }));
  assert.equal((await buildCompetitionImportPreview(input(referenceAsCandidate, "illegal-reference"))).summary.errorRows, 10);
  const knockout = await prisma.competitionStage.create({ data: { competitionId: competition.id, name: "淘汰赛", type: "KNOCKOUT" } });
  const quarter = await prisma.competitionRound.create({ data: { stageId: knockout.id, name: "1/4决赛" } });
  const [home, away] = await prisma.team.findMany({ where: { competitionId: competition.id }, take: 2 });
  const beforeKo = await prisma.match.count();
  const manual = await prisma.match.create({ data: { slug: "manual-quarter", competitionId: competition.id, stage: "淘汰赛", stageId: knockout.id, roundId: quarter.id, round: "1/4决赛", matchNumber: 31, homeTeamId: home.id, awayTeamId: away.id, kickoff: new Date("2025-01-01T00:00:00Z"), venue: "隔离足球场", status: "COMPLETED", homeScore: 2, awayScore: 1 } });
  assert.equal(await prisma.match.count(), beforeKo + 1);
  const { getKnockoutResultCandidates } = await import("../src/lib/competition-knockout-candidates");
  const candidates = await getKnockoutResultCandidates(competition.id, quarter.id, 1);
  assert.equal(candidates.items.find((r) => r.id === manual.id)?.winner?.id, home.id);
  assert.equal(await prisma.match.count(), beforeKo + 1);
  const media = await prisma.mediaAsset.create({ data: { storageKey: "fixture/media.pdf", storedFilename: "media.pdf", originalFilename: "media.pdf", mimeType: "application/pdf", size: 10 } });
  await prisma.mediaAsset.create({ data: { storageKey: "fixture/unused.pdf", storedFilename: "unused.pdf", originalFilename: "unused.pdf", mimeType: "application/pdf", size: 10 } });
  for (let i = 0; i < 31; i++) await prisma.contentPost.create({ data: { slug: `fixture-${i}`, title: `引用文章${i}`, summary: "隔离", content: { schemaVersion: 1, document: { type: "doc", content: [] } }, coverMediaId: media.id } });
  const { getAdminMediaPage } = await import("../src/lib/admin-media-service");
  const contentActor = testUnifiedAdminActor({ roles: ["CONTENT_EDITOR"] });
  const used = await getAdminMediaPage({ actor: contentActor, usage: "used" });
  const unused = await getAdminMediaPage({ actor: contentActor, usage: "unused" });
  assert.equal(used.total, 1); assert.equal(unused.total, 1); assert.equal(used.items[0].usageCount, 31); assert.equal(used.items[0].usage.length, 31);
  const referees = await Promise.all(Array.from({ length: 30 }, (_, i) => prisma.referee.create({ data: { publicCode: `OPS-AV-${i}`, name: `隔离裁判${i}` } })));
  const { saveRefereeAvailability } = await import("../src/lib/referee-r1-service");
  for (const [i, referee] of referees.entries()) for (let d = 1; d <= (i === 0 ? 20 : 2); d++) await prisma.refereeAvailability.create({ data: { refereeId: referee.id, startAt: new Date(`2030-10-${String(d).padStart(2,"0")}T11:00:00Z`), endAt: new Date(`2030-10-${String(d).padStart(2,"0")}T13:00:00Z`), kind: d % 2 ? "AVAILABLE" : "UNAVAILABLE" } });
  const { getAdminAvailabilityPage, getAdminAvailabilityDetail } = await import("../src/lib/admin-availability-page");
  const page = await getAdminAvailabilityPage({});
  assert.equal(page.total, 30); assert.equal(page.items.length, 30);
  const singleReferee = await getAdminAvailabilityPage({ refereeId: referees[0].id });
  assert.equal(singleReferee.total, 1); assert.equal(singleReferee.items[0].recordCount, 20);
  const row = page.items.find((r) => r.id === referees[0].id)!;
  assert.equal(row.recordCount, 20); assert.equal(row.filledDays, 20); assert.equal(row.availableDays, 10); assert.equal(row.unavailableDays, 10);
  const detail = await getAdminAvailabilityDetail(referees[0].id, {}); assert.equal(detail?.total, 20); assert.equal(detail?.records.length, 20);
  const day = await getAdminAvailabilityPage({ date: "2030-10-02" }); assert.equal(day.total, 30); assert.equal(day.items.length, 30); assert(day.items.every((r) => r.dateRecords.every((d) => d.kind === "UNAVAILABLE")));
  const extra = await prisma.referee.create({ data: { publicCode: "OPS-AV-30", name: "新增裁判" } });
  await saveRefereeAvailability({ refereeId: extra.id, startAt: new Date("2030-10-03T11:00:00Z"), endAt: new Date("2030-10-03T13:00:00Z"), kind: "AVAILABLE", actor: { type: "ADMIN", id: null } });
  const page2 = await getAdminAvailabilityPage({ page: 2 }); assert.equal(page2.total, 31); assert.equal(page2.items.length, 1);
  const extraDetail = await getAdminAvailabilityDetail(extra.id, {}); assert.equal(extraDetail?.total, 1);
  console.log(JSON.stringify({ fixtureSha256: createHash("sha256").update(document).digest("hex"), docx: { group: parsed.rows.length, knockoutReference: parsed.referenceRows.length, created: imported.createdMatches, repeated: again.createdMatches }, knockout: { candidates: candidates.total, autoCreated: 0 }, media: { used: used.total, unused: unused.total, references: used.items[0].usageCount }, availability: { people: page2.total, firstRecordCount: row.recordCount, page2: page2.items.length, datePeople: day.total, afterAdminEntry: extraDetail?.total }, database: root }, null, 2));
} finally { await prisma.$disconnect(); }

}
main().catch((error) => { console.error(error); process.exitCode = 1; });
