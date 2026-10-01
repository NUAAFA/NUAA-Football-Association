import { NextResponse } from "next/server";
import { authorizeUnifiedAdminRequest, unifiedAdminErrorResponse, UnifiedAdminInputError } from "@/lib/unified-admin-api";
import { prisma } from "@/lib/prisma";
import { parseCompetitionImportDate } from "@/lib/competition-import-service";
import { isRecord } from "@/lib/referee-validation";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authorizeUnifiedAdminRequest(request,"competitions:write",{mutation:true});
    const body: unknown = await request.json();
    if (!isRecord(body) || typeof body.tentativeDate !== "string" || typeof body.tentativeSchedule !== "string" || body.tentativeSchedule.length > 500) throw new UnifiedAdminInputError("暂定安排格式无效。");
    const date = body.tentativeDate, note = body.tentativeSchedule;
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !parseCompetitionImportDate(`${date} 00:00`,"date","暂定日期",[],false))) throw new UnifiedAdminInputError("暂定日期无效。");
    const id = (await context.params).id;
    await prisma.$transaction(async (tx) => {
      const match = await tx.match.findUnique({where:{id}});
      if (!match || match.status !== "SCHEDULED") throw new UnifiedAdminInputError("仅未结束且未取消的比赛可修改暂定安排。",409);
      await tx.match.update({where:{id},data:{tentativeDate:date || null,tentativeSchedule:note || null}});
      await tx.auditLog.create({data:{actorType:"ADMIN",actorId:actor.id,action:"MATCH_TENTATIVE_UPDATED",entityType:"Match",entityId:id,summary:"修改暂定安排，正式排期保持原样",metadata:JSON.stringify({competitionId:match.competitionId,tentativeDate:date,tentativeSchedule:note})}});
    });
    return NextResponse.json({ok:true});
  } catch(error) { return unifiedAdminErrorResponse(error,"暂定安排保存失败。"); }
}
