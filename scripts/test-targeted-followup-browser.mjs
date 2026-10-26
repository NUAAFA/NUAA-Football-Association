import assert from 'node:assert/strict';
import { createHmac,randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir,mkdtemp,readdir,readFile,realpath,writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { expectedStaticHistory } from './static-history-expectations.ts';
import { staticContentPublishedAt,isPublishedStaticContent } from '../src/lib/content-publication.ts';
import { officialWomensCupNews } from '../src/data/womens-intercollege-cup-2026.ts';

const before=process.argv.includes('--before');
let publicationDate=staticContentPublishedAt,publicationEligible=isPublishedStaticContent;
if(before){const ts=createRequire(import.meta.url)('typescript');const source=execFileSync('git',['show','3d216472f3b9ba7401d1881edc4292e563880b2d:src/lib/content-publication.ts'],{encoding:'utf8'});const scope={exports:{}};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,scope);publicationDate=scope.exports.staticContentPublishedAt;publicationEligible=scope.exports.isPublishedStaticContent;}
const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'nuaafa-targeted-')));
const evidence=path.resolve(process.env.TARGETED_EVIDENCE_DIR??path.join(root,'evidence'));await mkdir(evidence,{recursive:true});
const db=path.join(root,'synthetic.db');const uploads=path.join(root,'uploads');await mkdir(uploads);
Object.assign(process.env,{DATABASE_URL:`file:${db}`,NUAAFA_UPLOAD_DIR:uploads,NODE_ENV:'test'});
const raw=createClient({url:process.env.DATABASE_URL});
for(const entry of(await readdir('prisma/migrations',{withFileTypes:true})).filter(e=>e.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name)))await raw.executeMultiple(await readFile(path.join('prisma/migrations',entry.name,'migration.sql'),'utf8'));
raw.close();assert.equal(await realpath(db),db);
const {prisma}=await import('../src/lib/prisma.ts');
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
const origin=`http://127.0.0.1:${port}`;
const memberSecret='Synthetic-Targeted-Member-Secret-Only-2026';const adminSecret='Synthetic-Targeted-Admin-Secret-Only-2026';
const hash=(token,secret)=>createHmac('sha256',secret).update(token).digest('hex');
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{env:{PATH:process.env.PATH,HOME:os.homedir(),TMPDIR:os.tmpdir(),NODE_ENV:'production',TZ:'UTC',NEXT_TELEMETRY_DISABLED:'1',DATABASE_URL:`file:${db}`,NUAAFA_UPLOAD_DIR:uploads,NUAAFA_CONTENT_SOURCE:'static',REFEREE_MEMBER_SESSION_SECRET:memberSecret,REFEREE_ADMIN_SESSION_SECRET:adminSecret},stdio:['ignore','pipe','pipe']});
let serverLog='',browser;server.stdout.on('data',c=>serverLog+=c);server.stderr.on('data',c=>serverLog+=c);
const result={mode:before?'before':'after',startedAt:new Date().toISOString(),checks:[],syntheticDatabase:true};
try{
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert(ready,serverLog);
 const women=officialWomensCupNews.find(item=>item.id==='2026-womens-intercollege-cup-closing');assert(women);assert.equal(women.dateLabel,'2026-06-22 16:53');
 const parsed=publicationDate(women)?.toISOString()??null;
 const text=async p=>{const response=await fetch(origin+p);return{status:response.status,body:await response.text()};};
 const pages={news:await text('/news'),sitemap:await text('/sitemap.xml'),rss:await text('/rss.xml'),women:await text(women.href)};
 const newsPaths=[...new Set([...pages.news.body.matchAll(/<a\b[^>]*\bhref="([^\"]+)"/g)].map(m=>m[1].split(/[?#]/)[0]).filter(v=>v.startsWith('/news/')))];
 const feedPaths=body=>[...new Set([...body.matchAll(/https:\/\/nuaafa\.cn(\/news\/[^<"\s]+)/g)].map(m=>m[1]))];
 const expected=expectedStaticHistory.map(([id])=>'/news/'+id).sort();
 if(before){
  assert.equal(parsed,null);assert.equal(publicationEligible(women),false);assert.equal(pages.women.status,404);
  for(const set of [newsPaths,feedPaths(pages.sitemap.body),feedPaths(pages.rss.body)])assert.deepEqual(set.sort(),expected.filter(v=>v!==women.href));
 }else{
  assert.equal(parsed,'2026-06-22T08:53:00.000Z');assert(publicationEligible(women));
  for(const set of [newsPaths,feedPaths(pages.sitemap.body),feedPaths(pages.rss.body)])assert.deepEqual(set.sort(),expected);
  for(const [id,at]of expectedStaticHistory){const article=await text('/news/'+id);assert.equal(article.status,200,id);assert(article.body.includes(`property="article:published_time" content="${at}"`),id+' publication metadata');assert(article.body.includes('https://nuaafa.cn/news/'+id),id+' canonical');assert(!article.body.includes('Invalid Date'));}
  assert(pages.women.body.includes('2026-06-22T08:53:00.000Z'));assert(!/<meta name="robots" content="noindex/.test(pages.women.body));
 }
 console.log('R1 HTTP complete');result.checks.push({name:'R1 static complete historical set and real article HTTP/metadata',status:'PASS',expected:expected.length,actual:newsPaths.length,womenParsed:parsed,womenHttp:pages.women.status,mode:before?'defect reproduced':'fixed'});

 const competition=await prisma.competition.create({data:{slug:'r2-synthetic',name:'虚构R2赛事',campus:'虚构校区',format:'FUTSAL',status:'ONGOING'}});
 const teams=await Promise.all(['虚构R2甲','虚构R2乙'].map(name=>prisma.team.create({data:{competitionId:competition.id,name}})));
 const referee=await prisma.referee.create({data:{publicCode:'R2-SYNTHETIC',name:'虚构持续挂载裁判',studentId:'R2-SYNTHETIC-ID',status:'ACTIVE',assignmentEligibility:'ELIGIBLE',mustChangePassword:false,passwordHash:'synthetic-not-a-password',capabilities:{create:{format:'FUTSAL',positionKey:'REFEREE',status:'READY'}}}});
 const admin=await prisma.adminAccount.create({data:{username:'r2-synthetic-admin',displayName:'虚构处理管理员',role:'SUPER_ADMIN',mustChangePassword:false,passwordHash:'synthetic-not-a-password'}});
 await prisma.adminSession.create({data:{adminAccountId:admin.id,tokenHash:hash('r2-admin',adminSecret),expiresAt:new Date(Date.now()+3600000)}});
 await prisma.refereeSession.create({data:{refereeId:referee.id,tokenHash:hash('r2-member',memberSecret),expiresAt:new Date(Date.now()+3600000)}});
 const match=await prisma.match.create({data:{slug:'r2-synthetic-match',competitionId:competition.id,stage:'虚构生命周期测试',status:'SCHEDULED',kickoff:new Date(Date.now()+172800000),venue:'虚构场地',homeTeamId:teams[0].id,awayTeamId:teams[1].id}});
 const appointment=await prisma.refereeAppointment.create({data:{matchId:match.id,status:'PUBLISHED',publishedAt:new Date(),revision:1,positions:{create:{refereeId:referee.id,key:'REFEREE',label:'裁判员',sortOrder:1}},versions:{create:{revision:1,status:'PUBLISHED',snapshot:'{}'}}},include:{versions:true}});
 const version=appointment.versions[0];
 browser=await chromium.launch({channel:process.env.TARGETED_BROWSER_CHANNEL??'chrome',headless:true});result.browser=browser.version();
 const context=await browser.newContext();await context.addCookies([{name:'nuaa_referee_member',value:'r2-member',url:origin,httpOnly:true,sameSite:'Lax'}]);
 await context.route(origin+'/api/**',async route=>{const response=await route.fetch({headers:{...await route.request().allHeaders(),origin:'https://nuaafa.cn'}});await route.fulfill({response});});
 const page=await context.newPage();page.setDefaultTimeout(12000);let documents=0;page.on('request',r=>{if(r.resourceType()==='document')documents++;});
 const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
 await page.goto(origin+'/referees/workspace');console.log('R2 page loaded');const panel=page.locator(`[data-appointment-id="${appointment.id}"]`);await panel.waitFor();
 const handle=await panel.elementHandle();const sentinel=randomUUID();await handle.evaluate((el,value)=>{el.dataset.targetedSentinel=value;window.__targetedDocumentSentinel=value;
  // Read only the committed React tree, never an obsolete alternate. This test probe
  // checks that refresh delivered props without recreating the component's hook queue.
  const appointmentId=el.dataset.appointmentId;let originalQueue;
  window.__targetedReportState=()=>{
   const key=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));let root=el[key];while(root?.return)root=root.return;
   const stack=[root?.stateNode?.current];
   while(stack.length){const fiber=stack.pop();if(!fiber)continue;
    const props=fiber.memoizedProps;
    if(props?.appointmentId===appointmentId&&Object.hasOwn(props,'acknowledgedAt')){
     const queue=fiber.memoizedState?.queue;if(!originalQueue)originalQueue=queue;
     return{status:props.report?.status??props.reportStatus??null,reportedAt:props.report?.reportedAt??null,resolvedAt:props.report?.resolvedAt??null,explanation:props.report?.explanation??null,sameHookQueue:Boolean(queue&&queue===originalQueue)};
    }
    if(fiber.sibling)stack.push(fiber.sibling);if(fiber.child)stack.push(fiber.child);
   }return null;
  };window.__targetedReportState();
 },sentinel);
 const reportButton=()=>panel.getByRole('button',{name:'报告冲突',exact:true});
 const pendingButton=()=>panel.getByRole('button',{name:'冲突待处理',exact:true});
 const submit=async explanation=>{await reportButton().click();await panel.locator('[name=reasonCode]').selectOption('OTHER');await panel.locator('[name=explanation]').fill(explanation);await panel.getByRole('button',{name:'提交冲突报告',exact:true}).click();await pendingButton().waitFor();assert(await pendingButton().isDisabled());};
 const resolve=async()=>{const report=await prisma.appointmentConflictReport.findUniqueOrThrow({where:{versionId_refereeId:{versionId:version.id,refereeId:referee.id}}});const response=await fetch(origin+`/api/referees/admin/conflict-reports/${report.id}`,{method:'PATCH',headers:{cookie:'nuaa_referee_admin=r2-admin',origin:'https://nuaafa.cn','content-type':'application/json'},body:JSON.stringify({status:'RESOLVED',resolutionNote:'虚构管理员已处理'})});assert.equal(response.status,200,await response.text());return prisma.appointmentConflictReport.findUniqueOrThrow({where:{id:report.id}});};
 const refresh=async(expected)=>{const request=page.waitForResponse(r=>new URL(r.url()).pathname==='/referees/workspace'&&r.request().headers()['rsc']==='1');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));assert.equal((await request).status(),200);await page.waitForFunction(expected=>{const state=window.__targetedReportState();return state?.status==='RESOLVED'&&state.sameHookQueue&&(!expected||state.explanation===expected);},expected);return page.evaluate(()=>window.__targetedReportState());};
 const stillMounted=async()=>{assert.equal(documents,1);assert(await handle.evaluate((el,value)=>el.isConnected&&el===document.querySelector(`[data-appointment-id="${el.dataset.appointmentId}"]`)&&el.dataset.targetedSentinel===value&&window.__targetedDocumentSentinel===value,sentinel));assert.match(await panel.locator('[aria-live=polite]').innerText(),/已保存/);assert((await page.evaluate(()=>window.__targetedReportState()))?.sameHookQueue,'React hook queue must survive refresh');};
 await submit('虚构首次报告A');console.log('R2 submitted');const resolved=await resolve();console.log('R2 resolved');assert.equal(resolved.status,'RESOLVED');assert.equal(resolved.versionId,version.id);
 const refreshed=await refresh(before?undefined:'虚构首次报告A');result.firstResolvedProps=refreshed;
 if(before){console.log('R2 before refresh received');await page.waitForTimeout(100);assert(await pendingButton().isDisabled());await stillMounted();}
 else{
  await reportButton().waitFor();assert(await reportButton().isEnabled());await stillMounted();
  await submit('虚构再次报告B');await stillMounted();
  const staleProps=await page.evaluate(()=>window.__targetedReportState());assert.equal(staleProps.status,'RESOLVED');assert.equal(staleProps.explanation,'虚构首次报告A');assert(await pendingButton().isDisabled(),'Old RESOLVED props must not unlock a fresh local PENDING');result.staleResolvedPropsAfterNewSubmission=staleProps;
  const updated=await prisma.appointmentConflictReport.findUniqueOrThrow({where:{id:resolved.id}});assert.equal(updated.status,'PENDING');assert.equal(updated.explanation,'虚构再次报告B');
  await resolve();await refresh('虚构再次报告B');await reportButton().waitFor();assert(await reportButton().isEnabled());await stillMounted();
  const duplicate=await fetch(origin+`/api/referees/appointments/${appointment.id}/conflict`,{method:'POST',headers:{cookie:'nuaa_referee_member=r2-member',origin:'https://nuaafa.cn','content-type':'application/json'},body:JSON.stringify({expectedVersionId:version.id,reasonCode:'OTHER',explanation:'虚构再次报告B'})});assert.equal(duplicate.status,200);
  assert.equal((await prisma.appointmentConflictReport.findUniqueOrThrow({where:{id:resolved.id}})).status,'RESOLVED');assert.equal(await prisma.appointmentConflictReport.count({where:{versionId:version.id}}),1);
  assert.equal(duplicate.headers.get('cache-control'),'private, no-store');
  const receipt=await duplicate.json();const keys=['id','reportedAt','resolvedAt','status','reasonCode','explanation'].sort();assert.deepEqual(Object.keys(receipt.report).sort(),keys);assert.equal(receipt.report.status,'RESOLVED');assert.equal(receipt.report.id,resolved.id);assert(receipt.report.resolvedAt);
  const endpoint=origin+`/api/referees/appointments/${appointment.id}`;const headers={cookie:'nuaa_referee_member=r2-member',origin:'https://nuaafa.cn','content-type':'application/json'};const body=JSON.stringify({expectedVersionId:version.id,reasonCode:'OTHER',explanation:'虚构权限探针'});
  assert.equal((await fetch(endpoint+'/conflict',{method:'POST',headers:{'content-type':'application/json',origin:'https://nuaafa.cn'},body})).status,401);
  assert.equal((await fetch(endpoint+'/conflict',{method:'POST',headers:{...headers,origin:'https://invalid.example'},body})).status,403);
  assert.equal((await fetch(endpoint+'/conflict',{method:'POST',headers,body:JSON.stringify({expectedVersionId:'stale-version',reasonCode:'OTHER',explanation:'虚构权限探针'})})).status,409);
  const other=await prisma.referee.create({data:{publicCode:'R2-OTHER',name:'虚构其他裁判',status:'ACTIVE',mustChangePassword:false}});await prisma.refereeSession.create({data:{refereeId:other.id,tokenHash:hash('r2-other',memberSecret),expiresAt:new Date(Date.now()+3600000)}});
  assert.equal((await fetch(endpoint+'/conflict',{method:'POST',headers:{...headers,cookie:'nuaa_referee_member=r2-other'},body})).status,409);
  const state=await fetch(endpoint+`/status?versionId=${version.id}`,{headers});assert.equal(state.status,200);assert.equal(state.headers.get('cache-control'),'private, no-store');assert.deepEqual((await state.json()).report,receipt.report);
  assert.equal((await prisma.appointmentConflictReport.findUniqueOrThrow({where:{id:resolved.id}})).status,'RESOLVED');assert.equal(await prisma.appointmentConflictReport.count(),1);
  result.checks.push({name:'R2 API receipt/readback DTO and unchanged authorization/version gates',status:'PASS',receiptFields:keys,anonymous:401,crossOrigin:403,staleVersion:409,otherReferee:409,noUnauthorizedWrite:true});
  assert.deepEqual(pageErrors,[]);
 }
 await page.screenshot({path:path.join(evidence,before?'R2-before-continuous.png':'R2-after-continuous.png'),fullPage:true});
 result.checks.push({name:'R2 continuous mounted submit-admin-resolve-refresh-resubmit',status:'PASS',mode:before?'defect reproduced':'fixed',documentLoads:documents,componentDomAndLocalMessagePreserved:true,committedReactHookQueuePreserved:true,versionUnchanged:true,staleResolvedDoesNotUnlock:before?'NOT RUN':true,sameHandledContentIdempotent:before?'NOT RUN':true});
 result.status='PASS';await context.close();
}catch(error){result.status='FAIL';result.error=String(error);throw error;}
finally{result.finishedAt=new Date().toISOString();await browser?.close();if(server.exitCode===null&&server.signalCode===null){const stop=once(server,'exit');server.kill('SIGTERM');await stop;}await prisma.$disconnect();await writeFile(path.join(evidence,before?'targeted-before.json':'targeted-after.json'),JSON.stringify(result,null,2));await writeFile(path.join(evidence,before?'targeted-before-server.log':'targeted-after-server.log'),serverLog);console.log(JSON.stringify(result,null,2));}
