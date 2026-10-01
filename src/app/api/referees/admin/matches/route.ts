import { NextResponse } from "next/server";

import { authorizeLegacyAdminRequest } from "@/lib/legacy-admin-authorization";
import { revalidatePublicCompetitionById } from "@/lib/public-competition-revalidation";
import { refereeApiErrorResponse, RefereeApiInputError } from "@/lib/referee-api";
import { createMatchFromSelections } from "@/lib/referee-service";
import {
  isRecord,
  positionKeys,
  readDate,
  readEnum,
  readInteger,
  readShortText,
} from "@/lib/referee-validation";

function readPositionCounts(value: unknown) {
  if (!isRecord(value)) throw new RefereeApiInputError("岗位人数格式不正确。");
  return Object.fromEntries(
    positionKeys.map((key) => [
      key,
      readInteger(value[key] ?? 0, `${key} 人数`, 0, 5),
    ]),
  );
}

export async function POST(request: Request) {
  const authorization = await authorizeLegacyAdminRequest(request, "competitions:write");
  if (!authorization.ok) return authorization.response;
  const actor = authorization.actor;
  try {
    const body: unknown = await request.json();
    if (!isRecord(body)) throw new RefereeApiInputError("场次内容格式不正确。");
    const legacyHomeTeamId = readShortText(body.homeTeamId, "主队", 64, false);
    const legacyAwayTeamId = readShortText(body.awayTeamId, "客队", 64, false);
    const match = await createMatchFromSelections({
      matchNumber: body.matchNumber === undefined ? undefined : body.matchNumber === null || body.matchNumber === "" ? null : readInteger(body.matchNumber, "场序", 1, 99999),
      slug: readShortText(body.slug, "页面标识", 80),
      competitionId: readShortText(body.competitionId, "赛事", 64),
      stageId: body.stageId === undefined ? undefined : readShortText(body.stageId, "阶段", 64, false) || null,
    groupId: body.groupId === undefined ? undefined : readShortText(body.groupId, "分组", 64, false) || null,
    roundId: body.roundId === undefined ? undefined : readShortText(body.roundId, "轮次", 64, false) || null,
    stage: readShortText(body.stage, "比赛名称或轮次", 80),
      kickoff: readDate(body.kickoff, "比赛时间", false) ?? null,
      endAt: readDate(body.endAt, "比赛结束时间", false),
      venue: readShortText(body.venue, "比赛场地", 120, false) || null,
      round: readShortText(body.round, "轮次", 80, false),
      source: readEnum(body.source ?? "MANUAL", ["MANUAL", "FOOTBALL_CHINA"] as const, "数据来源"),
      externalMatchId: readShortText(body.externalMatchId, "外部比赛 ID", 120, false),
      homeTeamSelection: readShortText(
        body.homeTeamSelection ?? (legacyHomeTeamId ? `team:${legacyHomeTeamId}` : undefined),
        "主队",
        80,
      ),
      awayTeamSelection: readShortText(
        body.awayTeamSelection ?? (legacyAwayTeamId ? `team:${legacyAwayTeamId}` : undefined),
        "客队",
        80,
      ),
      status: readEnum(
        body.status,
        ["SCHEDULED", "COMPLETED", "CANCELLED"] as const,
        "比赛状态",
      ),
      applicationWindowStatus: readEnum(
        body.applicationWindowStatus,
        ["OPEN", "CLOSED"] as const,
        "报名窗口",
      ),
      applicationDeadline: readDate(body.applicationDeadline, "报名截止时间", false),
      publicNote: readShortText(body.publicNote, "公开说明", 500, false),
      internalNote: readShortText(body.internalNote, "内部备注", 500, false),
      positionCounts: readPositionCounts(body.positionCounts),
    }, actor);
    await revalidatePublicCompetitionById(match.competitionId);
    return NextResponse.json({ ok: true, matchId: match.id }, { status: 201 });
  } catch (error) {
    return refereeApiErrorResponse(error, "场次创建失败，请稍后重试。");
  }
}
