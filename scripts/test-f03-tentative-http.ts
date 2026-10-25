import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";

const before = process.argv.includes("--before");
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const parent = await realpath(process.env.F03_TEST_ROOT ?? os.tmpdir());
  const root = await realpath(await mkdtemp(path.join(parent, "f03-tentative-")));
  const database = path.join(root, "fictional.db"), uploads = path.join(root, "uploads");
  await mkdir(uploads);
  Object.assign(process.env, { DATABASE_URL: "file:" + database, NUAAFA_UPLOAD_DIR: uploads, NODE_ENV: "test", NUAAFA_ISOLATED_SECURITY_TEST: "1" });
  const raw = createClient({ url: process.env.DATABASE_URL! });
  const migrations = (await readdir("prisma/migrations", { withFileTypes: true })).filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of migrations) await raw.executeMultiple(await readFile(path.join("prisma/migrations", entry.name, "migration.sql"), "utf8"));
  raw.close(); assert.equal(migrations.length, 20); assert.equal(await realpath(database), database);
  const { prisma } = await import("../src/lib/prisma");
  const service = await import("../src/lib/referee-service");
  const structure = await import("../src/lib/competition-structure-service");
  const caps = await import("./security-r4a-test-capabilities");
  const { hashPassword } = await import("../src/lib/referee-security");
  const password = "Synthetic-F03-Tentative-Only-2026!";
  const passwordHash = await hashPassword(password);
  const original = await prisma.adminAccount.create({ data: { username: "tentative-historical-confirmer", displayName: "虚构历史确认人", role: "SUPER_ADMIN", passwordHash } });
  const editor = await prisma.adminAccount.create({ data: { username: "tentative-current-admin", displayName: "虚构本次管理员", role: "SUPER_ADMIN", passwordHash } });
  await prisma.adminAccount.create({ data: { username: "tentative-content-only", displayName: "虚构内容编辑", role: "REFEREE_MANAGER", passwordHash, unifiedRoles: { create: { role: "CONTENT_EDITOR" } } } });
  await prisma.adminAccount.create({ data: { username: "tentative-change-required", displayName: "虚构须改密账号", role: "SUPER_ADMIN", passwordHash, mustChangePassword: true } });
  const actor = { ...caps.testUnifiedAdminActor({ id: original.id }), role: "SUPER_ADMIN" as const };
  const grant = caps.issueTestAdminServiceAuthorization("competitions:write", actor);
  const at = (hours: number) => new Date(Date.now() + hours * 3600000);
  const input = (note = "虚构待定安排") => ({ tentativeDate: "2026-12-01", tentativeSchedule: note });
  let seq = 0;
  async function fixture(kind: "legacy" | "stale" | "unprovable" | "v2" | "ungrouped" = "legacy") {
    const key = "tentative-" + ++seq;
    const competition = await prisma.competition.create({ data: { slug: key, name: "虚构赛事" + key, campus: "虚构校区", format: "FUTSAL", status: "ONGOING", publicPublished: true } });
    const teams = await Promise.all(["A", "B", "C"].map(name => prisma.team.create({ data: { competitionId: competition.id, name: "虚构" + name } })));
    const stage = kind === "ungrouped" ? null : await prisma.competitionStage.create({ data: { competitionId: competition.id, name: "虚构小组赛", type: "GROUP" } });
    const group = stage ? await prisma.competitionGroup.create({ data: { stageId: stage.id, name: "虚构A组" } }) : null;
    if (group && stage) await prisma.teamGroupMembership.createMany({ data: teams.map(t => ({ teamId: t.id, stageId: stage.id, groupId: group.id })) });
    const common = { competitionId: competition.id, stage: "虚构比赛", stageId: stage?.id, groupId: group?.id, homeTeamId: teams[0].id, status: "SCHEDULED" as const, applicationWindowStatus: "CLOSED" as const, positionCounts: {} };
    const played = await service.createMatch({ ...common, slug: key + "-played", awayTeamId: teams[1].id, kickoff: at(-48), endAt: at(-46), venue: "虚构已赛场地" }, actor);
    const correction = { homeScore: 1, awayScore: 1, homePenaltyScore: null, awayPenaltyScore: null, expectedVersion: 0, actualEnded: true, reason: "虚构完赛平局" };
    await service.confirmMatchResult(played.id, correction, grant);
    const pending = await service.createMatch({ ...common, slug: key + "-pending", awayTeamId: teams[2].id, kickoff: null, venue: null }, actor);
    if (group) {
      const table = await structure.getGroupStandings(group.id), order = [teams[1].id, teams[0].id, teams[2].id];
      if (kind === "v2") {
        await structure.confirmGroup(competition.id, group.id, { kind: "RANKING", teamIds: order, fingerprint: table.fingerprint, reason: "虚构人工次序" }, actor);
        const ranked = await structure.getGroupStandings(group.id);
        await structure.confirmGroup(competition.id, group.id, { kind: "QUALIFICATION", teamIds: [teams[1].id], fingerprint: ranked.qualificationFingerprint, reason: "提前确认：虚构规程" }, actor);
      } else {
        const matches = await prisma.match.findMany({ where: { groupId: group.id }, orderBy: { id: "asc" } });
        // Independent historical serialization; do not use the helper under test.
        const digest = createHash("sha256").update(JSON.stringify({ members: teams.map(t => t.id).sort(), matches: matches.map(m => [m.id, m.homeTeamId, m.awayTeamId, m.homeScore, m.awayScore, m.status, m.resultVersion, m.updatedAt]) })).digest("hex");
        const fingerprint = kind === "unprovable" ? "0".repeat(64) : digest;
        const ranking = await prisma.groupConfirmation.create({ data: { groupId: group.id, kind: "RANKING", teamIds: order, fingerprint, reason: "虚构旧人工同分次序", actorId: original.id, createdAt: new Date("2026-08-01T00:00:00Z") } });
        await prisma.groupConfirmation.create({ data: { groupId: group.id, kind: "QUALIFICATION", teamIds: [teams[1].id], fingerprint: createHash("sha256").update(fingerprint + ranking.id).digest("hex"), reason: "提前确认：虚构旧规程", actorId: original.id, createdAt: new Date("2026-08-01T00:00:01Z") } });
        if (kind === "stale") {
          assert((await structure.getGroupStandings(group.id)).rankingConfirmed);
          await service.confirmMatchResult(played.id, { ...correction, homeScore: 2, expectedVersion: 1, reason: "虚构旧确认后真实赛果更正" }, grant);
          const stale = await structure.getGroupStandings(group.id); assert(stale.rankingStale && stale.qualificationStale);
        }
      }
    }
    return { competition, teams, group, played, pending };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const confirmations = (f: Fixture) => prisma.groupConfirmation.findMany({ where: { groupId: f.group!.id }, orderBy: { id: "asc" } });
  async function upgrades(f: Fixture) {
    const rows = await confirmations(f);
    return prisma.auditLog.findMany({ where: { action: "GROUP_CONFIRMATION_FINGERPRINT_UPGRADED", entityId: { in: rows.map(r => r.id) } }, orderBy: { id: "asc" } });
  }
  const tentativeAudit = (f: Fixture) => prisma.auditLog.findMany({ where: { action: "MATCH_TENTATIVE_UPDATED", entityId: f.pending.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const historical = (rows: Awaited<ReturnType<typeof confirmations>>) => rows.map(r => ({ id: r.id, groupId: r.groupId, kind: r.kind, teamIds: r.teamIds, reason: r.reason, actorId: r.actorId, createdAt: r.createdAt }));
  const matchFacts = (m: Fixture["pending"]) => { const { tentativeDate, tentativeSchedule, updatedAt, ...rest } = m; void tentativeDate; void tentativeSchedule; void updatedAt; return rest; };
  const load = (f: Fixture) => prisma.match.findUniqueOrThrow({ where: { id: f.pending.id } });
  async function unchanged(f: Fixture, rows: Awaited<ReturnType<typeof confirmations>>) {
    assert.deepEqual(await confirmations(f), rows); assert.deepEqual(await load(f), f.pending);
    assert.equal((await upgrades(f)).length, 0); assert.equal((await tentativeAudit(f)).length, 0);
  }
  async function preserved(f: Fixture, prior: Awaited<ReturnType<typeof confirmations>>, upgradeCount = 2) {
    const table = await structure.getGroupStandings(f.group!.id), rows = await confirmations(f), audit = await upgrades(f);
    assert(table.rankingConfirmed); assert.deepEqual(table.qualifiedTeamIds, [f.teams[1].id]); assert.deepEqual(table.rows.map(r => r.id), [f.teams[1].id, f.teams[0].id, f.teams[2].id]);
    assert.deepEqual(historical(rows), historical(prior)); assert.equal(audit.length, upgradeCount);
    for (const row of rows) assert(row.fingerprint.startsWith("v2:"));
    for (const row of audit) {
      assert.equal(row.actorId, editor.id); const metadata = JSON.parse(row.metadata!);
      const old = prior.find(r => r.id === row.entityId)!, current = rows.find(r => r.id === row.entityId)!;
      assert.equal(metadata.before, old.fingerprint); assert.equal(metadata.after, current.fingerprint); assert.equal(metadata.verifiedBeforeBusinessWrite, true);
    }
    const updated = await load(f); assert.deepEqual(matchFacts(updated), matchFacts(f.pending));
    const writes = await tentativeAudit(f);
    for (const row of writes) { assert.equal(row.actorId, editor.id); assert.equal(JSON.parse(row.metadata!).competitionId, f.competition.id); }
    return { compatibility: table.confirmationCompatibility, order: table.rows.map(r => r.id), qualifiers: table.qualifiedTeamIds, before: prior, after: rows, upgradeAudit: audit, tentativeAudit: writes, matchBefore: f.pending, matchAfter: updated };
  }
  const servers: Array<{ child: ReturnType<typeof spawn>; origin: string; log: string }> = [];
  const requests: Array<Record<string, unknown>> = [], checks: Array<Record<string, unknown>> = [];
  const evidence = process.env.F03_TENTATIVE_EVIDENCE;
  const record = (name: string, detail?: unknown) => { checks.push({ name, status: "PASS", detail }); console.log("PASS F03-TENTATIVE " + name); };
  async function startServer() {
    const socket = net.createServer(); socket.listen(0, "127.0.0.1"); await once(socket, "listening");
    const port = (socket.address() as net.AddressInfo).port; await new Promise<void>(resolve => socket.close(() => resolve()));
    const origin = "http://127.0.0.1:" + port;
    const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], { env: { PATH: process.env.PATH, HOME: os.homedir(), TMPDIR: root, TZ: "UTC", NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", DATABASE_URL: "file:" + database, NUAAFA_UPLOAD_DIR: uploads, REFEREE_ADMIN_SESSION_SECRET: "Synthetic-F03-Tentative-Admin-2026", REFEREE_MEMBER_SESSION_SECRET: "Synthetic-F03-Tentative-Member-2026" }, stdio: ["ignore", "pipe", "pipe"] });
    const server = { child, origin, log: "" }; servers.push(server);
    child.stdout!.on("data", value => server.log += value); child.stderr!.on("data", value => server.log += value);
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) break;
      try { if ((await fetch(origin + "/api/health", { signal: AbortSignal.timeout(2000) })).ok) { ready = true; break; } } catch { /* Wait for this synthetic process. */ }
      await pause(100);
    }
    assert(ready, server.log); return origin;
  }
  async function login(origin: string, username: string) {
    const response = await fetch(origin + "/api/referees/admin/login", { method: "POST", headers: { origin: "https://nuaafa.cn", "content-type": "application/json" }, body: JSON.stringify({ username, password }), signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 200, await response.clone().text());
    const cookie = response.headers.getSetCookie().find(value => value.startsWith("nuaa_referee_admin="))?.split(";")[0]; assert(cookie); return cookie;
  }
  async function post(origin: string, id: string, body: unknown, cookie: string, source: string | null = "https://nuaafa.cn", endpoint = "tentative") {
    const response = await fetch(origin + "/api/admin/matches/" + id + "/" + endpoint, { method: "POST", headers: { ...(cookie ? { cookie } : {}), ...(source ? { origin: source } : {}), "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const text = await response.text(); const data: unknown = JSON.parse(text);
    requests.push({ origin, method: "POST", id, endpoint, input: body, principal: cookie ? cookie.includes("invalid") ? "invalid session" : "synthetic authenticated account" : "anonymous", source, status: response.status, body: data });
    assert(!/fictional\.db|SELECT |UPDATE |synthetic.*abort|PrismaClient|\/Users\/|node_modules/i.test(text), text);
    return { status: response.status, body: data as { error?: string; code?: string; correlationId?: string } };
  }
  let result: Record<string, unknown> | undefined;
  try {
    const origin = await startServer(), adminCookie = await login(origin, editor.username);
    record("real password login creates an authenticated synthetic administrator session");
    const first = await fixture(), old = await confirmations(first), prior = await structure.getGroupStandings(first.group!.id);
    assert(prior.rankingConfirmed); assert.equal(prior.confirmationCompatibility.qualification, "LEGACY_VALID");
    assert.equal((await post(origin, first.pending.id, input(), adminCookie)).status, 200);
    if (before) {
      const lost = await structure.getGroupStandings(first.group!.id); assert(!lost.rankingConfirmed); assert.deepEqual(lost.qualifiedTeamIds, []);
      record("baseline authenticated HTTP reproduces valid legacy confirmation loss", { before: prior.confirmationCompatibility, after: lost.confirmationCompatibility, v2FingerprintUnchanged: prior.fingerprint === lost.fingerprint });
    } else {
      record("valid legacy order, early qualifiers and different original confirmer survive HTTP mutation", await preserved(first, old));
      assert.equal((await tentativeAudit(first)).length, 1);
      const upgraded = await confirmations(first);
      for (const body of [input("虚构第二次修改"), input("虚构第二次修改"), { tentativeDate: "", tentativeSchedule: "" }]) assert.equal((await post(origin, first.pending.id, body, adminCookie)).status, 200);
      assert.deepEqual(await confirmations(first), upgraded); await preserved(first, old); assert.equal((await tentativeAudit(first)).length, 4);
      const cleared = await load(first); assert.equal(cleared.tentativeDate, null); assert.equal(cleared.tentativeSchedule, null);
      record("repeat, identical repeat and clearing edits keep one upgrade pair and one audit per successful request");

      for (const kind of ["stale", "unprovable", "v2"] as const) {
        const f = await fixture(kind), rows = await confirmations(f);
        assert.equal((await post(origin, f.pending.id, input(), adminCookie)).status, 200);
        assert.deepEqual(await confirmations(f), rows); assert.equal((await upgrades(f)).length, 0);
        if (kind === "v2") await preserved(f, rows, 0);
        else { const table = await structure.getGroupStandings(f.group!.id); assert(table.rankingStale && table.qualificationStale); assert.deepEqual(table.qualifiedTeamIds, []); }
        record(kind + " confirmation behavior is preserved through real HTTP");
      }
      const ungrouped = await fixture("ungrouped"), count = await prisma.groupConfirmation.count();
      assert.equal((await post(origin, ungrouped.pending.id, input(), adminCookie)).status, 200); assert.equal(await prisma.groupConfirmation.count(), count); assert.deepEqual(matchFacts(await load(ungrouped)), matchFacts(ungrouped.pending)); assert.equal((await tentativeAudit(ungrouped)).length, 1);
      record("ungrouped mutation keeps formal schedule and all confirmations untouched");

      const locked = await fixture(), lockedRows = await confirmations(locked);
      const contentCookie = await login(origin, "tentative-content-only"), passwordCookie = await login(origin, "tentative-change-required");
      for (const [cookie, source, status] of [["", "https://nuaafa.cn", 401], ["nuaa_referee_admin=invalid", "https://nuaafa.cn", 401], [contentCookie, "https://nuaafa.cn", 403], [passwordCookie, "https://nuaafa.cn", 403], [adminCookie, "https://invalid.example", 403], [adminCookie, null, 403]] as const) {
        assert.equal((await post(origin, locked.pending.id, input(), cookie, source)).status, status); await unchanged(locked, lockedRows);
      }
      record("anonymous, invalid session, content role, password-change gate and CSRF are enforced before writes");
      for (const body of [{ tentativeDate: "2026-02-30", tentativeSchedule: "虚构" }, { tentativeDate: "2026-12-01", tentativeSchedule: "x".repeat(501) }, { tentativeDate: 10, tentativeSchedule: "虚构" }]) {
        assert.equal((await post(origin, locked.pending.id, body, adminCookie)).status, 400); await unchanged(locked, lockedRows);
      }
      assert.equal((await post(origin, locked.played.id, input(), adminCookie)).status, 409); await unchanged(locked, lockedRows);
      assert.equal((await post(origin, "fictional-not-found", input(), adminCookie)).status, 409);
      record("invalid input and completed or missing matches cannot upgrade or mutate records");

      const rollback = await fixture(), rollbackRows = await confirmations(rollback);
      await prisma.$executeRawUnsafe("CREATE TRIGGER f03_tentative_abort BEFORE UPDATE OF tentativeDate ON \"Match\" WHEN OLD.id = '" + rollback.pending.id + "' BEGIN SELECT RAISE(ABORT, 'synthetic tentative abort'); END");
      try { const failure = await post(origin, rollback.pending.id, input(), adminCookie); assert.equal(failure.status, 500); assert.equal(failure.body.code, "INTERNAL_ERROR"); assert(failure.body.correlationId); }
      finally { await prisma.$executeRawUnsafe("DROP TRIGGER f03_tentative_abort"); }
      await unchanged(rollback, rollbackRows);
      assert.equal((await post(origin, rollback.pending.id, input("虚构回滚后明确重试"), adminCookie)).status, 200);
      record("real SQLite abort rolls back proof, match and both audits; one explicit HTTP retry succeeds", await preserved(rollback, rollbackRows));

      const secondOrigin = await startServer();
      const blocked = await fixture(), blockedRows = await confirmations(blocked);
      // A separate process explicitly closes its native connection before recovery.
      // Closing a libsql client does not close a connection detached into a transaction.
      const holder = spawn("python3", ["-u", "-c", [
        "import sqlite3, sys",
        "db = sqlite3.connect(sys.argv[1], timeout=1)",
        "try:",
        " db.execute('BEGIN IMMEDIATE')",
        " db.execute('UPDATE Match SET tentativeDate = tentativeDate WHERE 0')",
        " print('LOCKED', flush=True)",
        " assert sys.stdin.readline().strip() == 'release'",
        "finally:",
        " db.rollback()",
        " db.close()",
        "print('RELEASED', flush=True)",
      ].join("\n"), database], { stdio: ["pipe", "pipe", "pipe"] });
      const holderExit = once(holder, "exit"); let holderLog = "", holderError = "";
      holder.stdout.on("data", value => holderLog += value); holder.stderr.on("data", value => holderError += value);
      const lockResponses: Awaited<ReturnType<typeof post>>[] = [];
      try {
        for (let i = 0; i < 100 && !holderLog.includes("LOCKED"); i++) await pause(25);
        assert(holderLog.includes("LOCKED"), holderError);
        lockResponses.push(...await Promise.all([post(origin, blocked.pending.id, input("虚构持锁A"), adminCookie), post(secondOrigin, blocked.pending.id, input("虚构持锁B"), adminCookie)]));
        for (const failure of lockResponses) { assert.equal(failure.status, 409); assert.equal(failure.body.error, "其他管理员正在更新相关任务，请刷新核对后重试。"); }
      } finally {
        holder.stdin.end("release\n");
        const timer = setTimeout(() => holder.kill("SIGTERM"), 5000);
        const [code, signal] = await holderExit; clearTimeout(timer);
        await writeFile(path.join(root, "external-lock-holder.log"), holderLog + holderError);
        assert.equal(code, 0, holderError); assert.equal(signal, null); assert(holderLog.includes("RELEASED"));
      }
      await unchanged(blocked, blockedRows);
      assert.equal((await post(origin, blocked.pending.id, input("虚构写锁释放后单次重试"), adminCookie)).status, 200);
      await preserved(blocked, blockedRows); assert.equal((await tentativeAudit(blocked)).length, 1);
      record("two independent HTTP processes under a real writer lock fail safely, fully roll back and recover once", { lockResponses, immediateSuccesses: 0, explicitRecoveryRequests: 1 });

      const race = await fixture(), raceRows = await confirmations(race);
      const raceInputs = [{ tentativeDate: "2026-12-02", tentativeSchedule: "虚构并发A" }, { tentativeDate: "2026-12-03", tentativeSchedule: "虚构并发B" }];
      const outcomes = await Promise.all([post(origin, race.pending.id, raceInputs[0], adminCookie), post(secondOrigin, race.pending.id, raceInputs[1], adminCookie)]);
      const successes = outcomes.flatMap((response, i) => response.status === 200 ? [raceInputs[i]] : []);
      for (const response of outcomes.filter(r => r.status !== 200)) { assert.equal(response.status, 409); assert.equal(response.body.error, "其他管理员正在更新相关任务，请刷新核对后重试。"); }
      assert.equal((await tentativeAudit(race)).length, successes.length);
      if (!successes.length) {
        await unchanged(race, raceRows);
        assert.equal((await post(origin, race.pending.id, input("虚构并发后单次重试"), adminCookie)).status, 200);
      }
      const raceSaved = await load(race), successfulInputs = successes.length ? successes : [input("虚构并发后单次重试")];
      assert(successfulInputs.some(v => v.tentativeDate === raceSaved.tentativeDate && v.tentativeSchedule === raceSaved.tentativeSchedule));
      assert.equal((await tentativeAudit(race)).length, successes.length || 1); await preserved(race, raceRows);
      record("unblocked simultaneous HTTP edits keep complete field pairs, exact audit counts and a single proof upgrade", { outcomes, successes: successes.length, explicitRecoveryRequests: successes.length ? 0 : 1, semantics: "Repeated tentative edits are permitted; two successful responses can be naturally serialized edits, never two proof upgrades." });

      const beforeCorrection = await confirmations(first);
      const correction = { homeScore: 2, awayScore: 1, homePenaltyScore: null, awayPenaltyScore: null, expectedVersion: 1, actualEnded: true, reason: "虚构真实赛果更正" };
      assert.equal((await post(origin, first.played.id, correction, adminCookie, "https://nuaafa.cn", "result")).status, 200);
      const stale = await structure.getGroupStandings(first.group!.id); assert(stale.rankingStale && stale.qualificationStale); assert.deepEqual(stale.qualifiedTeamIds, []); assert.deepEqual(await confirmations(first), beforeCorrection);
      assert.equal((await post(origin, first.pending.id, input("虚构更正后暂定编辑"), adminCookie)).status, 200);
      const stillStale = await structure.getGroupStandings(first.group!.id); assert(stillStale.rankingStale && stillStale.qualificationStale); assert.deepEqual(stillStale.qualifiedTeamIds, []); assert.deepEqual(await confirmations(first), beforeCorrection);
      record("real authenticated result correction invalidates proofs; later tentative edits never resurrect them");
      assert(!servers.some(s => /fictional\.db|SELECT |synthetic tentative abort|\/Users\/|node_modules/.test(s.log)));
      record("HTTP failures and server logs remain sanitized");
    }
    result = { status: "PASS", scope: before ? "baseline defect reproduced" : "F03-TENTATIVE local acceptance", root, syntheticDatabase: true, migrations: migrations.length, sourceHeadAtTest: process.env.F03_EXPECTED_HEAD ?? "see command identity log", checks, requestCount: requests.length, localOnly: true };
  } catch (error) {
    result = { status: "FAIL", scope: "F03-TENTATIVE", root, checks, error: error instanceof Error ? error.message : String(error) }; throw error;
  } finally {
    for (const server of servers) {
      if (server.child.exitCode === null && server.child.signalCode === null) { const exited = once(server.child, "exit"); server.child.kill("SIGTERM"); await exited; }
    }
    const label = before ? "tentative-before" : "tentative-after";
    await writeFile(path.join(root, "requests.json"), JSON.stringify(requests, null, 2));
    if (evidence) {
      await writeFile(path.join(evidence, label + ".json"), JSON.stringify(result, null, 2));
      await writeFile(path.join(evidence, label + "-requests.json"), JSON.stringify(requests, null, 2));
      for (let i = 0; i < servers.length; i++) await writeFile(path.join(evidence, label + "-server-" + i + ".log"), servers[i].log);
    }
    await prisma.$disconnect();
  }
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
