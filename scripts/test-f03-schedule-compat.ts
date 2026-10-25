import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";

const before = process.argv.includes("--before");
const http = process.argv.includes("--http");
const worker = process.argv.indexOf("--schedule-worker");
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function scheduleWorker() {
  const [matchId, actorId, venue, barrier, output] = process.argv.slice(worker + 1);
  const parent = await realpath(process.env.F03_WORKER_ROOT!);
  assert(process.env.NUAAFA_ISOLATED_SECURITY_TEST === "1" && process.env.DATABASE_URL === `file:${path.join(parent, "fictional.db")}`);
  assert(output.startsWith(parent + path.sep) && barrier.startsWith(parent + path.sep));
  const { prisma } = await import("../src/lib/prisma");
  const caps = await import("./security-r4a-test-capabilities");
  const { scheduleMatch } = await import("../src/lib/match-scheduling-service");
  const grant = caps.issueTestAdminServiceAuthorization("competitions:write", caps.testUnifiedAdminActor({ id: actorId }));
  await writeFile(output + ".ready", "ready");
  for (let i = 0; i < 200 && !await stat(barrier).catch(() => null); i++) await pause(25);
  try {
    const match = await scheduleMatch(matchId, { kickoff: new Date(Date.now() + 172800000), venue }, grant);
    await writeFile(output, JSON.stringify({ saved: true, venue: match.venue }));
  } catch (error) {
    const e = error as { status?: number; code?: string; message?: string };
    await writeFile(output, JSON.stringify({ saved: false, status: e.status ?? null, code: e.code ?? null, message: e.message }));
  } finally { await prisma.$disconnect(); }
}

