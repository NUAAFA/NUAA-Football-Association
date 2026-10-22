import { readBoundedJson } from "@/lib/bounded-json";
import { NextResponse } from "next/server";
import { authorizeLegacyAdminRequest } from "@/lib/legacy-admin-authorization";
import { refereeApiErrorResponse, RefereeApiInputError } from "@/lib/referee-api";
import { setRefereeGrade } from "@/lib/referee-grade-service";
import { gradeModes } from "@/lib/referee-grade";
import { isRecord, readEnum, readShortText } from "@/lib/referee-validation";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeLegacyAdminRequest(request, "referees:write");
  if (!auth.ok) return auth.response;
  try {
    const body: unknown = await readBoundedJson(request);
    if (!isRecord(body)) throw new RefereeApiInputError("年级配置格式无效。");
    await setRefereeGrade(readShortText((await context.params).id, "裁判员", 64), { mode: readEnum(body.mode, gradeModes, "计算方式"), grade: readShortText(body.grade, "人工年级", 20, false), reason: readShortText(body.reason, "调整原因", 500), expectedUpdatedAt: readShortText(body.expectedUpdatedAt, "档案版本", 40) }, auth.authorization);
    return NextResponse.json({ ok: true });
  } catch (error) { return refereeApiErrorResponse(error, "年级设置保存失败。"); }
}
