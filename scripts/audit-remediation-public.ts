import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import type { Prisma } from "../src/generated/prisma-v29/client";

const results: Array<Record<string, unknown>> = [];
const evidence = process.env.NUAAFA_TEST_EVIDENCE ? path.resolve(process.env.NUAAFA_TEST_EVIDENCE) : undefined;
const runHttp = process.argv.includes("--http");
const runBrowser = process.argv.includes("--browser");

async function port() {
  const socket = net.createServer();
  await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const value = (socket.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return value;
}

async function main() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "nuaafa-audit-public-")));
  const db = path.join(root, "synthetic.db");
  const uploads = path.join(root, "uploads");
  await mkdir(uploads);
  process.env.DATABASE_URL = `file:${db}`;
  process.env.NUAAFA_UPLOAD_DIR = uploads;
  process.env.NUAAFA_CONTENT_SOURCE = "database";
  const raw = createClient({ url: process.env.DATABASE_URL });
  for (const migration of (await readdir("prisma/migrations", { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    await raw.executeMultiple(await readFile(path.join("prisma/migrations", migration.name, "migration.sql"), "utf8"));
  }
  raw.close();
  assert.equal(await realpath(db), db, "Synthetic database cannot resolve through a symlink");
  // Next supplies this compile-time marker; Node service tests use an empty marker only.
  const loader = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
  const originalLoad = loader._load;
  loader._load = function (request, parent, isMain) { return request === "server-only" ? {} : originalLoad.call(this, request, parent, isMain); };
  const { prisma } = await import("../src/lib/prisma");
  const { getPublishedContentPage, getPublishedContentDetailBySlug } = await import("../src/lib/admin-content-service");
  const { getPublicDiscoveryItems } = await import("../src/lib/public-content-discovery");
  const { getPublicCompetition, getPublicCompetitionCatalog, getHomepagePublicCompetitions } = await import("../src/lib/public-competition-service");
  const { getPublicSitemap } = await import("../src/lib/public-sitemap");
  const { GET: rss } = await import("../src/app/rss.xml/route");
  const { GET: sitemapRoute } = await import("../src/app/sitemap.xml/route");
  let server: ChildProcess | undefined;
  let browser: { close(): Promise<void> } | undefined;
  let serverLog = "";
  let contentRenamed = false;
  let competitionRenamed = false;
  const future = new Date(Date.now() + 3_600_000);
  const day = new Date(Date.now() - 86_400_000);
  const post = (id: string, extra: Partial<Prisma.ContentPostCreateManyInput> = {}): Prisma.ContentPostCreateManyInput => ({
    id, slug: id, type: "NEWS", title: `隔离中文 & <文章> \"${id}\"`, summary: `隔离摘要 & < > ${id}`,
    content: { schemaVersion: 1, document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `虚构正文 ${id}` }] }] } },
    status: "PUBLISHED", publishedAt: day, ...extra,
  });
  try {
    const rows = Array.from({ length: 215 }, (_, i) => post(`public-${String(i).padStart(3, "0")}`, { publishedAt: new Date(day.getTime() + i * 1000) }));
    await prisma.contentPost.createMany({ data: [...rows,
      post("tie-a", { publishedAt: new Date(day.getTime() + 300_000) }),
      post("tie-z", { publishedAt: new Date(day.getTime() + 300_000) }),
      post("draft", { status: "DRAFT" }), post("archived", { status: "ARCHIVED" }),
      post("future", { publishedAt: future }), post("no-date", { publishedAt: null }),
      post("2026-freshman-cup-preparation-started", { status: "ARCHIVED" }),
    ] });
    const publicCompetition = await prisma.competition.create({ data: { slug: "audit-public", name: "隔离公开赛事", campus: "虚构校区", format: "FUTSAL", status: "ONGOING", publicPublished: true, homepageFeatured: true } });
    await prisma.competition.createMany({ data: [
      { slug: "audit-private", name: "PRIVATE-COMPETITION-DO-NOT-EXPOSE", campus: "虚构校区", format: "FUTSAL", status: "PREPARING", publicPublished: false },
      { slug: "audit-test", name: "TEST-COMPETITION-DO-NOT-EXPOSE", campus: "虚构校区", format: "FUTSAL", status: "PREPARING", publicPublished: true, isTestData: true },
    ] });
    const eligible = await getPublicDiscoveryItems();
    assert.equal(eligible.length, 217);
    assert.deepEqual((await getPublicDiscoveryItems({ type: "NEWS", take: 3 })).map((item) => item.id), ["tie-z", "tie-a", "public-214"]);
    assert.equal((await getPublishedContentPage({ pageSize: 10 })).items.length, 10);
    for (const slug of ["draft", "archived", "future", "no-date", "2026-freshman-cup-preparation-started"]) {
      assert.equal(await getPublishedContentDetailBySlug(slug), null);
      assert(!eligible.some((item) => item.href.endsWith("/" + slug)));
    }
    assert.equal((await getPublicDiscoveryItems({ now: new Date(future.getTime() + 1) })).length, 218);
    const map = await getPublicSitemap();
    assert.equal(map.filter((item) => item.url.includes("/news/")).length, 217);
    assert.equal(new Set(map.map((item) => item.url)).size, map.length);
    const rssResponse = await rss();
    const rssText = await rssResponse.text();
    assert.equal((rssText.match(/<item>/g) ?? []).length, 30);
    assert(rssText.includes("&amp; &lt;文章&gt; &quot;tie-z&quot;"));
    assert(!rssText.includes("Invalid Date"));
    const { Parser } = createRequire(import.meta.url)("saxen") as { Parser: new () => { on(event: string, callback: (error: Error) => void): void; parse(value: string): void } };
    for (const value of [rssText, await (await sitemapRoute()).text()]) {
      const parser = new Parser();
      parser.on("error", (error) => { throw error; }); parser.on("warn", (error) => { throw error; }); parser.parse(value);
    }
    const { xmlText } = await import("../src/lib/public-feed-response");
    assert.equal(xmlText("a\u0000\u0001\ud800b & < > \" ' 足球⚽"), "ab &amp; &lt; &gt; &quot; &apos; 足球⚽");
    assert.match(rssResponse.headers.get("cache-control")!, /no-store/);
    assert.match((await sitemapRoute()).headers.get("cache-control")!, /no-store/);
    assert(await getPublicCompetition("audit-public"));
    assert.equal(await getPublicCompetition("audit-private"), undefined);
    assert.equal(await getPublicCompetition("audit-test"), undefined);
    assert.equal(await getPublicCompetition("does-not-exist"), undefined);
    results.push({ case: "qualification-pagination-order-and-xml", result: "PASS", published: 217, sitemapPublished: 217, rss: 30, homepage: ["tie-z", "tie-a", "public-214"], hiddenSlugs: ["draft", "archived", "future", "no-date", "2026-freshman-cup-preparation-started"] });

    // Preserve a before measurement from the exact baseline route, not the earlier audit's result.
    const ts = createRequire(import.meta.url)("typescript") as typeof import("typescript");
    const SourceModule = createRequire(import.meta.url)("node:module") as typeof Module & { _nodeModulePaths(path: string): string[] };
    const baselineSource = execFileSync("git", ["show", "496629c67c939c688f2d556917685936a1d658dc:src/app/rss.xml/route.ts"], { encoding: "utf8" });
    const legacy = new SourceModule(path.resolve("src/app/rss.xml/route.ts")) as InstanceType<typeof Module> & { _compile(source: string, filename: string): void };
    legacy.filename = path.resolve("src/app/rss.xml/route.ts"); legacy.paths = SourceModule._nodeModulePaths(path.dirname(legacy.filename));
    legacy._compile(ts.transpileModule(baselineSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, legacy.filename);
    const legacyResponse = await (legacy.exports as { GET(): Promise<Response> }).GET();
    const legacyText = await legacyResponse.text();
    assert(!legacyText.includes("/news/tie-z"));
    results.push({ case: "baseline-before", result: "CONFIRMED", sha: "496629c67c939c688f2d556917685936a1d658dc", oldRssIncludesSyntheticLatest: false, newRssIncludesSyntheticLatest: rssText.includes("/news/tie-z") });

    const legacyCompetitionPath = "src/lib/public-competition-service.ts";
    const legacyCompetitionSource = execFileSync("git", ["show", "496629c67c939c688f2d556917685936a1d658dc:" + legacyCompetitionPath], { encoding: "utf8" });
    const legacyCompetition = new SourceModule(path.resolve(legacyCompetitionPath)) as InstanceType<typeof Module> & { _compile(source: string, filename: string): void };
    legacyCompetition.filename = path.resolve(legacyCompetitionPath); legacyCompetition.paths = SourceModule._nodeModulePaths(path.dirname(legacyCompetition.filename));
    legacyCompetition._compile(ts.transpileModule(legacyCompetitionSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, legacyCompetition.filename);
    const previousReads = legacyCompetition.exports as { getPublicCompetition(slug: string): Promise<unknown>; getPublicCompetitionCatalog(): Promise<unknown[]>; getHomepagePublicCompetitions(): Promise<unknown[]> };
    await prisma.$executeRawUnsafe('ALTER TABLE "Competition" RENAME TO "AuditTemporarilyUnavailableCompetition"'); competitionRenamed = true;
    assert.equal(await previousReads.getPublicCompetition("audit-public"), undefined);
    assert.deepEqual(await previousReads.getPublicCompetitionCatalog(), []);
    assert.deepEqual(await previousReads.getHomepagePublicCompetitions(), []);
    await assert.rejects(() => getPublicCompetition("audit-public"), (error: unknown) => error instanceof Error && error.name === "PublicReadUnavailableError");
    await prisma.$executeRawUnsafe('ALTER TABLE "AuditTemporarilyUnavailableCompetition" RENAME TO "Competition"'); competitionRenamed = false;
    results.push({ case: "baseline-storage-fault-before-after", result: "PASS", before: { detail: "undefined", catalogue: [], homepage: [] }, after: "explicit PublicReadUnavailableError", mechanism: "actual baseline code and patched code against the same new SQLite with temporarily unavailable table" });

    if (runHttp || runBrowser) {
      const chosenPort = await port(); const base = `http://127.0.0.1:${chosenPort}`;
      const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, NODE_ENV: "production", TZ: "UTC", DATABASE_URL: `file:${db}`, NUAAFA_UPLOAD_DIR: uploads, NUAAFA_CONTENT_SOURCE: "database", NEXT_TELEMETRY_DISABLED: "1", REFEREE_ADMIN_SESSION_SECRET: "Synthetic-Audit-Public-Admin-Only-2026", REFEREE_MEMBER_SESSION_SECRET: "Synthetic-Audit-Public-Member-Only-2026" };
      server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(chosenPort)], { env, stdio: ["ignore", "pipe", "pipe"] });
      server.stdout!.on("data", (chunk) => { serverLog += String(chunk); }); server.stderr!.on("data", (chunk) => { serverLog += String(chunk); });
      let ready = false;
      for (let i = 0; i < 150; i++) {
        if (server.exitCode !== null) break;
        try { if ((await fetch(base + "/api/health")).ok) { ready = true; break; } } catch { /* loopback startup */ }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert(ready, "Isolated server failed to start");
      const request = async (pathname: string) => { const response = await fetch(base + pathname); const rawText = await response.text(); return { response, rawText, text: rawText.replace(/<!--[\s\S]*?-->/g, "") }; };
      for (const pathname of ["/", "/news", "/news/tie-z", "/sitemap.xml", "/rss.xml", "/competitions/audit-public"]) assert.equal((await request(pathname)).response.status, 200, pathname);
      const homepage = (await request("/")).text;
      assert(homepage.includes('href="/news/tie-z"'));
      assert(!homepage.includes('href="/news/public-213"'));
      for (const pathname of ["/news/draft", "/news/archived", "/news/future", "/news/2026-freshman-cup-preparation-started", "/competitions/audit-private", "/competitions/audit-test", "/competitions/missing"]) {
        assert.equal((await request(pathname)).response.status, 404, pathname);
      }
      const { hashPassword } = await import("../src/lib/referee-security");
      const password = "Synthetic-Public-Content-Test-2026!";
      await prisma.adminAccount.create({ data: { username: "audit-public-editor", displayName: "虚构内容管理员", role: "SUPER_ADMIN", passwordHash: await hashPassword(password) } });
      const jsonRequest = (value: unknown, cookie?: string) => ({ method: "POST", headers: { "content-type": "application/json", origin: "https://nuaafa.cn", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(value) });
      const login = await fetch(base + "/api/referees/admin/login", jsonRequest({ username: "audit-public-editor", password }));
      assert.equal(login.status, 200);
      const cookie = login.headers.getSetCookie().filter((value) => value.startsWith("nuaa_referee_admin=")).at(-1)?.split(";", 1)[0];
      assert(cookie, "Synthetic admin login must provide its real session cookie");
      const contentInput = { type: "NEWS", slug: "api-publication", title: "隔离API发布 & 同步", summary: "隔离内容同步验证", status: "DRAFT", content: { schemaVersion: 1, document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "虚构API正文" }] }] } } };
      const created = await fetch(base + "/api/admin/content/posts", jsonRequest(contentInput, cookie));
      assert.equal(created.status, 201);
      const createdBody = await created.json() as { post: { id: string } };
      assert.equal((await request("/news/api-publication")).response.status, 404);
      const changeContent = async (status: string) => {
        const response = await fetch(base + "/api/admin/content/posts/" + createdBody.post.id, { ...jsonRequest({ ...contentInput, status }, cookie), method: "PATCH" });
        assert.equal(response.status, 200);
      };
      await changeContent("PUBLISHED");
      for (const pathname of ["/", "/news", "/sitemap.xml", "/rss.xml"]) assert((await request(pathname)).text.includes("/news/api-publication"), pathname);
      assert.equal((await request("/news/api-publication")).response.status, 200);
      await changeContent("ARCHIVED");
      for (const pathname of ["/", "/news", "/sitemap.xml", "/rss.xml"]) assert(!(await request(pathname)).text.includes("/news/api-publication"), pathname);
      assert.equal((await request("/news/api-publication")).response.status, 404);
      results.push({ case: "real-authenticated-content-api-publish-and-archive", result: "PASS", lifecycle: ["DRAFT", "PUBLISHED", "ARCHIVED"], role: "synthetic SUPER_ADMIN", feedsAndHomepageSynchronizedOnNextRequest: true });
      const crossingAt = new Date(Date.now() + 3500);
      await prisma.contentPost.create({ data: post("clock-crossing", { publishedAt: crossingAt }) });
      assert(!(await request("/sitemap.xml")).text.includes("/news/clock-crossing"));
      assert.equal((await request("/news/clock-crossing")).response.status, 404);
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, crossingAt.getTime() - Date.now() + 50)));
      for (const pathname of ["/", "/news", "/sitemap.xml", "/rss.xml"]) assert((await request(pathname)).text.includes("/news/clock-crossing"), pathname);
      assert.equal((await request("/news/clock-crossing")).response.status, 200);
      await prisma.contentPost.update({ where: { slug: "clock-crossing" }, data: { status: "ARCHIVED" } });
      for (const pathname of ["/", "/news", "/sitemap.xml", "/rss.xml"]) assert(!(await request(pathname)).text.includes("/news/clock-crossing"), pathname);
      assert.equal((await request("/news/clock-crossing")).response.status, 404);
      results.push({ case: "real-http-publication-clock-crossing-and-archive", result: "PASS", cache: "no-store; next request sees eligibility changes; no save required at scheduled time", clockCrossingUpperBoundMs: 3550, base });

      let page: { goto(url: string): Promise<unknown>; getByRole(role: string, options: { name: string; exact?: boolean }): { click(): Promise<void>; isVisible(): Promise<boolean>; waitFor(options: { state: "visible"; timeout?: number }): Promise<void> }; getByText(text: string, options?: { exact?: boolean }): { isVisible(): Promise<boolean> }; locator(selector: string): { innerText(): Promise<string> }; screenshot(options: { path: string; fullPage: boolean }): Promise<unknown> } | undefined;
      if (runBrowser) {
        const modulePath = process.env.PLAYWRIGHT_MODULE;
        assert(modulePath, "PLAYWRIGHT_MODULE is required for the browser check");
        const pw = await import(pathToFileURL(path.resolve(modulePath)).href);
        const launched = await pw.chromium.launch({ headless: true, ...(process.env.AUDIT_BROWSER_CHANNEL ? { channel: process.env.AUDIT_BROWSER_CHANNEL } : {}) });
        browser = launched;
        page = await launched.newPage();
      }
      await prisma.$executeRawUnsafe('ALTER TABLE "Competition" RENAME TO "AuditTemporarilyUnavailableCompetition"'); competitionRenamed = true;
      for (const load of [() => getPublicCompetition("audit-public"), () => getPublicCompetitionCatalog(), () => getHomepagePublicCompetitions()]) {
        await assert.rejects(load, (error: unknown) => error instanceof Error && error.name === "PublicReadUnavailableError" && !/SELECT|file:|Prisma/.test(error.message));
      }
      const mapError = await request("/sitemap.xml"); assert.equal(mapError.response.status, 503); assert.match(mapError.response.headers.get("cache-control")!, /no-store/); assert(!mapError.text.includes("<urlset"));
      const hubError = await request("/competitions"); assert.equal(hubError.response.status, 200); assert(hubError.text.includes("当前公开赛事暂时无法加载")); assert(hubError.text.includes("比赛数据与赛事档案")); assert(!hubError.text.includes("当前暂无公开赛事"));
      const homeError = await request("/"); assert.equal(homeError.response.status, 200); assert(homeError.text.includes("当前赛事暂时无法加载")); assert(homeError.text.includes("/news/tie-z"));
      if (page) {
        await page.goto(base + "/competitions/audit-public");
        assert(await page.getByRole("heading", { name: "资料暂时无法加载", exact: true }).isVisible());
      }
      await prisma.$executeRawUnsafe('ALTER TABLE "AuditTemporarilyUnavailableCompetition" RENAME TO "Competition"'); competitionRenamed = false;
      if (page) {
        await page.getByRole("button", { name: "重新加载", exact: true }).click();
        await page.getByRole("heading", { name: "隔离公开赛事", exact: true }).waitFor({ state: "visible" });
        assert((await page.locator("body").innerText()).includes("隔离公开赛事"));
      }
      assert.equal((await request("/sitemap.xml")).response.status, 200);
      assert.equal((await request("/competitions/audit-public")).response.status, 200);
      await prisma.$executeRawUnsafe('ALTER TABLE "ContentPost" RENAME TO "AuditTemporarilyUnavailableContentPost"'); contentRenamed = true;
      const rssError = await request("/rss.xml"); assert.equal(rssError.response.status, 503); assert.match(rssError.response.headers.get("cache-control")!, /no-store/);
      assert.equal((await request("/sitemap.xml")).response.status, 503);
      const newsError = await request("/news"); assert.notEqual(newsError.response.status, 404); assert(newsError.response.status >= 500 || newsError.text.includes("digest")); assert(!newsError.text.includes("暂无已发布内容"));
      const homeNewsError = await request("/"); assert(homeNewsError.text.includes("最新故事暂时无法加载")); assert(!homeNewsError.text.includes("暂无已发布报道")); assert(homeNewsError.text.includes(publicCompetition.name));
      if (page) {
        await page.goto(base + "/news");
        assert(await page.getByRole("heading", { name: "资料暂时无法加载", exact: true }).isVisible());
      }
      await prisma.$executeRawUnsafe('ALTER TABLE "AuditTemporarilyUnavailableContentPost" RENAME TO "ContentPost"'); contentRenamed = false;
      if (page) {
        await page.getByRole("button", { name: "重新加载", exact: true }).click();
        await page.getByRole("heading", { name: "新闻公告", exact: true }).waitFor({ state: "visible" });
        assert((await page.locator("body").innerText()).includes("tie-z"));
        if (evidence) await page.screenshot({ path: path.join(evidence, "public-news-recovered.png"), fullPage: true });
      }
      assert.equal((await request("/rss.xml")).response.status, 200);
      assert.equal((await request("/news")).response.status, 200);
      assert(!/SELECT .*ContentPost|no such table|file:\/|PrismaClientKnownRequestError:/.test(serverLog), "Server logs must not include raw storage details");
      results.push({ case: "real-storage-faults-and-recovery", result: "PASS", feedFailureStatus: 503, newsFailureHttpStatus: newsError.response.status, homepageOtherSectionsRetained: true, browserRetry: page ? "PASS" : "NOT RUN", databaseFaultMethod: "only newly created synthetic tables temporarily renamed, restored in finally" });
    }
    process.env.NUAAFA_CONTENT_SOURCE = "static";
    const staticItems = await getPublicDiscoveryItems();
    assert(staticItems.some((item) => item.href === "/news/2026-freshman-cup-preparation-started"));
    assert.equal((await getPublicDiscoveryItems({ now: new Date("2000-01-01T00:00:00Z") })).length, 0);
    assert.equal(new Set(staticItems.map((item) => item.href)).size, staticItems.length);
    results.push({ case: "explicit-static-mode-history-and-time", result: "PASS", preservedHistoricalArticles: staticItems.length, archivedCmsNotUsedAsFallback: true });
    console.log(JSON.stringify({ result: "PASS", results }, null, 2));
  } finally {
    if (contentRenamed) await prisma.$executeRawUnsafe('ALTER TABLE "AuditTemporarilyUnavailableContentPost" RENAME TO "ContentPost"');
    if (competitionRenamed) await prisma.$executeRawUnsafe('ALTER TABLE "AuditTemporarilyUnavailableCompetition" RENAME TO "Competition"');
    await browser?.close();
    if (server && server.exitCode === null) { server.kill("SIGTERM"); await once(server, "exit"); }
    await prisma.$disconnect();
    if (evidence) {
      await mkdir(evidence, { recursive: true });
      await writeFile(path.join(evidence, runHttp || runBrowser ? "content-and-errors.json" : "content-and-errors-unit.json"), JSON.stringify({ baseline: "496629c67c939c688f2d556917685936a1d658dc", environment: { node: process.version, platform: process.platform, syntheticRoot: root }, results }, null, 2));
      if (runHttp || runBrowser) await writeFile(path.join(evidence, "public-server.log"), serverLog);
    }
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
