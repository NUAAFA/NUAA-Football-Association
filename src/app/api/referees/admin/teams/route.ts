import { readBoundedJson } from "@/lib/bounded-json";
import { NextResponse } from "next/server";

import { authorizeLegacyAdminRequest } from "@/lib/legacy-admin-authorization";
import { revalidatePublicCompetitionById, revalidatePublicTeamDirectory } from "@/lib/public-competition-revalidation";
import { refereeApiErrorResponse, RefereeApiInputError } from "@/lib/referee-api";
import { createJointTeam, createOrganizationTeam, createTeamsBulk, createTeamsFromUnits } from "@/lib/referee-r1-service";
import { isRecord, readEnum, readShortText, readShortTextArray } from "@/lib/referee-validation";

export async function POST(request: Request) {
  const authorization = await authorizeLegacyAdminRequest(request, "competitions:write");
  if (!authorization.ok) return authorization.response;
  const actor = authorization.actor;
  try {
    const body: unknown = await readBoundedJson(request);
    if (!isRecord(body)) throw new RefereeApiInputError("球队内容格式不正确。");
    const action = readEnum(body.action, ["bulk", "from-units", "joint", "organization"] as const, "操作");
    const competitionId = readShortText(body.competitionId, "赛事", 64);
    const result = action === "bulk"
      ? await createTeamsBulk({ competitionId, names: readShortTextArray(body.names, "球队名称", 80, 500), actor })
      : action === "organization"
        ? await createOrganizationTeam({ competitionId, unitId: readShortText(body.unitId, "组织单位", 64), name: readShortText(body.name, "球队名称", 80), actor })
      : action === "from-units"
        ? await createTeamsFromUnits({ competitionId, unitIds: readShortTextArray(body.unitIds, "组织单位", 64, 100), actor })
        : await createJointTeam({
            competitionId,
            name: readShortText(body.name, "联合队名称", 80),
            unitIds: readShortTextArray(body.unitIds, "组织单位", 64, 30),
            actor,
          });
    await revalidatePublicCompetitionById(competitionId);
    revalidatePublicTeamDirectory();
    return NextResponse.json({ ok: true, result }, { status: 201 });
  } catch (error) {
    return refereeApiErrorResponse(error, "球队创建失败，请稍后重试。");
  }
}
