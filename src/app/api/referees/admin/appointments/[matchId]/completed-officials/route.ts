import { NextResponse } from "next/server";
import { authorizeLegacyAdminRequest } from "@/lib/legacy-admin-authorization";
import { refereeApiErrorResponse, RefereeApiInputError } from "@/lib/referee-api";
import { recordCompletedOfficials } from "@/lib/completed-officials-service";
import { isRecord, readBoolean, readEnum, readInteger, readPositionAssignments, readShortText } from "@/lib/referee-validation";
export async function POST(request: Request, context: { params: Promise<{ matchId: string }> }) {
  const authorization = await authorizeLegacyAdminRequest(request, "referees:write");
  if (!authorization.ok) return authorization.response;
  try {
    const body: unknown = await request.json();
    if (!isRecord(body)) throw new RefereeApiInputError("补录内容格式不正确。");
    const result = await recordCompletedOfficials({
      matchId: readShortText((await context.params).matchId, "场次", 64),
      action: readEnum(body.action, ["record", "correct"] as const, "操作"),
      expectedAppointmentRevision: readInteger(body.expectedAppointmentRevision, "执裁版本", 0, 2147483647),
      expectedResultVersion: readInteger(body.expectedResultVersion, "赛果版本", 0, 2147483647),
      reason: readShortText(body.reason, "补录 / 更正原因", 500),
      verificationReason: readShortText(body.verificationReason, "核实依据", 1000, false),
      publicHistoryVisible: readBoolean(body.publicHistoryVisible, "公开历史确认"),
      positions: readPositionAssignments(body.positions),
    }, authorization.authorization);
    return NextResponse.json({ ok: true, revision: result.appointment.revision, warnings: result.warnings, currentExceptions: result.currentExceptions });
  } catch (error) { return refereeApiErrorResponse(error, "赛后执裁记录保存失败，请稍后重试。"); }
}
