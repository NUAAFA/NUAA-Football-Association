// Targeted real-browser editing regression; explicit isolated runtime and browser.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile, realpath, lstat } from "node:fs/promises";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const argument = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const runtime = await realpath(argument("runtime"));
const evidence = await mkdtemp(path.join(await realpath(argument("evidence")), "tiptap-"));
assert(!runtime.startsWith("/srv/") && !runtime.startsWith("/etc/"));
assert.equal(process.versions.node, "22.23.4");
const browserRequire = createRequire(path.join(argument("playwright"), "package.json"));
const { chromium } = browserRequire("playwright");
assert.equal(JSON.parse(await readFile(path.join(runtime, "node_modules/@tiptap/core/package.json"))).version, "3.30.5");
const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "nuaafa-editor-")));
const db = path.join(root, "synthetic.db");
const uploads = path.join(root, "uploads");
await mkdir(uploads);
const env = { PATH: process.env.PATH, HOME: root, TMPDIR: root, TZ: "UTC", NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", CHECKPOINT_DISABLE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1", DATABASE_URL: `file:${db}`, UNIFIED_ADMIN_SMOKE_DATABASE_PATH: db, NUAAFA_UPLOAD_DIR: uploads, NUAAFA_CONTENT_SOURCE: "database", REFEREE_ADMIN_SESSION_SECRET: "Synthetic-Editor-Admin-Only-2026", REFEREE_MEMBER_SESSION_SECRET: "Synthetic-Editor-Member-Only-2026" };
let server, browser, context;
let serverLog = "";
const errors = [];
const events = [];
const monitoredPages = [];
const rejectionChecks = [];
let result;
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function persistedPost(page, id) {
  const response = await page.evaluate(async (postId) => {
    const response = await fetch(`/api/admin/content/posts/${postId}`, { cache: "no-store" });
    return { status: response.status, body: await response.json() };
  }, id);
  assert.equal(response.status, 200);
  return response.body.post;
}
async function capture(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: runtime, env });
    let output = "", error = "";
    child.stdout.on("data", (d) => { output += d; });
    child.stderr.on("data", (d) => { error += d; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve(output) : reject(new Error(`Fixture failed ${code}: ${error}`)));
  });
}
async function save(page, status) {
  const response = page.waitForResponse((r) => r.url().includes("/api/admin/content/posts") && ["POST", "PATCH"].includes(r.request().method()));
  await page.getByRole("button", { name: status, exact: true }).click();
  const result = await response;
  const body = await result.json();
  assert(result.ok(), JSON.stringify(body));
  await page.waitForURL(/\/admin\/content\/news\?message=/);
  return body.post;
}
try {
  const fixture = JSON.parse((await capture(["--import", "tsx", "scripts/prepare-unified-admin-smoke.ts"])).trim().split(/\r?\n/).at(-1));
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const localOrigin = `http://127.0.0.1:${port}`;
  const origin = "https://nuaafa.cn";
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: runtime, env });
  server.stdout.on("data", (d) => { serverLog += d; });
  server.stderr.on("data", (d) => { serverLog += d; });
  let healthy = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(serverLog);
    try { if ((await fetch(`${localOrigin}/api/health`)).ok) { healthy = true; break; } } catch { /* Local startup only. */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert(healthy, serverLog);
  browser = await chromium.launch({ channel: "chrome", headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.on("page", (page) => {
    const identity = { id: monitoredPages.length + 1, page };
    monitoredPages.push(identity);
    page.on("pageerror", (error) => errors.push({ page: identity.id, url: page.url(), message: error.message }));
  });
  // Production origin/cookie rules remain intact. ALL browser traffic is
  // intercepted and fulfilled from this loopback fixture; no production socket.
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { await route.abort(); return; }
    const response = await route.fetch({ url: localOrigin + url.pathname + url.search, maxRedirects: 0 });
    await route.fulfill({ response });
  });
  const page = await context.newPage();
  page.on("dialog", async (d) => d.type() === "prompt" ? d.accept("https://example.invalid/editor-proof") : d.accept());
  await page.goto(`${origin}/admin/login`);
  await page.getByLabel("管理员账号").fill("smoke-content");
  await page.getByLabel("管理员密码").fill(fixture.password);
  await page.getByRole("button", { name: "登录统一管理后台" }).click();
  await page.waitForURL(/\/admin(?!\/login)/);
  events.push("synthetic content editor login through browser PASS");
  await page.goto(`${origin}/admin/content/news/new`);
  await page.getByLabel("标题", { exact: true }).fill("Tiptap 定向交互验证");
  await page.getByLabel("摘要", { exact: true }).fill("仅用于隔离环境的升级交互回归。");
  const editor = page.locator('[contenteditable="true"][aria-label="结构化正文编辑器"]');
  await editor.fill("EDITOR_HEADING");
  await page.getByRole("button", { name: "H2", exact: true }).click();
  assert.equal(await editor.locator("h2").textContent(), "EDITOR_HEADING");
  await editor.press("End");
  await editor.press("Enter");
  await page.getByRole("button", { name: "B", exact: true }).click();
  await page.keyboard.insertText("EDITOR_BOLD_BODY ");
  await page.getByRole("button", { name: "B", exact: true }).click();
  await page.getByRole("button", { name: "链接", exact: true }).click();
  await page.keyboard.insertText("EDITOR_LINK");
  await page.getByLabel("插入媒体库图片").selectOption(fixture.coverMediaId);
  await page.getByRole("button", { name: "插入图片", exact: true }).click();
  const serialized = JSON.parse(await page.locator('textarea[name="content"]').inputValue());
  assert(JSON.stringify(serialized).includes('"type":"bold"'));
  assert(JSON.stringify(serialized).includes("https://example.invalid/editor-proof"));
  assert(JSON.stringify(serialized).includes(`/media/${fixture.coverMediaId}`));
  await page.screenshot({ path: path.join(evidence, "editor-before-save.png"), fullPage: true });
  const post = await save(page, "保存草稿");
  events.push("heading/bold/link/media UI editing and draft save PASS");
  await page.goto(`${origin}/admin/content/news/${post.id}`);
  await editor.waitFor();
  assert((await editor.textContent()).includes("EDITOR_BOLD_BODY"));
  assert.equal(await editor.locator("a").getAttribute("href"), "https://example.invalid/editor-proof");
  assert.equal(await editor.locator("img").getAttribute("src"), `/media/${fixture.coverMediaId}`);
  await page.keyboard.press("Escape");
  await page.screenshot({ path: path.join(evidence, "editor-reopened.png"), fullPage: true });
  const preview = await context.newPage();
  await preview.goto(`${origin}/admin/content/news/${post.id}/preview`);
  assert((await preview.locator("article").textContent()).includes("EDITOR_BOLD_BODY"));
  assert.equal(await preview.locator('article a[href="https://example.invalid/editor-proof"]').count(), 1);
  const previewImage = preview.locator("article figure img");
  assert.equal(await previewImage.count(), 1);
  assert.equal(new URL(await previewImage.getAttribute("src"), origin).searchParams.get("url"), `/media/${fixture.coverMediaId}`);
  await previewImage.scrollIntoViewIfNeeded();
  await previewImage.evaluate((image) => image.decode());
  assert((await previewImage.evaluate((image) => image.naturalWidth)) > 0);
  await preview.screenshot({ path: path.join(evidence, "editor-draft-preview.png"), fullPage: true });
  assert.equal((await fetch(`${localOrigin}/news/${post.slug}`)).status, 404);
  await save(page, "发布");
  const publicPage = await context.newPage();
  await publicPage.goto(`${origin}/news/${post.slug}`);
  assert((await publicPage.locator("article").textContent()).includes("EDITOR_BOLD_BODY"));
  const publicImage = publicPage.locator("article figure img");
  assert.equal(await publicImage.count(), 1);
  assert.equal(new URL(await publicImage.getAttribute("src"), origin).searchParams.get("url"), `/media/${fixture.coverMediaId}`);
  await publicImage.scrollIntoViewIfNeeded();
  await publicImage.evaluate((image) => image.decode());
  assert((await publicImage.evaluate((image) => image.naturalWidth)) > 0);
  assert.equal(await publicPage.locator('article a[href="https://example.invalid/editor-proof"]').getAttribute("rel"), "noopener noreferrer nofollow");
  await publicPage.screenshot({ path: path.join(evidence, "editor-public-render.png"), fullPage: true });
  events.push("reopen, saved draft preview, draft privacy and public rendering PASS");
  // Browser-authenticated requests go through the actual server validator. They
  // supplement interaction evidence; they are not substituted for UI editing.
  const before = await persistedPost(page, post.id);
  const publicBefore = await publicPage.locator("article").innerHTML();
  await writeFile(path.join(evidence, "persisted-before.json"), JSON.stringify(before, null, 2) + "\n", { flag: "wx" });
  for (const [caseName, node] of [
    ["javascript-link", { type: "paragraph", content: [{ type: "text", text: "bad", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }],
    ["data-image", { type: "image", attrs: { src: "data:image/png;base64,AAAA" } }],
    ["script-node", { type: "script", content: [{ type: "text", text: "alert(1)" }] }],
  ]) {
    const status = await page.evaluate(async ({ id, payload }) => (await fetch(`/api/admin/content/posts/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })).status,
      { id: post.id, payload: { type: "NEWS", slug: post.slug, title: post.title, summary: post.summary, content: { schemaVersion: 1, document: { type: "doc", content: [node] } }, status: "PUBLISHED" } });
    assert.equal(status, 400);
    const after = await persistedPost(page, post.id);
    await writeFile(path.join(evidence, `persisted-after-${caseName}.json`), JSON.stringify(after, null, 2) + "\n", { flag: "wx" });
    assert.deepEqual(after, before, `${caseName}: full persistent record changed after rejection`);
    await publicPage.reload();
    assert.equal(await publicPage.locator("article").innerHTML(), publicBefore, `${caseName}: public article changed`);
    rejectionChecks.push({ case: caseName, status, beforeSha256: digest(before), afterSha256: digest(after), fullRecordEqual: true, publicArticleEqual: true });
  }
  events.push("illegal link/image/node rejected by live server; published content preserved PASS");
  assert.deepEqual(errors, []);
  assert.equal(monitoredPages.length, context.pages().length, "Every context page must have an error listener");
  result = { platform: `${process.platform}/${process.arch}`, uid: process.getuid(), node: process.versions.node, tiptap: "3.30.5", browser: await browser.version(), evidence, events, rejectionChecks, pageErrors: errors, monitoredPages: monitoredPages.map(({ id, page }) => ({ id, url: page.url() })), network: "all browser URLs intercepted and fulfilled only from loopback synthetic server", humanReview: "PENDING independent review", productionAccess: false };
} catch (error) {
  await writeFile(path.join(evidence, "tiptap-failure.json"), JSON.stringify({ events, error: error.stack ?? String(error), errors }, null, 2) + "\n");
  throw error;
} finally {
  await writeFile(path.join(evidence, "tiptap-server.log"), serverLog);
  if (context) await context.unrouteAll({ behavior: "ignoreErrors" });
  if (browser) await browser.close();
  if (server && server.exitCode === null) {
    const stopped = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    const timer = setTimeout(() => server.kill("SIGKILL"), 5000);
    await stopped; clearTimeout(timer);
  }
  await rm(root, { recursive: true, force: true });
  await assert.rejects(lstat(root), { code: "ENOENT" });
}
result.cleanup = "PASS";
await writeFile(path.join(evidence, "tiptap-browser-result.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(result, null, 2));
