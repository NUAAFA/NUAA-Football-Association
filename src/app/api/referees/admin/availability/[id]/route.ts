import { NextResponse } from "next/server";
import { authorizeLegacyAdminRequest } from "@/lib/legacy-admin-authorization";
import { getAdminAvailabilityCalendar, getAdminAvailabilityDetail } from "@/lib/admin-availability-page";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeLegacyAdminRequest(request, "referees:read", { mutation: false });
  if (!authorization.ok) return authorization.response;
  const query = new URL(request.url).searchParams;
  const month = query.get("month");
  if (month !== null) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: "月份格式不正确。" }, { status: 400 });
    const result = await getAdminAvailabilityCalendar((await context.params).id, month);
    return result ? NextResponse.json(result) : NextResponse.json({ error: "裁判员不存在。" }, { status: 404 });
  }
  const kind = query.get("kind");
  const result = await getAdminAvailabilityDetail((await context.params).id, { date: query.get("date") ?? "", kind: kind === "AVAILABLE" || kind === "UNAVAILABLE" ? kind : "", page: Number(query.get("page") ?? 1) });
  return result ? NextResponse.json(result) : NextResponse.json({ error: "裁判员不存在。" }, { status: 404 });
}
