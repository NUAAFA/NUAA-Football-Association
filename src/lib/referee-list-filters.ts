import type { CompetitionFormat, Prisma } from "@/generated/prisma-v29/client";
import { parseBeijingDateTime } from "@/lib/beijing-datetime";

export type RefereeListSearchParams = Record<string, string | string[] | undefined>;
export type RefereeListFilters = {
  competition: string;
  format: CompetitionFormat | "";
  from: string;
  to: string;
  q: string;
  after: string;
  cursor?: { at: string; distance: number; id: string };
  error?: string;
};
export const refereeListPageSize = 3;

export function refereeListFilters(params: RefereeListSearchParams): RefereeListFilters {
  let error: string | undefined;
  const read = (key: string, max = 120) => {
    const value = params[key];
    if (value === undefined) return "";
    if (typeof value !== "string" || value.length > max) {
      error = "筛选条件格式不正确，请重新选择。";
      return "";
    }
    return value.trim();
  };
  const competition = read("competition");
  const rawFormat = read("format");
  const format = ["ELEVEN_A_SIDE", "FUTSAL", "CUSTOM"].includes(rawFormat) ? rawFormat as CompetitionFormat : "";
  if (rawFormat && !format) error = "请选择有效赛制。";
  const from = read("from"), to = read("to"), q = read("q", 100);
  try {
    for (const date of [from, to].filter(Boolean)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error();
      parseBeijingDateTime(date, "比赛日期");
    }
    if (from && to && from > to) throw new Error();
  } catch {
    error = "请填写有效的比赛日期，开始日期不能晚于结束日期。";
  }
  const after = read("after", 1024);
  let cursor: RefereeListFilters["cursor"];
  if (after) {
    try {
      const value = JSON.parse(Buffer.from(after, "base64url").toString("utf8"));
      const anchor = Date.parse(value.at);
      if (typeof value.at !== "string" || !Number.isFinite(anchor) || anchor < Date.UTC(1900, 0, 1) || anchor > Date.UTC(2201, 0, 1) ||
          !Number.isSafeInteger(value.distance) || value.distance < 0 || value.distance > 10_000_000_000_000 ||
          typeof value.id !== "string" || !value.id || value.id.length > 120) throw new Error();
      cursor = { at: new Date(anchor).toISOString(), distance: value.distance, id: value.id };
    } catch { error = "加载位置已失效，请清除筛选后重新查看。"; }
  }
  return { competition, format, from, to, q, after, cursor, error };
}

export function refereeMatchFilters(filters: RefereeListFilters): Prisma.MatchWhereInput {
  if (filters.error) return { id: { in: [] } };
  const from = parseBeijingDateTime(filters.from, "比赛日期");
  const to = parseBeijingDateTime(filters.to, "比赛日期");
  return {
    ...(filters.competition ? { competitionId: filters.competition } : {}),
    ...(filters.format ? { competition: { format: filters.format } } : {}),
    ...(from || to ? { kickoff: { ...(from ? { gte: from } : {}), ...(to ? { lt: new Date(to.getTime() + 86_400_000) } : {}) } } : {}),
  };
}

export function refereeListHref(base: string, filters: RefereeListFilters, after: string | null) {
  const params = new URLSearchParams();
  for (const key of ["competition", "format", "from", "to", "q"] as const) {
    if (filters[key]) params.set(key, filters[key]);
  }
  if (after) params.set("after", after);
  return `${base}${params.size ? `?${params}` : ""}#referee-results`;
}