async function main() {
  const parent = await realpath(process.env.F03_TEST_ROOT ?? os.tmpdir());
  const root = await realpath(await mkdtemp(path.join(parent, "f03-schedule-")));
  const database = path.join(root, "fictional.db"), uploads = path.join(root, "uploads");
  await mkdir(uploads);
  Object.assign(process.env, { DATABASE_URL: `file:${database}`, NUAAFA_UPLOAD_DIR: uploads, NODE_ENV: "test", NUAAFA_ISOLATED_SECURITY_TEST: "1" });
  const raw = createClient({ url: process.env.DATABASE_URL! });
  for (const entry of (await readdir("prisma/migrations", { withFileTypes: true })).filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    await raw.executeMultiple(await readFile(path.join("prisma/migrations", entry.name, "migration.sql"), "utf8"));
  }
  raw.close(); assert.equal(await realpath(database), database);
  const { prisma } = await import("../src/lib/prisma");
  const { scheduleMatch } = await import("../src/lib/match-scheduling-service");
  const service = await import("../src/lib/referee-service");
  const structure = await import("../src/lib/competition-structure-service");
  const caps = await import("./security-r4a-test-capabilities");
  const admin = await prisma.adminAccount.create({ data: { username: "f03-fictional-admin", displayName: "虚构F03管理员", role: "SUPER_ADMIN", mustChangePassword: false, passwordHash: "synthetic-not-a-password" } });
  const actor = { ...caps.testUnifiedAdminActor({ id: admin.id }), role: "SUPER_ADMIN" as const };
  const grant = caps.issueTestAdminServiceAuthorization("competitions:write", actor);
  const at = (hours: number) => new Date(Date.now() + hours * 3600000);
  const nextSchedule = () => ({ kickoff: at(48), endAt: at(50), venue: "虚构首次排期场地" });
  let seq = 0;
  async function fixture(kind: "legacy" | "stale" | "unprovable" | "v2" | "ungrouped" = "legacy") {
    const key = `f03-${++seq}`;
    const competition = await prisma.competition.create({ data: { slug: key, name: `虚构赛事${key}`, campus: "虚构校区", format: "FUTSAL", status: "ONGOING", publicPublished: true } });
    const teams = await Promise.all(["A", "B", "C"].map(name => prisma.team.create({ data: { competitionId: competition.id, name: `虚构${name}` } })));
    const stage = kind === "ungrouped" ? null : await prisma.competitionStage.create({ data: { competitionId: competition.id, name: "虚构小组赛", type: "GROUP" } });
    const group = stage ? await prisma.competitionGroup.create({ data: { stageId: stage.id, name: "虚构A组" } }) : null;
    if (group && stage) await prisma.teamGroupMembership.createMany({ data: teams.map(t => ({ teamId: t.id, stageId: stage.id, groupId: group.id })) });
    const common = { competitionId: competition.id, stage: "虚构比赛", stageId: stage?.id, groupId: group?.id, homeTeamId: teams[0].id, status: "SCHEDULED" as const, applicationWindowStatus: "CLOSED" as const, positionCounts: {} };
    const played = await service.createMatch({ ...common, slug: `${key}-played`, awayTeamId: teams[1].id, kickoff: at(-48), endAt: at(-46), venue: "虚构已赛场地" }, actor);
    await service.confirmMatchResult(played.id, { homeScore: 1, awayScore: 1, homePenaltyScore: null, awayPenaltyScore: null, expectedVersion: 0, actualEnded: true, reason: "虚构完赛平局" }, grant);
    const pending = await service.createMatch({ ...common, slug: `${key}-pending`, awayTeamId: teams[2].id, kickoff: null, venue: null }, actor);
    if (group) {
      const table = await structure.getGroupStandings(group.id);
      const order = [teams[1].id, teams[0].id, teams[2].id];
      if (kind === "v2") {
        await structure.confirmGroup(competition.id, group.id, { kind: "RANKING", teamIds: order, fingerprint: table.fingerprint, reason: "虚构人工同分次序" }, actor);
        const ranked = await structure.getGroupStandings(group.id);
        await structure.confirmGroup(competition.id, group.id, { kind: "QUALIFICATION", teamIds: [teams[1].id], fingerprint: ranked.qualificationFingerprint, reason: "提前确认：虚构规程核验" }, actor);
      } else {
        // Exact historical serialization, independently of the new compatibility helper.
        const matches = await prisma.match.findMany({ where: { groupId: group.id }, orderBy: { id: "asc" } });
        const digest = createHash("sha256").update(JSON.stringify({ members: teams.map(t => t.id).sort(), matches: matches.map(m => [m.id, m.homeTeamId, m.awayTeamId, m.homeScore, m.awayScore, m.status, m.resultVersion, m.updatedAt]) })).digest("hex");
        const fingerprint = kind === "unprovable" ? "0".repeat(64) : digest;
        const ranking = await prisma.groupConfirmation.create({ data: { groupId: group.id, kind: "RANKING", teamIds: order, fingerprint, reason: "虚构旧人工同分次序", actorId: admin.id, createdAt: new Date("2026-08-01T00:00:00Z") } });
        await prisma.groupConfirmation.create({ data: { groupId: group.id, kind: "QUALIFICATION", teamIds: [teams[1].id], fingerprint: createHash("sha256").update(fingerprint + ranking.id).digest("hex"), reason: "提前确认：虚构旧规程核验", actorId: admin.id, createdAt: new Date("2026-08-01T00:00:01Z") } });
        if (kind === "stale") {
          assert((await structure.getGroupStandings(group.id)).rankingConfirmed);
          await service.confirmMatchResult(played.id, { homeScore: 2, awayScore: 1, homePenaltyScore: null, awayPenaltyScore: null, expectedVersion: 1, actualEnded: true, reason: "虚构旧确认后真实赛果更正" }, grant);
          const expired = await structure.getGroupStandings(group.id);
          assert(expired.rankingStale && expired.qualificationStale);
        }
      }
    }
    return { competition, teams, group, played, pending };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const records = (f: Fixture) => prisma.groupConfirmation.findMany({ where: { groupId: f.group!.id }, orderBy: { id: "asc" } });
  const upgrades = (ids: string[]) => prisma.auditLog.findMany({ where: { action: "GROUP_CONFIRMATION_FINGERPRINT_UPGRADED", entityId: { in: ids } }, orderBy: { createdAt: "asc" } });
  const stable = (rows: Awaited<ReturnType<typeof records>>) => rows.map(row => ({ id: row.id, groupId: row.groupId, kind: row.kind, teamIds: row.teamIds, reason: row.reason, actorId: row.actorId, createdAt: row.createdAt }));
  async function preserved(f: Fixture, previous: Awaited<ReturnType<typeof records>>, expectedUpgrades: number) {
    const table = await structure.getGroupStandings(f.group!.id), after = await records(f);
    assert(table.rankingConfirmed); assert.deepEqual(table.qualifiedTeamIds, [f.teams[1].id]);
    assert.deepEqual(table.rows.map(row => row.id), [f.teams[1].id, f.teams[0].id, f.teams[2].id]);
    assert.deepEqual(stable(after), stable(previous));
    assert(after.every(row => row.fingerprint.startsWith("v2:")));
    const audit = await upgrades(previous.map(row => row.id)); assert.equal(audit.length, expectedUpgrades);
    for (const row of audit) { assert.equal(row.actorId, admin.id); assert.equal(JSON.parse(row.metadata!).verifiedBeforeBusinessWrite, true); }
    const scheduled = await prisma.match.findUniqueOrThrow({ where: { id: f.pending.id } });
    const scheduleAudit = await prisma.auditLog.findMany({ where: { entityId: f.pending.id, action: "MATCH_SCHEDULED" } });
    assert.equal(scheduleAudit.length, 1); assert.equal(scheduleAudit[0].actorId, admin.id);
    return { rankingConfirmed: table.rankingConfirmed, compatibility: table.confirmationCompatibility, order: table.rows.map(row => row.id), qualifiedTeamIds: table.qualifiedTeamIds, before: previous, after, upgradeAudit: audit, scheduleAudit, matchBefore: f.pending, matchAfter: scheduled };
  }
  const checks: Array<Record<string, unknown>> = [], knownFindings: Array<Record<string, unknown>> = [];
  const check = (name: string, evidence: unknown = undefined) => { checks.push({ name, status: "PASS", evidence }); console.log("PASS F03 " + name); };
  let server: ReturnType<typeof spawn> | undefined, serverLog = "";
  const adminSecret = "Synthetic-F03-Schedule-Admin-Secret-Only-2026";
  try {
    const first = await fixture(), previous = await records(first);
    const prior = await structure.getGroupStandings(first.group!.id); assert(prior.rankingConfirmed); assert.equal(prior.confirmationCompatibility.ranking, "LEGACY_VALID");
    await scheduleMatch(first.pending.id, nextSchedule(), grant);
    const now = await structure.getGroupStandings(first.group!.id); assert.equal(now.fingerprint, prior.fingerprint); assert.equal(now.qualificationFingerprint, prior.qualificationFingerprint);
    if (before) { assert(!now.rankingConfirmed); assert.deepEqual(now.qualifiedTeamIds, []); check("before real SQLite first scheduling reproduces loss of valid legacy confirmations", { before: prior.confirmationCompatibility, after: now.confirmationCompatibility, fingerprintUnchanged: true }); }
    else {
      check("real service preserves valid legacy order, qualifiers, history and actor-bound audit", await preserved(first, previous, 2));
      const stale = await fixture("stale"), staleRows = await records(stale); await scheduleMatch(stale.pending.id, nextSchedule(), grant);
      assert.deepEqual(await records(stale), staleRows); assert.equal((await upgrades(staleRows.map(row => row.id))).length, 0); assert.equal((await structure.getGroupStandings(stale.group!.id)).confirmationCompatibility.ranking, "LEGACY_UNVERIFIED");
      check("legacy confirmations expired by a real result correction are never resurrected");
      const unprovable = await fixture("unprovable"), unprovableRows = await records(unprovable); await scheduleMatch(unprovable.pending.id, nextSchedule(), grant); assert.deepEqual(await records(unprovable), unprovableRows); assert.equal((await upgrades(unprovableRows.map(row => row.id))).length, 0); assert(!(await structure.getGroupStandings(unprovable.group!.id)).rankingConfirmed); check("unprovable legacy fingerprints are never upgraded");
      const v2 = await fixture("v2"), v2Rows = await records(v2); await scheduleMatch(v2.pending.id, nextSchedule(), grant); assert.deepEqual(await records(v2), v2Rows); await preserved(v2, v2Rows, 0); check("existing v2 confirmations remain byte-for-field unchanged");
      const ungrouped = await fixture("ungrouped"); await scheduleMatch(ungrouped.pending.id, nextSchedule(), grant); assert((await prisma.match.findUniqueOrThrow({ where: { id: ungrouped.pending.id } })).kickoff); check("ungrouped match schedules without touching confirmations");
      const invalid = await fixture(), invalidRows = await records(invalid); await assert.rejects(scheduleMatch(invalid.pending.id, { ...nextSchedule(), endAt: at(47) }, grant)); assert.deepEqual(await records(invalid), invalidRows); assert.equal((await upgrades(invalidRows.map(row => row.id))).length, 0); check("invalid parameters reject before confirmation or match writes");
      const rollback = await fixture(), rollbackRows = await records(rollback);
      await prisma.$executeRawUnsafe(`CREATE TRIGGER f03_schedule_abort BEFORE UPDATE OF kickoff ON "Match" WHEN OLD.id = '${rollback.pending.id}' BEGIN SELECT RAISE(ABORT, 'synthetic F03 schedule failure'); END`);
      try { await assert.rejects(scheduleMatch(rollback.pending.id, nextSchedule(), grant)); } finally { await prisma.$executeRawUnsafe("DROP TRIGGER f03_schedule_abort"); }
      assert.deepEqual(await records(rollback), rollbackRows); assert.equal((await upgrades(rollbackRows.map(row => row.id))).length, 0); assert.equal((await prisma.match.findUniqueOrThrow({ where: { id: rollback.pending.id } })).kickoff, null); assert.equal(await prisma.auditLog.count({ where: { entityId: rollback.pending.id, action: "MATCH_SCHEDULED" } }), 0); check("real SQLite abort rolls back upgrades, upgrade audit, scheduling and schedule audit atomically");
      await assert.rejects(scheduleMatch(first.pending.id, nextSchedule(), grant), (e: unknown) => e instanceof service.RefereeServiceError && e.status === 409); assert.equal(await prisma.auditLog.count({ where: { entityId: first.pending.id, action: "MATCH_SCHEDULED" } }), 1); await preserved(first, previous, 2); check("repeat scheduling cannot overwrite an arranged match or duplicate upgrades");
      await assert.rejects(scheduleMatch(first.played.id, nextSchedule(), grant), (e: unknown) => e instanceof service.RefereeServiceError && e.status === 409); await preserved(first, previous, 2); check("completed match state rejects scheduling before confirmation writes");
      const forbidden = await fixture(), forbiddenRows = await records(forbidden); await assert.rejects(scheduleMatch(forbidden.pending.id, nextSchedule(), {} as never), (e: unknown) => e instanceof service.RefereeServiceError && e.status === 403); assert.deepEqual(await records(forbidden), forbiddenRows); check("untrusted service authorization is rejected before writes");
      const race = await fixture(), raceRows = await records(race), barrier = path.join(root, "schedule.start"), outputs = [path.join(root, "race-a.json"), path.join(root, "race-b.json")];
      const raceMatch = await prisma.match.findUniqueOrThrow({ where: { id: race.pending.id } });
      const children = outputs.map((output, i) => spawn(process.execPath, ["--import", "tsx", path.resolve("scripts/test-f03-schedule-compat.ts"), "--schedule-worker", race.pending.id, admin.id, `虚构并发${i}`, barrier, output], { env: { ...process.env, F03_WORKER_ROOT: root }, stdio: ["ignore", "pipe", "pipe"] }));
      const stopped = children.map(child => once(child, "exit"));
      const childLogs = ["", ""];
      children.forEach((child, i) => { child.stdout.on("data", value => childLogs[i] += value); child.stderr.on("data", value => childLogs[i] += value); });
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        for (let i = 0; i < 200; i++) { if ((await Promise.all(outputs.map(file => stat(file + ".ready").catch(() => null)))).every(Boolean)) break; await pause(25); }
        assert((await Promise.all(outputs.map(file => stat(file + ".ready").catch(() => null)))).every(Boolean), childLogs.join("\n"));
        await writeFile(barrier, "go");
        const exits = await Promise.race([Promise.all(stopped), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Synthetic concurrency workers timed out")), 20000); })]);
        assert(exits.every(([code]) => code === 0), childLogs.join("\n"));
      } finally {
        clearTimeout(timeout);
        children.forEach(child => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM"); });
        await Promise.all(stopped);
        await writeFile(path.join(root, "concurrent-workers.log"), childLogs.join("\n"));
      }
      const outcomes = await Promise.all(outputs.map(async file => JSON.parse(await readFile(file, "utf8"))));
      const winners = outcomes.filter(o => o.saved);
      assert(winners.length <= 1, "Concurrent requests must never both schedule the match");
      for (const failure of outcomes.filter(o => !o.saved)) assert(failure.status === 409 || ["P1008", "SQLITE_BUSY"].includes(failure.code), JSON.stringify(failure));
      if (!winners.length) {
        // SQLite can reject both deferred transactions while they contend for its write lock.
        // Prove full rollback before one explicit recovery request; never auto-retry in production.
        assert.deepEqual(await prisma.match.findUniqueOrThrow({ where: { id: race.pending.id } }), raceMatch);
        assert.deepEqual(await records(race), raceRows);
        assert.equal((await upgrades(raceRows.map(row => row.id))).length, 0);
        assert.equal(await prisma.auditLog.count({ where: { entityId: race.pending.id, action: "MATCH_SCHEDULED" } }), 0);
        await scheduleMatch(race.pending.id, { ...nextSchedule(), venue: "虚构明确重试" }, grant);
      }
      assert.equal((await prisma.match.findUniqueOrThrow({ where: { id: race.pending.id } })).venue, winners[0]?.venue ?? "虚构明确重试");
      assert.equal(await prisma.auditLog.count({ where: { entityId: race.pending.id, action: "MATCH_SCHEDULED" } }), 1);
      await preserved(race, raceRows, 2);
      check("independent SQLite writers cannot duplicate or partially commit; explicit recovery succeeds after full rollback", { outcomes, immediateSuccesses: winners.length, explicitRecoveryRequests: winners.length ? 0 : 1 });
      const correctedRows = await records(first); await service.confirmMatchResult(first.played.id, { homeScore: 2, awayScore: 1, homePenaltyScore: null, awayPenaltyScore: null, expectedVersion: 1, actualEnded: true, reason: "虚构真实赛果更正" }, grant); const changed = await structure.getGroupStandings(first.group!.id); assert(changed.rankingStale && changed.qualificationStale); assert.deepEqual(changed.qualifiedTeamIds, []); assert.deepEqual(await records(first), correctedRows); check("real result correction invalidates confirmations without deleting history");
    }
    if (http) {
      const socket = net.createServer(); socket.listen(0, "127.0.0.1"); await once(socket, "listening"); const port = (socket.address() as net.AddressInfo).port; await new Promise<void>(resolve => socket.close(() => resolve())); const origin = `http://127.0.0.1:${port}`;
      await prisma.adminSession.create({ data: { adminAccountId: admin.id, tokenHash: createHmac("sha256", adminSecret).update("f03-admin").digest("hex"), expiresAt: at(1) } });
      const editor = await prisma.adminAccount.create({ data: { username: "f03-content-only", displayName: "虚构内容编辑", role: "REFEREE_MANAGER", unifiedRoles: { create: { role: "CONTENT_EDITOR" } }, passwordHash: "synthetic-not-a-password", mustChangePassword: false } });
      await prisma.adminSession.create({ data: { adminAccountId: editor.id, tokenHash: createHmac("sha256", adminSecret).update("f03-editor").digest("hex"), expiresAt: at(1) } });
      server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], { env: { PATH: process.env.PATH, HOME: os.homedir(), TMPDIR: root, TZ: "UTC", NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", DATABASE_URL: `file:${database}`, NUAAFA_UPLOAD_DIR: uploads, REFEREE_ADMIN_SESSION_SECRET: adminSecret, REFEREE_MEMBER_SESSION_SECRET: "Synthetic-F03-Member-Only-2026" }, stdio: ["ignore", "pipe", "pipe"] });
      server.stdout!.on("data", value => serverLog += value); server.stderr!.on("data", value => serverLog += value);
      let ready = false; for (let i = 0; i < 100; i++) { try { if ((await fetch(origin + "/api/health")).ok) { ready = true; break; } } catch { /* Await this synthetic server only. */ } await pause(100); } assert(ready, serverLog);
      const requests: Array<Record<string, unknown>> = [];
      const post = async (id: string, input = nextSchedule(), token = "f03-admin", source = "https://nuaafa.cn", endpoint = "schedule") => { const response = await fetch(origin + `/api/admin/matches/${id}/${endpoint}`, { method: "POST", headers: { cookie: `nuaa_referee_admin=${token}`, origin: source, "content-type": "application/json" }, body: JSON.stringify(input) }); const body = await response.text(); requests.push({ method: "POST", id, endpoint, input, source, principal: token === "f03-admin" ? "fictional administrator" : token === "f03-editor" ? "fictional content editor" : "invalid session", status: response.status, body }); return response.status; };
      const live = await fixture(), liveRows = await records(live); assert.equal(await post(live.pending.id), 200);
      if (before) { assert(!(await structure.getGroupStandings(live.group!.id)).rankingConfirmed); check("before real authenticated HTTP first scheduling reproduces the same legacy loss"); }
      else {
        check("real authenticated HTTP scheduling preserves proofs and history", await preserved(live, liveRows, 2));
        const protectedFixture = await fixture(), protectedRows = await records(protectedFixture);
        assert.equal(await post(protectedFixture.pending.id, nextSchedule(), "missing"), 401); assert.equal(await post(protectedFixture.pending.id, nextSchedule(), "f03-editor"), 403); assert.equal(await post(protectedFixture.pending.id, nextSchedule(), "f03-admin", "https://invalid.example"), 403); assert.deepEqual(await records(protectedFixture), protectedRows); assert.equal((await prisma.match.findUniqueOrThrow({ where: { id: protectedFixture.pending.id } })).kickoff, null); check("HTTP anonymous, unauthorized role and cross-origin requests cannot write");
        assert.equal(await post(live.pending.id), 409); assert.equal(await prisma.auditLog.count({ where: { entityId: live.pending.id, action: "MATCH_SCHEDULED" } }), 1); check("HTTP repeat scheduling retains the original result");
        assert.equal(await post(live.played.id), 409); await preserved(live, liveRows, 2); check("HTTP completed state cannot be scheduled");
        const liveV2 = await fixture("v2"), liveV2Rows = await records(liveV2); assert.equal(await post(liveV2.pending.id), 200); assert.deepEqual(await records(liveV2), liveV2Rows); await preserved(liveV2, liveV2Rows, 0); check("HTTP v2 confirmations are unchanged");
        const liveUngrouped = await fixture("ungrouped"); assert.equal(await post(liveUngrouped.pending.id), 200); check("HTTP ungrouped scheduling succeeds");
        const invalidHttpRows = await records(protectedFixture); assert.equal(await post(protectedFixture.pending.id, { ...nextSchedule(), endAt: at(47) }), 400); assert.deepEqual(await records(protectedFixture), invalidHttpRows); assert.equal((await upgrades(invalidHttpRows.map(row => row.id))).length, 0); check("HTTP invalid end time returns 400 without writes");
        const liveStale = await fixture("stale"), liveStaleRows = await records(liveStale); assert.equal(await post(liveStale.pending.id), 200); assert.deepEqual(await records(liveStale), liveStaleRows); assert(!(await structure.getGroupStandings(liveStale.group!.id)).rankingConfirmed); check("HTTP stale legacy proofs remain unverified");
        const liveRollback = await fixture(), liveRollbackRows = await records(liveRollback);
        await prisma.$executeRawUnsafe(`CREATE TRIGGER f03_http_abort BEFORE UPDATE OF kickoff ON "Match" WHEN OLD.id = '${liveRollback.pending.id}' BEGIN SELECT RAISE(ABORT, 'synthetic HTTP failure'); END`);
        try { assert.equal(await post(liveRollback.pending.id), 500); } finally { await prisma.$executeRawUnsafe("DROP TRIGGER f03_http_abort"); }
        assert.deepEqual(await records(liveRollback), liveRollbackRows); assert.equal((await upgrades(liveRollbackRows.map(row => row.id))).length, 0); assert.equal((await prisma.match.findUniqueOrThrow({ where: { id: liveRollback.pending.id } })).kickoff, null); assert(!requests.some(row => /fictional\.db|SELECT |synthetic HTTP failure|PrismaClient/.test(String(row.body)))); check("HTTP storage failure is sanitized and rolls back proof and match writes");
        if (process.argv.includes("--observe-tentative")) {
          const other = await fixture(); const initial = await structure.getGroupStandings(other.group!.id);
          const input = { tentativeDate: "2026-12-01", tentativeSchedule: "虚构待定安排" };
          const response = await fetch(origin + `/api/admin/matches/${other.pending.id}/tentative`, { method: "POST", headers: { cookie: "nuaa_referee_admin=f03-admin", origin: "https://nuaafa.cn", "content-type": "application/json" }, body: JSON.stringify(input) }); assert.equal(response.status, 200);
          requests.push({ method: "POST", id: other.pending.id, endpoint: "tentative", input, source: "https://nuaafa.cn", principal: "fictional administrator", status: response.status, body: await response.text() });
          const observed = await structure.getGroupStandings(other.group!.id);
          knownFindings.push({ id: "F03-TENTATIVE", status: observed.rankingConfirmed ? "PASS" : "FAIL", scope: "other write entry observation only; not modified or silently accepted", http: response.status, before: initial.confirmationCompatibility, after: observed.confirmationCompatibility, rankingFingerprintUnchanged: initial.fingerprint === observed.fingerprint, qualifiersBefore: initial.qualifiedTeamIds, qualifiersAfter: observed.qualifiedTeamIds });
        }
      }
      await writeFile(path.join(root, "requests.json"), JSON.stringify(requests, null, 2));
      const evidence = process.env.F03_EVIDENCE_DIR; if (evidence) await writeFile(path.join(evidence, before ? "http-before.json" : "http-after.json"), JSON.stringify(requests, null, 2));
    }
    const result = { status: "PASS", mode: before ? "before defects reproduced" : "specified scheduling fix accepted", syntheticDatabase: true, root, checks, knownFindings, mergeReadiness: knownFindings.some(row => row.status === "FAIL") ? "NO-GO" : "not assessed by this test" };
    if (process.env.F03_EVIDENCE_DIR) await writeFile(path.join(process.env.F03_EVIDENCE_DIR, before ? "f03-before.json" : http ? "f03-http-after.json" : "f03-service-after.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (server && server.exitCode === null && server.signalCode === null) { const exit = once(server, "exit"); server.kill("SIGTERM"); await exit; }
    if (http && process.env.F03_EVIDENCE_DIR) await writeFile(path.join(process.env.F03_EVIDENCE_DIR, before ? "http-before-server.log" : "http-after-server.log"), serverLog);
    await prisma.$disconnect();
  }
}
(worker >= 0 ? scheduleWorker() : main()).catch(error => { console.error(error); process.exitCode = 1; });
