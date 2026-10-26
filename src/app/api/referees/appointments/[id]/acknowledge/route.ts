import { NextResponse } from "next/server";

import { refereeApiErrorResponse, readRefereeApiJson, RefereeApiInputError } from "@/lib/referee-api";
import { authorizeRefereeMemberBusinessRequest } from "@/lib/referee-member-api";
import { acknowledgeAppointment } from "@/lib/referee-r1-service";
import { isRecord, readShortText } from "@/lib/referee-validation";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authorization = await authorizeRefereeMemberBusinessRequest(request, { mutation: true });
    if (!authorization.ok) return authorization.response;
    const body = await readRefereeApiJson(request, "请刷新工作区后重新确认任务版本。");
    if (!isRecord(body)) throw new RefereeApiInputError("请刷新工作区后重新确认任务版本。");
    const expectedVersionId = readShortText(body.expectedVersionId, "任务版本，请刷新工作区", 100);
    const { id } = await context.params;
    await acknowledgeAppointment(id, authorization.session.refereeId, expectedVersionId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return refereeApiErrorResponse(error, "确认失败，请稍后重试。");
  }
}
