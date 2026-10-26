import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { CompetitionImportInput } from "../src/lib/competition-import-types";

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "nuaafa-league-"));
  Object.assign(process.env, {
    DATABASE_URL: `file:${path.join(root, "test.db")}`,
    NUAAFA_UPLOAD_DIR: path.join(root, "uploads"),
    NUAAFA_ISOLATED_SECURITY_TEST: "1",
    REFEREE_ADMIN_SESSION_SECRET: "league-isolated-test-session-secret-2026",
  });
  const raw = createClient({ url: process.env.DATABASE_URL! });
  const migrations = (await readdir("prisma/migrations", { withFileTypes: true })).filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of migrations) {
    if (entry.name === "20261026120000_competition_league") {
      await raw.execute("INSERT INTO Competition (id,slug,name,campus,format,status,updatedAt) VALUES ('legacy-league-test','legacy-league-test','旧赛事','隔离','FUTSAL','PREPARING',CURRENT_TIMESTAMP)");
    }
    await raw.executeMultiple(await readFile(path.join("prisma/migrations", entry.name, "migration.sql"), "utf8"));
  }
  raw.close();
  const { prisma } = await import("../src/lib/prisma");
  const { parseCompetitionImportDocx, completeDocxRows } = await import("../src/lib/competition-import-docx");
  const imports = await import("../src/lib/competition-import-service");
  const competitions = await import("../src/lib/referee-competition-service");
  const structure = await import("../src/lib/competition-structure-service");
  const { readCompetitionCreateInput, readCompetitionUpdateInput } = await import("../src/lib/referee-competition-input");
  const { confirmMatchResult } = await import("../src/lib/referee-service");
  const { scheduleMatch } = await import("../src/lib/match-scheduling-service");
  const caps = await import("./security-r4a-test-capabilities");
  const actor = { ...caps.testUnifiedAdminActor(), role: "SUPER_ADMIN" as const };
  const grant = caps.issueTestAdminServiceAuthorization("competitions:write", actor);
  try {
    assert.equal((await prisma.competition.findUniqueOrThrow({ where: { id: "legacy-league-test" } })).competitionSystem, "GROUP_KNOCKOUT");
    const bytes = await readFile("scripts/fixtures/league/2026-women-league.docx");
    const parsed = parseCompetitionImportDocx(bytes);
    assert.equal(parsed.rows.length, 12);
    assert.equal(parsed.referenceRows.length, 0);
    assert.equal(new Set(parsed.rows.map((r) => r.values.round)).size, 6);
    const names = [...new Set(parsed.rows.flatMap((r) => [String(r.values.homeTeam), String(r.values.awayTeam)]))];
    assert.deepEqual(names, ["致和书院女足", "致微书院女足", "致慧书院女足", "致元书院女足"]);
    const pairs = parsed.rows.map((r) => [r.values.homeTeam, r.values.awayTeam].join("|"));
    assert.equal(new Set(pairs).size, 12);
    for (const row of parsed.rows) {
      assert.equal(row.values.stage, "联赛");
      assert.equal(row.values.group, "");
      assert.equal(row.values.kickoff, "");
      assert(pairs.includes([row.values.awayTeam, row.values.homeTeam].join("|")));
    }
    const archive = unzipSync(bytes);
    archive["word/document.xml"] = strToU8(strFromU8(archive["word/document.xml"]).replace("阶段：联赛", "阶段：未知阶段"));
    assert.throws(() => parseCompetitionImportDocx(Buffer.from(zipSync(archive))), /缺少明确的阶段/);
    console.log("PASS actual DOCX: four teams, six rounds, twelve reciprocal fixtures, no invented dates or groups");

    const form = { slug: "women-league", name: "隔离测试 女子足球联赛", campus: "隔离校区", format: "FUTSAL", playingFormat: "五人制", competitionSystem: "LEAGUE", status: "PREPARING", publicPublished: true };
    assert.throws(() => readCompetitionCreateInput({ ...form, competitionSystem: "INVALID" }), /比赛形式/);
    const league = await competitions.createCompetition(readCompetitionCreateInput(form), actor);
    const stages = await structure.loadCompetitionStructure(league.id);
    assert.equal(stages.length, 1);
    assert.equal(stages[0].type, "LEAGUE");
    assert.throws(() => readCompetitionUpdateInput({ ...form, slug: undefined }), /Slug/);
    const legacyForm = { name: form.name, campus: form.campus, format: "FUTSAL" as const, playingFormat: form.playingFormat, status: "PREPARING" as const, publicPublished: true };
    await competitions.updateCompetition(league.id, readCompetitionUpdateInput(legacyForm), actor);
    assert.equal((await prisma.competition.findUniqueOrThrow({ where: { id: league.id } })).competitionSystem, "LEAGUE");
    await assert.rejects(() => structure.mutateCompetitionStructure(league.id, { action: "group", stageId: stages[0].id, name: "A组", sortOrder: 0 }, actor), /仅小组赛/);
    await assert.rejects(() => structure.mutateCompetitionStructure(league.id, { action: "stage", name: "淘汰赛", type: "KNOCKOUT", sortOrder: 1 }, actor), /比赛形式/);
    await assert.rejects(() => structure.assertMatchStructure(prisma, { competitionId: league.id, homeTeamId: "missing", awayTeamId: "missing" }), /请选择正式联赛阶段/);
    const input: CompetitionImportInput = { competitionId: league.id, importType: "MATCH", inputMethod: "DOCX", inputHash: createHash("sha256").update(bytes).digest("hex"), rows: parsed.rows, inputWarnings: parsed.inputWarnings, referenceRows: parsed.referenceRows };
    const empty = await imports.buildCompetitionImportPreview(input);
    assert.equal(empty.summary.errorRows, 12);
    assert(empty.rows.every((r) => r.errors.some((e) => e.errorCode === "REAL_TEAM_REQUIRED")));
    assert.equal(await prisma.competitionRound.count({ where: { stageId: stages[0].id } }), 0);
    const teams = await Promise.all(names.map((name) => prisma.team.create({ data: { competitionId: league.id, name } })));
    const preview = await imports.buildCompetitionImportPreview(input);
    assert.equal(preview.summary.errorRows, 0, JSON.stringify(preview.rows));
    assert.equal(preview.summary.createRows, 12);
    assert.equal(new Set(preview.rows.map((r) => r.normalized.roundId)).size, 6);
    assert(preview.rows.every((r) => r.normalized.groupId === null && r.normalized.kickoff === null && r.normalized.venue === null));
    assert.equal(await prisma.match.count({ where: { competitionId: league.id } }), 0);
    assert.equal(await prisma.competitionRound.count({ where: { stageId: stages[0].id } }), 0);
    const invalid = { ...input, rows: [...input.rows.slice(0, 11), { ...input.rows[11], values: { ...input.rows[11].values, awayTeam: "不存在的球队" } }] };
    await assert.rejects(() => imports.commitCompetitionImport(invalid, grant), /错误/);
    assert.equal(await prisma.competitionRound.count({ where: { stageId: stages[0].id } }), 0);
    const fault = createClient({ url: process.env.DATABASE_URL! });
    await fault.executeMultiple(`CREATE TRIGGER league_test_abort BEFORE INSERT ON Match WHEN NEW.competitionId='${league.id}' BEGIN SELECT RAISE(ABORT, 'ISOLATED_TEST_ABORT'); END;`);
    await assert.rejects(() => imports.commitCompetitionImport({ ...input, expectedPlanHash: preview.planHash }, grant));
    assert.equal(await prisma.competitionRound.count({ where: { stageId: stages[0].id } }), 0, "A failed match insert must roll back newly created rounds");
    assert.equal(await prisma.match.count({ where: { competitionId: league.id } }), 0);
    await fault.executeMultiple("DROP TRIGGER league_test_abort;");
    fault.close();
    const result = await imports.commitCompetitionImport({ ...input, expectedPlanHash: preview.planHash }, grant);
    assert.equal(result.createdMatches, 12);
    assert.equal(result.createdTeams, 0);
    const rounds = await prisma.competitionRound.findMany({ where: { stageId: stages[0].id }, orderBy: { sortOrder: "asc" } });
    assert.deepEqual(rounds.map((r) => r.name), ["第1轮", "第2轮", "第3轮", "第4轮", "第5轮", "第6轮"]);
    const matches = await prisma.match.findMany({ where: { competitionId: league.id }, orderBy: { matchNumber: "asc" } });
    assert(matches.every((m) => m.kickoff === null && m.venue === null && m.groupId === null && m.roundId && m.applicationWindowStatus === "CLOSED"));
    assert.equal((await imports.buildCompetitionImportPreview(input)).summary.skipRows, 12);
    const repeated = await imports.commitCompetitionImport(input, grant);
    assert.equal(repeated.createdMatches, 0);
    assert.equal(repeated.skippedMatches, 12);
    assert.equal(await prisma.competitionRound.count({ where: { stageId: stages[0].id } }), 6);
    assert.equal(await prisma.competitionGroup.count({ where: { stageId: stages[0].id } }), 0);
    assert.equal(await prisma.teamGroupMembership.count({ where: { stageId: stages[0].id } }), 0);
    await assert.rejects(() => competitions.updateCompetition(league.id, { name: league.name, format: league.format, status: league.status, competitionSystem: "GROUP_KNOCKOUT" }, actor), /已有比赛.*比赛形式/);
    console.log("PASS import: preview has no writes; atomic twelve-match import creates six rounds, retries skip duplicates; no groups; format change protected");

    let tables = await structure.getCompetitionLeagueStandings(league.id);
    assert.equal(tables[0].rows.length, 4);
    assert(tables[0].rows.every((r) => r.points === 0 && r.played === 0));
    await scheduleMatch(matches[0].id, { kickoff: new Date(Date.now() - 86400000), venue: "隔离测试场地" }, grant);
    await assert.rejects(() => confirmMatchResult(matches[0].id, { homeScore: 1, awayScore: 1, homePenaltyScore: 3, awayPenaltyScore: 2, expectedVersion: 0, actualEnded: true, reason: "" }, grant), /点球仅用于淘汰赛/);
    await confirmMatchResult(matches[0].id, { homeScore: 2, awayScore: 0, homePenaltyScore: null, awayPenaltyScore: null, expectedVersion: 0, actualEnded: true, reason: "" }, grant);
    tables = await structure.getCompetitionLeagueStandings(league.id);
    assert.equal(tables[0].rows.find((r) => r.id === teams[0].id)?.points, 3);
    assert.equal(tables[0].rows.find((r) => r.id === teams[0].id)?.goalDifference, 2);
    await confirmMatchResult(matches[0].id, { homeScore: 1, awayScore: 1, homePenaltyScore: null, awayPenaltyScore: null, expectedVersion: 1, actualEnded: true, reason: "隔离更正验证" }, grant);
    tables = await structure.getCompetitionLeagueStandings(league.id);
    assert.equal(tables[0].rows.find((r) => r.id === teams[0].id)?.points, 1);
    assert.equal(tables[0].rows.find((r) => r.id === teams[1].id)?.points, 1);
    assert.equal(tables[0].rows.reduce((n, r) => n + r.played, 0), 2);
    assert.equal((await structure.getCompetitionGroupStandings(league.id)).length, 0);
    console.log("PASS league standings: all four participants, pending fixtures excluded, win/draw points, score correction, no knockout penalty rules");

    const group = await competitions.createCompetition({ ...legacyForm, slug: "group-format", name: "隔离小组赛事", format: "FUTSAL", status: "PREPARING" }, actor);
    assert.equal(group.competitionSystem, "GROUP_KNOCKOUT");
    const wrongFormat = await imports.buildCompetitionImportPreview({ ...input, competitionId: group.id });
    assert(wrongFormat.rows.every((r) => r.errors.some((e) => e.errorCode === "LEAGUE_SYSTEM_REQUIRED")));
    const changed = await competitions.updateCompetition(group.id, { name: group.name, format: group.format, status: group.status, competitionSystem: "LEAGUE" }, actor);
    assert.equal(changed.competitionSystem, "LEAGUE");
    assert.equal((await structure.loadCompetitionStructure(group.id))[0].type, "LEAGUE");
    await competitions.updateCompetition(group.id, { name: group.name, format: group.format, status: group.status, competitionSystem: "GROUP_KNOCKOUT" }, actor);
    assert.equal((await structure.loadCompetitionStructure(group.id)).length, 0);
    const partial = { ...input, rows: completeDocxRows(parsed.rows, { "1": { date: "2026-10-27", time: "", venue: "西操场" } }) };
    const partialPreview = await imports.buildCompetitionImportPreview(partial);
    assert.equal(partialPreview.rows[0].normalized.tentativeDate, "2026-10-27");
    assert.equal(partialPreview.rows[0].normalized.kickoff, null);
    const disposable = await competitions.createCompetition({ name: "隔离空联赛", format: "FUTSAL", status: "PREPARING", competitionSystem: "LEAGUE" }, actor);
    await competitions.deleteCompetitionSafely(disposable.id, disposable.name, grant);
    assert.equal(await prisma.competitionStage.count({ where: { competitionId: disposable.id } }), 0);
    console.log("PASS compatibility: old competitions retain default, wrong format actionable, existing empty competition can switch, partial date stays tentative");

    if (process.env.LEAGUE_TEST_KEEP === "1") {
      const { hashPassword } = await import("../src/lib/referee-security");
      await prisma.adminAccount.create({ data: { username: "league-test-admin", displayName: "隔离联赛管理员", role: "SUPER_ADMIN", mustChangePassword: false, passwordHash: await hashPassword("League-Isolated-Only-2026!") } });
      await writeFile(path.join(root, "fixture.json"), JSON.stringify({ root, databaseUrl: process.env.DATABASE_URL, competitionId: league.id, slug: league.slug, stageId: stages[0].id }, null, 2));
      console.log(`ISOLATED_FIXTURE=${root}`);
    }
  } finally {
    await prisma.$disconnect();
    if (process.env.LEAGUE_TEST_KEEP !== "1") await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
