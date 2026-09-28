import { NextResponse } from "next/server";
import { readCompetitionImportRequest } from "@/lib/competition-import-parser";
import { authorizeUnifiedAdminRequest } from "@/lib/unified-admin-api";
import { competitionImportErrorResponse } from "@/lib/competition-import-api";
export async function POST(request: Request) {
  try {
    await authorizeUnifiedAdminRequest(request, "competitions:write", { mutation: true });
    const input = await readCompetitionImportRequest(request);
    return NextResponse.json({ columns: input.columns, samples: input.samples });
  } catch (error) { return competitionImportErrorResponse(error, "对应列读取失败。"); }
}
