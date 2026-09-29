import { NextResponse } from "next/server";
import { getKnockoutResultCandidates } from "@/lib/competition-knockout-candidates";
import { authorizeUnifiedAdminRequest, unifiedAdminErrorResponse } from "@/lib/unified-admin-api";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await authorizeUnifiedAdminRequest(request, "competitions:read");
    const query = new URL(request.url).searchParams;
    return NextResponse.json(await getKnockoutResultCandidates((await context.params).id, query.get("roundId") ?? "", Number(query.get("page") ?? 1)));
  } catch (error) { return unifiedAdminErrorResponse(error, "候选球队读取失败。"); }
}
