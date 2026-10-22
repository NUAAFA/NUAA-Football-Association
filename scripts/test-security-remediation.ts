import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { zipSync, strToU8 } from "fflate";
import { readBoundedJson } from "../src/lib/bounded-json";
import { prepareCompetitionImportXlsx } from "../src/lib/competition-import-xlsx-security";
import { parseCompetitionImportXlsx } from "../src/lib/competition-import-parser";
import { RefereeServiceError } from "../src/lib/referee-service-error";

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "nuaafa-security-remediation-"));
  process.env.DATABASE_URL = `file:${path.join(root, "synthetic.db")}`;
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.NUAAFA_ISOLATED_SECURITY_TEST = "1";
  const client = createClient({ url: process.env.DATABASE_URL });
  for (const name of (await readdir("prisma/migrations")).sort()) {
    if (name === "migration_lock.toml") continue;
    await client.executeMultiple(await readFile(path.join("prisma/migrations", name, "migration.sql"), "utf8"));
  }
  client.close();
  const { prisma } = await import("../src/lib/prisma");
  const quota = await import("../src/lib/request-budget");
  const service = await import("../src/lib/referee-service");
  const r1 = await import("../src/lib/referee-r1-service");
  const admission = await import("../src/lib/referee-admission-service");
  const security = await import("../src/lib/referee-security");
  const credentials = await import("../src/lib/referee-credentials");
  const issuance = await import("../src/lib/session-issuance");
  const caps = await import("./security-r4a-test-capabilities");
  const actor = { id: null, role: "SUPER_ADMIN" as const };
  const appointmentAuth = caps.issueTestAdminServiceAuthorization("referees:write", caps.testUnifiedAdminActor({ isLegacy: true }));
  const rejected = (fn: () => Promise<unknown>, status: number) => assert.rejects(fn, (error: unknown) => error instanceof Error && "status" in error && error.status === status);
  try {
    const json = (value: string) => new Request("http://localhost/api/referees/login", { method: "POST", headers: { "content-type": "application/json" }, body: value });
    assert.deepEqual(await readBoundedJson(json('{"ok":true}'), 32), { ok: true });
    await rejected(() => readBoundedJson(json('{"extra":"bounded fixture"}'), 12), 413);
    await rejected(() => readBoundedJson(new Request("http://localhost/", { method: "POST", body: "{}" })), 415);
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new Uint8Array(8)); }, cancel() { cancelled = true; } });
    await rejected(() => readBoundedJson(new Request("http://localhost/", { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit), 12), 413);
    assert(cancelled);
    console.log("PASS R02: byte-limited JSON and chunked cancellation before parsing");

    const xml = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:A2"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>name</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Fictitious Team</t></is></c></row></sheetData></worksheet>';
    const files = {
      "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
      "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      "xl/workbook.xml": '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Import" sheetId="1" r:id="rId1"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      "xl/worksheets/sheet1.xml": xml,
    };
    const workbook = Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))));
    assert.equal((await parseCompetitionImportXlsx(workbook, "TEAM")).rows.length, 1);
    const mismatch = Buffer.from(workbook);
    // Tiny inconsistent fixture; no allocation or stress test beyond 4 KB.
    mismatch.writeUInt32LE(4096, 22);
    assert.throws(() => prepareCompetitionImportXlsx(mismatch));
    console.log("PASS S01: valid workbook preserved; inconsistent headers rejected before downstream allocation");

    const reservations = await Promise.allSettled(Array.from({ length: 12 }, () => quota.consumeRequestQuota("regression:atomic", "synthetic", 3, 60_000)));
    assert.equal(reservations.filter((r) => r.status === "fulfilled").length, 3);
    assert(reservations.filter((r) => r.status === "rejected").every((r) => r.status === "rejected" && r.reason instanceof RefereeServiceError && r.reason.status === 429));
    const now = new Date();
    await quota.consumeRequestQuota("regression:expiry", "synthetic", 1, 1000, now);
    await rejected(() => quota.consumeRequestQuota("regression:expiry", "synthetic", 1, 1000, now), 429);
    await quota.consumeRequestQuota("regression:expiry", "synthetic", 1, 1000, new Date(now.getTime() + 1001));
    for (let i = 0; i < 20; i++) (await quota.reserveLoginBudget("admin", new Request("http://localhost/", { headers: { "x-real-ip": `192.0.2.${i + 1}` } }), "synthetic-account"))();
    await rejected(() => quota.reserveLoginBudget("admin", new Request("http://localhost/", { headers: { "x-real-ip": "192.0.2.2" } }), "synthetic-account"), 429);
    console.log("PASS S02: atomic concurrency, expiry and cross-address account budgets");

    const oldPassword = "Synthetic-Old-Password-2026!", nextPassword = "Synthetic-New-Password-2026!";
    const hash = await security.hashPassword(oldPassword);
    const admin = await prisma.adminAccount.create({ data: { username: "security-fixture-admin", displayName: "Synthetic administrator", passwordHash: hash, role: "SUPER_ADMIN" } });
    const adminAuth = caps.issueTestAdminServiceAuthorization("dashboard:read", caps.testUnifiedAdminActor({ id: admin.id }));
    let seen!: () => void, resume!: () => void;
    const ready = new Promise<void>((resolve) => { seen = resolve; });
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    const inFlight = credentials.authenticateAdminCredentials(admin.username, oldPassword, async () => { seen(); await gate; return true; });
    await ready;
    await prisma.adminSession.create({ data: { adminAccountId: admin.id, tokenHash: "synthetic-old-cookie", expiresAt: new Date(Date.now() + 60_000) } });
    await r1.changeAdminPassword({ adminAccountId: admin.id, currentSessionId: "synthetic", currentPassword: oldPassword, newPassword: nextPassword }, adminAuth);
    resume();
    const stale = (await inFlight)!;
    assert.equal(await issuance.issueVerifiedAdminSession({ account: stale, tokenHash: "synthetic-stale-admin", expiresAt: new Date(Date.now() + 60_000) }), false);
    assert.equal(await prisma.adminSession.count({ where: { adminAccountId: admin.id } }), 0);
    const fresh = (await credentials.authenticateAdminCredentials(admin.username, nextPassword))!;
    assert.equal(await issuance.issueVerifiedAdminSession({ account: fresh, tokenHash: "synthetic-fresh-admin", expiresAt: new Date(Date.now() + 60_000) }), true);
    console.log("PASS S03: actual password change invalidates cookies and rejects in-flight old credentials");

    const first = await admission.submitRefereeAdmissionApplication({ name: "Synthetic Applicant A", studentId: "102610001", phone: "13000000001" }, { rateLimitKey: "synthetic-a" });
    const second = await admission.submitRefereeAdmissionApplication({ name: "Synthetic Applicant B", studentId: "102610001", phone: "13000000002" }, { rateLimitKey: "synthetic-b" });
    assert.notEqual(first.id, second.id);
    assert.equal((await admission.submitRefereeAdmissionApplication({ name: "Synthetic Applicant A", studentId: "102610001", phone: "13000000001" }, { rateLimitKey: "synthetic-a" })).id, first.id);
    assert.equal(await prisma.refereeAdmissionApplication.count({ where: { studentId: "102610001" } }), 2);
    console.log("PASS S04: unverified identifier cannot exclude another applicant; exact repeats idempotent");

    const competition = await prisma.competition.create({ data: { slug: "security-fixture", name: "Fictitious competition", campus: "isolated", format: "ELEVEN_A_SIDE", status: "ONGOING" } });
    const home = await prisma.team.create({ data: { competitionId: competition.id, name: "Fictitious Home" } });
    const away = await prisma.team.create({ data: { competitionId: competition.id, name: "Fictitious Away" } });
    const referee = await prisma.referee.create({ data: { publicCode: "SECURITY-FAKE", name: "Fictitious referee", passwordHash: hash, status: "ACTIVE", mustChangePassword: false, trainingStatus: "QUALIFIED", assignmentEligibility: "ELIGIBLE", elevenASide: true, capabilities: { create: { format: "ELEVEN_A_SIDE", positionKey: "REFEREE", status: "READY" } } } });
    await service.resetRefereePassword(referee.id, nextPassword, appointmentAuth);
    assert.equal(await issuance.issueVerifiedRefereeSession({ account: referee, tokenHash: "synthetic-stale-member", expiresAt: new Date(Date.now() + 60_000) }), false);
    const makeMatch = (label: string, day: number) => prisma.match.create({ data: { slug: `security-${label}`, competitionId: competition.id, stage: label, kickoff: new Date(Date.UTC(2035, 0, day, 8)), endAt: new Date(Date.UTC(2035, 0, day, 10)), venue: "Fictitious field", homeTeamId: home.id, awayTeamId: away.id, status: "SCHEDULED", applicationWindowStatus: "CLOSED", applicationDeadline: new Date(Date.UTC(2034, 11, 30)), positionRequirements: { create: { key: "REFEREE", label: "Referee", count: 1, sortOrder: 1 } } } });
    const match = await makeMatch("published", 1);
    const position = { key: "REFEREE" as const, slot: 1, refereeId: referee.id };
    await service.saveAppointmentDraft({ matchId: match.id, publicationNote: "Synthetic fixture", positions: [position] }, appointmentAuth);
    await service.publishAppointment(match.id, "", "", appointmentAuth);
    const published = await prisma.refereeAppointment.findUniqueOrThrow({ where: { matchId: match.id } });
    await r1.acknowledgeAppointment(published.id, referee.id);
    const facts = { slug: match.slug, competitionId: competition.id, stage: match.stage, kickoff: match.kickoff!, endAt: match.endAt!, venue: match.venue, homeTeamId: home.id, awayTeamId: away.id, status: "SCHEDULED" as const, applicationWindowStatus: "CLOSED" as const, applicationDeadline: match.applicationDeadline!, positionCounts: { REFEREE: 1 } };
    await rejected(() => service.updateMatch(match.id, { ...facts, kickoff: new Date(match.kickoff!.getTime() + 86_400_000), endAt: new Date(match.endAt!.getTime() + 86_400_000) }, actor), 409);
    await rejected(() => service.updateMatch(match.id, { ...facts, positionCounts: { REFEREE: 2 } }, actor), 409);
    await service.updateMatch(match.id, { ...facts, publicNote: "Updated editorial text" }, actor);
    assert.equal((await prisma.match.findUniqueOrThrow({ where: { id: match.id } })).kickoff!.getTime(), match.kickoff!.getTime());
    console.log("PASS S05: published assignment facts protected; benign editorial changes allowed");

    const application = await prisma.refereeApplication.create({ data: { matchId: match.id, refereeId: referee.id, preferredPositions: "[]", status: "APPOINTED" } });
    await rejected(() => service.withdrawRefereeApplication(application.id, referee.id), 409);
    assert.equal((await prisma.refereeApplication.findUniqueOrThrow({ where: { id: application.id } })).status, "APPOINTED");
    const withdrawable = await makeMatch("withdrawal", 2);
    const owned = await prisma.refereeApplication.create({ data: { matchId: withdrawable.id, refereeId: referee.id, preferredPositions: "[]", status: "APPROVED" } });
    assert.equal((await service.withdrawRefereeApplication(owned.id, referee.id)).status, "WITHDRAWN");
    await rejected(() => service.withdrawRefereeApplication(owned.id, "other-referee"), 404);
    console.log("PASS S06: conditional withdrawal preserves APPOINTED; normal owner withdrawal succeeds");

    const availability = (from: string, to: string, kind: "AVAILABLE" | "UNAVAILABLE" = "AVAILABLE") => r1.saveRefereeAvailability({ refereeId: referee.id, startAt: new Date(from), endAt: new Date(to), kind, actor: { type: "REFEREE", id: referee.id } });
    await rejected(() => availability("2026-01-01T00:00:00Z", "2028-01-01T00:00:00Z"), 400);
    await availability("2026-10-01T16:00:00Z", "2026-10-04T16:00:00Z");
    await availability("2026-10-03T16:00:00Z", "2026-10-06T16:00:00Z");
    await availability("2026-10-02T16:00:00Z", "2026-10-03T16:00:00Z", "UNAVAILABLE");
    const { getAdminAvailabilityPage } = await import("../src/lib/admin-availability-page");
    const summary = await getAdminAvailabilityPage({ refereeId: referee.id });
    assert.equal(summary.items[0].filledDays, 5);
    assert.equal(summary.items[0].availableDays, 5);
    assert.equal(summary.items[0].unavailableDays, 1);
    assert.equal((await getAdminAvailabilityPage({ refereeId: referee.id, date: "2026-10-03" })).items[0].filledDays, 1);
    await availability("2026-10-01T16:00:00Z", "2026-10-04T16:00:00Z");
    assert.equal(await prisma.refereeAvailability.count({ where: { refereeId: referee.id } }), 3);
    console.log("PASS R03: bounded intervals, idempotent repeats and arithmetic Beijing-day union counts");
  } finally {
    await prisma.$disconnect();
    await rm(root, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
