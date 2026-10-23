import { readBoundedJson } from "@/lib/bounded-json";
import { NextResponse } from "next/server";

import { authorizeLegacyAdminRequest } from "@/lib/legacy-admin-authorization";
import { revalidatePublicCompetitionPaths } from "@/lib/public-competition-revalidation";
import { refereeApiErrorResponse } from "@/lib/referee-api";
import { readCompetitionCreateInput } from "@/lib/referee-competition-input";
import { createCompetition } from "@/lib/referee-competition-service";

export async function POST(request: Request) {
  const authorization = await authorizeLegacyAdminRequest(request, "competitions:write");
  if (!authorization.ok) return authorization.response;
  try {
    const competition = await createCompetition(
      readCompetitionCreateInput(await readBoundedJson(request)),
      authorization.actor,
    );
    revalidatePublicCompetitionPaths(competition.slug);
    return NextResponse.json({ ok: true, competitionId: competition.id }, { status: 201 });
  } catch (error) {
    return refereeApiErrorResponse(error, "赛事创建失败，请稍后重试。");
  }
}
