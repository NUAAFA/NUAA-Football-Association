import { readBoundedJson } from "@/lib/bounded-json";
import { NextResponse } from "next/server";

import { authorizeLegacyAdminRequest } from "@/lib/legacy-admin-authorization";
import { revalidatePublicCompetitionPaths, revalidatePublicTeamDirectory } from "@/lib/public-competition-revalidation";
import { refereeApiErrorResponse, RefereeApiInputError } from "@/lib/referee-api";
import { readCompetitionUpdateInput } from "@/lib/referee-competition-input";
import { deleteCompetitionSafely, updateCompetition } from "@/lib/referee-competition-service";
import { isRecord, readShortText } from "@/lib/referee-validation";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = await authorizeLegacyAdminRequest(request, "competitions:write");
  if (!authorization.ok) return authorization.response;
  try {
    const { id } = await context.params;
    const competition = await updateCompetition(
      id,
      readCompetitionUpdateInput(await readBoundedJson(request)),
      authorization.actor,
    );
    revalidatePublicCompetitionPaths(competition.slug);
    revalidatePublicTeamDirectory();
    return NextResponse.json({ ok: true, competitionId: competition.id });
  } catch (error) {
    return refereeApiErrorResponse(error, "赛事更新失败，请稍后重试。");
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = await authorizeLegacyAdminRequest(request, "competitions:write");
  if (!authorization.ok) return authorization.response;
  try {
    const body: unknown = await readBoundedJson(request);
    if (!isRecord(body)) throw new RefereeApiInputError("删除内容格式不正确。");
    const { id } = await context.params;
    const deleted = await deleteCompetitionSafely(
      id,
      readShortText(body.confirmationName, "赛事名称确认", 120),
      authorization.authorization,
    );
    revalidatePublicCompetitionPaths(deleted.slug);
    revalidatePublicTeamDirectory();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return refereeApiErrorResponse(error, "赛事删除失败，请稍后重试。");
  }
}
