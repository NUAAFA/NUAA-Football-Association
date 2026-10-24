import { NextResponse } from "next/server";

import { refereeApiErrorResponse, readRefereeApiJson, RefereeApiInputError } from "@/lib/referee-api";
import { authorizeRefereeMemberBusinessRequest } from "@/lib/referee-member-api";
import { reportAppointmentConflict } from "@/lib/referee-r1-service";
import { isRecord, readEnum, readShortText } from "@/lib/referee-validation";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authorization = await authorizeRefereeMemberBusinessRequest(request, { mutation: true });
    if (!authorization.ok) return authorization.response;
    const body = await readRefereeApiJson(request, "冲突报告格式不正确。");
    if (!isRecord(body)) throw new RefereeApiInputError("冲突报告格式不正确。");
    const { id } = await context.params;
    const expectedVersionId = readShortText(body.expectedVersionId, "任务版本，请刷新工作区", 100);
    await reportAppointmentConflict(
      id,
      authorization.session.refereeId,
      {
        reasonCode: readEnum(body.reasonCode, ["TIME_CONFLICT", "UNABLE_TO_ATTEND", "COURSE_EXAM", "HEALTH", "OTHER"] as const, "冲突原因"),
        explanation: readShortText(body.explanation, "补充说明", 500),
      },
      expectedVersionId,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return refereeApiErrorResponse(error, "报告失败，请稍后重试。");
  }
}
