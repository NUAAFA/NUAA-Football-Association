import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";

const root = await mkdtemp(path.join(os.tmpdir(), "nuaafa-current-matches-"));
process.env.DATABASE_URL = `file:${path.join(root, "synthetic.db")}`;
const secret = "synthetic-current-matches-session-secret-only";
const token = "synthetic-current-matches-token";
const { prisma } = await import("../src/lib/prisma.ts");
const { getRefereeCurrentMatches: current } = await import("../src/lib/referee-current-matches.ts");
const { refereeListFilters: filters } = await import("../src/lib/referee-list-filters.ts");
let server, browser;
try {
  const raw = createClient({ url: process.env.DATABASE_URL });
  try {
    for (const entry of (await readdir("prisma/migrations", { withFileTypes: true })).filter((v) => v.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      await raw.executeMultiple(await readFile(path.join("prisma/migrations", entry.name, "migration.sql"), "utf8"));
    }
  } finally { raw.close(); }
  const now = new Date();
  const at = (days) => new Date(now.getTime() + days * 86_400_000);
  const referee = await prisma.referee.create({ data: {
    publicCode: "SYNTHETIC-001", name: "模拟裁判", studentId: "SYNTHETIC-ID", status: "ACTIVE",
    mustChangePassword: false, assignmentEligibility: "ELIGIBLE",
    capabilities: { create: { format: "FUTSAL", positionKey: "REFEREE", status: "READY" } },
  } });
  const other = await prisma.referee.create({ data: { publicCode: "SYNTHETIC-002", name: "模拟其他裁判" } });
  const competitions = [];
  for (const id of ["cup", "league"]) {
    const competition = await prisma.competition.create({ data: { id, slug: id, campus: "模拟校区", name: id === "cup" ? "模拟新生杯" : "模拟联赛", format: "FUTSAL", status: "ONGOING" } });
    const home = await prisma.team.create({ data: { competitionId: id, name: id === "cup" ? "模拟甲队" : "模拟丙队" } });
    const away = await prisma.team.create({ data: { competitionId: id, name: "模拟乙队" } });
    competitions.push({ competition, home, away });
  }
  const make = (id, days, changes = {}, index = 0) => prisma.match.create({ data: {
    id, slug: id, competitionId: competitions[index].competition.id,
    homeTeamId: competitions[index].home.id, awayTeamId: competitions[index].away.id,
    status: "SCHEDULED", kickoff: at(days), venue: "模拟东操", stage: "小组赛", round: "第4轮",
    applicationWindowStatus: "OPEN", applicationDeadline: at(5), internalNote: "PRIVATE-MATCH-NOTE",
    positionRequirements: { create: { key: "REFEREE", label: "裁判员", count: 2, sortOrder: 1 } },
    ...changes,
  } });
  const apply = (matchId, status = "PENDING", refereeId = referee.id) => prisma.refereeApplication.create({ data: {
    matchId, refereeId, status, preferredPositions: '["REFEREE"]',
    note: "PRIVATE-APPLICATION-NOTE", reviewNote: "PRIVATE-REVIEW-NOTE",
  } });
  for (let i = 1; i <= 6; i++) await make(`open-${i}`, 10 + i, {}, i > 4 ? 1 : 0);
  await apply("open-2", "APPROVED");
  await apply("open-1", "REJECTED", other.id);
  for (const [id, days, changes, status] of [
    ["old-completed", -12, { status: "COMPLETED" }, "WITHDRAWN"],
    ["old-pending", -10, {}, "PENDING"],
    ["cancelled", 3, { status: "CANCELLED" }, "PENDING"],
    ["future-completed", 3, { status: "COMPLETED" }, "APPROVED"],
    ["closed-mine", 2, { applicationWindowStatus: "CLOSED", applicationDeadline: at(-1) }, "REVIEWING"],
    ["null-deadline-mine", 3, { applicationDeadline: null }, "PENDING"],
    ["closed-withdrawn", 4, { applicationWindowStatus: "CLOSED" }, "WITHDRAWN"],
    ["test-match", 5, { isTestData: true }, "PENDING"],
    ["started", 0, {}, "PENDING"],
  ]) { await make(id, days, changes); await apply(id, status); }
  await make("closed-other", 3, { applicationWindowStatus: "CLOSED" });
  await apply("closed-other", "PENDING", other.id);
  const first = await current(referee.id, { now, limit: 3 });
  assert.deepEqual(first.items.map((v) => v.id), ["open-1", "open-2", "open-3"]);
  assert.equal(first.total, 8); assert.equal(first.openCount, 6);
  assert.equal(first.items[0].application, null, "Other referees' applications must not be displayed");
  assert.equal(first.items[1].application.status, "APPROVED");
  assert.equal(first.items[1].application.canWithdraw, true);
  const all = await current(referee.id, { now });
  assert.deepEqual(all.items.map((v) => v.id), ["open-1", "open-2", "open-3", "open-4", "open-5", "open-6", "closed-mine", "null-deadline-mine"]);
  assert.equal(new Set(all.items.map((v) => v.id)).size, 8);
  assert.equal(all.items.at(-1).application.canWithdraw, false);
  assert(!JSON.stringify(all).includes("PRIVATE-"));
  assert.equal((await current(referee.id, { now, filters: filters({ competition: "league" }) })).total, 2);
  assert.equal((await current(referee.id, { now, filters: filters({ q: "模拟丙队" }) })).total, 2);
  assert.equal((await current(referee.id, { now, filters: filters({ format: "ELEVEN_A_SIDE" }) })).total, 0);
  assert.equal((await current(referee.id, { now, filters: filters({ from: "bad-date" }) })).total, 0);
  const day = new Date(at(11).getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
  assert.deepEqual((await current(referee.id, { now, filters: filters({ from: day, to: day }) })).items.map((v) => v.id), ["open-1"]);
  assert.equal((await current(other.id, { now })).items.some((v) => v.id === "closed-mine"), false);
  const expired = await current(referee.id, { now: at(6), limit: 3 });
  assert.equal(expired.openCount, 0);
  assert.deepEqual(expired.items.map((v) => v.id), ["open-2"]);
  assert.equal(expired.items[0].application.canWithdraw, false);
  const appointment = await prisma.refereeAppointment.create({ data: {
    matchId: "open-2", status: "PUBLISHED",
    positions: { create: { refereeId: referee.id, key: "REFEREE", label: "裁判员", sortOrder: 1 } },
  } });
  const appointed = (await current(referee.id, { now })).items.find((v) => v.id === "open-2");
  assert.equal(appointed.application.status, "APPOINTED");
  assert.equal(appointed.application.canWithdraw, false);
  await prisma.refereeAppointment.delete({ where: { id: appointment.id } });
  assert.equal((await current(referee.id, { now: at(30) })).total, 0);
  await prisma.match.update({ where: { id: "open-1" }, data: { status: "COMPLETED" } });
  assert.deepEqual((await current(referee.id, { now, limit: 3 })).items.map((v) => v.id), ["open-2", "open-3", "open-4"]);
  await prisma.match.update({ where: { id: "open-1" }, data: { status: "SCHEDULED" } });
  console.log("PASS query: open matches first, three-row dashboard, all current rows, status/deadline/date boundaries, filters, private intention isolation, completion replacement.");

  if (process.argv.includes("--http")) {
    const socket = createServer(); socket.listen(0, "127.0.0.1"); await once(socket, "listening");
    const port = socket.address().port; await new Promise((resolve) => socket.close(resolve));
    const origin = `http://127.0.0.1:${port}`;
    const env = {
      PATH: process.env.PATH, HOME: os.homedir(), TMPDIR: os.tmpdir(), NODE_ENV: "production",
      DATABASE_URL: process.env.DATABASE_URL, NUAAFA_UPLOAD_DIR: path.join(root, "uploads"),
      REFEREE_MEMBER_SESSION_SECRET: secret, REFEREE_ADMIN_SESSION_SECRET: secret,
      NEXT_TELEMETRY_DISABLED: "1",
    };
    await mkdir(env.NUAAFA_UPLOAD_DIR);
    let log = "";
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], { env, stdio: ["ignore", "pipe", "pipe"] });
    server.stdout.on("data", (v) => { log += v; }); server.stderr.on("data", (v) => { log += v; });
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(origin + "/api/health")).ok) { ready = true; break; } } catch { /* Local server startup. */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert(ready, log);
    await prisma.refereeSession.create({ data: {
      refereeId: referee.id, tokenHash: createHmac("sha256", secret).update(token).digest("hex"),
      expiresAt: at(1),
    } });
    const html = async (route, member = true) => {
      const response = await fetch(origin + route, { headers: member ? { Cookie: `nuaa_referee_member=${token}` } : {} });
      assert.equal(response.status, 200, route);
      const body = await response.text();
      for (const value of ["PRIVATE-MATCH-NOTE", "PRIVATE-APPLICATION-NOTE", "PRIVATE-REVIEW-NOTE"]) assert(!body.includes(value));
      return body;
    };
    const ids = (body) => [...body.matchAll(/data-current-match-id="([^"]+)"/g)].map((v) => v[1]);
    assert.deepEqual(ids(await html("/referees/workspace")), ["open-1", "open-2", "open-3"]);
    assert.deepEqual(ids(await html("/referees/open-matches")), all.items.map((v) => v.id));
    assert.equal(ids(await html("/referees/open-matches?competition=league")).length, 2);
    const publicHtml = await html("/referees/open-matches", false);
    assert.equal(ids(publicHtml).length, 0);
    assert(!publicHtml.includes("我的执裁意向："));
    const publicApi = await (await fetch(origin + "/api/referees/public-list?kind=open-matches")).json();
    assert(!JSON.stringify(publicApi).includes("PRIVATE-"));
    assert(publicApi.items.every((v) => !("application" in v)));
    console.log("PASS HTTP: production pages show three/all rows, filters work, visitors and public API have no personal intention data.");

    if (process.argv.includes("--browser")) {
      const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
      browser = await chromium.launch({ channel: process.env.CURRENT_MATCH_BROWSER_CHANNEL ?? "chrome", headless: true });
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await context.addCookies([{ name: "nuaa_referee_member", value: token, url: origin, httpOnly: true, sameSite: "Lax" }]);
      await context.route(origin + "/api/**", async (route) => {
        const response = await route.fetch({ headers: { ...await route.request().allHeaders(), origin: "https://nuaafa.cn" } });
        await route.fulfill({ response });
      });
      const page = await context.newPage();
      const errors = []; page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(origin + "/referees/workspace");
      const rows = page.locator("[data-current-match-id]");
      assert.equal(await rows.count(), 3);
      await rows.first().getByRole("link", { name: "查看岗位并报名 →" }).click();
      await page.locator('form.referee-form input[value="REFEREE"]').check();
      await page.getByRole("button", { name: "提交执裁意向", exact: true }).click();
      await page.getByText("执裁意向已提交，请等待管理员审核。", { exact: true }).waitFor();
      await page.getByRole("link", { name: "工作台", exact: true }).click();
      await page.locator('[data-current-match-id="open-1"]').getByText("我的执裁意向：已提交", { exact: true }).waitFor();
      const out = path.resolve(process.env.CURRENT_MATCH_EVIDENCE_DIR ?? path.join(root, "evidence"));
      await mkdir(out, { recursive: true });
      for (const [name, width, height] of [["desktop", 1440, 1000], ["mobile", 390, 844]]) {
        await page.setViewportSize({ width, height });
        await page.locator(".referee-dashboard-priority").scrollIntoViewIfNeeded();
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name);
        await page.locator(".referee-dashboard-priority").screenshot({ path: path.join(out, `dashboard-${name}.png`) });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole("link", { name: /查看更多（共/ }).click();
      await page.waitForURL(origin + "/referees/open-matches");
      assert.equal(await rows.count(), 8);
      assert.equal(await page.getByRole("button", { name: "继续浏览", exact: true }).count(), 0);
      await page.locator("#referee-results").screenshot({ path: path.join(out, "all-matches.png") });
      await prisma.match.update({ where: { id: "open-1" }, data: { status: "COMPLETED" } });
      await page.getByRole("link", { name: "工作台", exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('[data-current-match-id="open-1"]'));
      assert.equal(await rows.count(), 3);
      assert.deepEqual(await rows.evaluateAll((items) => items.map((v) => v.dataset.currentMatchId)), ["open-2", "open-3", "open-4"]);
      assert.equal(await prisma.refereeApplication.count({ where: { matchId: "open-1", refereeId: referee.id } }), 1);
      assert.deepEqual(errors, []);
      console.log(`PASS browser: actual signup and return shows intention, desktop/mobile layout, see-all navigation, completion removes old intention and fills next slot. Evidence: ${out}`);
    }
  }
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { const stopped = once(server, "exit"); server.kill("SIGTERM"); await stopped; }
  await prisma.$disconnect();
  await rm(root, { recursive: true, force: true });
}
