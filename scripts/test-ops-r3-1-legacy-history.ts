import assert from "node:assert/strict";
import { readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../src/generated/prisma-v29/client";

async function main() {
  const info = JSON.parse(await readFile("docs/ops-r3-1/evidence/acceptance-environment.json", "utf8"));
  const root = await realpath(info.root);
  assert.equal(path.dirname(root), await realpath(os.tmpdir()));
  assert(path.basename(root).startsWith("nuaafa-ops-acceptance-"));
  assert.equal(await realpath(info.databasePath), path.join(root, "smoke.db"));
  assert.equal(await realpath(info.uploadRoot), path.join(root, "uploads"));
  process.env.DATABASE_URL = `file:${info.databasePath}`;
  process.env.NUAAFA_UPLOAD_DIR = info.uploadRoot;
  const accounts = JSON.parse(await readFile(path.join(root, "accounts.json"), "utf8"));
  const db = new PrismaClient({ adapter: new PrismaLibSql({ url: process.env.DATABASE_URL }) });
  const before = process.argv.includes("--record-before");
  try {
    const competition = await db.competition.upsert({ where: { slug: "ops-legacy-history-review" }, update: {}, create: { slug: "ops-legacy-history-review", name: "OPS旧历史无比分隔离", campus: "隔离", format: "ELEVEN_A_SIDE", status: "COMPLETED", isTestData: true } });
    const teams = [];
    for (const [slug, name] of [["ops-legacy-history-home", "旧档案合成甲队"], ["ops-legacy-history-away", "旧档案合成乙队"]]) {
      teams.push(await db.team.upsert({ where: { id: slug }, update: {}, create: { id: slug, competitionId: competition.id, name } }));
    }
    const fixtures: Array<{ matchId: string; appointmentId: string; label: string }> = [];
    for (const [slug, status, label] of [["ops-legacy-completed-no-score", "COMPLETED", "原比赛已完成"], ["ops-legacy-scheduled-completed-appointment", "SCHEDULED", "原比赛仍已安排"]] as const) {
      const match = await db.match.upsert({ where: { slug }, update: {}, create: { slug, competitionId: competition.id, stage: `旧档案${label}`, kickoff: new Date(Date.now() - 7 * 86400000), homeTeamId: teams[0].id, awayTeamId: teams[1].id, venue: "仅隔离历史验收", status, isTestData: true } });
      let appointment = await db.refereeAppointment.findUnique({ where: { matchId: match.id } });
      if (!appointment) appointment = await db.refereeAppointment.create({ data: { matchId: match.id, status: "COMPLETED", revision: 2, publishedAt: match.kickoff, completedAt: new Date(match.kickoff.getTime() + 7200000), publicationNote: "合成旧完成档案；比分原本缺失", positions: { create: { key: "REFEREE", label: "历史裁判员", refereeId: accounts.refereeId, sortOrder: 0 } }, versions: { create: [{ revision: 1, status: "PUBLISHED", snapshot: JSON.stringify({ fixture: "restored-legacy" }) }, { revision: 2, status: "COMPLETED", snapshot: JSON.stringify({ fixture: "restored-legacy" }) }] } } });
      fixtures.push({ matchId: match.id, appointmentId: appointment.id, label });
    }
    const snapshots = async () => Promise.all(fixtures.map(async (f) => ({ ...f, match: await db.match.findUniqueOrThrow({ where: { id: f.matchId }, select: { status: true, homeScore: true, awayScore: true, resultVersion: true, resultConfirmedAt: true } }), versions: await db.appointmentVersion.count({ where: { appointmentId: f.appointmentId } }), audits: await db.auditLog.count({ where: { entityId: { in: [f.matchId, f.appointmentId] } } }) })));
    const original = await snapshots();
    async function login(route: string, payload: unknown) {
      const response = await fetch(info.origin + route, { method: "POST", headers: { "content-type": "application/json", origin: "https://nuaafa.cn" }, body: JSON.stringify(payload) });
      assert.equal(response.status, 200);
      return response.headers.get("set-cookie")!.split(";")[0];
    }
    const admin = await login("/api/referees/admin/login", { username: "smoke-referee", password: accounts.password });
    const member = await login("/api/referees/login", { studentId: "16268888", password: accounts.password });
    async function page(route: string, cookie: string) { const response = await fetch(info.origin + route, { headers: { cookie }, cache: "no-store" }); assert.equal(response.status, 200); return (await response.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ""); }
    const adminHtml = await page(`/admin/referees/${accounts.refereeId}`, admin);
    const memberHtml = await page("/referees/workspace", member);
    const statsHtml = await page("/admin/statistics?range=all&referee=SMOKE-R1-001&competition=" + encodeURIComponent(competition.name), admin);
    const history = (memberHtml.split('id="task-history"')[1] ?? "").split("</section>")[0];
    const { getCompletedRefereeStatistics, ...services } = await import("../src/lib/referee-r1-service");
    const verified = await getCompletedRefereeStatistics({ competitionId: competition.id });
    const pending = !before && "getUnverifiedCompletedAssignments" in services ? await services.getUnverifiedCompletedAssignments({ competitionId: competition.id }) : [];
    const proof = { checkedAt: new Date().toISOString(), applicationVersion: process.env.OPS_HISTORY_VERSION ?? "b5fe6e6084aa7d5ecd7e5007941564da0e5d10b4", phase: before ? "BEFORE" : "AFTER", fixture: { competitionId: competition.id, refereeId: accounts.refereeId, ...{ records: fixtures } }, adminHistoryVisible: adminHtml.includes("OPS旧历史无比分隔离"), adminHistoryVisibleRecords: (adminHtml.match(/OPS旧历史无比分隔离/g) ?? []).length, memberHistoryReviewLabels: (history.match(/完赛事实待核/g) ?? []).length, memberHistoryVisibleRecords: (history.match(/OPS旧历史无比分隔离/g) ?? []).length, statisticsReviewVisible: statsHtml.includes("完赛事实待核") && statsHtml.includes("OPS旧历史无比分隔离"), verifiedStatisticsMatches: verified.reduce((sum, r) => sum + r.totalMatches, 0), unverifiedRecords: pending.length, originalFacts: original, originalFactsPreserved: JSON.stringify(await snapshots()) === JSON.stringify(original) };
    assert(proof.originalFactsPreserved);
    for (const f of original) { assert.equal(f.match.homeScore, null); assert.equal(f.match.awayScore, null); assert.equal(f.match.resultVersion, 0); assert.equal(f.match.resultConfirmedAt, null); assert.equal(f.versions, 2); assert.equal(f.audits, 0); }
    if (!before) {
      const previous = JSON.parse(await readFile("docs/ops-r3-1/acceptance-preparation/evidence/legacy-history-before.json", "utf8"));
      assert.deepEqual(original, previous.originalFacts);
      assert.equal((await services.getUnverifiedCompletedAssignments({ competitionId: competition.id, positionKey: "FOURTH_OFFICIAL" })).length, 0);
      assert.equal((await services.getUnverifiedCompletedAssignments({ competitionId: competition.id, from: new Date() })).length, 0);
      assert.equal((await services.getUnverifiedCompletedAssignments({ competitionId: competition.id, to: new Date("2000-01-01") })).length, 0);
      for (const fixture of fixtures) await page(`/admin/appointments/${fixture.matchId}`, admin);
      const excluded = await page("/admin/statistics?range=all&referee=NO_SUCH_SYNTHETIC_REFEREE&competition=" + encodeURIComponent(competition.name), admin);
      assert(excluded.includes("当前筛选 0 条原已完成选派"));
      assert(proof.adminHistoryVisible); assert.equal(proof.adminHistoryVisibleRecords, 2); assert.equal(proof.memberHistoryReviewLabels, 2); assert.equal(proof.memberHistoryVisibleRecords, 2); assert(proof.statisticsReviewVisible); assert.equal(proof.verifiedStatisticsMatches, 0); assert.equal(proof.unverifiedRecords, 2); }
    await writeFile(`docs/ops-r3-1/acceptance-preparation/evidence/legacy-history-${before ? "before" : "after"}.json`, JSON.stringify(proof, null, 2));
    console.log(JSON.stringify(proof, null, 2));
    if (!before) console.log("PASS legacy records remain visible without fabricated scores or confirmed-count inflation.");
  } finally { await db.$disconnect(); const { prisma } = await import("../src/lib/prisma"); await prisma.$disconnect(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
