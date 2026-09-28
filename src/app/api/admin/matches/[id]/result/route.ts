import { NextResponse } from "next/server";
import { authorizeLegacyAdminRequest } from "@/lib/legacy-admin-authorization";
import { confirmMatchResult } from "@/lib/referee-service";
import { refereeApiErrorResponse, RefereeApiInputError } from "@/lib/referee-api";
import { revalidatePublicCompetitionById } from "@/lib/public-competition-revalidation";
import { isRecord } from "@/lib/referee-validation";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeLegacyAdminRequest(request, "competitions:write");
  if (!auth.ok) return auth.response;
  try {
    const body: unknown = await request.json();
    if (!isRecord(body) || typeof body.homeScore !== "number" || typeof body.awayScore !== "number" || typeof body.expectedVersion !== "number" || typeof body.reason !== "string" || ![null, "number"].includes(body.homePenaltyScore === null ? null : typeof body.homePenaltyScore) || ![null, "number"].includes(body.awayPenaltyScore === null ? null : typeof body.awayPenaltyScore)) throw new RefereeApiInputError("赛果输入格式无效。");
    const result = await confirmMatchResult((await context.params).id, { homeScore: body.homeScore, awayScore: body.awayScore, homePenaltyScore: body.homePenaltyScore as number | null, awayPenaltyScore: body.awayPenaltyScore as number | null, expectedVersion: body.expectedVersion, actualEnded: body.actualEnded === true, reason: body.reason }, auth.authorization);
    await revalidatePublicCompetitionById(result.competitionId);
    return NextResponse.json({ ok: true, resultVersion: result.resultVersion });
  } catch (error) { return refereeApiErrorResponse(error, "赛果确认失败。"); }
}
