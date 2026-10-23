import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const modulePath = process.env.PLAYWRIGHT_MODULE;
assert(modulePath, "Set PLAYWRIGHT_MODULE to the installed Playwright package path.");
const { chromium, webkit } = await import(pathToFileURL(path.join(modulePath, "index.mjs")).href);
const { expect } = await import(pathToFileURL(path.join(modulePath, "test.mjs")).href);
const root = process.argv[2];
assert(root && path.isAbsolute(root), "Pass the isolated fixture root from test-competition-presentation.ts --prepare.");
const fixture = JSON.parse(await readFile(path.join(root, "fixture.json"), "utf8"));
const base = process.env.COMPETITION_PREVIEW_URL ?? "http://127.0.0.1:3136";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Browser mutations are limited to local isolated previews.");
const mutationOrigin = process.env.COMPETITION_MUTATION_ORIGIN ?? "https://nuaafa.cn"; // The production origin allow-list is exercised against local fixtures only.
const evidence = path.join(root, "evidence");
await mkdir(evidence, { recursive: true });
const results = [];
const errors = [];
const prefetchDiagnostics = [];
async function stable(page) { await delay(150); await page.waitForLoadState("networkidle"); }
async function goto(page, route) { const response = await page.goto(`${base}${route}`); if (response) assert.equal(response.status(), 200, route); await stable(page); }
const rows = (page) => page.locator('ul[aria-label="公开赛程"] > li');
const appointments = (page) => page.locator('[aria-label="本赛事裁判选派"] > article');
const ids = (page) => rows(page).evaluateAll((items) => items.map((item) => item.id));
const widths = process.env.COMPETITION_TEST_WIDTHS ? process.env.COMPETITION_TEST_WIDTHS.split(",").map(Number) : [320, 390, 768, 1024, 1440, 1920];

