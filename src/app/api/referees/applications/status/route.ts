import { NextResponse } from "next/server";

import { refereeApiErrorResponse } from "@/lib/referee-api";
import { authorizeRefereeMemberBusinessRequest } from "@/lib/referee-member-api";
import { getRefereeApplicationSubmissionState } from "@/lib/referee-submission-state";
import { readShortText } from "@/lib/referee-validation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let response: NextResponse;
  try {
    const authorization = await authorizeRefereeMemberBusinessRequest(request);
    if (!authorization.ok) response = authorization.response;
    else {
      const matchId = readShortText(new URL(request.url).searchParams.get("matchId"), "比赛", 64);
      response = NextResponse.json(await getRefereeApplicationSubmissionState(matchId, authorization.session.refereeId));
    }
  } catch (error) { response = refereeApiErrorResponse(error, "暂时无法核对报名结果，请稍后重试。"); }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
