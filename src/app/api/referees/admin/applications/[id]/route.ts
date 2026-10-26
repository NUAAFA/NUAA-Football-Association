import { readBoundedJson } from "@/lib/bounded-json";
import { NextResponse } from "next/server";
import { authorizeLegacyAdminRequest } from "@/lib/legacy-admin-authorization";
import { refereeApiErrorResponse, RefereeApiInputError } from "@/lib/referee-api";
import { reviewApplication } from "@/lib/referee-service";
import { isRecord, readEnum, readShortText } from "@/lib/referee-validation";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = await authorizeLegacyAdminRequest(request, "referees:write");
  if (!authorization.ok) return authorization.response;
  try {
    const body: unknown = await readBoundedJson(request);
    if (!isRecord(body)) throw new RefereeApiInputError("审核内容格式不正确。" );
    const { id } = await context.params;
    await reviewApplication(
      id,
      readEnum(
        body.status,
        ["PENDING", "REVIEWING", "APPROVED", "REJECTED"] as const,
        "审核状态",
      ),
      readShortText(body.reviewNote, "审核备注", 240, false),
      authorization.authorization,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return refereeApiErrorResponse(error, "审核失败，请稍后重试。");
  }
}