for (const [engineName, engine] of [["chromium", chromium], ["webkit", webkit]]) {
  const browser = await engine.launch({ headless: true, ...(engineName === "chromium" ? { channel: "chrome" } : {}) });
  const context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 1000 } });
  await context.route("**/api/**", async (route) => {
    if (new URL(route.request().url()).origin !== base) return route.continue();
    const response = await route.fetch({ headers: { ...route.request().headers(), origin: mutationOrigin } });
    await route.fulfill({ response });
  });
  const page = await context.newPage();
  const enginePrefetchRoutes = new Set();
  page.on("pageerror", (error) => {
    const match = error.message.match(/^\/127\.0\.0\.1:\d+(\/(?:association|participation|competitions\/arbitration|news|media|teams|referees\/assignments(?:\/[a-z0-9]+\/print)?))\?_rsc=[^\s]+ due to access control checks\.$/);
    if (engineName === "webkit" && match) { enginePrefetchRoutes.add(match[1]); prefetchDiagnostics.push(error.message); }
    else errors.push(`${engineName}: ${error.message}`);
  });
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    await goto(page, "/competitions/presentation-cup");
    assert.equal(await rows(page).count(), 3, `${engineName} ${width}: initial three`);
    assert.equal(await page.getByRole("group", { name: "赛程筛选" }).isVisible(), false);
    assert(!(await page.locator("#schedule .core-competition-section-intro").innerText()).includes("下一场"));
    if (width >= 1024) {
      const copy = await page.locator(".cup-archive-hero-copy").boundingBox();
      const summary = await page.locator(".cup-archive-hero-summary").boundingBox();
      assert(summary.x >= copy.x + copy.width, "original left hero and right summary retained");
    }
    assert.deepEqual(await ids(page), [5, 6, 7].map((i) => `match-${fixture.ids[`future-${i}`]}`));
    await page.locator("#schedule").scrollIntoViewIfNeeded();
    assert.equal(await rows(page).count(), 3, "scroll must not expand fixtures");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${width}: public overflow`);
    assert.equal(await appointments(page).count(), 3);
    assert.equal(await appointments(page).filter({ hasText: "已完成" }).count(), 0);
    assert.equal(await appointments(page).filter({ hasText: "A组 · 第3轮" }).count(), 3);
    assert.equal(await appointments(page).filter({ hasText: "19:00" }).count(), 3);
    await page.getByRole("link", { name: /展示更多比赛/ }).click(); await stable(page);
    await expect(rows(page)).toHaveCount(6);
    const collected = await ids(page);
    for (let n = 2; n <= 4; n++) { const previous = await rows(page).first().getAttribute("id"); await page.getByRole("navigation", { name: "赛程分页" }).getByRole("link", { name: "下一页", exact: true }).click(); await expect(rows(page).first()).not.toHaveAttribute("id", previous); await stable(page); collected.push(...await ids(page)); }
    assert.equal(new Set(collected).size, 20); assert.equal(collected.length, 20);
    assert.equal(collected.at(-1), `match-${fixture.ids["cancelled-18"]}`);
    assert.deepEqual(collected.slice(14, 19), [0, 1, 2, 3, 4].map((i) => `match-${fixture.ids[`pending-${i}`]}`));
    console.log(`PASS ${engineName} ${width}`);
    results.push(`${engineName} ${width}: three by default, upcoming order, six per page, all 20 exactly once, no horizontal overflow, upcoming appointments`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await goto(page, "/competitions/presentation-cup");
  const filters = page.getByRole("group", { name: "赛程筛选" });
  assert.equal(await filters.isVisible(), false, "filters stay collapsed on arrival");
  await page.locator('summary[aria-label="筛选比赛"]').click();
  const fontSize = await filters.getByLabel("阶段", { exact: true }).evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  assert(fontSize >= 15, "legible filter text");
  await filters.getByLabel("比赛状态", { exact: true }).selectOption("pending"); await stable(page);
  assert.equal(await rows(page).count(), 3); assert(await rows(page).first().innerText().then((v) => v.includes("时间待定")));
  await page.getByRole("link", { name: /展示更多比赛/ }).click(); await stable(page); await expect(rows(page)).toHaveCount(5);
  await filters.getByLabel("阶段", { exact: true }).selectOption("小组赛"); await stable(page);
  await filters.getByLabel("小组", { exact: true }).selectOption("A组"); await stable(page);
  await filters.getByLabel("轮次", { exact: true }).selectOption("第3轮"); await stable(page);
  await expect(rows(page)).toHaveCount(5);
  await filters.getByLabel("比赛日期", { exact: true }).fill("2020-01-01"); await stable(page);
  await expect(rows(page)).toHaveCount(0); assert(await page.getByText("暂无符合条件的公开赛程", { exact: true }).isVisible());
  await goto(page, `/competitions/presentation-cup#match-${fixture.ids["future-11"]}`);
  await page.waitForURL(/view=all.*page=2/); await stable(page);
  assert.equal(await page.locator(`#match-${fixture.ids["future-11"]}`).count(), 1, "deep match opens correct page");
  await goto(page, "/competitions/presentation-cup");
  await page.getByRole("button", { name: /查看全部裁判员选派/ }).click(); assert.equal(await appointments(page).count(), 6);
  await page.getByRole("navigation", { name: "裁判选派分页" }).getByRole("button", { name: "下一页" }).click();
  assert(await appointments(page).filter({ hasText: "已完成" }).count() > 0);
  assert(await appointments(page).filter({ hasText: "选派已完成" }).count() > 0);
  const appointmentIds = await appointments(page).evaluateAll((cards) => cards.map((card) => card.querySelector('a').getAttribute('href')));
  assert.equal(appointmentIds.length, 6);
  await page.getByRole("navigation", { name: "裁判选派分页" }).getByRole("button", { name: "下一页" }).click();
  assert.equal(await appointments(page).count(), 1, "all 13 public appointments, draft stays private");
  await page.getByRole("button", { name: "仅看近期选派", exact: true }).click(); assert.equal(await appointments(page).count(), 3);
  await goto(page, "/competitions/schedule#published-matches"); assert.equal(await rows(page).count(), 3);
  if (fixture.refereeCompetitions?.length) {
    await goto(page, "/competitions/presentation-cup#standings");
    const standings = page.locator("#standings");
    assert.equal(await standings.locator("details").count(), 0, "standings are visible cards, not disclosure rows");
    assert.equal(await standings.getByRole("table").count(), 2);
    await standings.getByRole("button", { name: /^B组/ }).click();
    assert.equal(await standings.getByRole("table").count(), 1);
    await standings.getByRole("searchbox", { name: "搜索小组或球队" }).fill("伦敦国际");
    assert(await standings.getByText("没有找到对应的小组或球队").isVisible());
    await standings.getByRole("button", { name: "清除筛选" }).click();
    await standings.getByRole("searchbox", { name: "搜索小组或球队" }).fill("伦敦国际");
    assert.equal(await standings.getByRole("table").count(), 1);
    assert.equal(await standings.locator("tbody tr").count(), 6, "search keeps full ranking context");
    results.push(`${engineName}: visible group standings, group tabs, search, ranking context PASS`);
    for (const route of ["assignments", "open-matches"]) {
      const expected = route === "assignments" ? fixture.assignmentOrder : fixture.openOrder;
      const list = () => page.getByRole("list", { name: "公开选派记录", exact: true });
      for (const width of widths) {
        await page.setViewportSize({ width, height: 1000 });
        await goto(page, `/referees/${route}`);
        assert.equal(await list().locator(":scope > li").count(), 3);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `referee ${route} overflow at ${width}`);
      }
      const firstLinks = await list().getByRole("link").evaluateAll((anchors) => anchors.map((a) => a.getAttribute("href")));
      assert.deepEqual(firstLinks, expected.slice(0, 3).map((id) => route === "assignments" ? `/referees/assignments/${id}/print` : `/referees/open-matches/${id}`));
      await page.getByRole("button", { name: /继续浏览/ }).click(); await stable(page);
      await expect(list().locator(":scope > li")).toHaveCount(expected.length);
      for (const competition of fixture.refereeCompetitions) {
        await page.getByRole("combobox", { name: "赛事", exact: true }).selectOption(competition.id); await page.getByRole("button", { name: "筛选", exact: true }).click(); await stable(page);
        assert.equal(await list().locator(":scope > li").count(), 3);
        await expect(list()).toContainText(competition.name);
        const text = await list().innerText(); assert(text.includes(competition.name));
        for (const other of fixture.refereeCompetitions.filter((c) => c.id !== competition.id)) assert(!text.includes(other.name));
        await page.getByRole("button", { name: /继续浏览/ }).click(); await stable(page);
        await expect(list().locator(":scope > li").nth(3)).toBeVisible();
        await page.reload(); await stable(page);
        assert.equal(await page.getByRole("combobox", { name: "赛事", exact: true }).inputValue(), competition.id);
      }
      await goto(page, `/referees/${route}?competition=unknown`);
      assert.equal(await page.getByRole("combobox", { name: "赛事", exact: true }).inputValue(), "unknown");
      assert.equal(await list().count(), 0);
      results.push(`${engineName}: ${route} six widths, time order, three then all, three distinct competition filters, refresh, empty category PASS`);
    }
  }
  await goto(page, "/competitions/presentation-futsal"); await expect(rows(page)).toHaveCount(0); assert(await page.getByText("当前暂无赛程赛果", { exact: true }).isVisible());
  await goto(page, "/competitions");
  assert.equal(await page.getByRole("navigation", { name: "赛事中心公开导航" }).getByRole("link").count(), 7);
  for (const anchor of await page.getByRole("navigation", { name: "赛事中心公开导航" }).getByRole("link").all()) assert.equal((await context.request.get(await anchor.getAttribute("href"))).status(), 200);
  if (engineName === "chromium") {
    await page.screenshot({ path: path.join(evidence, "desktop-center.png"), fullPage: false });
    await page.getByRole("heading", { name: "当前公开赛事", exact: true }).evaluate((e) => e.closest("section").scrollIntoView({ block: "start" }));
    await stable(page);
    await page.screenshot({ path: path.join(evidence, "desktop-cards.png") });
    await goto(page, "/competitions/presentation-cup");
    await page.screenshot({ path: path.join(evidence, "desktop-detail.png") });
    for (const section of ["overview", "schedule", "standings", "officials"]) { await page.locator(`#${section}`).evaluate((e) => e.scrollIntoView({ block: "start" })); await stable(page); await page.screenshot({ path: path.join(evidence, `desktop-${section}.png`) }); }
    await page.setViewportSize({ width: 390, height: 844 });
    await goto(page, "/competitions/presentation-cup#schedule");
    await page.screenshot({ path: path.join(evidence, "mobile-schedule.png") });
    await page.locator("#officials").scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(evidence, "mobile-appointments.png") });
    await page.setViewportSize({ width: 1440, height: 1000 });
    const login = await context.request.post(`${base}/api/referees/admin/login`, { headers: { origin: mutationOrigin }, data: { username: fixture.username, password: fixture.password } });
    assert.equal(login.status(), 200, await login.text());
    const sessionCookie = login.headers()["set-cookie"]?.match(/nuaa_referee_admin=([^;]+)/)?.[1];
    assert(sessionCookie, "isolated login cookie");
    // Local HTTP cannot transport a production Secure cookie; install this fixture cookie locally.
    await context.addCookies([{ name: "nuaa_referee_admin", value: sessionCookie, url: base, httpOnly: true, sameSite: "Lax" }]);
    await goto(page, fixture.adminPath);
    for (const [name, count] of [["campus", 2], ["venue", 2], ["host", 1], ["organizer", 2]]) { const field = page.locator(`textarea[name="${name}"]`); assert.equal(await field.count(), 1); assert.equal((await field.inputValue()).split("\n").length, count); }
    const values = { campus: "天目湖校区\n将军路校区", venue: "天目湖校区西操场（东操场备用）\n将军路校区西操场（慧园足球场、东操场备用）", host: "南京航空航天大学体育部\n赛事组委会", organizer: "南京航空航天大学天目湖学生足球协会\n南京航空航天大学将军路学生足球协会" };
    for (const [name, value] of Object.entries(values)) await page.locator(`textarea[name="${name}"]`).fill(value);
    await page.getByRole("heading", { name: "赛事公开资料", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(evidence, "desktop-admin-multiline.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "admin mobile overflow");
    await page.screenshot({ path: path.join(evidence, "mobile-admin.png") });
    const saved = page.waitForResponse((r) => r.url().endsWith(`/api/referees/admin/competitions/${fixture.competitionId}`) && r.request().method() === "PATCH");
    await page.getByRole("button", { name: "保存赛事", exact: true }).click(); const savedResponse = await saved; assert.equal(savedResponse.status(), 200, await savedResponse.text()); await page.waitForURL("**/admin/competitions");
    await goto(page, fixture.adminPath);
    for (const [name, value] of Object.entries(values)) assert.equal(await page.locator(`textarea[name="${name}"]`).inputValue(), value);
    await goto(page, "/competitions/presentation-cup#overview");
    for (const label of ["校区", "比赛场地", "主办单位", "承办单位"]) { const fact = page.locator(".core-competition-facts dl").filter({ has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) }); assert.equal(await fact.locator("dd > span > span").count(), 2, label); }
    results.push("authenticated admin: legacy multiline defaults, four fields saved and reloaded, public rendering, mobile overflow PASS");
  }
  results.push(`${engineName}: status/stage/group/round/date filters, empty state, deep match paging, completed appointment expansion, menu links PASS`);
  const noJS = await browser.newContext({ baseURL: base, javaScriptEnabled: false });
  const noJSPage = await noJS.newPage();
  await goto(noJSPage, "/competitions/presentation-cup");
  assert.equal(await rows(noJSPage).count(), 3, "server-rendered initial fixtures");
  await noJSPage.getByRole("link", { name: /展示更多比赛/ }).click();
  await stable(noJSPage);
  assert.equal(await rows(noJSPage).count(), 6, "native link expansion without JavaScript");
  for (const route of enginePrefetchRoutes) {
    const response = await context.request.get(route);
    assert.equal(response.status(), 200, `direct route after WebKit prefetch diagnostic: ${route}`);
  }
  if (fixture.refereeCompetitions?.length) {
    for (const route of ["assignments", "open-matches"]) {
      await goto(noJSPage, `/referees/${route}`);
      const list = noJSPage.getByRole("list", { name: "公开选派记录", exact: true });
      assert.equal(await list.locator(":scope > li").count(), 3);
      await noJSPage.getByRole("combobox", { name: "赛事", exact: true }).selectOption(fixture.refereeCompetitions[0].id);
      await noJSPage.getByRole("button", { name: "筛选", exact: true }).click(); await stable(noJSPage);
      assert((await list.innerText()).includes(fixture.refereeCompetitions[0].name));
      await noJSPage.getByRole("link", { name: /继续查看比赛/ }).click(); await stable(noJSPage);
      assert((await list.locator(":scope > li").count()) > 3);
    }
    results.push(`${engineName}: no-JS competition filtering and expand-all PASS`);
  }
  await noJS.close();
  await context.close(); await browser.close();
}
assert.deepEqual(errors, [], "browser exceptions");
await writeFile(path.join(evidence, "results.json"), JSON.stringify({ status: "PASS", results, prefetchDiagnostics, evidence }, null, 2));
console.log(JSON.stringify({ status: "PASS", results, prefetchDiagnostics, evidence }, null, 2));
