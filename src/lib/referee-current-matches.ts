import type { Prisma } from "@/generated/prisma-v29/client";
import { prisma } from "@/lib/prisma";
import { effectiveApplicationStatus } from "@/lib/referee-application-state";
import { refereeMatchFilters, type RefereeListFilters } from "@/lib/referee-list-filters";
import { formatLabels, getPositionTemplate } from "@/lib/referee-roles";

// Read only the signed-in referee's intention and task membership. Never send
// applications from other referees or internal match notes to these pages.
export async function getRefereeCurrentMatches(
  refereeId: string,
  { now = new Date(), filters, limit }: { now?: Date; filters?: RefereeListFilters; limit?: number } = {},
) {
  const current: Prisma.MatchWhereInput = {
    status: "SCHEDULED", kickoff: { gt: now }, isTestData: false,
    competition: { isTestData: false, format: { not: "CUSTOM" } },
  };
  const open: Prisma.MatchWhereInput = {
    applicationWindowStatus: "OPEN", applicationDeadline: { gt: now },
    venue: { not: null },
  };
  const mine: Prisma.MatchWhereInput = {
    applications: { some: { refereeId, status: { not: "WITHDRAWN" } } },
  };
  const base: Prisma.MatchWhereInput = { AND: [current, { OR: [open, mine] }] };
  const filtered: Prisma.MatchWhereInput = filters ? {
    AND: [base, refereeMatchFilters(filters),
      ...(filters.q ? [{ OR: [
        { homeTeam: { name: { contains: filters.q } } },
        { awayTeam: { name: { contains: filters.q } } },
      ] }] : []),
    ],
  } : base;
  const select = {
    id: true, slug: true, kickoff: true, venue: true, stage: true, round: true,
    applicationDeadline: true,
    competition: { select: { id: true, name: true, format: true, playingFormat: true } },
    homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } },
    structureStage: { select: { name: true } }, structureGroup: { select: { name: true } },
    structureRound: { select: { name: true } },
    positionRequirements: { select: { count: true } },
    applications: { where: { refereeId }, select: { id: true, status: true } },
    appointment: { select: {
      status: true, positions: { where: { refereeId }, select: { id: true }, take: 1 },
    } },
  } satisfies Prisma.MatchSelect;
  return prisma.$transaction(async (tx) => {
    // Separate buckets keep open registration ahead of old review results.
    // Bound each dashboard query; the full member list deliberately has no cap.
    const openWhere: Prisma.MatchWhereInput = { AND: [filtered, open] };
    // Explicit NULL branches matter in SQL: NOT(deadline > now) omits NULL
    // deadlines, including intentions on matches whose window was reset.
    const closedWhere: Prisma.MatchWhereInput = { AND: [filtered, { OR: [
      { applicationWindowStatus: "CLOSED" }, { applicationDeadline: null },
      { applicationDeadline: { lte: now } }, { venue: null },
    ] }] };
    const orderBy = [{ kickoff: "asc" }, { id: "asc" }] satisfies Prisma.MatchOrderByWithRelationInput[];
    const openRows = await tx.match.findMany({ where: openWhere, select, orderBy, ...(limit ? { take: limit } : {}) });
    const remaining = limit ? limit - openRows.length : undefined;
    const closedRows = remaining === 0 ? [] : await tx.match.findMany({
      where: closedWhere, select, orderBy, ...(remaining ? { take: remaining } : {}),
    });
    const items = [
      ...openRows.map((row) => ({ row, accepting: true })),
      ...closedRows.map((row) => ({ row, accepting: false })),
    ].map(({ row, accepting }) => {
      const application = row.applications[0];
      const hasOfficialTask = Boolean(row.appointment &&
        ["PUBLISHED", "COMPLETED"].includes(row.appointment.status) && row.appointment.positions.length);
      const status = application ? effectiveApplicationStatus(application.status, hasOfficialTask, accepting) : null;
      return {
        id: row.id, href: `/referees/open-matches/${row.slug}`,
        competition: row.competition.name, format: row.competition.playingFormat ?? formatLabels[row.competition.format],
        matchup: `${row.homeTeam.name} vs ${row.awayTeam.name}`,
        kickoff: row.kickoff!, venue: row.venue ?? "场地待定",
        stage: [row.structureStage?.name ?? row.stage, row.structureGroup?.name, row.structureRound?.name ?? row.round].filter(Boolean).join(" · "),
        deadline: row.applicationDeadline, accepting,
        demand: row.positionRequirements.length ? row.positionRequirements.reduce((sum, position) => sum + position.count, 0)
          : getPositionTemplate(row.competition.format).length,
        application: application && status ? {
          id: application.id, status,
          canWithdraw: accepting && !["APPOINTED", "WITHDRAWN"].includes(status),
        } : null,
      };
    });
    const total = await tx.match.count({ where: filtered });
    const openCount = await tx.match.count({ where: openWhere });
    const competitions = await tx.competition.findMany({
      where: { matches: { some: base } },
      select: { id: true, name: true, format: true, playingFormat: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    return { items, total, openCount, competitions, nextCursor: null };
  });
}

export type RefereeCurrentMatch = Awaited<ReturnType<typeof getRefereeCurrentMatches>>["items"][number];
