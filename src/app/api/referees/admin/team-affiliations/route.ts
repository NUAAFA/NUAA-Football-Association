import { readBoundedJson } from "@/lib/bounded-json";
import { NextResponse } from "next/server";

import { authorizeLegacyAdminRequest } from "@/lib/legacy-admin-authorization";
import { revalidatePublicCompetitionById } from "@/lib/public-competition-revalidation";
import { refereeApiErrorResponse, RefereeApiInputError } from "@/lib/referee-api";
import { setTeamUnitAffiliations } from "@/lib/referee-r1-service";
import { isRecord, readEnum, readShortText, readShortTextArray } from "@/lib/referee-validation";

export async function PUT(request: Request) {
  const authorization = await authorizeLegacyAdminRequest(request, "competitions:write");
  if (!authorization.ok) return authorization.response;
  try {
    const body: unknown = await readBoundedJson(request);
    if (!isRecord(body)) throw new RefereeApiInputError("球队组织关联格式不正确。");
    const unitIds = readShortTextArray(body.unitIds ?? body.collegeIds, "组织单位", 64, 30);
    const inferredType = unitIds.length > 1 ? "JOINT" : unitIds.length === 1 ? "ORGANIZATION" : "FREEFORM";
    const team = await setTeamUnitAffiliations(
      readShortText(body.teamId, "球队", 64),
      unitIds,
      readEnum(body.teamType ?? inferredType, ["ORGANIZATION", "JOINT", "FREEFORM"] as const, "球队类型"),
      authorization.actor,
    );
    await revalidatePublicCompetitionById(team.competitionId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return refereeApiErrorResponse(error, "球队组织关联更新失败，请稍后重试。");
  }
}
