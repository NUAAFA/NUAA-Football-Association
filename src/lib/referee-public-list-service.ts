import { refereeContinuationSize } from "@/types/referee-public-list";
import type { Prisma } from "@/generated/prisma-v29/client";
import { prisma } from "@/lib/prisma";
import { publicAppointmentSelect, publicHistoricalAppointmentWhere, publicUpcomingAppointmentWhere } from "@/lib/referee-public";
import { refereeListPageSize, refereeMatchFilters, type RefereeListFilters } from "@/lib/referee-list-filters";

const competitionSelect = { id: true, name: true, format: true, playingFormat: true } as const;
const competitionOrder = [{ name: "asc" }, { id: "asc" }] satisfies Prisma.CompetitionOrderByWithRelationInput[];

// A cursor fixes the reference time for the whole scroll session. Each side of
// that time reads only one bounded look-ahead; old pending matches cannot jump the queue.
function nearestCursor(filters: RefereeListFilters, now: Date) {
  const at = filters.cursor?.at ?? now.toISOString();
  return { at, anchor: new Date(at).getTime(), last: filters.cursor };
}

function boundary(filters: RefereeListFilters, now: Date, future: boolean) {
  const { anchor, last } = nearestCursor(filters, now);
  return { anchor: new Date(anchor), time: new Date(anchor + (future ? 1 : -1) * (last?.distance ?? 0)), last };
}

