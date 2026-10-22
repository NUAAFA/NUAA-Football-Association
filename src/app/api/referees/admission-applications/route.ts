import { readBoundedJson } from "@/lib/bounded-json";
import { consumePublicRequestBudget } from "@/lib/request-budget";
import { NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/referee-auth";
import { submitRefereeAdmissionApplication } from "@/lib/referee-admission-service";
import { refereeApiErrorResponse } from "@/lib/referee-api";
import { getAdmissionRateLimitKey } from "@/lib/referee-security";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  }

  try {
    await consumePublicRequestBudget("admission", request);
    const body = await readBoundedJson(request);
    await submitRefereeAdmissionApplication(body, {
      rateLimitKey: getAdmissionRateLimitKey(request),
    });
    // Neither duplicate state nor another applicant's record ID is disclosed.
    return NextResponse.json({ ok: true, status: "PENDING" }, { status: 201 });
  } catch (error) {
    return refereeApiErrorResponse(
      error,
      "申请提交失败，请稍后重试。",
      { includeInternalCode: false },
    );
  }
}
