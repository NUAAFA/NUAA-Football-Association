import { NextResponse } from "next/server";
import { authorizeUnifiedAdminServiceRequest, unifiedAdminErrorResponse, UnifiedAdminInputError } from "@/lib/unified-admin-api";
import { inspectTeamRemoval, removeCompetitionTeams } from "@/lib/competition-team-removal";
import { revalidatePublicCompetitionById, revalidatePublicTeamDirectory } from "@/lib/public-competition-revalidation";
import { isRecord } from "@/lib/referee-validation";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const grant = await authorizeUnifiedAdminServiceRequest(request, "competitions:write", { mutation: true });
    const competitionId = (await context.params).id;
    const body: unknown = await request.json();
    if (!isRecord(body) || !Array.isArray(body.teamIds) || body.teamIds.some((id) => typeof id !== "string" || id.length > 64)) throw new UnifiedAdminInputError("球队选择无效。");
    const teamIds = body.teamIds as string[];
    if (body.action === "inspect") return NextResponse.json(await inspectTeamRemoval(competitionId, teamIds));
    if (body.action !== "remove" || typeof body.reason !== "string") throw new UnifiedAdminInputError("请先检查并确认移除名单。");
    const result = await removeCompetitionTeams(competitionId, teamIds, body.reason, grant.authorization);
    await revalidatePublicCompetitionById(competitionId); revalidatePublicTeamDirectory();
    return NextResponse.json({ ok: true, result });
  } catch (error) { return unifiedAdminErrorResponse(error, "球队移除失败，全部所选球队保持原样。"); }
}
