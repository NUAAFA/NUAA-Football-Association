import assert from "node:assert/strict";
import { readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
async function main() {
  const root=await realpath(process.env.OPS_R313_ROOT!); assert.equal(path.dirname(root),await realpath(os.tmpdir()));assert(path.basename(root).startsWith("nuaafa-ops-r313-"));
  const info=JSON.parse(await readFile(path.join(root,"fixture.json"),"utf8"));process.env.DATABASE_URL=info.databaseUrl;
  const {prisma}=await import("../src/lib/prisma");
  try {
    const cid=info.docxCompetitionId;
    const stage=await prisma.competitionStage.findFirstOrThrow({where:{competitionId:cid,type:"GROUP"}});
    if(!await prisma.team.findFirst({where:{competitionId:cid,name:"误加未分组验收队"}})) await prisma.team.create({data:{competitionId:cid,name:"误加未分组验收队"}});
    const {parseCompetitionImportDocx}=await import("../src/lib/competition-import-docx");const parsed=parseCompetitionImportDocx(await readFile("scripts/fixtures/ops-r3-1-1/2026-09-29_06.43.05-65a5f60ea71e6a7385071a16fed8e472.docx"));
    for (const n of [29,30]) {if(await prisma.match.findFirst({where:{competitionId:cid,matchNumber:n}}))continue;const row=parsed.rows.find((r)=>Number(r.values.matchNumber)===n)!;const group=await prisma.competitionGroup.findFirstOrThrow({where:{stageId:stage.id,name:String(row.values.group)}});const round=await prisma.competitionRound.findFirstOrThrow({where:{stageId:stage.id,groupId:group.id,name:String(row.values.round)}});const home=await prisma.team.findFirstOrThrow({where:{competitionId:cid,name:String(row.values.homeTeam)}});const away=await prisma.team.findFirstOrThrow({where:{competitionId:cid,name:String(row.values.awayTeam)}});await prisma.match.create({data:{competitionId:cid,slug:`r313-qa-${n}`,stage:stage.name,stageId:stage.id,groupId:group.id,roundId:round.id,homeTeamId:home.id,awayTeamId:away.id,matchNumber:n,status:"SCHEDULED",isTestData:true}});}
    const first=await prisma.match.findFirstOrThrow({where:{competitionId:cid,matchNumber:1}});await prisma.match.update({where:{id:first.id},data:{kickoff:new Date("2026-10-09T07:30:00Z"),venue:"天目湖校区西操场"}});
    const large=await prisma.competition.create({data:{slug:`r313-large-${Date.now()}`,name:"R313 · 72队17组隔离验收",campus:"隔离",format:"FUTSAL",status:"ONGOING",isTestData:true}});const ls=await prisma.competitionStage.create({data:{competitionId:large.id,name:"小组赛",type:"GROUP"}});
    const groups=[];for(let i=0;i<17;i++)groups.push(await prisma.competitionGroup.create({data:{stageId:ls.id,name:i<12?`${String.fromCharCode(65+i)}组`:["第一小组","男子A组","女子A组","天目湖组","自定义第17组"][i-12],sortOrder:i}}));
    for(let i=1;i<=72;i++){const t=await prisma.team.create({data:{competitionId:large.id,name:`验收球队${String(i).padStart(3,"0")}`}});if(i<=68)await prisma.teamGroupMembership.create({data:{teamId:t.id,stageId:ls.id,groupId:groups[(i-1)%17].id}});}
    await writeFile(path.join(root,"browser-fixture.json"),JSON.stringify({...info,largeCompetitionId:large.id,smallCompetitionId:cid},null,2));console.log(`PASS isolated browser fixtures: 13 teams / 2 groups / 30 matches (29 pending + 1 scheduled); 72 teams / 17 groups. ${large.id}`);
  }finally{await prisma.$disconnect();}
}
main().catch((e)=>{console.error(e);process.exitCode=1;});
