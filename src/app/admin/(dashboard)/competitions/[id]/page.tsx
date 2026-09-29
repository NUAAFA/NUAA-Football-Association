import { getHomepagePublicCompetitions, getPublicCompetition } from "@/lib/public-competition-service";
import type { Prisma } from "@/generated/prisma-v29/client";
import { CompetitionStructureManager } from "@/components/admin/competition-structure-manager";
import { loadCompetitionStructure, getGroupStandings } from "@/lib/competition-structure-service";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminCompetitionWorkspace } from "@/components/referees/admin/admin-competition-workspace";
import { AdminPageHeader, competitionStatusLabels } from "@/components/referees/admin/admin-ui";
import { affiliationOptionLabel, sortAffiliationOptions } from "@/lib/referee-affiliation-options";
import { formatRefereeDateTime } from "@/lib/referee-presenters";
import { prisma } from "@/lib/prisma";
import { guardUnifiedAdminPage } from "@/lib/unified-admin-page";
import { hasUnifiedAdminPermission } from "@/lib/unified-admin-rbac";

export default async function CompetitionWorkspacePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ section?: string; stageId?: string; groupId?: string; roundId?: string; status?: string; page?: string }> }) {
  const actor = await guardUnifiedAdminPage("competitions:read", "competitions");
  const { id } = await params;
  const query = await searchParams;
  const { section } = query;
  const where: Prisma.MatchWhereInput = { competitionId: id, ...(query.stageId ? { stageId: query.stageId === "legacy" ? null : query.stageId } : {}), ...(query.groupId ? { groupId: query.groupId } : {}), ...(query.roundId ? { roundId: query.roundId } : {}), ...(["SCHEDULED", "COMPLETED", "CANCELLED"].includes(query.status ?? "") ? { status: query.status as "SCHEDULED" | "COMPLETED" | "CANCELLED" } : {}) };
  const [matchCount, pendingCount] = await Promise.all([prisma.match.count({ where }), prisma.match.count({ where: { competitionId: id, status: "SCHEDULED" } })]);
  const page = Math.min(Math.max(1, Math.ceil(matchCount / 30)), Math.max(1, Math.floor(Number(query.page) || 1)));
  const [competition, rawUnits] = await Promise.all([
    prisma.competition.findUnique({
      where: { id },
      include: {
        teams: {
          include: {
            unitAffiliations: { select: { unitId: true } },
            _count: { select: { homeMatches: true, awayMatches: true } },
          },
          orderBy: { name: "asc" },
        },
        matches: {
          where, take: 30, skip: (page - 1) * 30,
          include: { homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } }, structureStage: { select: { name: true } }, structureGroup: { select: { name: true } }, structureRound: { select: { name: true } } },
          orderBy: { kickoff: "asc" },
        },
        _count: { select: { disciplineDetails: true, teams: true, matches: true } },
      },
    }),
    prisma.affiliationUnit.findMany({ include: { legacyCollege: { include: { codeMappings: true } } } }),
  ]);
  if (!competition) notFound();
  const units = sortAffiliationOptions(rawUnits.map((unit) => ({ id: unit.id, name: unit.name, type: unit.type, prefixes: unit.legacyCollege?.codeMappings.map((mapping) => mapping.prefix) ?? [] })))
    .map((unit) => ({ ...unit, label: affiliationOptionLabel(unit) }));
  const stages = await loadCompetitionStructure(id);
  const tables = await Promise.all(stages.flatMap((stage) => stage.groups.map((g) => getGroupStandings(g.id))));
  const [homepage, publicView] = await Promise.all([getHomepagePublicCompetitions(), getPublicCompetition(competition.slug)]);
  const chosen = homepage.some((c) => c.id === id);
  const publicEffect = !competition.publicPublished ? "赛事中心尚未公开" : competition.isTestData ? "测试标记阻止公开" : chosen ? "赛事中心已公开 · 当前入选首页" : competition.status === "COMPLETED" ? "赛事中心已公开 · 已结束，不占活跃首页位" : !competition.homepageFeatured ? "赛事中心已公开 · 未选择首页候选" : "赛事中心已公开 · 首页候选，目前按近期比赛排序未入选";
  const canWrite = hasUnifiedAdminPermission(actor.roles, "competitions:write");
  return <>
    <AdminPageHeader eyebrow="COMPETITION WORKSPACE" title={competition.name} description={`${competition.playingFormat ?? (competition.format === "FUTSAL" ? "五人制" : competition.format === "ELEVEN_A_SIDE" ? "十一人制" : "比赛制式待补充")} · 当前赛事工作台`} actions={<Link className="admin-button admin-button-secondary" href="/admin/competitions">返回赛事列表</Link>} />
    <AdminCompetitionWorkspace
      canWrite={canWrite}
      counts={{ teams: competition._count.teams, matches: competition._count.matches, pending: pendingCount, filtered: matchCount }} page={page} stages={stages}
      publicEffect={publicEffect + (publicView?.nextMatch.state === "scheduled" ? ` · 下一场：${publicView.nextMatch.homeTeam} vs ${publicView.nextMatch.awayTeam} ${publicView.nextMatch.dateLabel} ${publicView.nextMatch.timeLabel}` : publicView ? ` · ${publicView.nextMatch.summary}` : "")}
      structure={<CompetitionStructureManager key={id} competitionId={id} stages={stages} tables={tables} teams={competition.teams.map((t) => ({ id: t.id, name: t.name }))} canWrite={canWrite} />}
      initialSection={section === "teams" ? "teams" : section === "matches" ? "matches" : "overview"}
      competition={{
        id: competition.id,
        name: competition.name,
        formatLabel: competition.playingFormat ?? (competition.format === "FUTSAL" ? "五人制" : competition.format === "ELEVEN_A_SIDE" ? "十一人制" : "比赛制式待补充"),
        statusLabel: competitionStatusLabels[competition.status],
        year: competition.year,
        slug: competition.slug,
        deletionProtectedReason: competition._count.teams || competition._count.matches || competition._count.disciplineDetails || competition.publicPublished || competition.homepageFeatured || competition.source !== "MANUAL" || competition.externalCompetitionId
          ? "该赛事已有参赛球队、比赛、公开发布或其他正式数据，不能直接删除。请保留历史并逐项核对。"
          : undefined,
      }}
      matches={competition.matches.map((match) => ({ matchNumber: match.matchNumber, id: match.id, matchup: `${match.homeTeam.name} vs ${match.awayTeam.name}`, kickoff: formatRefereeDateTime(match.kickoff), venue: match.venue, status: match.status, stage: match.structureStage?.name ?? match.stage, group: match.structureGroup?.name, round: match.structureRound?.name ?? match.round ?? "", score: match.homeScore !== null && match.awayScore !== null ? `${match.homeScore}:${match.awayScore}` : "" }))}
      teams={competition.teams.map((team) => ({ id: team.id, name: team.name, teamType: team.teamType, unitIds: team.unitAffiliations.map((item) => item.unitId), matchCount: team._count.homeMatches + team._count.awayMatches }))}
      units={units}
    />
  </>;
}
