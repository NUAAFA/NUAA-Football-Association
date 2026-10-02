import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

// Use the installed Playwright package, or point PLAYWRIGHT_MODULE at a bundled index.mjs.
// Requires a completed `npm run build`. All writes use a disposable fixture DB.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const out = path.resolve(process.env.DIALOG_EVIDENCE_DIR ?? 'docs/admin-dialog-hotfix/evidence');
await mkdir(out, { recursive: true });
async function run(args, extra = {}) {
  const child = spawn(process.execPath, args, { env: { ...process.env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (c) => output += c); child.stderr.on('data', (c) => output += c);
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  assert.equal(code, 0, output); return output;
}
const fixtureLog = process.env.OPS_R313_ROOT ? '' : await run(['node_modules/tsx/dist/cli.mjs', 'scripts/test-ops-r3-1-3.ts']);
const root = await realpath(process.env.OPS_R313_ROOT ?? fixtureLog.match(/ISOLATED_FIXTURE=(.+)/)[1]);
assert.equal(path.dirname(root), await realpath(os.tmpdir()));
assert(path.basename(root).startsWith('nuaafa-ops-r313-'));
const info = JSON.parse(await readFile(path.join(root, 'fixture.json'), 'utf8'));
if (!process.env.DIALOG_FIXTURE_PREPARED) await run(['node_modules/tsx/dist/cli.mjs', 'scripts/prepare-admin-dialog-browser.ts'], { OPS_R313_ROOT: root });
const port = Number(process.env.DIALOG_TEST_PORT ?? 3198), origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
  env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: info.databaseUrl, NUAAFA_UPLOAD_DIR: path.join(root, 'uploads'), REFEREE_ADMIN_SESSION_SECRET: 'dialog-isolated-test-secret-at-least-32-characters' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', c => serverLog += c); server.stderr.on('data', c => serverLog += c);
const results = [], errors = [];
const startedAt = new Date().toISOString();
let complete = false, browserVersion;
let browser;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  let ready = false;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(origin + '/api/health')).ok) { ready = true; break; } } catch {} await delay(250); }
  assert(ready, serverLog);
  browser = await chromium.launch({ channel: process.env.DIALOG_BROWSER_CHANNEL ?? 'chrome', headless: true });
  browserVersion = browser.version();
  async function contextFor(viewport, mobile = false) {
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
    const login = await context.request.post(origin + '/api/referees/admin/login', { headers: { origin: 'https://nuaafa.cn' }, data: { username: 'r313-super', password: 'R313-Isolated-only-verify!' } });
    assert.equal(login.status(), 200, await login.text());
    // The built production server accepts only the canonical Origin. Keep this
    // test-only header adaptation scoped to the disposable loopback server.
    await context.route(origin + '/api/**', async route => { const response = await route.fetch({ headers: { ...await route.request().allHeaders(), origin: 'https://nuaafa.cn' } }); await route.fulfill({ response }); });
    const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
    return { context, page };
  }
  async function checkDialog(page, title, actions = []) {
    const dialog = page.getByRole('dialog', { name: title, exact: true });
    await dialog.waitFor();
    const body = dialog.locator('.ops-workspace-dialog-body');
    const measure = await dialog.evaluate(d => {
      const rect = d.getBoundingClientRect(), b = d.querySelector('.ops-workspace-dialog-body');
      return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, height: innerHeight, width: innerWidth, bodyHeight: b.clientHeight, scrollHeight: b.scrollHeight, overflow: getComputedStyle(b).overflowY };
    });
    assert(measure.top >= 15 && measure.bottom <= measure.height - 15, JSON.stringify(measure));
    assert(measure.left >= 15 && measure.right <= measure.width - 15, JSON.stringify(measure));
    assert.equal(measure.overflow, 'auto'); assert(measure.bodyHeight > 0);
    async function footerVisible() {
      assert(await dialog.locator('footer').evaluate(f => { const r = f.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }));
    }
    assert(await dialog.locator('footer button[type=submit]').evaluateAll(buttons => buttons.every(b => b.form && b.form.closest('dialog') === b.closest('dialog'))), 'Footer submits must belong to the original form');
    await body.evaluate(b => b.scrollTop = 0); await footerVisible();
    await body.evaluate(b => b.scrollTop = b.scrollHeight); await footerVisible();
    assert(await body.evaluate(b => Math.abs(b.scrollHeight - b.clientHeight - b.scrollTop) < 2));
    for (const name of actions) {
      const action = dialog.getByRole('button', { name, exact: true });
      await action.scrollIntoViewIfNeeded();
      assert(await action.evaluate(e => { const r = e.getBoundingClientRect(); const b = e.closest('.ops-workspace-dialog-body'); const bounds = b?.getBoundingClientRect(); return r.top >= (bounds?.top ?? 0) - 1 && r.bottom <= (bounds?.bottom ?? innerHeight) + 1; }), `Clipped action: ${name}`);
    }
    return { dialog, body, measure };
  }
  async function close(page, dialog) { await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' }); }
  const sizes = process.env.DIALOG_SKIP_MATRIX ? [] : [[1440,900],[1024,768],[768,768],[390,700],[360,700],[1280,720],[1440,700]];
  for (const [width, height] of sizes) {
    const { context, page } = await contextFor({ width, height }, width < 500);
    await page.goto(`${origin}/admin/competitions/${info.competitionId}?section=teams`);
    const trigger = page.getByRole('button', { name: '添加球队', exact: true });
    await trigger.click();
    await page.locator('dialog summary').filter({ hasText: '添加组织代表队' }).click();
    await page.locator('dialog summary').filter({ hasText: '创建联合队' }).click();
    await page.locator('dialog summary').filter({ hasText: '批量导入自由组队球队' }).click();
    const { dialog, body, measure } = await checkDialog(page, '添加球队', ['创建联合队', '批量创建代表队', '批量导入球队']);
    const submit = dialog.getByRole('button', { name: '创建联合队', exact: true });
    assert(await submit.evaluate(b => b.form?.id === b.getAttribute('form') && !!b.form?.querySelector('input[required]')));
    await body.evaluate(b => b.scrollTop = 0);
    assert(await submit.evaluate(b => { const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }));
    const bb = await body.boundingBox(); await page.mouse.move(bb.x + bb.width - 15, bb.y + 35); await page.mouse.wheel(0, 600);
    await page.waitForFunction(() => document.querySelector('dialog .ops-workspace-dialog-body').scrollTop > 0);
    await body.evaluate(b => { b.scrollTop = 0; b.focus(); }); await page.keyboard.press('PageDown');
    await page.waitForFunction(() => document.querySelector('dialog .ops-workspace-dialog-body').scrollTop > 0);
    await delay(300); await body.evaluate(b => { b.scrollTop = 0; b.focus(); }); await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => document.querySelector('dialog .ops-workspace-dialog-body').scrollTop > 0);
    // Native keyboard focus remains in the dialog in both directions and reveals the last checkbox.
    const lastCheckbox = dialog.locator('input[type=checkbox]').last();
    if (width === 390) {
      await dialog.getByRole('button',{name:'关闭',exact:true}).focus();
      let reached = false;
      for (let i = 0; i < 160; i++) { await page.keyboard.press('Tab'); if (await lastCheckbox.evaluate(e => e === document.activeElement)) { reached = true; break; } }
      assert(reached, 'Tab must reach the last input');
    } else await lastCheckbox.focus();
    assert(await lastCheckbox.evaluate(e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }));
    await page.keyboard.press('Tab'); assert(await dialog.evaluate(d => d.contains(document.activeElement)));
    await page.keyboard.press('Shift+Tab'); assert(await lastCheckbox.evaluate(e => e === document.activeElement));
    if (width < 500) {
      const cdp = await context.newCDPSession(page);
      await body.evaluate(b => b.scrollTop = 0);
      const x = Math.round(bb.x + 12), y = Math.round(bb.y + bb.height - 40);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{x,y}] });
      for(let i=1;i<=8;i++) { await cdp.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{x,y:y-i*25}] }); await delay(20); }
      await cdp.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
      await page.waitForFunction(() => document.querySelector('dialog .ops-workspace-dialog-body').scrollTop > 0);
      await cdp.detach();
    }
    if (width === 390) {
      await page.locator('dialog summary').filter({ hasText: '添加组织代表队' }).click();
      await page.locator('dialog summary').filter({ hasText: '批量导入自由组队球队' }).click();
      const form = dialog.locator('form');
      await form.locator('input[type=checkbox]').nth(0).check();
      await form.locator('input[type=checkbox]').nth(1).check();
      assert.equal(await form.evaluate(f => f.checkValidity()),false);
      assert.equal(await submit.isEnabled(),false);
      const name = `隔离弹窗联合队${Date.now()}`;
      await form.getByLabel('联合队名称').fill(name);
      assert(await submit.isEnabled());
      await page.screenshot({path:path.join(out,'joint-ready-390x700.png')});
      const responsePromise = page.waitForResponse(r => r.url().endsWith('/api/referees/admin/teams'));
      await submit.click();
      const response = await responsePromise;
      assert.equal(response.status(),201,await response.text());
      const payload = response.request().postDataJSON();
      assert.equal(payload.action,'joint'); assert.equal(payload.name,name); assert.equal(payload.unitIds.length,2);
      results.push({id:'DIALOG-FORM',requiredValidation:true,associatedSubmit:true,isolatedJointCreate:true});
    }
    await page.screenshot({ path: path.join(out, `joint-${width}x${height}.png`) });
    await close(page, dialog); assert(await trigger.evaluate(e => e === document.activeElement));
    const configTrigger = page.getByRole('button', { name: '阶段与轮次', exact: true }); await configTrigger.click();
    const config = await checkDialog(page, '阶段与轮次', ['建立阶段','建立','删除空阶段','删除维护轮次40']);
    assert(config.measure.scrollHeight > config.measure.bodyHeight);
    const structure = config.dialog.getByRole('combobox', { name: '结构', exact: true });
    await structure.selectOption('group'); await config.dialog.getByRole('button', { name: '建立', exact:true }).scrollIntoViewIfNeeded();
    await structure.selectOption('round'); await config.dialog.getByRole('button', { name: '建立', exact:true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, `structure-${width}x${height}.png`) });
    await close(page, config.dialog); assert(await configTrigger.evaluate(e => e === document.activeElement));
    results.push({ viewport: `${width}x${height}`, joint: measure, structure: config.measure, wheel: true, keyboardScroll: true, touch: width < 500 });
    await context.close();
    console.log(`PASS DIALOG-01/02/03 ${width}x${height}`);
  }
  const { context, page } = await contextFor({ width:390, height:700 }, true);
  await page.goto(`${origin}/admin/competitions/${info.competitionId}?section=teams`);
  // Open at an existing scroll position using keyboard; restore styles, position and focus.
  const trigger = page.getByRole('button', {name:'添加球队',exact:true}); await trigger.focus();
  await page.evaluate(() => { document.body.style.paddingRight='7px'; window.scrollTo(0, 100); });
  const before = await page.evaluate(() => ({y:scrollY, body:document.body.getAttribute('style'), html:document.documentElement.style.overflow}));
  await page.keyboard.press('Enter'); const dialog = page.getByRole('dialog',{name:'添加球队',exact:true}); await dialog.waitFor();
  assert.equal(await page.evaluate(() => document.body.style.position), 'fixed');
  const locked = await page.evaluate(() => scrollY); await page.mouse.move(2,2); await page.mouse.wheel(0,500); await delay(100);
  assert.equal(await page.evaluate(() => scrollY), locked);
  await close(page, dialog);
  assert.deepEqual(await page.evaluate(() => ({y:scrollY,body:document.body.getAttribute('style'),html:document.documentElement.style.overflow})),before);
  assert(await trigger.evaluate(e => e === document.activeElement));
  await page.mouse.move(200,600); await page.mouse.wheel(0,400); await page.waitForFunction(y => scrollY !== y, before.y);
  results.push({id:'DIALOG-04',restore:true,backgroundWheel:true,focus:true});
  // Every other current shared entry: small forms, large confirmation lists and nested import repair.
  await page.getByRole('button',{name:'新建小组',exact:true}).click();
  let checked = await checkDialog(page,'新建小组',['保存小组']); await close(page,checked.dialog);
  await page.getByRole('button',{name:'修改A组',exact:true}).click();
  checked = await checkDialog(page,'修改小组',['保存小组']); await close(page,checked.dialog);
  await page.getByRole('button',{name:/全选本页/}).click();
  const inspectionResponse = page.waitForResponse(r => r.url().endsWith('/teams/remove'));
  await page.getByRole('button',{name:'移除所选球队',exact:true}).click();
  const inspection = await inspectionResponse; assert.equal(inspection.status(),200,await inspection.text());
  checked = await checkDialog(page,'从本赛事移除');
  await checked.dialog.getByRole('button',{name:/确认移除/}).scrollIntoViewIfNeeded(); await close(page,checked.dialog);
  const firstRow = page.locator('.ops-team-row').filter({hasText:'SQA项目队'});
  await firstRow.locator('summary').click(); await firstRow.getByRole('button',{name:'移出本小组',exact:true}).click();
  checked = await checkDialog(page,'确认更换分组',['确认更改']); await close(page,checked.dialog);
  await page.goto(`${origin}/admin/competitions/${info.competitionId}?section=standings`);
  await page.getByRole('button',{name:'调整同分次序',exact:true}).first().click();
  checked = await checkDialog(page,'调整同分次序',['确认同分次序','恢复自动显示顺序']); await close(page,checked.dialog);
  await page.getByRole('button',{name:'确认出线球队',exact:true}).first().click();
  checked = await checkDialog(page,'确认出线球队',['确认勾选球队出线（按当前顺序）']); await close(page,checked.dialog);
  await page.goto(`${origin}/admin/competitions/import?competitionId=${info.competitionId}&kind=matches`);
  await page.getByRole('radio',{name:'批量粘贴',exact:true}).click();
  await page.locator('textarea').fill('主队\t客队\t阶段\t分组\t轮次\t开球时间\t场地\nSQA项目队\t机电学院\t小组赛\tA组\t第1轮\t2026-10-12 15:30\t隔离球场');
  const previewResponse = page.waitForResponse(r => r.url().endsWith('/import/preview'));
  await page.getByRole('button',{name:'检查导入内容',exact:true}).click();
  const preview = await previewResponse; const previewData = await preview.json(); assert.equal(preview.status(),200,JSON.stringify(previewData)); assert.equal(previewData.preview.summary.errorRows,0,JSON.stringify(previewData));
  await page.getByRole('button',{name:'确认导入',exact:true}).click();
  checked = await checkDialog(page,'确认导入所选赛程',['确认提交 1 场']); await close(page,checked.dialog);
  // Recheck with a team/group mismatch to expose the real repair entry, with no commit.
  await page.locator('textarea').fill('主队\t客队\t阶段\t分组\t轮次\t开球时间\t场地\n仅移出小组\t机电学院\t小组赛\tA组\t第1轮\t2026-10-12 15:30\t隔离球场');
  await page.getByRole('button',{name:'检查导入内容',exact:true}).click();
  await page.getByRole('button',{name:'管理球队分组',exact:true}).first().click();
  checked = await checkDialog(page,'管理球队分组',['返回并重新检查']);
  await checked.dialog.getByRole('button',{name:'新建小组',exact:true}).click();
  const child = await checkDialog(page,'新建小组',['保存小组']); await close(page,child.dialog);
  assert(await checked.dialog.isVisible());
  assert.equal(await page.evaluate(() => document.body.style.position),'fixed');
  assert(await checked.dialog.getByRole('button',{name:'新建小组',exact:true}).evaluate(e => e === document.activeElement));
  await close(page,checked.dialog); assert.notEqual(await page.evaluate(() => document.body.style.position),'fixed');
  results.push({id:'DIALOG-05',entries:['添加球队/组织/联合队/自由组队','阶段与轮次','新建小组','修改小组','从本赛事移除','确认更换分组','调整同分次序','确认出线球队','确认导入所选赛程','管理球队分组'],nestedLock:true});
  await context.close();
  assert.deepEqual(errors,[]);
  complete = true;
  console.log('PASS DIALOG-04/05: scroll/focus restore, shared entries, nested locks; no production writes');
} finally {
  await browser?.close(); server.kill('SIGTERM');
  await writeFile(path.join(out,'results.json'),JSON.stringify({status:complete?'PASS':'FAIL',startedAt,finishedAt:new Date().toISOString(),browserVersion,results,errors},null,2));
  await writeFile(path.join(out,'server.log'),serverLog);
}
