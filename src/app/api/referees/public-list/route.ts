import { refereeListFilters, type RefereeListSearchParams } from "@/lib/referee-list-filters";
import { getPublicRefereeList } from "@/lib/referee-public-list-view";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const headers = { "Cache-Control": "no-store" };
  if (kind !== "assignments" && kind !== "history" && kind !== "open-matches") {
    return Response.json({ error: "请选择有效的比赛列表。" }, { status: 400, headers });
  }
  const params: RefereeListSearchParams = {};
  for (const key of url.searchParams.keys()) {
    const values = url.searchParams.getAll(key);
    params[key] = values.length > 1 ? values : values[0];
  }
  const filters = refereeListFilters(params);
  if (filters.error) return Response.json({ error: filters.error }, { status: 400, headers });
  try {
    const { items, total, nextCursor } = await getPublicRefereeList(kind, filters);
    return Response.json({ items, total, nextCursor }, { headers });
  } catch {
    return Response.json({ error: "暂时无法加载比赛，请稍后重试。" }, { status: 503, headers });
  }
}
