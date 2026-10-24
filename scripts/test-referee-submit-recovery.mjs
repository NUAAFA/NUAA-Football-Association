import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";

// Every database/session/media path is newly created. No .env or existing data is copied.
const startedAt = new Date().toISOString();
const before = process.env.F06_EXPECT_BEFORE === "1";
const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "nuaafa-f06-")));
assert(path.basename(root).startsWith("nuaafa-f06-"));
const out = path.resolve(process.env.F06_EVIDENCE_DIR ?? path.join(root, "evidence"));
await mkdir(out, { recursive: true });
const databaseUrl = `file:${path.join(root, "synthetic.db")}`;
process.env.DATABASE_URL = databaseUrl;
const raw = createClient({ url: databaseUrl });
for (const entry of (await readdir("prisma/migrations", { withFileTypes: true })).filter((v) => v.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
  await raw.executeMultiple(await readFile(path.join("prisma/migrations", entry.name, "migration.sql"), "utf8"));
}
raw.close();
const { prisma } = await import("../src/lib/prisma.ts");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const socket = net.createServer();
await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const secret = "Synthetic-F06-Member-Session-Secret-Only-2026";
const token = "synthetic-f06-member-cookie";
const serverRoot = path.resolve(process.env.F06_SERVER_ROOT ?? process.cwd());
const minimalEnv = {
  PATH: process.env.PATH, HOME: os.homedir(), TMPDIR: os.tmpdir(), NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
  DATABASE_URL: databaseUrl, NUAAFA_UPLOAD_DIR: path.join(root, "uploads"),
  REFEREE_MEMBER_SESSION_SECRET: secret, REFEREE_ADMIN_SESSION_SECRET: "Synthetic-F06-Admin-Secret-Only-2026",
};
await mkdir(minimalEnv.NUAAFA_UPLOAD_DIR);
const server = spawn(process.execPath, [path.join(serverRoot, "node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], { cwd: serverRoot, env: minimalEnv, stdio: ["ignore", "pipe", "pipe"] });
let serverLog = "";
server.stdout.on("data", (v) => { serverLog += v; }); server.stderr.on("data", (v) => { serverLog += v; });
let browser;
const checks = [];
const pageErrors = [];
const check = async (name, fn) => { const at = new Date().toISOString(); const result = await fn(); checks.push({ name, status: "PASS", at, ...result }); console.log(`PASS F06 ${name}`); };
try {
  const competition = await prisma.competition.create({ data: { slug: "f06-isolated-cup", name: "隔离虚构F06杯", campus: "虚构校区", format: "FUTSAL", status: "ONGOING", publicPublished: true } });
  const home = await prisma.team.create({ data: { competitionId: competition.id, name: "隔离虚构甲队" } });
  const away = await prisma.team.create({ data: { competitionId: competition.id, name: "隔离虚构乙队" } });
  const referee = await prisma.referee.create({ data: { publicCode: "F06-SYNTHETIC", name: "隔离虚构裁判", studentId: "F06-SYNTHETIC-ID", status: "ACTIVE", mustChangePassword: false, assignmentEligibility: "ELIGIBLE", passwordHash: "synthetic-not-a-login-password", capabilities: { create: [{ format: "FUTSAL", positionKey: "REFEREE", status: "READY" }] } } });
  await prisma.refereeSession.create({ data: { refereeId: referee.id, tokenHash: createHmac("sha256", secret).update(token).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) } });
  let ready = false;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(origin + "/api/health")).ok) { ready = true; break; } } catch { /* loopback startup */ } await new Promise((r) => setTimeout(r, 100)); }
  assert(ready, serverLog);
  browser = await chromium.launch({ channel: process.env.F06_BROWSER_CHANNEL ?? "chrome", headless: true });
  const makeFixture = async (kind, tag) => {
    const match = await prisma.match.create({ data: { slug: `f06-${kind}-${tag}`, competitionId: competition.id, stage: "隔离虚构恢复验收", status: "SCHEDULED", kickoff: new Date(Date.now() + 172_800_000), venue: "隔离虚构球场", homeTeamId: home.id, awayTeamId: away.id, applicationWindowStatus: "OPEN", applicationDeadline: new Date(Date.now() + 86_400_000), positionRequirements: { create: { key: "REFEREE", label: "裁判员", count: 1, sortOrder: 1 } } } });
    if (kind === "application") return { match };
    const appointment = await prisma.refereeAppointment.create({ data: { matchId: match.id, status: "PUBLISHED", revision: 1, publishedAt: new Date(), positions: { create: { refereeId: referee.id, key: "REFEREE", label: "裁判员", sortOrder: 1 } }, versions: { create: { status: "PUBLISHED", revision: 1, snapshot: "{}" } } }, include: { versions: true } });
    return { match, appointment, version: appointment.versions[0] };
  };
  const open = async (kind, fixture) => {
    const context = await browser.newContext();
    await context.addCookies([{ name: "nuaa_referee_member", value: token, url: origin, httpOnly: true, sameSite: "Lax" }]);
    await context.route(origin + "/api/**", async (route) => { const response = await route.fetch({ headers: { ...await route.request().allHeaders(), origin: "https://nuaafa.cn" } }); await route.fulfill({ response }); });
    const page = await context.newPage(); page.setDefaultTimeout(15_000);
    page.on("pageerror", (error) => { pageErrors.push({ message: error.message, before }); });
    await page.goto(origin + (kind === "application" ? `/referees/open-matches/${fixture.match.slug}` : "/referees/workspace"));
    let panel;
    if (kind === "application") panel = page.locator("form.referee-form");
    else if (before) panel = page.locator(".referee-task-actions").last();
    else panel = page.locator(`[data-appointment-id="${fixture.appointment.id}"]`);
    if (kind === "application") { await panel.locator('[name="preferredPositions"]').check(); await panel.locator('[name="note"]').fill("隔离虚构输入，需要完整保留。"); }
    if (kind === "conflict") { await panel.getByRole("button", { name: "报告冲突", exact: true }).click(); await panel.locator('[name="explanation"]').fill("隔离虚构冲突说明，需要完整保留。"); }
    const submit = kind === "acknowledge" ? panel.getByRole("button", { name: "确认知悉", exact: true }) : panel.locator('button[type="submit"]');
    const message = panel.locator('[aria-live="polite"]');
    return { context, page, panel, submit, message };
  };
  const kinds = ["acknowledge", "conflict", "application"];
  const scenarios = before ? ["network", "html"] : ["success", "business-error", "network", "timeout", "html", "empty", "saved-lost", "readback-down", "double-click"];
  for (const kind of kinds) for (const scenario of scenarios) {
    await check(`${kind}/${scenario}`, async () => {
      const fixture = await makeFixture(kind, scenario);
      const ui = await open(kind, fixture);
      let posts = 0, reads = 0, failReadback = scenario === "readback-down";
      const held = [];
      const postPath = kind === "application" ? "/api/referees/applications" : `/api/referees/appointments/${fixture.appointment.id}/${kind}`;
      const statusPath = kind === "application" ? "/api/referees/applications/status" : `/api/referees/appointments/${fixture.appointment.id}/status`;
      await ui.page.route(origin + statusPath + "?*", async (route) => {
        reads++;
        if (failReadback && reads > 1) return route.abort("failed");
        const response = await route.fetch(); await route.fulfill({ response });
      });
      await ui.page.route(origin + postPath, async (route) => {
        posts++;
        if (scenario === "network") return route.abort("failed");
        if (scenario === "business-error") return route.fulfill({ status: 400, json: { error: "隔离虚构业务校验失败。" } });
        if (scenario === "html") return route.fulfill({ status: 502, contentType: "text/html", body: "<html>synthetic gateway unavailable</html>" });
        if (scenario === "empty") return route.fulfill({ status: 200, contentType: "application/json", body: "" });
        if (scenario === "timeout") { await new Promise((resolve) => held.push(resolve)); await route.abort("failed").catch(() => {}); return; }
        const response = await route.fetch({ headers: { ...await route.request().allHeaders(), origin: "https://nuaafa.cn" } });
        assert(response.ok(), `${postPath}: ${response.status()} ${await response.text()}`);
        if (["saved-lost", "readback-down"].includes(scenario)) return route.abort("failed");
        return route.fulfill({ response });
      });
      if (scenario === "timeout") await ui.page.clock.install();
      const postSeen = scenario === "timeout" ? ui.page.waitForRequest((request) => new URL(request.url()).pathname === postPath) : null;
      if (scenario === "double-click") await ui.submit.dblclick(); else await ui.submit.click();
      if (scenario === "timeout") {
        await postSeen;
        await ui.page.clock.fastForward(12_100);
      }
      if (before) {
        await ui.page.waitForTimeout(150);
        assert(await ui.submit.isDisabled()); assert.equal(await ui.message.innerText(), "");
        await ui.context.close();
        return { expectedDefectObserved: true, posts };
      }
      const success = ["success", "saved-lost", "double-click"].includes(scenario);
      if (success) await ui.message.getByText(/已保存|已提交/).waitFor();
      else if (scenario === "business-error") await ui.message.getByText("隔离虚构业务校验失败。", { exact: true }).waitFor();
      else await ui.message.getByText(/输入已保留/).waitFor();
      assert.equal(posts, 1, "A UI action never automatically replays the POST");
      if (!success) assert(await ui.submit.isEnabled(), "The submit control recovers after error or unknown result");
      if (kind !== "acknowledge" && !success) assert.equal(await ui.panel.locator(kind === "application" ? '[name="note"]' : '[name="explanation"]').inputValue(), kind === "application" ? "隔离虚构输入，需要完整保留。" : "隔离虚构冲突说明，需要完整保留。");
      if (scenario === "readback-down") {
        assert(await ui.panel.getByRole("button", { name: "再次核对结果" }).isEnabled());
        await ui.page.screenshot({ path: path.join(out, `${kind}-unknown-input-retained.png`), fullPage: true });
        failReadback = false;
        await ui.panel.getByRole("button", { name: "再次核对结果" }).click();
        await ui.message.getByText(/已核对，操作已保存/).waitFor(); assert.equal(posts, 1);
      }
      const count = kind === "application" ? await prisma.refereeApplication.count({ where: { matchId: fixture.match.id } }) : kind === "acknowledge" ? await prisma.appointmentAcknowledgement.count({ where: { versionId: fixture.version.id } }) : await prisma.appointmentConflictReport.count({ where: { versionId: fixture.version.id } });
      assert.equal(count, success || scenario === "readback-down" ? 1 : 0);
      const result = { posts, reads, persistedRecords: count, message: await ui.message.innerText() };
      if (scenario === "readback-down") await ui.page.screenshot({ path: path.join(out, `${kind}-recovered.png`), fullPage: true });
      held.forEach((resolve) => resolve());
      await ui.context.close();
      return result;
    });
  }
  if (!before) {
    await check("old browser page cannot confirm a newer task version", async () => {
      const fixture = await makeFixture("acknowledge", "old-page");
      const ui = await open("acknowledge", fixture);
      await prisma.refereeAppointment.update({ where: { id: fixture.appointment.id }, data: { revision: 2, versions: { create: { revision: 2, status: "PUBLISHED", snapshot: "{}" } } } });
      let posts = 0;
      await ui.page.route(origin + `/api/referees/appointments/${fixture.appointment.id}/acknowledge`, async (route) => { posts++; await route.abort("failed"); });
      await ui.submit.click(); await ui.message.getByText(/任务版本或岗位已变化/).waitFor();
      assert(await ui.submit.isEnabled()); assert.equal(posts, 0);
      assert.equal(await prisma.appointmentAcknowledgement.count({ where: { appointmentId: fixture.appointment.id } }), 0);
      await ui.context.close(); return { posts: 0, unintendedAcknowledgements: 0 };
    });
    await check("new conflict content after a handled report becomes pending in UI and database", async () => {
      const fixture = await makeFixture("conflict", "new-content");
      await prisma.appointmentConflictReport.create({ data: { appointmentId: fixture.appointment.id, versionId: fixture.version.id, refereeId: referee.id, reason: "隔离旧报告", reasonCode: "OTHER", explanation: "隔离旧报告", status: "RESOLVED", resolutionNote: "隔离已处理" } });
      const ui = await open("conflict", fixture); await ui.submit.click();
      await ui.panel.getByRole("button", { name: "冲突待处理", exact: true }).waitFor();
      assert(await ui.panel.getByRole("button", { name: "冲突待处理", exact: true }).isDisabled());
      const report = await prisma.appointmentConflictReport.findFirstOrThrow({ where: { versionId: fixture.version.id } });
      assert.equal(report.status, "PENDING"); assert.equal(report.explanation, "隔离虚构冲突说明，需要完整保留。");
      await ui.context.close(); return { reportStatus: report.status, reportCount: 1 };
    });
    await check("HTTP version binding, member isolation, cache and duplicate guards", async () => {
      const fixture = await makeFixture("acknowledge", "http");
      const headers = { cookie: `nuaa_referee_member=${token}`, origin: "https://nuaafa.cn", "content-type": "application/json" };
      const endpoint = `/api/referees/appointments/${fixture.appointment.id}`;
      assert.equal((await fetch(origin + endpoint + `/status?versionId=${fixture.version.id}`)).status, 401);
      const status = await fetch(origin + endpoint + `/status?versionId=${fixture.version.id}`, { headers }); assert.equal(status.status, 200); assert.equal(status.headers.get("cache-control"), "private, no-store");
      assert.equal((await fetch(origin + endpoint + "/acknowledge", { method: "POST", headers, body: "{}" })).status, 400);
      assert.equal((await fetch(origin + endpoint + "/acknowledge", { method: "POST", headers, body: JSON.stringify({ expectedVersionId: "old-version" }) })).status, 409);
      const response = await fetch(origin + endpoint + "/acknowledge", { method: "POST", headers, body: JSON.stringify({ expectedVersionId: fixture.version.id }) }); assert.equal(response.status, 200);
      assert.equal((await fetch(origin + endpoint + "/acknowledge", { method: "POST", headers, body: JSON.stringify({ expectedVersionId: fixture.version.id }) })).status, 200);
      assert.equal(await prisma.appointmentAcknowledgement.count({ where: { versionId: fixture.version.id } }), 1);
      const other = await prisma.referee.create({ data: { publicCode: "F06-OTHER", name: "隔离虚构另一裁判", status: "ACTIVE", mustChangePassword: false } });
      const otherToken = "synthetic-f06-other-cookie"; await prisma.refereeSession.create({ data: { refereeId: other.id, tokenHash: createHmac("sha256", secret).update(otherToken).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) } });
      assert.equal((await fetch(origin + endpoint + `/status?versionId=${fixture.version.id}`, { headers: { cookie: `nuaa_referee_member=${otherToken}` } })).status, 409);
      await prisma.referee.update({ where: { id: other.id }, data: { mustChangePassword: true } });
      assert.equal((await fetch(origin + `/api/referees/applications/status?matchId=${fixture.match.id}`, { headers: { cookie: `nuaa_referee_member=${otherToken}` } })).status, 403);
      return { uniqueAcknowledgements: 1, missingVersion: 400, staleVersion: 409, anonymous: 401, otherMember: 409, passwordGate: 403 };
    });
    await check("identical handled conflict is not reopened and changed task version cannot be acknowledged", async () => {
      const fixture = await makeFixture("conflict", "handled");
      const headers = { cookie: `nuaa_referee_member=${token}`, origin: "https://nuaafa.cn", "content-type": "application/json" };
      const endpoint = `/api/referees/appointments/${fixture.appointment.id}`;
      const body = JSON.stringify({ expectedVersionId: fixture.version.id, reasonCode: "OTHER", explanation: "隔离虚构已经处理的说明" });
      assert.equal((await fetch(origin + endpoint + "/conflict", { method: "POST", headers, body })).status, 200);
      await prisma.appointmentConflictReport.updateMany({ where: { versionId: fixture.version.id }, data: { status: "RESOLVED", resolutionNote: "隔离虚构已经处理", resolvedAt: new Date() } });
      assert.equal((await fetch(origin + endpoint + "/conflict", { method: "POST", headers, body })).status, 200);
      assert.equal((await prisma.appointmentConflictReport.findFirstOrThrow({ where: { versionId: fixture.version.id } })).status, "RESOLVED");
      await prisma.refereeAppointment.update({ where: { id: fixture.appointment.id }, data: { revision: 2, versions: { create: { revision: 2, status: "PUBLISHED", snapshot: "{}" } } } });
      assert.equal((await fetch(origin + endpoint + "/acknowledge", { method: "POST", headers, body: JSON.stringify({ expectedVersionId: fixture.version.id }) })).status, 409);
      assert.equal(await prisma.appointmentAcknowledgement.count({ where: { appointmentId: fixture.appointment.id } }), 0);
      return { handledReportStatus: "RESOLVED", oldPageRejected: true, unintendedAcknowledgements: 0 };
    });
    assert.deepEqual(pageErrors, []);
  }
  const result = { status: "PASS", mode: before ? "original defects reproduced in real browser" : "fixed real browser and HTTP acceptance", startedAt, finishedAt: new Date().toISOString(), browser: browser.version(), database: "fresh synthetic SQLite only", root, serverRoot, checks, pageErrors };
  await writeFile(path.join(out, before ? "network-before.json" : "network-recovery.json"), JSON.stringify(result, null, 2));
} catch (error) {
  await writeFile(path.join(out, before ? "network-before.json" : "network-recovery.json"), JSON.stringify({ status: "FAIL", startedAt, finishedAt: new Date().toISOString(), checks, error: String(error), pageErrors }, null, 2));
  console.error(error); process.exitCode = 1;
} finally {
  await browser?.close();
  if (server.exitCode === null) { const stopped = new Promise((resolve) => server.once("exit", resolve)); server.kill("SIGTERM"); await stopped; }
  await prisma.$disconnect();
  await writeFile(path.join(out, before ? "network-before-server.log" : "network-server.log"), serverLog);
}
