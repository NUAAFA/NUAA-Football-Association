import { NextResponse } from "next/server";

import { refereeApiErrorResponse } from "@/lib/referee-api";
import { authorizeRefereeMemberBusinessRequest } from "@/lib/referee-member-api";
import { getRefereeTaskSubmissionState } from "@/lib/referee-submission-state";
import { readShortText } from "@/lib/referee-validation";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  let response: NextResponse;
  try {
    const authorization = await authorizeRefereeMemberBusinessRequest(request);
    if (!authorization.ok) response = authorization.response;
    else {
      const { id } = await context.params;
      const expected = readShortText(new URL(request.url).searchParams.get("versionId"), "任务版本，请刷新工作区", 100);
      response = NextResponse.json(await getRefereeTaskSubmissionState(id, authorization.session.refereeId, expected));
    }
  } catch (error) { response = refereeApiErrorResponse(error, "暂时无法核对任务结果，请稍后重试。"); }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
