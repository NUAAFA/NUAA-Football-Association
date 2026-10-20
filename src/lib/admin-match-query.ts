import { Prisma } from "@/generated/prisma-v29/client";
import { prisma } from "@/lib/prisma";
import { parseBeijingDateTime } from "@/lib/beijing-datetime";
export type AdminQuery = Record<string, string | string[] | undefined>;
export function queryText(query: AdminQuery, key: string) { return typeof query[key] === "string" ? query[key].slice(0, 200) : ""; }
export function queryHref(root: string, query: AdminQuery, patch: Record<string, string | undefined>) {
  const values = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...query, ...patch })) if (typeof value === "string" && value) values.set(key, value);
  return `${root}?${values}`;
}
export function queryPage(value: string) { return /^[1-9]\d{0,6}$/.test(value) ? Number(value) : 1; }
export const appointmentQuickLabels = { pending: "赛前待选派", incomplete: "赛前未完整", conflict: "冲突待处理", published: "已发布", postmatch: "赛后待补录", completed: "已完赛·有执裁记录", review: "历史待核对" };
export const matchQuickLabels = { pending: "待排期", scheduled: "待赛", completed: "已完赛", cancelled: "已取消" };
function roundName(name: string) {
  const normalized = name.normalize("NFKC").replace(/\s+/g, "");
  const numbers: Record<string, string> = { 一: "1", 二: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9", 十: "10" };
  return normalized.replace(/^第([一二三四五六七八九十])轮$/, (_, n: string) => `第${numbers[n]}轮`);
}
export function logicalRounds<T extends { id: string; stageId: string; groupId: string | null; name: string; sortOrder: number }>(rounds: T[]) {
  const buckets = new Map<string, T[]>();
  for (const round of rounds) {
    const key = `${round.stageId}:${round.sortOrder}:${roundName(round.name)}`;
    buckets.set(key, [...(buckets.get(key) ?? []), round]);
  }
  return [...buckets].flatMap(([key, items]) => {
    // Equal text alone cannot merge two rounds of the same group or a stage-wide round.
    const unambiguous = items.length === 1 || (items.every(i => i.groupId !== null) && new Set(items.map(i => i.groupId)).size === items.length);
    return unambiguous ? [{ key, label: items[0].name, stageId: items[0].stageId, ids: items.map(i => i.id) }] : items.map(i => ({ key: `id:${i.id}`, label: `${i.name}（独立轮次）`, stageId: i.stageId, ids: [i.id] }));
  });
}
export async function getAdminMatchList(query: AdminQuery, mode: "matches" | "appointments", now = new Date()) {
  const competitions = await prisma.competition.findMany({ select: { id: true, name: true, status: true, year: true }, orderBy: [{ year: "desc" }, { name: "asc" }, { id: "asc" }] });
  const requested = queryText(query, "competition");
  const competition = requested === "all" ? "all" : competitions.find(c => c.id === requested)?.id ?? competitions.find(c => c.status === "ONGOING")?.id ?? competitions[0]?.id ?? "all";
  const stages = await prisma.competitionStage.findMany({ where: competition === "all" ? {} : { competitionId: competition }, select: { id: true, name: true, type: true, competitionId: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
  const requestedStage = queryText(query, "stage");
  const stage = requestedStage === "legacy" ? "legacy" : stages.find(s => s.id === requestedStage)?.id ?? "";
  const groups = await prisma.competitionGroup.findMany({ where: { stageId: { in: stage && stage !== "legacy" ? [stage] : stages.map(s => s.id) } }, select: { id: true, name: true, stageId: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }] });
  const rounds = logicalRounds(await prisma.competitionRound.findMany({ where: { stageId: { in: stage && stage !== "legacy" ? [stage] : stages.map(s => s.id) } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }] }));
  const round = queryText(query, "round") === "unassigned" ? "unassigned" : rounds.find(r => r.key === queryText(query, "round"))?.key ?? "";
  const group = queryText(query, "group") === "unassigned" ? "unassigned" : groups.find(g => g.id === queryText(query, "group"))?.id ?? "";
  const filters: Prisma.MatchWhereInput[] = [];
  if (competition !== "all") filters.push({ competitionId: competition });
  if (stage === "legacy") filters.push({ OR: [{ stageId: null }, { roundId: null }, { structureStage: { type: "GROUP" }, groupId: null }] });
  else if (stage) filters.push({ stageId: stage });
  if (round) filters.push(round === "unassigned" ? { roundId: null } : { roundId: { in: rounds.find(r => r.key === round)!.ids } });
  if (group) filters.push({ groupId: group === "unassigned" ? null : group });
  const q = queryText(query, "q").trim();
  if (q) filters.push({ OR: [{ homeTeam: { name: { contains: q } } }, { awayTeam: { name: { contains: q } } }, { stage: { contains: q } }, { round: { contains: q } }] });
  const date = queryText(query, "date");
  let dateError = "";
  if (date) { try { const start = parseBeijingDateTime(date, "比赛日期")!; filters.push({ kickoff: { gte: start, lt: new Date(start.getTime() + 86400000) } }); } catch { dateError = "日期无效，请使用真实北京自然日。"; filters.push({ id: { in: [] } }); } }
  const matchStatus = queryText(query, "matchStatus");
  if (["SCHEDULED", "COMPLETED", "CANCELLED"].includes(matchStatus)) filters.push({ status: matchStatus as "SCHEDULED" | "COMPLETED" | "CANCELLED" });
  const appointmentStatus = queryText(query, "appointmentStatus");
  if (appointmentStatus === "NONE") filters.push({ appointment: null });
  else if (["DRAFT", "PUBLISHED", "WITHDRAWN", "COMPLETED", "CANCELLED"].includes(appointmentStatus)) filters.push({ appointment: { status: appointmentStatus as "DRAFT" | "PUBLISHED" | "WITHDRAWN" | "COMPLETED" | "CANCELLED" } });
  const validCompleted: Prisma.MatchWhereInput = { status: "COMPLETED", kickoff: { lte: now }, homeScore: { not: null }, awayScore: { not: null }, resultConfirmedAt: { lte: now }, resultVersion: { gt: 0 }, OR: [{ endAt: null }, { endAt: { lte: now } }] };
  // Correlated aggregation is evaluated by SQLite before any LIMIT; no truncated in-memory filtering.
  const incompletePredicate = Prisma.sql`(SELECT COUNT(*) FROM "AppointmentPosition" p JOIN "RefereeAppointment" a ON a.id=p."appointmentId" WHERE a."matchId"=m.id AND p."refereeId" IS NOT NULL) < COALESCE((SELECT SUM(r.count) FROM "MatchPositionRequirement" r WHERE r."matchId"=m.id), CASE WHEN c.format IN ('FUTSAL','ELEVEN_A_SIDE') THEN 5 ELSE 0 END)`;
  // JSON is one bound parameter, avoiding SQLite's 999-parameter limit for large historical sets.
  const incomplete = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT m.id FROM "Match" m JOIN "Competition" c ON c.id=m."competitionId" WHERE m.status='SCHEDULED' AND (${competition === "all" ? Prisma.sql`1=1` : Prisma.sql`m."competitionId"=${competition}`}) AND (${incompletePredicate})`);
  const quicks: Record<string, Prisma.MatchWhereInput> = mode === "appointments" ? {
    pending: { status: "SCHEDULED", OR: [{ appointment: null }, { appointment: { status: { in: ["DRAFT", "WITHDRAWN"] } } }] },
    incomplete: { status: "SCHEDULED" },
    conflict: { appointment: { conflictReports: { some: { status: "PENDING" } } } },
    published: { status: "SCHEDULED", appointment: { status: "PUBLISHED" } },
    postmatch: { AND: [validCompleted, { OR: [{ appointment: null }, { appointment: { status: { in: ["DRAFT", "WITHDRAWN", "CANCELLED"] } } }] }] },
    completed: { AND: [validCompleted, { appointment: { status: "COMPLETED" } }] },
    review: { OR: [{ status: "COMPLETED", NOT: validCompleted }, { status: "COMPLETED", appointment: { status: "PUBLISHED" } }, { appointment: { status: "COMPLETED" }, NOT: validCompleted }] },
  } : {
    pending: { status: "SCHEDULED", OR: [{ kickoff: null }, { venue: null }, { venue: "" }] }, scheduled: { status: "SCHEDULED", kickoff: { not: null }, venue: { not: "" } }, completed: { status: "COMPLETED" }, cancelled: { status: "CANCELLED" },
  };
  const quick = Object.hasOwn(quicks, queryText(query, "quick")) ? queryText(query, "quick") : "";
  const baseWhere: Prisma.MatchWhereInput = { AND: filters };
  // An incomplete queue may contain arbitrarily many IDs. Resolve the structural filtered
  // candidate set in bounded ID batches without ever truncating to a display limit.
  const incompleteIds: string[] = [];
  for (let i = 0; i < incomplete.length; i += 400) {
    const rows = await prisma.match.findMany({ where: { AND: [baseWhere, { id: { in: incomplete.slice(i, i + 400).map(r => r.id) } }] }, select: { id: true } });
    incompleteIds.push(...rows.map(r => r.id));
  }
  const counts = Object.fromEntries(await Promise.all(Object.entries(quicks).map(async ([key, where]) => [key, key === "incomplete" ? incompleteIds.length : await prisma.match.count({ where: { AND: [...filters, where] } })])));
  const where: Prisma.MatchWhereInput = { AND: [...filters, ...(quick ? [quicks[quick]] : [])] };
  const total = quick === "incomplete" ? incompleteIds.length : await prisma.match.count({ where });
  const pages = Math.max(1, Math.ceil(total / 20)); const page = Math.min(queryPage(queryText(query, "page")), pages);
  let incompletePageIds: string[] | null = null;
  if (quick === "incomplete") {
    incompletePageIds = (await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT m.id FROM "Match" m WHERE m.id IN (SELECT value FROM json_each(${JSON.stringify(incompleteIds)})) ORDER BY m.kickoff DESC, m.id ASC LIMIT 20 OFFSET ${(page - 1) * 20}`)).map(r => r.id);
  }
  const matches = await prisma.match.findMany({ where: incompletePageIds ? { id: { in: incompletePageIds } } : where, skip: incompletePageIds ? 0 : (page - 1) * 20, take: 20, orderBy: [{ kickoff: "desc" }, { id: "asc" }], select: {
    id: true, kickoff: true, venue: true, stage: true, round: true, status: true, homeScore: true, awayScore: true, structureGroup: { select: { name: true } }, structureStage: { select: { name: true } }, structureRound: { select: { name: true } }, competition: { select: { name: true, format: true } }, homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } }, positionRequirements: { select: { count: true } }, appointment: { select: { status: true, recordSource: true, positions: { select: { refereeId: true } }, conflictReports: { where: { status: "PENDING" }, select: { id: true } } } },
  } });
  return { competitions, competition, stages, stage, groups, group, rounds, round, quick, counts, total, page, pages, matches, dateError, canonical: { ...query, competition, stage, round, group, quick } };
}
