import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { PrismaClient } from '../src/generated/prisma-v29/client';
import { strToU8, zipSync } from 'fflate';
import { formatBeijingDateTimeInput } from '../src/lib/beijing-datetime';
async function main() {
 const info = JSON.parse(await readFile('docs/ops-r3-1/evidence/acceptance-environment.json','utf8'));
 assert(info.root.includes('nuaafa-ops-acceptance-')); const db = new PrismaClient({adapter:new PrismaLibSql({url:`file:${info.databasePath}`})});
 const accounts = JSON.parse(await readFile(info.root+'/accounts.json','utf8')); const origin=process.argv[2] ?? info.origin, mutationOrigin=process.argv[2] ? origin : "https://nuaafa.cn";
 const proof: Record<string,unknown> = { origin, startedAt:new Date().toISOString() };
 async function request(route:string, method:string, body:unknown, cookie='', expected=200) { const r=await fetch(origin+route,{method,headers:{origin:mutationOrigin,...(cookie?{cookie}:{}),...(!(body instanceof FormData)?{'content-type':'application/json'}:{})},body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'}); const t=await r.text(); assert.equal(r.status,expected,`${route}: ${t.slice(0,700)}`); return t?JSON.parse(t):{}; }
 async function login(username:string){ const r=await fetch(origin+'/api/referees/admin/login',{method:'POST',headers:{origin:mutationOrigin,'content-type':'application/json'},body:JSON.stringify({username:`smoke-${username}`,password:accounts.password})});assert.equal(r.status,200);return r.headers.get('set-cookie')!.split(';')[0]; }
 async function html(route:string,cookie=''){const r=await fetch(origin+route,{headers:cookie?{cookie}:{},cache:'no-store'});assert.equal(r.status,200,route);return r.text();}
 try {
 await db.competition.updateMany({where:{slug:{startsWith:'ops-'}},data:{publicPublished:false,homepageFeatured:false}});
 const [compCookie,refCookie,contentCookie,superCookie]=await Promise.all(['competition','referee','content','super'].map(login));
 const suffix=Date.now().toString(36), slug=`ops-36-${suffix}`;
 const cp={slug,name:`OPS隔离36场-${suffix}`,campus:'隔离环境',format:'FUTSAL',playingFormat:'五人制',status:'ONGOING',year:2026,publicPublished:false,homepageFeatured:false,publicOrder:999,summary:'仅用于隔离验收',notice:'合成数据'};
 const {competitionId:id}=await request('/api/referees/admin/competitions','POST',cp,compCookie,201);
 await request('/api/referees/admin/teams','POST',{action:'bulk',competitionId:id,names:Array.from({length:16},(_,i)=>`合成球队${i+1}`)},compCookie,201);
 const teams=await db.team.findMany({where:{competitionId:id},orderBy:{id:'asc'}});
 const structureRoute=`/api/admin/competitions/${id}/structure`;
 const stage=(await request(structureRoute,'POST',{action:'stage',name:'小组赛',type:'GROUP',sortOrder:0},compCookie)).result;
 const knockout=(await request(structureRoute,'POST',{action:'stage',name:'淘汰赛',type:'KNOCKOUT',sortOrder:1},compCookie)).result;
 const semi=(await request(structureRoute,'POST',{action:'round',stageId:knockout.id,name:'半决赛',sortOrder:0},compCookie)).result;
 const groups=[];
 for(let g=0;g<4;g++){const group=(await request(structureRoute,'POST',{action:'group',stageId:stage.id,name:`${'ABCD'[g]}组`,sortOrder:g},compCookie)).result; groups.push(group);await request(structureRoute,'POST',{action:'members',groupId:group.id,teamIds:teams.slice(g*4,g*4+4).map(t=>t.id),reason:'手工分组合成验收'},compCookie);for(let r=1;r<=3;r++)await request(structureRoute,'POST',{action:'round',stageId:stage.id,groupId:group.id,name:`第${r}轮`,sortOrder:r},compCookie);}
 const now=Date.now();const header=['主队','客队','开球时间','结束时间','场地','阶段','分组','轮次'];const rows=[header];
 for(let g=0;g<4;g++)for(let i=0;i<9;i++) rows.push([teams[g*4+i%4].name,teams[g*4+(i+1)%4].name,formatBeijingDateTimeInput(new Date(now+(rows.length)*86400000)),'','隔离验收球场','小组赛',`${'ABCD'[g]}组`,`第${i%3+1}轮`]);
 const csv=rows.map(r=>r.join(',')).join('\n'),paste=rows.map(r=>r.join('\t')).join('\n');
 // Minimal XLSX package follows the existing repository fixture writer.
 const xml=(v:string)=>v.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 const sheet=rows.map((r,i)=>`<row r="${i+1}">${r.map((c,j)=>`<c r="${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[j]}${i+1}" t="inlineStr"><is><t>${xml(c)}</t></is></c>`).join('')}</row>`).join('');
 const files={'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>','_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>','xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Import" sheetId="1" r:id="rId1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>','xl/worksheets/sheet1.xml':`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`};
 const xlsx=Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([n,c])=>[n,strToU8(c)]))));
 function input(method:string,hash?:string){const f=new FormData();f.set('competitionId',id);f.set('importType','MATCH');f.set('inputMethod',method);if(method==='PASTE')f.set('content',paste);else f.set('file',new Blob([method==='CSV'?csv:xlsx],{type:method==='CSV'?'text/csv':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),`ops.${method.toLowerCase()}`);if(hash)f.set('planHash',hash);return f;}
 const before=await db.match.count({where:{competitionId:id}});let preview;
 for(const method of ['CSV','XLSX','PASTE']){preview=(await request('/api/admin/competitions/import/preview','POST',input(method),compCookie)).preview;assert.equal(preview.summary.createRows,36);assert.equal(preview.publicImpact,false);assert.equal(await db.match.count({where:{competitionId:id}}),before);}
 await request('/api/admin/competitions/import/commit','POST',input('PASTE',preview.planHash),compCookie,201);
 assert.equal(await db.match.count({where:{competitionId:id}}),36);
 preview=(await request('/api/admin/competitions/import/preview','POST',input('CSV'),compCookie)).preview;
 const repeat=await request('/api/admin/competitions/import/commit','POST',input('CSV',preview.planHash),compCookie,201);assert.equal(repeat.result.createdMatches,0);
 await request(`/api/referees/admin/competitions/${id}`,'PATCH',{...Object.fromEntries(Object.entries(cp).filter(([k])=>k!== 'slug')),publicPublished:true,homepageFeatured:true},compCookie);
 const fixtures=await db.match.findMany({where:{competitionId:id},orderBy:{kickoff:'asc'}}),match=fixtures[0];
 let home=await html('/'); assert.equal((home.match(new RegExp(`href="/competitions/${slug}#match-`,'g'))??[]).length,1);
 const detail1=await html(`/competitions/${slug}`),detail2=await html(`/competitions/${slug}?page=2`);for(const m of fixtures)assert((detail1+detail2).includes(`match-${m.id}`));
 assert((await html('/competitions/schedule?competition='+id)).includes('共 <!-- -->36<!-- --> 场'));
 // Test-only referee is enabled as an isolated fixture, preserving real role grants.
 await db.referee.update({where:{id:accounts.refereeId},data:{mustChangePassword:false,assignmentEligibility:'ELIGIBLE',futsal:true,capabilities:{upsert:{where:{refereeId_format_positionKey:{refereeId:accounts.refereeId,format:'FUTSAL',positionKey:'REFEREE'}},create:{format:'FUTSAL',positionKey:'REFEREE',status:'READY'},update:{status:'READY'}}}}});
 await db.matchPositionRequirement.create({data:{matchId:match.id,key:'REFEREE',label:'裁判员',count:1,sortOrder:0}});
 await request(`/api/referees/admin/appointments/${match.id}`,'PUT',{positions:[{key:'REFEREE',slot:1,refereeId:accounts.refereeId}],publicationNote:'合成选派'},refCookie);
 await request(`/api/referees/admin/appointments/${match.id}`,'POST',{action:'publish',reason:'合成正式发布'},refCookie);
 const loginResponse=await fetch(origin+'/api/referees/login',{method:'POST',headers:{origin:mutationOrigin,'content-type':'application/json'},body:JSON.stringify({studentId:'16268888',password:accounts.password})});assert.equal(loginResponse.status,200);const memberCookie=loginResponse.headers.get('set-cookie')!.split(';')[0];
 assert((await html('/referees/workspace',memberCookie)).includes('合成球队'));
 const appointment=await db.refereeAppointment.findUniqueOrThrow({where:{matchId:match.id}});await request(`/api/referees/appointments/${appointment.id}/acknowledge`,'POST',{},memberCookie);
 const result={homeScore:0,awayScore:0,homePenaltyScore:null,awayPenaltyScore:null,expectedVersion:0,actualEnded:true,reason:'合成实际完赛'};
 await request(`/api/admin/matches/${match.id}/result`,'POST',result,compCookie,409);await request(`/api/referees/admin/appointments/${match.id}`,'POST',{action:'publish'},compCookie,403);
 const patch={slug:match.slug,competitionId:id,stage:'小组赛',stageId:match.stageId,groupId:match.groupId,roundId:match.roundId,kickoff:new Date(now-7200000).toISOString(),endAt:new Date(now-3600000).toISOString(),venue:match.venue,round:match.round,source:'MANUAL',homeTeamId:match.homeTeamId,awayTeamId:match.awayTeamId,status:'SCHEDULED',applicationWindowStatus:'CLOSED',positionCounts:{REFEREE:1}};
 await request(`/api/referees/admin/matches/${match.id}`,'PATCH',patch,compCookie);await request(`/api/admin/matches/${match.id}/result`,'POST',result,compCookie);await request(`/api/admin/matches/${match.id}/result`,'POST',result,compCookie);
 assert.equal(await db.appointmentVersion.count({where:{appointmentId:appointment.id,status:'COMPLETED'}}),1);
 assert((await html(`/competitions/${slug}`)).includes('0 : 0'));assert((await html('/competitions/standings?competition='+id)).includes('同分，最终次序待确认'));
 const tables=(await request(structureRoute,'GET',undefined,compCookie)).tables;const table=tables.find((t:{group:{id:string}})=>t.group.id===match.groupId);
 await request(structureRoute,'POST',{action:'confirm',groupId:table.group.id,kind:'RANKING',teamIds:table.rows.map((r:{id:string})=>r.id),fingerprint:table.fingerprint,reason:'合成规程同分顺序'},compCookie);
 const ranked=(await request(structureRoute,'GET',undefined,compCookie)).tables.find((t:{group:{id:string}})=>t.group.id===match.groupId);
 await request(structureRoute,'POST',{action:'confirm',groupId:ranked.group.id,kind:'QUALIFICATION',teamIds:ranked.rows.slice(0,2).map((r:{id:string})=>r.id),fingerprint:ranked.qualificationFingerprint,reason:'提前确认：仅用于隔离人工旅程'},compCookie);
 const {matchId:semiId}=await request('/api/referees/admin/matches','POST',{...patch,slug:`ops-semi-${suffix}`,stage:'淘汰赛',stageId:knockout.id,groupId:null,roundId:semi.id,round:'半决赛',kickoff:new Date(now+45*86400000).toISOString(),endAt:'',homeTeamId:ranked.rows[0].id,awayTeamId:ranked.rows[1].id,positionCounts:{}},compCookie,201);
 await request(`/api/admin/matches/${match.id}/result`,'POST',{...result,homeScore:2,expectedVersion:1,reason:'合成更正'},compCookie);
 const stale=(await request(structureRoute,'GET',undefined,compCookie)).tables.find((t:{group:{id:string}})=>t.group.id===match.groupId);assert(stale.qualificationStale&&stale.affectedMatches.some((m:{id:string})=>m.id===semiId));
 assert((await html('/')).includes(`#match-${fixtures[1].id}`));
 // Three additional candidates each have 40 matches, nearest kickoff wins over publicOrder.
 for(let c=0;c<3;c++){const createdOther=await request('/api/referees/admin/competitions','POST',{...cp,slug:`ops-other-${suffix}-${c}`,name:`合成候选${c}`,publicPublished:true,homepageFeatured:true,publicOrder:c},compCookie,201);const other=await db.competition.findUniqueOrThrow({where:{id:createdOther.competitionId}});const a=await db.team.create({data:{competitionId:other.id,name:`候选${c}甲`}}),b=await db.team.create({data:{competitionId:other.id,name:`候选${c}乙`}});for(let j=0;j<40;j++)await db.match.create({data:{slug:`ops-other-${suffix}-${c}-${j}`,competitionId:other.id,homeTeamId:a.id,awayTeamId:b.id,stage:'合成',status:'SCHEDULED',kickoff:new Date(now+(c+4)*86400000+j*3600000),venue:'隔离候选场'}});}
 home=await html('/');assert.equal((home.match(/<article class="next-match-forecast-card"/g)??[]).length,2);assert(home.includes(`/competitions/${slug}#match-${fixtures[1].id}`));
 // Time-only rotation: two-second near kickoff, no mutation between requests.
 const clock=await db.match.create({data:{slug:`ops-clock-${suffix}`,competitionId:id,homeTeamId:teams[0].id,awayTeamId:teams[1].id,stage:'时钟测试',status:'SCHEDULED',kickoff:new Date(Date.now()+3000),venue:'仅时间流逝'}});
 assert((await html('/')).includes(`#match-${clock.id}`));await new Promise(r=>setTimeout(r,3200));assert(!(await html('/')).includes(`#match-${clock.id}`));
 // Anonymous and wrong-role write protection, public closure and private-field checks.
 await request(structureRoute,'POST',{action:'stage',name:'越权',type:'OTHER',sortOrder:0},'',401);await request(`/api/admin/matches/${match.id}/result`,'POST',result,contentCookie,403);
 for(const route of [`/competitions/${slug}`,'/competitions/schedule?competition='+id,'/competitions/standings?competition='+id]){const text=await html(route);for(const token of ['storageKey','passwordHash','internalNote','16268888'])assert(!text.includes(token),`${route} leaked ${token}`);}
 await request(`/api/referees/admin/competitions/${id}`,'PATCH',{...Object.fromEntries(Object.entries(cp).filter(([k])=>k!== 'slug')),publicPublished:false,homepageFeatured:false},compCookie);assert.equal((await fetch(origin+`/competitions/${slug}`)).status,404);assert(!(await html('/competitions/schedule')).includes(cp.name));
 await request(`/api/referees/admin/competitions/${id}`,'PATCH',{...Object.fromEntries(Object.entries(cp).filter(([k])=>k!== 'slug')),publicPublished:true,homepageFeatured:true},compCookie);
 proof['HTTP-journey']='PASS';proof['IMP-01']='36 CSV/XLSX/paste previews, zero writes, one atomic commit, duplicate zero';proof['PUB-01/02/03/05/06']='PASS';proof['REF/RES/TAB/QUAL']='PASS';proof.competitionId=id;proof.slug=slug;proof.matchId=match.id;proof.semiId=semiId;proof.finishedAt=new Date().toISOString();
 await writeFile('docs/ops-r3-1/evidence/ops-http.json',JSON.stringify(proof,null,2));console.log(JSON.stringify(proof,null,2));
 await writeFile(info.root+'/journey.json',JSON.stringify({id,slug,groups,stage,knockout,semiId,matchId:match.id},null,2));
 void superCookie;
 } finally {await db.$disconnect();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
