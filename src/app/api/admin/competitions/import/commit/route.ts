import { CompetitionImportParseError } from "@/lib/competition-import-parser";
import { revalidatePublicCompetitionById } from "@/lib/public-competition-revalidation";
import { NextResponse } from "next/server";

import { competitionImportErrorResponse } from "@/lib/competition-import-api";
import { readCompetitionImportRequest } from "@/lib/competition-import-parser";
import { commitCompetitionImport } from "@/lib/competition-import-service";
import { authorizeUnifiedAdminServiceRequest } from "@/lib/unified-admin-api";

export async function POST(request: Request) {
  try {
    const { authorization } = await authorizeUnifiedAdminServiceRequest(
      request,
      "competitions:write",
      { mutation: true },
    );
    const input = await readCompetitionImportRequest(request);
    if (!input.expectedPlanHash) throw new CompetitionImportParseError("请先检查导入内容并确认当前批次。");
    const result = await commitCompetitionImport(input, authorization);
    await revalidatePublicCompetitionById(input.competitionId);
    return NextResponse.json({ result }, { status: 201 });
  } catch (error) {
    return competitionImportErrorResponse(error, "赛事导入提交失败，请稍后重试。");
  }
}