function finishBatch<T extends { id: string }>(rows: T[], filters: RefereeListFilters, now: Date, kickoff: (row: T) => Date | null, size: number) {
  const { at, anchor } = nearestCursor(filters, now);
  const distance = (row: T) => Math.abs(kickoff(row)!.getTime() - anchor);
  rows.sort((a, b) => distance(a) - distance(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const items = rows.slice(0, size);
  const last = items.at(-1);
  return { items, pageSize: size, nextCursor: rows.length > size && last
    ? Buffer.from(JSON.stringify({ at, distance: distance(last), id: last.id })).toString("base64url") : null };
}

// Keep upcoming fixtures first and chronological within each bucket. Retain
// the original anchor throughout continuation; a time boundary cannot duplicate rows.
function chronologicalBoundary(filters: RefereeListFilters, now: Date, future: boolean) {
  const at = filters.cursor?.at ?? now.toISOString();
  const anchor = new Date(at);
  const last = filters.cursor?.bucket === (future ? "upcoming" : "overdue") ? filters.cursor : undefined;
  return { at, skip: future && filters.cursor?.bucket === "overdue", anchor, last,
    time: last ? new Date(Date.UTC(1900, 0, 1) + last.distance) : anchor };
}

function finishChronological<T extends { id: string }>(rows: T[], filters: RefereeListFilters, now: Date, kickoff: (row: T) => Date | null, size: number) {
  const at = filters.cursor?.at ?? now.toISOString();
  const anchor = Date.parse(at);
  rows.sort((a, b) => Number(kickoff(a)!.getTime() < anchor) - Number(kickoff(b)!.getTime() < anchor)
    || kickoff(a)!.getTime() - kickoff(b)!.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const items = rows.slice(0, size), last = items.at(-1);
  return { items, pageSize: size, nextCursor: rows.length > size && last
    ? Buffer.from(JSON.stringify({ at, distance: kickoff(last)!.getTime() - Date.UTC(1900, 0, 1), id: last.id,
      bucket: kickoff(last)!.getTime() >= anchor ? "upcoming" : "overdue" })).toString("base64url") : null };
}

export async function getPublicAppointmentPage(kind: "assignments" | "history", filters: RefereeListFilters, now = new Date()) {
  const base = kind === "history" ? publicHistoricalAppointmentWhere(now) : publicUpcomingAppointmentWhere();
  const where: Prisma.RefereeAppointmentWhereInput = { AND: [
    base,
    { match: refereeMatchFilters(filters) },
    ...(filters.q ? [{ OR: [
      { match: { OR: [{ homeTeam: { name: { contains: filters.q } } }, { awayTeam: { name: { contains: filters.q } } }] } },
      { positions: { some: { referee: { name: { contains: filters.q } } } } },
    ] }] : []),
  ] };
  const chronological = kind === "assignments" && (!filters.cursor || !!filters.cursor.bucket);
  return prisma.$transaction(async (tx) => {
    const total = await tx.refereeAppointment.count({ where });
    const size = filters.cursor ? refereeContinuationSize : refereeListPageSize;
    const sides = [];
    for (const future of [true, false]) {
      const position = chronological ? chronologicalBoundary(filters, now, future) : boundary(filters, now, future);
      if ("skip" in position && position.skip) continue;
      const { anchor, time, last } = position;
      const side: Prisma.RefereeAppointmentWhereInput = { AND: [where,
        { match: { kickoff: future ? { gte: anchor } : { lt: anchor } } },
        ...(last ? [{ OR: [
          { match: { kickoff: chronological || future ? { gt: time } : { lt: time } } },
          { match: { kickoff: time }, id: { gt: last.id } },
        ] }] : []),
      ] };
      sides.push(...await tx.refereeAppointment.findMany({
        where: side, select: publicAppointmentSelect, take: size + 1,
        orderBy: [{ match: { kickoff: chronological || future ? "asc" : "desc" } }, { id: "asc" }],
      }));
    }
    const batch = (chronological ? finishChronological : finishBatch)(sides, filters, now, (item) => item.match.kickoff, size);
    // Options come only from records eligible for this public page, never private drafts.
    const competitions = await tx.competition.findMany({
      where: { matches: { some: { appointment: { is: base } } } },
      select: competitionSelect, orderBy: competitionOrder,
    });
    return { total, ...batch, competitions };
  });
}

function publicOpenMatchWhere(now: Date): Prisma.MatchWhereInput {
  return {
    status: "SCHEDULED", kickoff: { not: null }, venue: { not: null },
    applicationWindowStatus: "OPEN", applicationDeadline: { gt: now }, isTestData: false,
    competition: { isTestData: false, format: { not: "CUSTOM" } },
  };
}

export async function getPublicOpenMatchPage(filters: RefereeListFilters, now = new Date()) {
  const base = publicOpenMatchWhere(now);
  const chronological = !filters.cursor || !!filters.cursor.bucket;
  const where: Prisma.MatchWhereInput = { AND: [
    base, refereeMatchFilters(filters),
    ...(filters.q ? [{ OR: [{ homeTeam: { name: { contains: filters.q } } }, { awayTeam: { name: { contains: filters.q } } }] }] : []),
  ] };
  return prisma.$transaction(async (tx) => {
    const total = await tx.match.count({ where });
    const size = filters.cursor ? refereeContinuationSize : refereeListPageSize;
    const sides = [];
    for (const future of [true, false]) {
      const position = chronological ? chronologicalBoundary(filters, now, future) : boundary(filters, now, future);
      if ("skip" in position && position.skip) continue;
      const { anchor, time, last } = position;
      sides.push(...await tx.match.findMany({
        where: { AND: [where, { kickoff: future ? { gte: anchor } : { lt: anchor } },
          ...(last ? [{ OR: [
            { kickoff: chronological || future ? { gt: time } : { lt: time } },
            { kickoff: time, id: { gt: last.id } },
          ] }] : []),
        ] },
        take: size + 1,
        select: {
          id: true, slug: true, stage: true, round: true, structureStage: { select: { name: true } }, structureGroup: { select: { name: true } }, structureRound: { select: { name: true } }, kickoff: true, venue: true, applicationDeadline: true,
          competition: { select: competitionSelect }, homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } },
          positionRequirements: { select: { count: true } },
        },
        orderBy: [{ kickoff: chronological || future ? "asc" : "desc" }, { id: "asc" }],
      }));
    }
    const batch = (chronological ? finishChronological : finishBatch)(sides, filters, now, (item) => item.kickoff, size);
    const competitions = await tx.competition.findMany({ where: { matches: { some: base } }, select: competitionSelect, orderBy: competitionOrder });
    return { total, ...batch, competitions };
  });
}
