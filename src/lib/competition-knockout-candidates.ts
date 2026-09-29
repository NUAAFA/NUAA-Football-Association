import { prisma } from "@/lib/prisma";

// Read-only single-match outcomes. Two-leg ties still require the administrator's decision.
export async function getKnockoutResultCandidates(competitionId: string, roundId = "", requestedPage = 1) {
  const where = { competitionId, status: "COMPLETED" as const, homeScore: { not: null }, awayScore: { not: null }, ...(roundId ? { roundId } : {}) };
  const total = await prisma.match.count({ where });
  const pageSize = 20, totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(totalPages, Math.max(1, Number.isSafeInteger(requestedPage) ? requestedPage : 1));
  const matches = await prisma.match.findMany({ where, orderBy: [{ kickoff: "desc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize,
    select: { id: true, matchNumber: true, stage: true, round: true, homeScore: true, awayScore: true, homePenaltyScore: true, awayPenaltyScore: true, homeTeam: { select: { id: true, name: true } }, awayTeam: { select: { id: true, name: true } } } });
  const items = matches.map((m) => {
    const score = m.homeScore! - m.awayScore!;
    const penalties = m.homePenaltyScore !== null && m.awayPenaltyScore !== null ? m.homePenaltyScore - m.awayPenaltyScore : 0;
    const outcome = score || penalties;
    return { id: m.id, label: m.matchNumber ? `第${m.matchNumber}场` : `${m.homeTeam.name} vs ${m.awayTeam.name}`, stage: m.stage, round: m.round,
      winner: outcome ? outcome > 0 ? m.homeTeam : m.awayTeam : null, loser: outcome ? outcome > 0 ? m.awayTeam : m.homeTeam : null };
  });
  return { items, total, page, pageSize, totalPages };
}
export type KnockoutCandidatePage = Awaited<ReturnType<typeof getKnockoutResultCandidates>>;
