import { Prisma } from "@/generated/prisma-v29/client";
import { prisma } from "@/lib/prisma";

export type AvailabilityKindFilter = "AVAILABLE" | "UNAVAILABLE" | "";
function dayStart(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00+08:00`)) ? new Date(`${value}T00:00:00+08:00`) : null; }
export async function getAdminAvailabilityPage(input: { refereeId?: string; date?: string; kind?: AvailabilityKindFilter; page?: number }) {
  const start = dayStart(input.date ?? "");
  const end = start && new Date(start.getTime() + 86400000);
  const where: Prisma.RefereeAvailabilityWhereInput = {
    referee: { status: { not: "ARCHIVED" } },
    ...(input.refereeId ? { refereeId: input.refereeId } : {}),
    ...(input.kind ? { kind: input.kind } : {}),
    ...(start && end ? { startAt: { lt: end }, endAt: { gt: start } } : {}),
  };
  const total = await prisma.referee.count({ where: { status: { not: "ARCHIVED" }, ...(input.refereeId ? { id: input.refereeId } : {}), availability: { some: where } } });
  const pageSize = 30, totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(totalPages, Math.max(1, Number.isSafeInteger(input.page) ? input.page! : 1));
  const groups = await prisma.refereeAvailability.groupBy({ by: ["refereeId"], where, _max: { updatedAt: true }, _count: { _all: true }, orderBy: [{ _max: { updatedAt: "desc" } }, { refereeId: "asc" }], skip: (page - 1) * pageSize, take: pageSize });
  const ids = groups.map((g) => g.refereeId);
  const daySql = `
    WITH RECURSIVE windows(refereeId, kind, day, lastDay) AS (
      SELECT refereeId, kind,
        date((CASE WHEN typeof(startAt) = 'integer' THEN startAt ELSE unixepoch(startAt) * 1000 END) / 1000, 'unixepoch', '+8 hours'),
        date(((CASE WHEN typeof(endAt) = 'integer' THEN endAt ELSE unixepoch(endAt) * 1000 END) - 1) / 1000, 'unixepoch', '+8 hours')
      FROM RefereeAvailability WHERE refereeId IN (${ids.map(() => "?").join(",")})
      ${input.kind ? "AND kind = ?" : ""}
      ${start && end ? "AND (CASE WHEN typeof(startAt) = 'integer' THEN startAt ELSE unixepoch(startAt) * 1000 END) < ? AND (CASE WHEN typeof(endAt) = 'integer' THEN endAt ELSE unixepoch(endAt) * 1000 END) > ?" : ""}
      UNION ALL SELECT refereeId, kind, date(day, '+1 day'), lastDay FROM windows WHERE day < lastDay
    )
    SELECT refereeId, COUNT(DISTINCT day) AS days,
      COUNT(DISTINCT CASE WHEN kind = 'AVAILABLE' THEN day END) AS availableDays,
      COUNT(DISTINCT CASE WHEN kind = 'UNAVAILABLE' THEN day END) AS unavailableDays
    FROM windows GROUP BY refereeId`;
  const dayParams: Array<string | number> = [...ids, ...(input.kind ? [input.kind] : []), ...(start && end ? [end.getTime(), start.getTime()] : [])];
  const [referees, kinds, dateRecords, days] = ids.length ? await Promise.all([
    prisma.referee.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, publicCode: true } }),
    prisma.refereeAvailability.groupBy({ by: ["refereeId", "kind"], where: { ...where, refereeId: { in: ids } }, _count: { _all: true } }),
    start && end ? prisma.refereeAvailability.findMany({ where: { ...where, refereeId: { in: ids } }, orderBy: [{ startAt: "asc" }, { id: "asc" }], select: { id: true, refereeId: true, kind: true, startAt: true, endAt: true, competitionFormat: true, note: true } }) : Promise.resolve([]),
    // Expand dates only for the current page, in SQL. This counts distinct Beijing calendar days, including multi-day windows.
    prisma.$queryRawUnsafe<Array<{ refereeId: string; days: bigint; availableDays: bigint; unavailableDays: bigint }>>(daySql, ...dayParams)
  ]) : [[], [], [], []] as const;
  const refById = new Map(referees.map((r) => [r.id, r]));
  const daysById = new Map(days.map((d) => [d.refereeId, d]));
  const items = groups.map((g) => ({ id: g.refereeId, referee: refById.get(g.refereeId)!, recordCount: g._count._all,
    filledDays: start ? 1 : Number(daysById.get(g.refereeId)?.days ?? 0), availableDays: start ? kinds.some((k) => k.refereeId === g.refereeId && k.kind === "AVAILABLE") ? 1 : 0 : Number(daysById.get(g.refereeId)?.availableDays ?? 0), unavailableDays: start ? kinds.some((k) => k.refereeId === g.refereeId && k.kind === "UNAVAILABLE") ? 1 : 0 : Number(daysById.get(g.refereeId)?.unavailableDays ?? 0),
    availableRecords: kinds.find((k) => k.refereeId === g.refereeId && k.kind === "AVAILABLE")?._count._all ?? 0,
    unavailableRecords: kinds.find((k) => k.refereeId === g.refereeId && k.kind === "UNAVAILABLE")?._count._all ?? 0,
    updatedAt: g._max.updatedAt, dateRecords: dateRecords.filter((r) => r.refereeId === g.refereeId) }));
  return { items, total, page, pageSize, totalPages, date: start ? input.date! : "" };
}
export async function getAdminAvailabilityDetail(refereeId: string, input: { date?: string; kind?: AvailabilityKindFilter; page?: number }) {
  const start = dayStart(input.date ?? ""), end = start && new Date(start.getTime() + 86400000);
  const where: Prisma.RefereeAvailabilityWhereInput = { refereeId, ...(input.kind ? { kind: input.kind } : {}), ...(start && end ? { startAt: { lt: end }, endAt: { gt: start } } : {}) };
  const [referee, total] = await Promise.all([prisma.referee.findUnique({ where: { id: refereeId }, select: { id: true, name: true, publicCode: true, status: true } }), prisma.refereeAvailability.count({ where })]);
  if (!referee || referee.status === "ARCHIVED") return null;
  const pageSize = 20, totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(totalPages, Math.max(1, Number.isSafeInteger(input.page) ? input.page! : 1));
  const records = await prisma.refereeAvailability.findMany({ where, orderBy: [{ startAt: "asc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize,
    select: { id: true, refereeId: true, kind: true, startAt: true, endAt: true, competitionFormat: true, note: true } });
  return { referee, records, total, page, pageSize, totalPages };
}
