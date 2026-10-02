import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

// Run after npm run build. PLAYWRIGHT_MODULE may point to the bundled index.mjs.
// Only the disposable database below is ever changed.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = await mkdtemp(path.join(os.tmpdir(), 'nuaafa-admin-accounts-'));
const out = path.resolve('docs/admin-accounts/evidence');
await mkdir(out, { recursive: true });
const origin = `http://127.0.0.1:${process.env.ADMIN_ACCOUNTS_TEST_PORT ?? 3117}`;
const env = { ...process.env, DATABASE_URL: `file:${path.join(root, 'test.db')}`, ADMIN_ACCOUNTS_TEST_ROOT: root, REFEREE_ADMIN_SESSION_SECRET: 'admin-accounts-isolated-secret-at-least-32-characters' };
const password = 'Browser-Isolated-Password-2026!';
const endpoint = '/api/admin/system/admin-accounts';
const errors = [], checks = [];
let server, browser, serverLog = '';
async function fixture() {
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/prepare-admin-accounts-browser.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', c => log += c); child.stderr.on('data', c => log += c);
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  assert.equal(code, 0, log);
}
async function request(context, method, body, url = endpoint, expected = 200) {
  // Production cookies are Secure; send the fixture cookie explicitly for the
  // loopback HTTP API probe, just as the browser sends it on local navigation.
  const cookie = (await context.cookies()).map(c => `${c.name}=${c.value}`).join('; ');
  const response = await context.request.fetch(origin + url, { method, headers: { origin: 'https://nuaafa.cn', cookie }, data: body });
  assert.equal(response.status(), expected, await response.text());
  return response;
}
async function login(username, loginPassword = password) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await request(context, 'POST', { username, password: loginPassword }, '/api/referees/admin/login');
  await context.route(origin + '/api/**', async route => {
    const response = await route.fetch({ headers: { ...await route.request().allHeaders(), origin: 'https://nuaafa.cn' } });
    await route.fulfill({ response });
  });
  return context;
}
async function pageFor(context) {
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/admin/system/admins'); return page;
}
function row(page, username) { return page.getByRole('row').filter({ has: page.locator('.admin-account-identity small').filter({ hasText: new RegExp(`^${username}( · 当前账号)?$`) }) }); }
async function dialogVisible(page, title) {
  const dialog = page.getByRole('dialog', { name: title, exact: true });
  await dialog.waitFor();
  assert(await dialog.evaluate(d => { const r = d.getBoundingClientRect(), f = d.querySelector('footer').getBoundingClientRect(); return r.top >= 15 && r.bottom <= innerHeight - 15 && r.left >= 15 && r.right <= innerWidth - 15 && f.bottom <= innerHeight; }));
  return dialog;
}
try {
  await fixture();
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', new URL(origin).port, '-H', '127.0.0.1'], { env: { ...env, NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', c => serverLog += c); server.stderr.on('data', c => serverLog += c);
  let ready = false;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(origin + '/api/health')).ok) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 250)); }
  assert(ready, serverLog);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const owner = await login('nuaafa');
  const page = await pageFor(owner);
  assert.equal(await page.locator('tbody tr').first().locator('.admin-account-identity small').textContent(), 'nuaafa · 当前账号');
  assert.equal(await row(page, 'nuaafa').getByRole('button').count(), 0);
  await page.screenshot({ path: path.join(out, 'accounts-desktop.png'), fullPage: true });
  checks.push('Owner pinned first, protected label and no destructive controls');

  await row(page, 'hb01').getByRole('button', { name: '角色权限', exact: true }).click();
  let dialog = await dialogVisible(page, '修改角色权限');
  const checkbox = dialog.getByRole('checkbox', { name: /超级管理员/ });
  assert.deepEqual(await checkbox.evaluate(e => ({ width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height })), { width: 18, height: 18 });
  await page.screenshot({ path: path.join(out, 'roles-desktop.png') });
  await page.keyboard.press('Escape');
  assert(await row(page, 'hb01').getByRole('button', { name: '角色权限', exact: true }).evaluate(e => e === document.activeElement));
  checks.push('Compact role cards, checkbox sizing, native dialog Escape and focus restoration');

  const delegate = await login('hb01');
  const delegatePage = await pageFor(delegate);
  assert.equal(await row(delegatePage, 'nuaafa').getByRole('button').count(), 0);
  const protectedId = 'test-nuaafa';
  const ordinaryId = 'test-wyx01';
  for (const payload of [{ id: protectedId, roles: ['CONTENT_EDITOR'] }, { id: protectedId, isActive: false }, { id: protectedId, isActive: true }, { id: protectedId, action: 'reset-password', password: 'Forbidden-Password-2026!' }]) {
    await request(delegate, 'PATCH', payload, endpoint, 403);
  }
  await request(delegate, 'DELETE', { id: protectedId, confirmUsername: 'nuaafa' }, endpoint, 403);
  await request(delegate, 'PATCH', { id: protectedId, isActive: false }, '/api/referees/admin/admin-accounts', 403);
  const csrf = await delegate.request.fetch(origin + endpoint, { method: 'DELETE', headers: { origin: 'https://invalid.example' }, data: { id: ordinaryId, confirmUsername: 'wyx01' } });
  assert.equal(csrf.status(), 403);
  checks.push('Delegated SUPER_ADMIN denied all owner mutations through current and legacy APIs; cross-origin delete rejected');

  // Exercise role changes, disable and enable through the real UI.
  await row(page, 'ymx001').getByRole('button', { name: '角色权限', exact: true }).click();
  dialog = await dialogVisible(page, '修改角色权限');
  await dialog.getByRole('checkbox', { name: /赛事管理员/ }).uncheck();
  await dialog.getByRole('button', { name: '保存权限' }).click(); await dialog.waitFor({ state: 'detached' });
  await row(page, 'ymx001').locator('.admin-account-roles').filter({ hasText: /^裁判管理员$/ }).waitFor();
  await row(page, 'ymx001').getByRole('button', { name: '停用', exact: true }).click();
  dialog = await dialogVisible(page, '停用管理员账号'); await dialog.getByRole('button', { name: '确认停用' }).click(); await dialog.waitFor({ state: 'detached' });
  await row(page, 'ymx001').getByText('已停用', { exact: true }).waitFor();
  await row(page, 'ymx001').getByRole('button', { name: '启用', exact: true }).click();
  dialog = await dialogVisible(page, '启用管理员账号'); await dialog.getByRole('button', { name: '确认启用' }).click(); await dialog.waitFor({ state: 'detached' });
  await row(page, 'ymx001').getByText('已启用', { exact: true }).waitFor();
  checks.push('Owner UI role change, disable and re-enable persist after refresh');

  const ordinary = await login('wyx01');
  await request(ordinary, 'DELETE', { id: ordinaryId, confirmUsername: 'wyx01' }, endpoint, 403);
  await row(page, 'wyx01').getByRole('button', { name: '重置密码', exact: true }).click();
  dialog = await dialogVisible(page, '重置管理员密码');
  await dialog.getByLabel('新的初始密码').fill('Reset-Browser-Password-2026!');
  await dialog.getByLabel('再次输入密码').fill('Mismatched-Password-2026!');
  await dialog.getByRole('button', { name: '确认重置' }).click();
  await dialog.getByRole('alert').filter({ hasText: '两次输入的密码不一致' }).waitFor();
  await dialog.getByLabel('再次输入密码').fill('Reset-Browser-Password-2026!');
  await page.screenshot({ path: path.join(out, 'reset-password.png') });
  await dialog.getByRole('button', { name: '确认重置' }).click(); await dialog.waitFor({ state: 'detached' });
  await request(ordinary, 'GET', undefined, '/api/admin/content/posts', 401);
  const resetUser = await login('wyx01', 'Reset-Browser-Password-2026!');
  await request(resetUser, 'GET', undefined, '/api/admin/content/posts', 403);
  checks.push('Reset modal confirmation, old session revoked, new password login and forced-change API gate');

  await row(page, 'wyx01').getByRole('button', { name: '删除', exact: true }).click();
  dialog = await dialogVisible(page, '删除管理员账号');
  assert(await dialog.getByRole('button', { name: '确认删除' }).isDisabled());
  await dialog.getByRole('textbox').fill('wrong');
  assert(await dialog.getByRole('button', { name: '确认删除' }).isDisabled());
  await request(owner, 'DELETE', { id: ordinaryId, confirmUsername: 'wrong' }, endpoint, 400);
  await dialog.getByRole('textbox').fill('wyx01');
  await page.screenshot({ path: path.join(out, 'delete-confirmation.png') });
  await dialog.getByRole('button', { name: '确认删除' }).click(); await dialog.waitFor({ state: 'detached' });
  await row(page, 'wyx01').waitFor({ state: 'detached' });
  await request(resetUser, 'GET', undefined, '/api/admin/content/posts', 401);
  checks.push('Delete requires exact username in UI and API; list refreshes and all sessions are revoked');

  for (const [width, height] of [[390, 700], [1024, 768]]) {
    await page.setViewportSize({ width, height });
    await page.getByRole('button', { name: '+ 新建管理员', exact: true }).click();
    dialog = await dialogVisible(page, '新建管理员');
    await dialog.locator('.ops-workspace-dialog-body').evaluate(e => e.scrollTop = e.scrollHeight);
    assert(await dialog.getByRole('button', { name: '创建账号', exact: true }).isVisible());
    await page.screenshot({ path: path.join(out, `create-${width}.png`) });
    await page.keyboard.press('Escape');
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: '+ 新建管理员', exact: true }).click();
  dialog = await dialogVisible(page, '新建管理员');
  await dialog.getByLabel('姓名', { exact: true }).fill('新管理员');
  await dialog.getByLabel(/^登录账号/).fill('created-browser');
  await dialog.getByLabel(/^初始密码/).fill('Created-Browser-Password-2026!');
  await dialog.getByRole('button', { name: '创建账号', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
  await row(page, 'created-browser').waitFor();
  checks.push('Create account via UI; 390px and 1024px dialog scroll with reachable fixed footer');
  assert.deepEqual(errors, []);
  await writeFile(path.join(out, 'browser-results.json'), JSON.stringify({ passed: true, checks, browser: browser.version(), errors, isolatedDatabase: true }, null, 2));
  console.log(checks.map(check => 'PASS ' + check).join('\n'));
} finally {
  await browser?.close();
  if (server) { server.kill('SIGTERM'); await new Promise(resolve => { if (server.exitCode !== null) resolve(); else server.once('exit', resolve); }); }
  await rm(root, { recursive: true, force: true });
}
