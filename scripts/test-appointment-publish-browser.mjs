import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';

// Requires npm run build. Fixtures and sessions are synthetic and disposable.
const root = await mkdtemp(path.join(os.tmpdir(), 'nuaafa-appointment-publish-'));
const evidence = path.resolve(process.env.APPOINTMENT_PUBLISH_EVIDENCE ?? path.join(root, 'evidence'));
await mkdir(evidence, { recursive: true });
const database = path.join(root, 'synthetic.db'), uploads = path.join(root, 'uploads');
await mkdir(uploads);
Object.assign(process.env, { DATABASE_URL: 'file:' + database, NUAAFA_UPLOAD_DIR: uploads, NODE_ENV: 'test' });
const raw = createClient({ url: process.env.DATABASE_URL });
for (const entry of (await readdir('prisma/migrations', { withFileTypes: true })).filter(e => e.isDirectory()).sort((a,b) => a.name.localeCompare(b.name))) {
  await raw.executeMultiple(await readFile(path.join('prisma/migrations', entry.name, 'migration.sql'), 'utf8'));
}
raw.close();
const { prisma } = await import('../src/lib/prisma.ts');
const { hashPassword } = await import('../src/lib/referee-security.ts');
const password = 'Synthetic-Publish-Only-2026!';
await prisma.adminAccount.create({ data: { username: 'publish-admin', displayName: '隔离验证管理员', role: 'SUPER_ADMIN', passwordHash: await hashPassword(password), mustChangePassword: false } });
const roles = [ ['REFEREE','裁判员'], ['ASSISTANT_REFEREE_1','第一助理裁判员'], ['ASSISTANT_REFEREE_2','第二助理裁判员'], ['FOURTH_OFFICIAL','第四官员'] ];
const referees = await Promise.all(['示例甲','示例乙','示例丙','示例丁'].map((name,index) => prisma.referee.create({ data: { publicCode: 'PUBLISH-' + index, name, status: 'ACTIVE', assignmentEligibility: 'ELIGIBLE', trainingStatus: 'QUALIFIED', capabilities: { create: roles.map(([positionKey]) => ({ format: 'ELEVEN_A_SIDE', positionKey, status: 'READY' })) } } })));
const competition = await prisma.competition.create({ data: { slug: 'publish-preview', name: '选派发布隔离验证赛', campus: '测试', format: 'ELEVEN_A_SIDE', status: 'ONGOING' } });
const teams = await Promise.all(['示例甲队','示例乙队'].map(name => prisma.team.create({ data: { competitionId: competition.id, name } })));
async function fixture(label, index, withDraft = true) {
  const match = await prisma.match.create({ data: { slug: label, competitionId: competition.id, stage: label, homeTeamId: teams[0].id, awayTeamId: teams[1].id, kickoff: new Date(Date.UTC(2035,0,index,8)), venue: '示例球场', status: 'SCHEDULED', applicationWindowStatus: 'CLOSED', positionRequirements: { create: roles.map(([key,label],sortOrder) => ({ key,label,sortOrder,count:1 })) } } });
  if (withDraft) await prisma.refereeAppointment.create({ data: { matchId: match.id, status: 'DRAFT', publicationNote: '旧备注', positions: { create: roles.map(([key,label],sortOrder) => ({ key,label,sortOrder,slot:1,refereeId: sortOrder ? null : referees[0].id })) } } });
  return match;
}
const stale = await fixture('old-draft-current-four',1), fresh = await fixture('first-publication',2,false), blocked = await fixture('blocked-publication',3), manual = await fixture('manual-save',4);
await prisma.refereeAvailability.create({ data: { refereeId: referees[2].id, kind: 'UNAVAILABLE', startAt: new Date(Date.UTC(2035,0,3,7)), endAt: new Date(Date.UTC(2035,0,3,10)) } });
const listener = net.createServer(); listener.listen(0,'127.0.0.1'); await once(listener,'listening'); const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
const origin = 'http://127.0.0.1:' + port;
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)], { env: { PATH: process.env.PATH, HOME: os.homedir(), TMPDIR: os.tmpdir(), NODE_ENV:'production', TZ:'UTC', NEXT_TELEMETRY_DISABLED:'1', DATABASE_URL:'file:' + database, NUAAFA_UPLOAD_DIR:uploads, NUAAFA_CONTENT_SOURCE:'database', REFEREE_ADMIN_SESSION_SECRET:'Synthetic-Publish-Admin-Secret-2026', REFEREE_MEMBER_SESSION_SECRET:'Synthetic-Publish-Member-Secret-2026' }, stdio:['ignore','pipe','pipe'] });
let serverLog = '', browser, page;
server.stdout.on('data',c => serverLog += c); server.stderr.on('data',c => serverLog += c);
const checks = [], errors = [], requests = [];
const endpoint = match => '/api/referees/admin/appointments/' + match.id;
async function stored(match) { return prisma.refereeAppointment.findUnique({ where:{matchId:match.id},include:{positions:{orderBy:{sortOrder:'asc'}},versions:true} }); }
try {
  let ready = false;
  for (let i=0;i<100;i++) { try { if ((await fetch(origin + '/api/health')).ok) { ready = true; break; } } catch {} await new Promise(r=>setTimeout(r,100)); }
  assert(ready && server.exitCode === null, serverLog);
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
  browser = await chromium.launch({ channel:process.env.APPOINTMENT_BROWSER_CHANNEL ?? 'chrome',headless:true });
  const context = await browser.newContext({ viewport:{width:1440,height:1000} });
  const login = await context.request.post(origin + '/api/referees/admin/login',{headers:{origin:'https://nuaafa.cn'},data:{username:'publish-admin',password}});
  assert.equal(login.status(),200,await login.text());
  await context.route(origin + '/api/**',async route=>{
    const request = route.request();
    if (request.url().includes('/appointments/')) requests.push({url:request.url(),method:request.method(),body:request.postDataJSON()});
    const response = await route.fetch({headers:{...await request.allHeaders(),origin:'https://nuaafa.cn'}});
    await route.fulfill({response});
  });
  page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror',e=>errors.push(e.message));
  async function open(match) { await page.goto(origin + '/admin/appointments/' + match.id,{waitUntil:'networkidle'}); }
  async function assignAll() {
    for (let i=0;i<roles.length;i++) {
      const toggle = page.getByLabel('启用' + roles[i][1],{exact:true});
      if (!await toggle.isChecked()) await toggle.check();
      await page.getByLabel(roles[i][1] + '裁判员',{exact:true}).selectOption(referees[i].id);
    }
  }
  async function publish(match, twice=false) {
    const response = page.waitForResponse(r=>r.url().endsWith(endpoint(match)) && r.request().method()==='POST');
    const button = page.getByRole('button',{name:'发布选派',exact:true});
    if (twice) await button.evaluate(node=>{node.click();node.click();}); else await button.click();
    const result = await response; assert.equal(result.status(),200,await result.text());
    await page.getByRole('button',{name:'撤回并修改',exact:true}).waitFor();
  }
  await open(stale); await assignAll();
  await page.locator('.admin-more-options').evaluate(node=>node.open=true);
  await page.getByLabel('公示备注',{exact:true}).fill('当前页面的四人选派备注');
  await page.screenshot({path:path.join(evidence,'four-assigned-before-publish.png'),fullPage:true});
  assert.match(await page.locator('.admin-assignment-summary').innerText(), /4\s*\/\s*4/);
  await publish(stale,true);
  const published = await stored(stale);
  assert.equal(published.status,'PUBLISHED'); assert.equal(published.positions.length,4); assert.equal(published.publicationNote,'当前页面的四人选派备注');
  assert.deepEqual(published.positions.map(p=>p.refereeId),referees.map(r=>r.id)); assert.equal(published.versions.length,1);
  const sent = requests.filter(r=>r.url.endsWith(endpoint(stale)));
  assert.equal(sent.length,1); assert.equal(sent[0].method,'POST'); assert.equal(sent[0].body.positions.length,4);
  assert((await page.locator('.admin-warning-panel').innerText()).includes('TIME_UNCERTAIN'));
  await page.screenshot({path:path.join(evidence,'published-four-with-advisory.png'),fullPage:true});
  checks.push('four current selections replace stale incomplete draft, one atomic POST, duplicate clicks ignored, note and snapshot preserved, end-time advisory allows publishing');

  await open(fresh); await assignAll(); await page.getByLabel('第二助理裁判员裁判员',{exact:true}).selectOption('');
  const countBefore = requests.length; await page.getByRole('button',{name:'发布选派',exact:true}).click();
  await page.getByText('发布前请分配：第二助理裁判员。',{exact:true}).waitFor(); assert.equal(requests.length,countBefore); assert.equal(await stored(fresh),null);
  await page.getByLabel('第二助理裁判员裁判员',{exact:true}).selectOption(referees[2].id); await publish(fresh);
  assert.equal((await stored(fresh)).status,'PUBLISHED'); checks.push('missing role named before request; first publication works without saved draft');

  await open(blocked); const before = JSON.stringify(await stored(blocked)); await assignAll();
  const failedResponse = page.waitForResponse(r=>r.url().endsWith(endpoint(blocked))&&r.request().method()==='POST');
  await page.getByRole('button',{name:'发布选派',exact:true}).click(); assert.equal((await failedResponse).status(),409);
  await page.getByText('存在不可覆盖的选派冲突，草稿未保存。',{exact:true}).waitFor();
  assert.equal(JSON.stringify(await stored(blocked)),before); assert.equal(await page.getByLabel('第二助理裁判员裁判员',{exact:true}).inputValue(),referees[2].id);
  checks.push('hard unavailability still blocks and preserves saved draft plus current unsaved editor selections');

  await open(manual); await assignAll();
  const saveResponse = page.waitForResponse(r=>r.url().endsWith(endpoint(manual))&&r.request().method()==='PUT');
  await page.getByRole('button',{name:'保存草稿',exact:true}).click(); assert.equal((await saveResponse).status(),200);
  await page.getByText('选派草稿已保存。',{exact:true}).waitFor();
  assert.equal((await stored(manual)).status,'DRAFT'); assert.equal((await stored(manual)).versions.length,0);
  checks.push('manual draft save remains available');

  const beforeMalformed = JSON.stringify(await stored(manual));
  const malformedStatus = await page.evaluate(async url => (await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'publish',positions:null})})).status, endpoint(manual));
  assert.equal(malformedStatus,400); assert.equal(JSON.stringify(await stored(manual)),beforeMalformed);
  const anonymous = await browser.newContext();
  const unauthorized = await anonymous.request.post(origin + endpoint(manual),{headers:{origin:'https://nuaafa.cn'},data:{action:'publish',positions:[]}});
  assert([401,403].includes(unauthorized.status())); await anonymous.close();
  checks.push('malformed assignment payload rejected and anonymous publication denied');
  await page.setViewportSize({width:390,height:844}); await page.reload({waitUntil:'networkidle'});
  assert.equal(await page.getByLabel('第四官员裁判员',{exact:true}).inputValue(),referees[3].id);
  await page.screenshot({path:path.join(evidence,'four-assigned-mobile.png'),fullPage:true});
  checks.push('mobile editor preserves four saved assignments');
  assert.deepEqual(errors,[]);
  await writeFile(path.join(evidence,'result.json'),JSON.stringify({ok:true,checks,browserErrors:errors},null,2));
  console.log(JSON.stringify({ok:true,checks,evidence},null,2));
} catch(error) {
  if (page) await page.screenshot({path:path.join(evidence,'failure.png'),fullPage:true}).catch(()=>{});
  await writeFile(path.join(evidence,'server.log'),serverLog); throw error;
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM'); await once(server,'exit').catch(()=>{}); await prisma.$disconnect();
  // Keep default evidence, but remove the disposable DB and uploads.
  if (!evidence.startsWith(root + path.sep)) await rm(root,{recursive:true,force:true});
  else { await rm(database,{force:true}); await rm(uploads,{recursive:true,force:true}); }
}
