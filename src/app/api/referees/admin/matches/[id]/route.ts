import { NextResponse } from "next/server";

import { authorizeLegacyAdminRequest } from "@/lib/legacy-admin-authorization";
import { prisma } from "@/lib/prisma";
import { revalidatePublicCompetitionById } from "@/lib/public-competition-revalidation";
import { refereeApiErrorResponse, RefereeApiInputError } from "@/lib/referee-api";
import {
  createMatch,
  deleteMatchSafely,
  RefereeServiceError,
  updateMatch,
} from "@/lib/referee-service";
import {
  isRecord,
  positionKeys,
  readDate,
  readEnum,
  readInteger,
  readShortText,
} from "@/lib/referee-validation";

async function authorize(request: Request) {
  const authorization = await authorizeLegacyAdminRequest(request, "competitions:write");
  return authorization.ok ? authorization : authorization.response;
}

function counts(value: unknown) {
  if (!isRecord(value)) throw new RefereeApiInputError("岗位人数格式不正确。");
  return Object.fromEntries(
    positionKeys.map((key) => [
      key,
      readInteger(value[key] ?? 0, `${key} 人数`, 0, 5),
    ]),
  );
}

function inputFromBody(body: Record<string, unknown>) {
  return {
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
    homeTeamId: readShortText(body.homeTeamId, "主队", 64),
    awayTeamId: readShortText(body.awayTeamId, "客队", 64),
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
    cancellationReason: readShortText(body.cancellationReason, "取消原因", 240, false),
    structureChangeReason: readShortText(body.structureChangeReason, "重新归类原因", 500, false),
    positionCounts: counts(body.positionCounts),
  };
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = await authorize(request);
  if (authorization instanceof Response) return authorization;
  try {
    const body: unknown = await request.json();
    if (!isRecord(body)) throw new RefereeApiInputError("场次内容格式不正确。");
    const { id } = await context.params;
    const match = await updateMatch(id, inputFromBody(body), authorization.actor);
    await revalidatePublicCompetitionById(match.competitionId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return refereeApiErrorResponse(error, "场次更新失败，请稍后重试。");
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = await authorize(request);
  if (authorization instanceof Response) return authorization;
  try {
    const body: unknown = await request.json();
    if (!isRecord(body) || body.action !== "copy") throw new RefereeApiInputError("操作格式不正确。");
    const { id } = await context.params;
    const source = await prisma.match.findUnique({
      where: { id },
      include: { positionRequirements: true },
    });
    if (!source) throw new RefereeServiceError("比赛不存在。", 404);
    const copied = await createMatch({
      matchNumber: body.matchNumber === undefined ? undefined : body.matchNumber === null || body.matchNumber === "" ? null : readInteger(body.matchNumber, "场序", 1, 99999),
      slug: readShortText(body.slug, "新页面标识", 80),
      competitionId: source.competitionId,
      stage: readShortText(body.stage, "新比赛名称或轮次", 80),
      stageId: source.stageId, groupId: source.groupId, roundId: source.roundId,
      kickoff: readDate(body.kickoff, "新比赛时间")!,
      endAt: undefined,
      venue: source.venue,
      round: source.round ?? undefined,
      source: "MANUAL",
      homeTeamId: source.homeTeamId,
      awayTeamId: source.awayTeamId,
      status: "SCHEDULED",
      applicationWindowStatus: "CLOSED",
      publicNote: source.publicNote ?? undefined,
      internalNote: source.internalNote ?? undefined,
      positionCounts: Object.fromEntries(
        source.positionRequirements.map((item) => [item.key, item.count]),
      ),
    }, authorization.actor);
    await revalidatePublicCompetitionById(copied.competitionId);
    return NextResponse.json({ ok: true, matchId: copied.id }, { status: 201 });
  } catch (error) {
    return refereeApiErrorResponse(error, "场次复制失败，请稍后重试。");
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = await authorize(request);
  if (authorization instanceof Response) return authorization;
  try {
    const body: unknown = await request.json();
    if (!isRecord(body)) throw new RefereeApiInputError("删除内容格式不正确。");
    const { id } = await context.params;
    const deleted = await deleteMatchSafely(
      id,
      readShortText(body.reason, "删除原因", 240),
      authorization.authorization,
    );
    await revalidatePublicCompetitionById(deleted.competitionId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return refereeApiErrorResponse(error, "比赛删除失败，请稍后重试。");
  }
}
