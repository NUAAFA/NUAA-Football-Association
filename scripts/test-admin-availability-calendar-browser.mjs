import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
assert(process.env.CALENDAR_FIXTURE_ROOT, 'Run test:admin-availability-calendar first and set CALENDAR_FIXTURE_ROOT. Requires a completed build.');
const root = await realpath(process.env.CALENDAR_FIXTURE_ROOT);
assert.equal(path.dirname(root), await realpath(os.tmpdir()));
assert(path.basename(root).startsWith('nuaafa-availability-calendar-'));
const info = JSON.parse(await readFile(path.join(root, 'fixture.json'), 'utf8'));
const out = path.resolve('docs/admin-availability-calendar/evidence');
await mkdir(out, { recursive: true });
const port = Number(process.env.CALENDAR_TEST_PORT ?? 3197), origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
  env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: info.databaseUrl, NUAAFA_UPLOAD_DIR: path.join(root, 'uploads'), REFEREE_ADMIN_SESSION_SECRET: 'calendar-isolated-test-session-secret-32-characters', REFEREE_MEMBER_SESSION_SECRET: 'calendar-isolated-member-secret-32-characters' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '', browser, complete = false;
server.stdout.on('data', (c) => serverLog += c); server.stderr.on('data', (c) => serverLog += c);
const errors = [], results = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  let ready = false;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(origin + '/api/health')).ok) { ready = true; break; } } catch {} await delay(250); }
  assert(ready, serverLog);
  browser = await chromium.launch({ channel: process.env.CALENDAR_BROWSER_CHANNEL ?? 'chrome', headless: true });
  const apiPath = `/api/referees/admin/availability/${info.refereeId}`;
  const anonymous = await browser.newContext();
  assert.equal((await anonymous.request.get(origin + apiPath + '?month=2026-10')).status(), 401);
  await anonymous.close();
  async function loggedIn(username, viewport = { width: 1440, height: 900 }) {
    const context = await browser.newContext({ viewport, timezoneId: 'Europe/London' });
    const login = await context.request.post(origin + '/api/referees/admin/login', { headers: { origin: 'https://nuaafa.cn' }, data: { username, password: info.password } });
    assert.equal(login.status(), 200, await login.text());
    // Production cookies are Secure. Re-scope this isolated fixture session to loopback HTTP for browser QA.
    const cookie = login.headers()['set-cookie'].split(';')[0];
    const separator = cookie.indexOf('=');
    await context.addCookies([{ name: cookie.slice(0, separator), value: cookie.slice(separator + 1), url: origin, httpOnly: true, secure: false, sameSite: 'Lax' }]);
    // Adapt the canonical Origin only for mutations against this disposable loopback server.
    await context.route(origin + '/api/**', async (route) => {
      if (route.request().method() === 'GET') return route.continue();
      const response = await route.fetch({ headers: { ...await route.request().allHeaders(), origin: 'https://nuaafa.cn' } });
      await route.fulfill({ response });
    });
    return context;
  }
  const content = await loggedIn('calendar-content');
  assert.equal((await content.request.get(origin + apiPath + '?month=2026-10')).status(), 403); await content.close();
  const admin = await loggedIn('calendar-super');
  const all = await admin.request.get(origin + apiPath + '?month=2026-10&kind=UNAVAILABLE&date=2026-10-03');
  assert.equal(all.status(), 200); assert.equal((await all.json()).records.length, 27);
  assert.equal((await admin.request.get(origin + apiPath + '?month=2026-13')).status(), 400);
  assert.equal((await admin.request.get(origin + `/api/referees/admin/availability/${info.archivedId}?month=2026-10`)).status(), 404);
  assert.equal((await (await admin.request.get(origin + apiPath)).json()).records.length, 20);
  await admin.close();
  results.push('HTTP: 401/403/400/404, GET without Origin, complete month with both kinds, existing paged endpoint preserved');

  for (const [width, height] of [[1440,900], [1024,768], [390,700], [360,700]]) {
    const context = await loggedIn('calendar-super', { width, height });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(origin + '/admin/referees/availability?date=2026-10-03&kind=UNAVAILABLE');
    const trigger = page.getByRole('button', { name: '查看详情', exact: true }); await trigger.click();
    const dialog = page.getByRole('dialog', { name: '月历验收裁判 · 可执裁时间', exact: true });
    await dialog.getByRole('button', { name: '2026-10-01，可执裁', exact: true }).waitFor();
    assert.equal(await dialog.locator('.referee-calendar-grid button').count(), 42);
    assert.equal(await dialog.getByRole('button', { name: '2026-10-03，指定时段', exact: true }).getAttribute('aria-pressed'), 'true');
    await dialog.getByRole('button', { name: '2026-10-25，可执裁', exact: true }).click();
    const dayDetail = dialog.getByRole('region', { name: '当日时间记录' });
    await dayDetail.getByRole('heading', { name: '2026-10-25', exact: true }).waitFor();
    assert(await dayDetail.getByRole('heading', { name: '全天', exact: true }).isVisible());
    await dialog.getByRole('button', { name: '2026-10-26，未设置', exact: true }).click();
    assert(await dayDetail.getByText('这一天尚未设置').isVisible());
    await dialog.getByRole('button', { name: '2026-09-28，指定时段', exact: true }).click();
    assert(await dayDetail.getByRole('heading', { name: '00:00–02:00', exact: true }).isVisible());
    await dialog.getByRole('button', { name: '下个月', exact: true }).click();
    await dialog.getByRole('button', { name: '2026-11-01，未设置', exact: true }).waitFor();
    await dialog.getByRole('button', { name: '上个月', exact: true }).click();
    await dialog.getByRole('button', { name: '2026-10-03，指定时段', exact: true }).click();
    assert(await dayDetail.getByText('上午有课，其他时间可安排').isVisible());
    const measure = await dialog.evaluate((d) => { const r = d.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight, overflow: d.scrollWidth > d.clientWidth + 1, bodyOverflow: d.querySelector('.ops-workspace-dialog-body').scrollWidth > d.querySelector('.ops-workspace-dialog-body').clientWidth + 1 }; });
    assert(measure.left >= 15 && measure.right <= width - 15 && measure.top >= 15 && measure.bottom <= height - 15, JSON.stringify(measure));
    assert(!measure.overflow && !measure.bodyOverflow, JSON.stringify(measure));
    await dialog.locator('.ops-workspace-dialog-body').evaluate((b) => b.scrollTop = 0);
    await page.screenshot({ path: path.join(out, `calendar-${width}x${height}.png`) });
    if (width === 1440) {
      await page.route('**/availability/*?month=2026-11', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '隔离读取失败' }) }));
      await dialog.getByRole('button', { name: '下个月', exact: true }).click();
      await dialog.getByRole('alert').getByText('隔离读取失败').waitFor();
      assert.equal(await dialog.locator('.referee-calendar-grid button[data-state]').count(), 0);
      await page.unroute('**/availability/*?month=2026-11');
      await dialog.getByRole('button', { name: '重新加载', exact: true }).click();
      await dialog.getByRole('button', { name: '2026-11-01，未设置', exact: true }).waitFor();
    }
    if (width === 360) {
      await dayDetail.getByRole('button', { name: '删除10:00–12:00不可执裁记录', exact: true }).click();
      await dialog.getByRole('button', { name: '2026-10-03，可执裁', exact: true }).waitFor();
      assert(await dayDetail.getByText('记录已删除。', { exact: true }).isVisible());
    }
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
    if (width === 360) assert.equal(await trigger.count(), 0); // Deleting the only matching record removes the filtered table row.
    else assert(await trigger.evaluate((e) => e === document.activeElement));
    assert.notEqual(await page.evaluate(() => document.body.style.position), 'fixed');
    await context.close(); results.push(`${width}x${height}: full calendar, day selection, multi-day records, month switching, dialog bounds/overflow and keyboard focus`);
  }
  const verifier = await loggedIn('calendar-super');
  for (const [zone, day] of [['Europe/London', '2026-10-28'], ['Asia/Shanghai', '2026-10-29'], ['America/Los_Angeles', '2026-10-30']]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: zone });
    const login = await context.request.post(origin + '/api/referees/login', { headers: { origin: 'https://nuaafa.cn' }, data: { studentId: '2026000001', password: info.password } });
    assert.equal(login.status(), 200, await login.text());
    const cookie = login.headers()['set-cookie'].split(';')[0], split = cookie.indexOf('=');
    await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), url: origin, httpOnly: true, secure: false, sameSite: 'Lax' }]);
    await context.route(origin + '/api/**', async (route) => {
      if (route.request().method() === 'GET') return route.continue();
      const response = await route.fetch({ headers: { ...await route.request().allHeaders(), origin: 'https://nuaafa.cn' } });
      await route.fulfill({ response });
    });
    const page = await context.newPage(); page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(origin + '/referees/workspace/availability');
    const grid = page.getByRole('region', { name: '可执裁时间月历' });
    const month = day.slice(0, 7);
    for (let attempts = 0; !(await grid.getByRole('button', { name: day + '，未设置', exact: true }).count()); attempts++) {
      assert(attempts < 24);
      const heading = await grid.getByRole('heading').innerText();
      const match = /^(\d+) 年 (\d+) 月$/.exec(heading); assert(match, heading);
      await grid.getByRole('button', { name: `${match[1]}-${match[2].padStart(2, '0')}` < month ? '下个月' : '上个月', exact: true }).click();
    }
    await grid.getByRole('button', { name: day + '，未设置', exact: true }).click();
    await page.getByRole('radio', { name: /整天不可执裁/ }).check();
    await page.getByRole('button', { name: '保存此日期', exact: true }).click();
    await grid.getByRole('button', { name: day + '，不可执裁', exact: true }).waitFor();
    const editor = page.locator('.referee-availability-editor');
    assert(await editor.getByText('整天不可执裁', { exact: true }).last().isVisible());
    assert(await editor.getByText('全天 · 两种制式', { exact: true }).isVisible());
    const saved = await (await verifier.request.get(origin + apiPath + '?month=2026-10')).json();
    const expectedStart = new Date(day + 'T00:00:00+08:00').toISOString();
    const record = saved.records.find((r) => r.kind === 'UNAVAILABLE' && r.startAt === expectedStart);
    assert(record, JSON.stringify(saved)); assert.equal(Date.parse(record.endAt) - Date.parse(record.startAt), 86400000);
    const adminPage = await verifier.newPage(); await adminPage.goto(origin + '/admin/referees/availability?date=' + day);
    await adminPage.getByRole('button', { name: '查看详情', exact: true }).click();
    const dialog = adminPage.getByRole('dialog');
    await dialog.getByRole('button', { name: day + '，不可执裁', exact: true }).waitFor();
    assert.equal(await dialog.getByRole('region', { name: '当日时间记录' }).locator('article').count(), 1);
    assert(await dialog.getByRole('heading', { name: '全天', exact: true }).isVisible());
    await adminPage.screenshot({ path: path.join(out, `all-day-${zone.replaceAll('/', '-')}.png`) });
    await adminPage.close(); await context.close(); results.push(zone + ': actual member all-day save, canonical UTC+8 storage, one red all-day admin record');
  }
  await verifier.close();
  assert.deepEqual(errors, []); complete = true;
  console.log('PASS: authenticated month API, 4 viewport browser checks in Europe/London, error/retry, deletion refresh and dialog accessibility');
} finally {
  await browser?.close(); server.kill('SIGTERM');
  await writeFile(path.join(out, 'results.json'), JSON.stringify({ status: complete ? 'PASS' : 'FAIL', results, errors }, null, 2));
  await writeFile(path.join(out, 'server.log'), serverLog);
}
