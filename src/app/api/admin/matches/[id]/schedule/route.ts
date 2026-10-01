import { NextResponse } from "next/server";
import { authorizeUnifiedAdminServiceRequest, unifiedAdminErrorResponse, UnifiedAdminInputError } from "@/lib/unified-admin-api";
import { scheduleMatch } from "@/lib/match-scheduling-service";
import { isRecord, readDate, readShortText } from "@/lib/referee-validation";
import { revalidatePublicCompetitionById } from "@/lib/public-competition-revalidation";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { authorization } = await authorizeUnifiedAdminServiceRequest(request, "competitions:write", { mutation: true });
    const body: unknown = await request.json();
    if (!isRecord(body)) throw new UnifiedAdminInputError("排期格式无效。");
    const match = await scheduleMatch((await context.params).id, { kickoff: readDate(body.kickoff, "开球时间")!, endAt: readDate(body.endAt, "结束时间", false), venue: readShortText(body.venue, "比赛场地", 120) }, authorization);
    await revalidatePublicCompetitionById(match.competitionId);
    return NextResponse.json({ ok: true });
  } catch (error) { return unifiedAdminErrorResponse(error, "安排比赛失败。"); }
}
