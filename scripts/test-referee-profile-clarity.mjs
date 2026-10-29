import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';

const root = await mkdtemp(path.join(os.tmpdir(), 'nuaafa-referee-profile-'));
const evidence = path.resolve(process.env.REFEREE_PROFILE_EVIDENCE ?? path.join(root, 'evidence'));
await mkdir(evidence, { recursive: true });
const database = path.join(root, 'synthetic.db'), uploads = path.join(root, 'uploads'); await mkdir(uploads);
Object.assign(process.env, { DATABASE_URL: 'file:' + database, NUAAFA_UPLOAD_DIR: uploads, NODE_ENV: 'test' });
const raw = createClient({ url: process.env.DATABASE_URL });
for (const entry of (await readdir('prisma/migrations', { withFileTypes: true })).filter(e => e.isDirectory()).sort((a,b) => a.name.localeCompare(b.name))) await raw.executeMultiple(await readFile(path.join('prisma/migrations', entry.name, 'migration.sql'), 'utf8'));
raw.close();
const { prisma } = await import('../src/lib/prisma.ts');
const { hashPassword } = await import('../src/lib/referee-security.ts');
const { getPublicRefereeQualification } = await import('../src/lib/referee-qualifications.ts');
const { getRefereeRegistrationSummary } = await import('../src/lib/referee-profile-summary.ts');
const password = 'Synthetic-Profile-Only-2026!';
await prisma.adminAccount.create({ data: { username: 'profile-admin', displayName: '隔离预览管理员', role: 'SUPER_ADMIN', passwordHash: await hashPassword(password), mustChangePassword: false } });
const original = { publicCode: 'PROFILE-01', name: '张澈', studentId: '162688881', grade: '大一', phone: '13800000000', qq: '987654321', certificateNote: 'PRIVATE-CERT-NUMBER', qualificationNote: 'PRIVATE-QUALIFICATION-NOTE', internalNote: 'PRIVATE-INTERNAL-NOTE', publicBio: '隔离测试公开简介', refereeLevel: '国家二级', joinedAt: new Date('2026-09-01T00:00:00.000+08:00'), status: 'ACTIVE', assignmentEligibility: 'ELIGIBLE', trainingStatus: 'IN_TRAINING', mustChangePassword: false, publicDirectoryEnabled: false };
const referee = await prisma.referee.create({ data: { ...original, capabilities: { create: [
  { format: 'ELEVEN_A_SIDE', positionKey: 'REFEREE', status: 'TRAINING' },
  { format: 'ELEVEN_A_SIDE', positionKey: 'ASSISTANT_REFEREE_1', status: 'READY' },
  { format: 'ELEVEN_A_SIDE', positionKey: 'ASSISTANT_REFEREE_2', status: 'TRAINING' },
  { format: 'ELEVEN_A_SIDE', positionKey: 'FOURTH_OFFICIAL', status: 'TRAINING' },
  { format: 'FUTSAL', positionKey: 'REFEREE', status: 'TRAINING' },
] } } });
const uncertified = await prisma.referee.create({ data: { publicCode: 'PROFILE-02', name: '林宁', refereeLevel: '暂无正式裁判资质', trainingStatus: 'QUALIFIED' } });
const invalid = await prisma.referee.create({ data: { publicCode: 'PROFILE-03', name: '陈禾', refereeLevel: 'PRIVATE-INVALID-LEVEL' } });
const competition = await prisma.competition.create({ data: { slug: 'profile-preview', name: '裁判档案隔离预览赛', campus: '隔离测试校区', format: 'ELEVEN_A_SIDE', status: 'ONGOING', publicPublished: true } });
const teams = await Promise.all(['示例甲队','示例乙队'].map(name => prisma.team.create({ data: { competitionId: competition.id, name } })));
const match = await prisma.match.create({ data: { slug: 'profile-preview-match', competitionId: competition.id, stage: '小组赛', homeTeamId: teams[0].id, awayTeamId: teams[1].id, kickoff: new Date(Date.now() + 172800000), venue: '示例球场', status: 'SCHEDULED', applicationWindowStatus: 'OPEN', applicationDeadline: new Date(Date.now() + 86400000) } });
const appointment = await prisma.refereeAppointment.create({ data: { matchId: match.id, status: 'PUBLISHED', publishedAt: new Date(), positions: { create: [
  { key: 'REFEREE', label: '裁判员', sortOrder: 1, refereeId: referee.id },
  { key: 'ASSISTANT_REFEREE_1', label: '第一助理裁判员', sortOrder: 2, refereeId: uncertified.id },
  { key: 'ASSISTANT_REFEREE_2', label: '第二助理裁判员', sortOrder: 3, refereeId: invalid.id },
] } } });
const listener = net.createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening'); const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
const origin = 'http://127.0.0.1:' + port;
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], { env: { PATH: process.env.PATH, HOME: os.homedir(), TMPDIR: os.tmpdir(), NODE_ENV: 'production', TZ: 'UTC', NEXT_TELEMETRY_DISABLED: '1', DATABASE_URL: 'file:' + database, NUAAFA_UPLOAD_DIR: uploads, NUAAFA_CONTENT_SOURCE: 'database', REFEREE_ADMIN_SESSION_SECRET: 'Synthetic-Profile-Admin-Secret-2026', REFEREE_MEMBER_SESSION_SECRET: 'Synthetic-Profile-Member-Secret-2026' }, stdio: ['ignore','pipe','pipe'] });
let serverLog = '', browser, page; server.stdout.on('data',c => serverLog += c); server.stderr.on('data',c => serverLog += c);
const checks = [], errors = [];
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(origin + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  assert.equal(server.exitCode, null, serverLog);
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
  browser = await chromium.launch({ channel: process.env.REFEREE_PROFILE_BROWSER_CHANNEL ?? 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const login = await context.request.post(origin + '/api/referees/admin/login', { headers: { origin: 'https://nuaafa.cn' }, data: { username: 'profile-admin', password } }); assert.equal(login.status(), 200, await login.text());
  await context.route(origin + '/api/**', async route => { const response = await route.fetch({ headers: { ...await route.request().allHeaders(), origin: 'https://nuaafa.cn' } }); await route.fulfill({ response }); });
  page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/admin/referees/' + referee.id, { waitUntil: 'networkidle' });
  assert.deepEqual(await page.getByRole('tab').allTextContents(), ['基本资料','报名与岗位','资质与培养','公开与账号']);
  assert.equal(await page.locator('.admin-profile-secondary[open]').count(), 0);
  await page.getByRole('tab', { name: '基本资料', exact: true }).focus(); await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('tab', { name: '报名与岗位' }).getAttribute('aria-selected'), 'true');
  assert(await page.getByText('报名基础条件已满足', { exact: true }).isVisible());
  await page.getByLabel('报名与选派资格', { exact: true }).selectOption('SUSPENDED'); assert(await page.getByText('报名与选派已暂停', { exact: true }).isVisible());
  await page.getByRole('button', { name: '取消修改', exact: true }).click(); assert.equal(await page.getByLabel('报名与选派资格', { exact: true }).inputValue(), 'ELIGIBLE');
  checks.push('four focused tabs, keyboard navigation, live eligibility preview and cancel');
  await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(evidence, 'admin-registration-desktop.png'), fullPage: true });

  await page.getByRole('tab', { name: '资质与培养', exact: true }).click();
  await page.getByLabel('协会培训状态（仅作记录）', { exact: true }).selectOption('QUALIFIED');
  await page.getByLabel('持证裁判等级', { exact: true }).selectOption('国家三级');
  assert((await page.locator('.admin-qualification-preview').innerText()).includes('（国家三级）'));
  await page.getByRole('tab', { name: '报名与岗位', exact: true }).click();
  assert.equal(await page.locator('select[name=capability]').first().inputValue(), 'ELEVEN_A_SIDE:REFEREE:TRAINING');
  await page.getByRole('button', { name: '取消修改', exact: true }).click();
  await page.getByRole('tab', { name: '资质与培养', exact: true }).click();
  assert.equal(await page.getByLabel('持证裁判等级', { exact: true }).inputValue(), '国家二级');
  assert.equal(await page.getByLabel('协会培训状态（仅作记录）', { exact: true }).inputValue(), 'IN_TRAINING');
  await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(evidence, 'admin-qualification-desktop.png'), fullPage: true });
  await page.locator('.admin-panel').filter({ has: page.getByRole('tablist') }).screenshot({ path: path.join(evidence, 'admin-qualification-panel.png') });
  checks.push('training record, certificate level and position capabilities remain independent');

  await page.getByRole('tab', { name: '公开与账号', exact: true }).click();
  await page.getByLabel('公开简介', { exact: true }).fill('跨分区保存后的公开简介');
  await page.getByLabel('账号状态', { exact: true }).selectOption('INACTIVE');
  await page.getByRole('tab', { name: '报名与岗位', exact: true }).click(); assert(await page.getByText('账号未启用，暂不能报名或选派', { exact: true }).isVisible());
  await page.getByRole('tab', { name: '公开与账号', exact: true }).click(); await page.getByLabel('账号状态', { exact: true }).selectOption('ACTIVE');
  await page.getByRole('tab', { name: '资质与培养', exact: true }).click(); await page.getByLabel('协会培训状态（仅作记录）', { exact: true }).selectOption('QUALIFIED');
  const savedResponse = page.waitForResponse(r => r.url().endsWith('/api/referees/admin/accounts/' + referee.id) && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: '保存修改', exact: true }).click(); assert.equal((await savedResponse).status(), 200); await page.getByText('裁判员档案已保存。', { exact: true }).waitFor();
  const saved = await prisma.referee.findUniqueOrThrow({ where: { id: referee.id }, include: { capabilities: true } });
  for (const key of ['name','studentId','grade','phone','qq','certificateNote','qualificationNote','internalNote','refereeLevel','status','assignmentEligibility','publicDirectoryEnabled']) assert.equal(saved[key], original[key], key);
  assert.equal(saved.joinedAt.toISOString(), original.joinedAt.toISOString()); assert.equal(saved.publicBio, '跨分区保存后的公开简介'); assert.equal(saved.trainingStatus, 'QUALIFIED');
  assert.equal(saved.capabilities.find(c => c.format === 'ELEVEN_A_SIDE' && c.positionKey === 'REFEREE').status, 'TRAINING');
  checks.push('real save from another tab preserves collapsed private fields, account, certificate and capabilities');

  await page.getByRole('tab', { name: '报名与岗位', exact: true }).click(); await page.getByLabel('报名与选派资格', { exact: true }).selectOption('SUSPENDED');
  await page.getByRole('button', { name: '保存修改', exact: true }).click(); await page.getByText('暂停或恢复正式选派资格时必须填写原因。', { exact: true }).waitFor();
  assert.equal((await prisma.referee.findUniqueOrThrow({ where: { id: referee.id } })).assignmentEligibility, 'ELIGIBLE');
  await page.getByRole('button', { name: '取消修改', exact: true }).click(); checks.push('failed save visibly explains the required reason and leaves stored eligibility intact');

  for (const width of [390,768,1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const label of ['基本资料','报名与岗位','资质与培养','公开与账号']) {
      await page.getByRole('tab', { name: label, exact: true }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${label} overflow ${width}`);
    }
    await page.getByRole('tab', { name: '报名与岗位', exact: true }).click();
    if (width === 390) { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(evidence, 'admin-registration-mobile.png'), fullPage: true }); }
  }
  checks.push('all four sections fit phone, tablet and desktop widths');

  const feed = await (await fetch(origin + '/api/referees/public-list?kind=assignments')).json();
  assert.equal(feed.items[0].positions[0].refereeLevel, '国家二级'); assert.equal(feed.items[0].positions[1].refereeLevel, null); assert.equal(feed.items[0].positions[2].refereeLevel, null);
  const publicPaths = ['/referees/assignments', '/referees/assignments/' + appointment.id + '/print', '/competitions/profile-preview'];
  for (const url of publicPaths) {
    const response = await fetch(origin + url); assert.equal(response.status, 200, url); const html = await response.text();
    for (const secret of ['PRIVATE-CERT-NUMBER','PRIVATE-QUALIFICATION-NOTE','PRIVATE-INTERNAL-NOTE','PRIVATE-INVALID-LEVEL','13800000000','987654321','162688881']) assert(!html.includes(secret), url + ' leaked ' + secret);
  }
  for (const secret of ['PRIVATE-CERT-NUMBER','PRIVATE-QUALIFICATION-NOTE','PRIVATE-INTERNAL-NOTE','PRIVATE-INVALID-LEVEL','13800000000','987654321','162688881']) assert(!JSON.stringify(feed).includes(secret));
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(origin + '/referees/assignments', { waitUntil: 'networkidle' });
  assert(await page.getByText('（国家二级）', { exact: true }).first().isVisible()); await page.getByText('岗位与公告详情', { exact: true }).click();
  assert((await page.locator('dl[aria-label="裁判组岗位"]').innerText()).includes('国家二级')); assert(!(await page.locator('dl[aria-label="裁判组岗位"]').innerText()).includes('暂无正式裁判资质'));
  await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(evidence, 'public-assignments-desktop.png'), fullPage: true });
  await page.locator('article[data-match-id]').screenshot({ path: path.join(evidence, 'public-assignments-card.png') });
  await page.goto(origin + '/referees/assignments/' + appointment.id + '/print', { waitUntil: 'networkidle' }); assert((await page.locator('tbody').innerText()).includes('（国家二级）'));
  await page.emulateMedia({ media: 'print' }); assert(await page.getByText('（国家二级）', { exact: true }).isVisible()); await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(evidence, 'public-appointment-print.png'), fullPage: true });
  await page.goto(origin + '/competitions/profile-preview', { waitUntil: 'networkidle' }); assert(await page.getByRole('region', { name: '本赛事裁判选派' }).count() || await page.locator('dl').filter({ hasText: '国家二级' }).count());
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(origin + '/referees/assignments', { waitUntil: 'networkidle' }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(evidence, 'public-assignments-mobile.png'), fullPage: true });
  checks.push('public list, competition appointments and print show registered levels; uncertified and invalid levels stay absent; private fields never cross public boundaries');
  assert.equal(getPublicRefereeQualification('考察通过'), null); assert.equal(getPublicRefereeQualification('暂无正式裁判资质'), null);
  for (const level of ['国家三级','国家二级','国家一级','预备国家级','国家级','国际级']) assert.equal(getPublicRefereeQualification(level), level);
  const base = { status: 'ACTIVE', assignmentEligibility: 'ELIGIBLE', mustChangePassword: false, capabilities: [{ format: 'ELEVEN_A_SIDE', status: 'TRAINING' }] };
  assert(getRefereeRegistrationSummary(base).canApply); assert(!getRefereeRegistrationSummary({ ...base, mustChangePassword: true }).canApply); assert(!getRefereeRegistrationSummary({ ...base, capabilities: [] }).canApply);
  assert.deepEqual(errors, []);
  await writeFile(path.join(evidence, 'results.json'), JSON.stringify({ status: 'PASS', syntheticDatabaseOnly: true, origin, checks }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', checks, evidence }, null, 2));
} finally {
  if (page && !page.isClosed()) await writeFile(path.join(evidence, 'last-page.txt'), await page.locator('body').innerText());
  if (browser) await browser.close();
  const stopped = once(server, 'exit'); server.kill('SIGTERM'); await stopped; await prisma.$disconnect();
  await writeFile(path.join(evidence, 'server.log'), serverLog);
  if (!evidence.startsWith(root + path.sep)) await rm(root, { recursive: true, force: true });
}
