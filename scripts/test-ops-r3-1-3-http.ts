import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
async function main(){
 const root=process.env.OPS_R313_ROOT!;assert(root && path.basename(root).startsWith('nuaafa-ops-r313-'));const info=JSON.parse(await readFile(path.join(root,'fixture.json'),'utf8'));process.env.DATABASE_URL=info.databaseUrl;
 const {prisma}=await import('../src/lib/prisma');const {hashPassword}=await import('../src/lib/referee-security');
 const origin=process.env.OPS_R313_ORIGIN ?? 'http://127.0.0.1:3194';
 async function api(route:string,body:unknown,cookie='',status=200,requestOrigin='https://nuaafa.cn'){const r=await fetch(origin+route,{method:'POST',headers:{'content-type':'application/json',origin:requestOrigin,cookie},body:JSON.stringify(body)});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d;}
 async function login(username:string){const r=await fetch(origin+'/api/referees/admin/login',{method:'POST',headers:{'content-type':'application/json',origin:'https://nuaafa.cn'},body:JSON.stringify({username,password:'R313-Isolated-only-verify!'})});assert.equal(r.status,200,await r.clone().text());return r.headers.get('set-cookie')!.split(';')[0];}
 try {
 const admin=await login('r313-super');const viewer=await prisma.adminAccount.create({data:{username:`r313-content-${Date.now()}`,displayName:'只读隔离',passwordHash:await hashPassword('R313-Isolated-only-verify!'),role:'REFEREE_MANAGER',unifiedRoles:{create:{role:'CONTENT_EDITOR'}}}});const readOnly=await login(viewer.username);
 const team=await prisma.team.create({data:{competitionId:info.competitionId,name:`HTTP误加${Date.now()}`}});const route=`/api/admin/competitions/${info.competitionId}/teams/remove`;const body={action:'inspect',teamIds:[team.id]};
 await api(route,body,'',401);await api(route,body,readOnly,403);await api(route,body,admin,403,'https://invalid.example');const p=await api(route,body,admin);assert.equal(p.teams[0].removable,true);assert(await prisma.team.findUnique({where:{id:team.id}}));
 const existing=await prisma.match.findFirstOrThrow({where:{competitionId:info.competitionId}});const blocked=await api(route,{action:'inspect',teamIds:[existing.homeTeamId,team.id]},admin);assert.equal(blocked.teams.filter((t:{removable:boolean})=>t.removable).length,1);await api(route,{action:'remove',teamIds:[existing.homeTeamId,team.id],reason:'误添加'},admin,409);assert(await prisma.team.findUnique({where:{id:team.id}}));
 await api(route,{action:'remove',teamIds:[team.id],reason:'误添加'},admin);assert.equal(await prisma.team.findUnique({where:{id:team.id}}),null);await api(route,{action:'remove',teamIds:[team.id],reason:'误添加'},admin,409);assert.equal(await prisma.auditLog.count({where:{action:'TEAM_DELETED',entityId:team.id}}),1);
 const foreign=await prisma.team.findFirstOrThrow({where:{competitionId:{not:info.competitionId}}});await api(route,{action:'remove',teamIds:[foreign.id],reason:'误添加'},admin,409);
 const pending=await prisma.match.findFirstOrThrow({where:{competitionId:info.competitionId,kickoff:null}});const noteRoute=`/api/admin/matches/${pending.id}/tentative`;
 await api(noteRoute,{tentativeDate:'2026-10-09',tentativeSchedule:'下午待通知'},readOnly,403);await api(noteRoute,{tentativeDate:'2026-02-30',tentativeSchedule:'下午'},admin,400);await api(noteRoute,{tentativeDate:'2026-10-09',tentativeSchedule:'下午待通知'},admin);const saved=await prisma.match.findUniqueOrThrow({where:{id:pending.id}});assert.equal(saved.kickoff,null);assert.equal(saved.tentativeDate,'2026-10-09');assert.equal(saved.tentativeSchedule,'下午待通知');
 console.log('PASS HTTP: auth/RBAC/CSRF/cross-competition, precheck zero writes, atomic mixed block, explicit safe collection, duplicate no second audit, tentative schedule persists without kickoff');
 }finally{await prisma.$disconnect();}
}
main().catch((e)=>{console.error(e);process.exitCode=1;});
