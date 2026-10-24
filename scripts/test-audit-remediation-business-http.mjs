import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp,mkdir,readdir,readFile,realpath,writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';

const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'audit-business-http-')));
const db=path.join(root,'synthetic.db');const uploads=path.join(root,'uploads');await mkdir(uploads);
Object.assign(process.env,{DATABASE_URL:`file:${db}`,NUAAFA_UPLOAD_DIR:uploads,NODE_ENV:'test',NUAAFA_ISOLATED_SECURITY_TEST:'1'});
const raw=createClient({url:process.env.DATABASE_URL});
for(const e of(await readdir('prisma/migrations',{withFileTypes:true})).filter(e=>e.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name)))await raw.executeMultiple(await readFile(path.join('prisma/migrations',e.name,'migration.sql'),'utf8'));
raw.close();
const {prisma}=await import('../src/lib/prisma.ts');
const caps=await import('./security-r4a-test-capabilities.ts');const service=await import('../src/lib/referee-service.ts');
const actor={...caps.testUnifiedAdminActor(),role:'SUPER_ADMIN'};const grant=caps.issueTestAdminServiceAuthorization('referees:write',actor);
const secret='Synthetic-Audit-HTTP-Admin-Secret-Only-2026';const memberSecret='Synthetic-Audit-HTTP-Member-Secret-Only-2026';
const hash=(token,key)=>createHmac('sha256',key).update(token).digest('hex');
let server,browser;const checks=[];let logs='';const output=process.env.NUAAFA_AUDIT_EVIDENCE;
try{
 const competition=await prisma.competition.create({data:{slug:'audit-http',name:'虚构HTTP赛事',campus:'虚构校区',format:'FUTSAL'}});
 const teams=await Promise.all(['虚构主队','虚构客队'].map(name=>prisma.team.create({data:{competitionId:competition.id,name}})));
 const referee=await prisma.referee.create({data:{publicCode:'AUDIT-HTTP',name:'虚构HTTP裁判',studentId:'AUDIT-HTTP-0001',status:'ACTIVE',assignmentEligibility:'ELIGIBLE',mustChangePassword:false,capabilities:{create:{format:'FUTSAL',positionKey:'REFEREE',status:'READY'}}}});
 const kickoff=new Date(Date.now()+86400000);const match=await service.createMatch({slug:'audit-http-match',competitionId:competition.id,stage:'虚构赛',kickoff,venue:'虚构场地',homeTeamId:teams[0].id,awayTeamId:teams[1].id,status:'SCHEDULED',applicationWindowStatus:'OPEN',applicationDeadline:new Date(kickoff.getTime()-3600000),positionCounts:{REFEREE:1}},actor);
 const app=await service.createRefereeApplication({matchId:match.id,refereeId:referee.id,preferredPositions:['REFEREE']});
 for(const [username,role]of[['audit-super','SUPER_ADMIN'],['audit-content','CONTENT_EDITOR']]){
  const account=await prisma.adminAccount.create({data:{username,displayName:'虚构HTTP管理员',role:'SUPER_ADMIN',passwordHash:'synthetic-not-login-password',mustChangePassword:false,unifiedRoles:{create:{role}}}});
  await prisma.adminSession.create({data:{adminAccountId:account.id,tokenHash:hash(username,secret),expiresAt:new Date(Date.now()+3600000)}});
 }
 await prisma.refereeSession.create({data:{refereeId:referee.id,tokenHash:hash('audit-member',memberSecret),expiresAt:new Date(Date.now()+3600000)}});
 const listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(r=>listener.close(r));const origin=`http://127.0.0.1:${port}`;
 server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{env:{PATH:process.env.PATH,HOME:os.homedir(),TMPDIR:os.tmpdir(),NODE_ENV:'production',DATABASE_URL:`file:${db}`,NUAAFA_UPLOAD_DIR:uploads,REFEREE_ADMIN_SESSION_SECRET:secret,REFEREE_MEMBER_SESSION_SECRET:memberSecret,NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',c=>logs+=c);server.stderr.on('data',c=>logs+=c);
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert(ready,logs);
 const review=async(status,token='audit-super',expected=400)=>{const r=await fetch(origin+`/api/referees/admin/applications/${app.id}`,{method:'PATCH',headers:{'content-type':'application/json',origin:'https://nuaafa.cn',...(token?{cookie:`nuaa_referee_admin=${token}`}:{})},body:JSON.stringify({status,reviewNote:'虚构审核'})});assert.equal(r.status,expected,await r.text());};
 await review('APPOINTED');await review('NOT_SELECTED');await review('APPROVED','',401);await review('APPROVED','audit-content',403);await review('APPROVED','audit-super',200);
 checks.push('F02 HTTP 400 derived states, 401 anonymous, 403 content editor, valid approval');
 await service.saveAppointmentDraft({matchId:match.id,publicationNote:'虚构',positions:[{key:'REFEREE',refereeId:referee.id}]},grant);await service.publishAppointment(match.id,'','',grant);
 await review('APPROVED','audit-super',409);
 const withdraw=await fetch(origin+`/api/referees/applications/${app.id}`,{method:'DELETE',headers:{origin:'https://nuaafa.cn',cookie:'nuaa_referee_member=audit-member'}});assert.equal(withdraw.status,409);
 checks.push('F02 HTTP cannot review or self-withdraw around an actual published task');
 if(process.env.PLAYWRIGHT_MODULE){
  const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);browser=await chromium.launch({channel:process.env.AUDIT_BROWSER_CHANNEL??'chrome',headless:true});
  const context=await browser.newContext();await context.addCookies([{name:'nuaa_referee_admin',value:'audit-super',url:origin,httpOnly:true,sameSite:'Lax'}]);const page=await context.newPage();await page.goto(origin+`/admin/appointments/${match.id}`);
  const row=page.locator('tr').filter({hasText:'虚构HTTP裁判'});await row.locator('select').waitFor();assert(await row.locator('select').isDisabled());assert(await row.getByRole('button',{name:'保存',exact:true}).isDisabled());
  if(output)await page.screenshot({path:path.join(output,'business-review-ui.png'),fullPage:true});
  checks.push('F02 real browser keeps official application review controls disabled');await context.close();
 }
 const result={status:'PASS',checks,synthetic:true,browser:browser?browser.version():null};if(output)await writeFile(path.join(output,'business-http.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{
 await browser?.close();if(server&&server.exitCode===null&&server.signalCode===null){const stop=once(server,'exit');server.kill('SIGTERM');await stop;}await prisma.$disconnect();if(output)await writeFile(path.join(output,'checks/business-http-server.log'),logs);
}
