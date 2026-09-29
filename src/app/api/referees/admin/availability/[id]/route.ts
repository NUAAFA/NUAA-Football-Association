import { NextResponse } from "next/server";
import { authorizeLegacyAdminRequest } from "@/lib/legacy-admin-authorization";
import { getAdminAvailabilityDetail } from "@/lib/admin-availability-page";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeLegacyAdminRequest(request, "referees:read");
  if (!authorization.ok) return authorization.response;
  const query = new URL(request.url).searchParams;
  const kind = query.get("kind");
  const result = await getAdminAvailabilityDetail((await context.params).id, { date: query.get("date") ?? "", kind: kind === "AVAILABLE" || kind === "UNAVAILABLE" ? kind : "", page: Number(query.get("page") ?? 1) });
  return result ? NextResponse.json(result) : NextResponse.json({ error: "裁判员不存在。" }, { status: 404 });
}
