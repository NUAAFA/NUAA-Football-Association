import { readBoundedJson } from "@/lib/bounded-json";
import { NextResponse } from "next/server";

import { createOnboardedRefereeAccount } from "@/lib/referee-admission-service";
import { isRecord, readShortText } from "@/lib/referee-validation";
import {
  authorizeUnifiedAdminRequest,
  UnifiedAdminInputError,
  unifiedAdminErrorResponse,
} from "@/lib/unified-admin-api";

export async function POST(request: Request) {
  try {
    const actor = await authorizeUnifiedAdminRequest(request, "referees:write", { mutation: true });
    const body: unknown = await readBoundedJson(request);
    if (!isRecord(body)) throw new UnifiedAdminInputError("账号内容格式不正确。");
    const onboarding = await createOnboardedRefereeAccount({
      name: readShortText(body.name, "姓名", 48),
      studentId: readShortText(body.studentId, "学号", 32),
    }, actor);
    return NextResponse.json({ ok: true, refereeId: onboarding.refereeId, onboarding }, { status: 201 });
  } catch (error) {
    return unifiedAdminErrorResponse(error, "账号创建失败，请稍后重试。");
  }
}
