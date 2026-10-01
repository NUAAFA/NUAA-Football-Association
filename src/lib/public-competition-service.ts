import "server-only";

import type { CompetitionStatus, Prisma } from "@/generated/prisma-v29/client";
import { formatBeijingDateTime, formatBeijingWindow } from "@/lib/beijing-datetime";
import { getCompetitionGroupStandings } from "@/lib/competition-structure-service";
import { prisma } from "@/lib/prisma";
import { isAllowedCompetitionRegistrationUrl } from "@/lib/referee-competition-input";
import type {
  CompetitionNextMatch,
  PublicCompetitionMatch,
  PublicCompetitionStatus,
  PublicCompetitionView,
} from "@/types/competition-center";

const publicCompetitionSelect = {
  id: true,
  slug: true,
  name: true,
  shortName: true,
  year: true,
  campus: true,
  format: true,
  playingFormat: true,
  status: true,
  semesterLabel: true,
  teamFormation: true,
  publicPublished: true,
  homepageFeatured: true,
  publicOrder: true,
  registrationStartAt: true,
  registrationEndAt: true,
  matchStartAt: true,
  matchEndAt: true,
  venue: true,
  host: true,
  organizer: true,
  summary: true,
  notice: true,
  registrationUrl: true,
  createdAt: true,
  teams: {
    orderBy: [{ name: "asc" }],
    select: { id: true, name: true, teamType: true },
  },
  matches: {
    where: { isTestData: false },
    orderBy: [{ kickoff: "asc" }, { structureStage: { sortOrder: "asc" } }, { structureGroup: { sortOrder: "asc" } }, { structureRound: { sortOrder: "asc" } }, { id: "asc" }],
    select: {
      id: true,
      slug: true,
      matchNumber: true,
      stage: true,
      structureStage: { select: { name: true, sortOrder: true } }, structureGroup: { select: { name: true, sortOrder: true } }, structureRound: { select: { name: true, sortOrder: true } }, homePenaltyScore: true, awayPenaltyScore: true,
      round: true,
      kickoff: true,
      venue: true,
      status: true,
      homeScore: true,
      awayScore: true,
      homeTeam: { select: { id: true, name: true } },
      awayTeam: { select: { id: true, name: true } },
      appointment: {
        select: {
          id: true,
          status: true,
          positions: {
            orderBy: [{ sortOrder: "asc" }, { slot: "asc" }],
            select: {
              key: true,
              label: true,
              slot: true,
              referee: { select: { name: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.CompetitionSelect;

type PublicCompetitionRow = Prisma.CompetitionGetPayload<{
  select: typeof publicCompetitionSelect;
}>;

const statusPresentation: Record<CompetitionStatus, {
  status: Exclude<PublicCompetitionStatus, "pending-confirmation">;
  statusLabel: string;
  badge: string;
  stageLabel: string;
  pendingSummary: string;
}> = {
  PREPARING: { status: "preparing", statusLabel: "筹备中", badge: "筹备工作已启动", stageLabel: "赛事筹备中", pendingSummary: "筹备工作已启动，赛程待正式发布。" },
  REGISTRATION: { status: "registration", statusLabel: "报名中", badge: "报名进行中", stageLabel: "报名进行中", pendingSummary: "报名进行中，赛程待正式发布。" },
  ONGOING: { status: "ongoing", statusLabel: "进行中", badge: "赛事进行中", stageLabel: "赛事进行中", pendingSummary: "当前暂无已正式发布的下一场比赛，请关注赛事公告。" },
  COMPLETED: { status: "completed", statusLabel: "已结束", badge: "赛事已结束", stageLabel: "赛事已结束", pendingSummary: "赛事已结束" },
};

const teamTypeLabels = { ORGANIZATION: "组织代表队", JOINT: "联合队", FREEFORM: "自由组队" } as const;
const matchStatusLabels = { SCHEDULED: "已安排", COMPLETED: "已完成", CANCELLED: "已取消" } as const;

function legacyPlayingFormat(format: PublicCompetitionRow["format"]) {
  if (format === "ELEVEN_A_SIDE") return "十一人制";
  if (format === "FUTSAL") return "五人制";
  return "自定义制式";
}

function publicMatch(match: PublicCompetitionRow["matches"][number]): PublicCompetitionMatch {
  const kickoff = formatBeijingDateTime(match.kickoff);
  const appointment = match.kickoff && match.venue?.trim() && match.appointment && ["PUBLISHED", "COMPLETED"].includes(match.appointment.status)
    ? {
        id: match.appointment.id,
        positions: match.appointment.positions.flatMap((position) => position.referee
          ? [{ key: `${position.key}-${position.slot}`, label: `${position.label}${position.slot > 1 ? ` ${position.slot}` : ""}`, refereeName: position.referee.name }]
          : []),
      }
    : null;
  return {
    id: match.id,
    slug: match.slug,
    matchNumber: match.matchNumber,
    stage: match.structureStage?.name ?? match.stage,
    group: match.structureGroup?.name ?? null,
    stageOrder: match.structureStage?.sortOrder ?? -1, groupOrder: match.structureGroup?.sortOrder ?? -1, roundOrder: match.structureRound?.sortOrder ?? -1,
    round: match.structureRound?.name ?? match.round,
    homePenaltyScore: match.homePenaltyScore, awayPenaltyScore: match.awayPenaltyScore,
    kickoff: match.kickoff,
    dateLabel: kickoff.dateLabel,
    timeLabel: kickoff.timeLabel,
    venue: match.venue?.trim() || "场地待定",
    status: match.status.toLowerCase() as PublicCompetitionMatch["status"],
    statusLabel: match.status === "SCHEDULED" && (!match.kickoff || !match.venue?.trim()) ? "待排期" : matchStatusLabels[match.status],
    homeTeam: { id: match.homeTeam.id, name: match.homeTeam.name },
    awayTeam: { id: match.awayTeam.id, name: match.awayTeam.name },
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    appointment,
  };
}

export function selectCompetitionNextMatch(
  matches: readonly PublicCompetitionMatch[],
  status: CompetitionStatus,
  fallbackVenue: string | null,
  detailHref: string,
  now = new Date(),
): CompetitionNextMatch {
  if (matches.some((item) => item.status === "scheduled" && !item.kickoff) && !matches.some((item) => item.status === "scheduled" && item.kickoff && item.kickoff >= now)) return { state: "pending", label: "待排期", summary: "赛程已公布，具体比赛时间待定", dateLabel: "时间待定", venue: "场地待定" };
  if (status === "COMPLETED") return { state: "completed", label: "赛事已结束", summary: "赛事已结束", archiveHref: detailHref };
  const match = matches.filter((m): m is PublicCompetitionMatch & { kickoff: Date } => m.kickoff !== null).sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime() || (a.stageOrder ?? -1) - (b.stageOrder ?? -1) || (a.groupOrder ?? -1) - (b.groupOrder ?? -1) || (a.roundOrder ?? -1) - (b.roundOrder ?? -1) || a.id.localeCompare(b.id)).find((item) => item.status === "scheduled" && item.kickoff >= now);
  if (match) {
    return {
      state: "scheduled",
      label: "下一场",
      homeTeam: match.homeTeam.name,
      awayTeam: match.awayTeam.name,
      dateLabel: match.dateLabel,
      timeLabel: match.timeLabel,
      venue: match.venue || "场地待定",
      detailHref: `${detailHref}#match-${match.id}`,
    };
  }
  if (matches.length) return { state: "none", label: "暂无下一场", summary: matches.some((item) => item.status === "scheduled") ? "暂无下一场预告，赛果待确认。" : "暂无后续赛程，可查看现有赛果。" };
  return { state: "pending", label: "赛程待发布", summary: statusPresentation[status].pendingSummary, dateLabel: "待正式发布", venue: fallbackVenue ?? "待正式确认" };
}

function databaseView(row: PublicCompetitionRow, now = new Date()): PublicCompetitionView {
  const presentation = statusPresentation[row.status];
  const detailHref = `/competitions/${row.slug}`;
  const matches = row.matches.map(publicMatch);
  return {
    id: row.id,
    currentEditionId: row.id,
    slug: row.slug,
    name: row.name,
    shortName: row.shortName ?? row.name,
    currentEdition: row.year ? String(row.year) : "届次待确认",
    year: row.year,
    season: row.year ? `${row.year} 赛季` : "赛季待确认",
    semesterLabel: row.semesterLabel ?? "学期待确认",
    campus: row.campus,
    eventType: "公开赛事",
    formatLabel: row.playingFormat?.trim() || legacyPlayingFormat(row.format),
    teamFormation: row.teamFormation ?? "组队方式待确认",
    status: presentation.status,
    statusLabel: presentation.statusLabel,
    badge: presentation.badge,
    stageLabel: presentation.stageLabel,
    registrationWindow: formatBeijingWindow(row.registrationStartAt, row.registrationEndAt, "待正式通知"),
    matchWindow: formatBeijingWindow(row.matchStartAt, row.matchEndAt, row.matches.length ? row.matches.some((m) => m.kickoff) ? "详见已公布赛程" : "时间待定" : "待正式发布"),
    venue: row.venue ?? "待正式确认",
    host: row.host ?? "待正式通知",
    organizer: row.organizer ?? "待正式通知",
    scale: row.teams.length ? `${row.teams.length} 支球队` : "参赛规模待确认",
    summary: row.summary ?? "赛事公开简介尚未发布。",
    requirements: [],
    notice: row.notice ?? "赛事公告尚未发布。",
    registrationUrl: row.registrationUrl && isAllowedCompetitionRegistrationUrl(row.registrationUrl) ? row.registrationUrl : null,
    publicPublished: row.publicPublished,
    homepageFeatured: row.homepageFeatured,
    publicOrder: row.publicOrder,
    detailHref,
    filesHref: "/competitions/files",
    links: {
      overview: `${detailHref}#overview`, schedule: `${detailHref}#schedule`, results: `${detailHref}#schedule`, standings: `${detailHref}#standings`, knockout: `${detailHref}#standings`, teams: `${detailHref}#teams`, referees: `${detailHref}#officials`, files: "/competitions/files", news: `${detailHref}#reports`,
    },
    teams: row.teams.map((team) => ({ id: team.id, name: team.name, teamType: team.teamType, teamTypeLabel: teamTypeLabels[team.teamType] })),
    matches,
    nextMatch: selectCompetitionNextMatch(matches, row.status, row.venue, detailHref, now),
    dataOrigin: "database",
  };
}

async function loadCompetitionSummaries(homepageOnly: boolean, asOf: Date) {
  const rows = await prisma.competition.findMany({
    where: { publicPublished: true, isTestData: false, ...(homepageOnly ? { homepageFeatured: true, status: { not: "COMPLETED" as const } } : {}) },
    select: { ...publicCompetitionSelect, teams: { ...publicCompetitionSelect.teams, take: 0 }, _count: { select: { teams: true, matches: { where: { isTestData: false } } } }, matches: { ...publicCompetitionSelect.matches, where: { isTestData: false, status: "SCHEDULED", kickoff: { gte: asOf } }, take: 1, select: { ...publicCompetitionSelect.matches.select, appointment: false } } },
    orderBy: [{ publicOrder: "asc" }, { year: "desc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  const counts = rows.length ? await prisma.match.groupBy({ by: ["competitionId", "status"], where: { competitionId: { in: rows.map((r) => r.id) }, isTestData: false }, _count: true }) : [];
  const pendingCounts = rows.length ? await prisma.match.groupBy({ by: ["competitionId"], where: { competitionId: { in: rows.map((r) => r.id) }, isTestData: false, status: "SCHEDULED", kickoff: null }, _count: true }) : [];
  return rows.map((row) => {
    const view = databaseView({ ...row, matches: row.matches.map((m) => ({ ...m, appointment: null })) }, asOf);
    view.scale = row._count.teams ? `${row._count.teams} 支球队` : "参赛规模待确认";
    if (!row.matches.length && row._count.matches && row.status !== "COMPLETED") view.nextMatch = { state: "none", label: "暂无下一场", summary: counts.some((c) => c.competitionId === row.id && c.status === "SCHEDULED") ? "暂无下一场预告，赛果待确认。" : "暂无后续赛程，可查看现有赛果。" };
    if (!row.matches.length && pendingCounts.some((c) => c.competitionId === row.id)) view.nextMatch = { state: "pending", label: "待排期", summary: "赛程已公布，具体比赛时间待定", dateLabel: "时间待定", venue: "场地待定" };
    return { view, nextTime: row.matches[0]?.kickoff?.getTime() ?? Infinity, publicOrder: row.publicOrder, id: row.id };
  });
}
export async function getPublicCompetitionCatalog(): Promise<PublicCompetitionView[]> {
  try { return (await loadCompetitionSummaries(false, new Date())).map((r) => r.view); }
  catch (error) { console.error("[public-competition] catalogue unavailable", { errorName: error instanceof Error ? error.name : "UnknownError" }); return []; }
}

export const getCurrentPublicCompetitions = getPublicCompetitionCatalog;

export async function getPublicCompetition(slug: string): Promise<PublicCompetitionView | undefined> {
  try {
    const row = await prisma.competition.findFirst({ where: { slug, publicPublished: true, isTestData: false }, select: publicCompetitionSelect });
    return row ? { ...databaseView(row), standings: await getPublicCompetitionStandings(row.id) } : undefined;
  } catch (error) {
    console.error("[public-competition] detail unavailable", { slug, errorName: error instanceof Error ? error.name : "UnknownError" });
    return undefined;
  }
}

export async function getHomepagePublicCompetitions(asOf = new Date()): Promise<PublicCompetitionView[]> {
  try { return (await loadCompetitionSummaries(true, asOf)).sort((a, b) => a.nextTime - b.nextTime || a.publicOrder - b.publicOrder || a.id.localeCompare(b.id)).slice(0, 2).map((r) => r.view); }
  catch (error) { console.error("[public-competition] homepage selection unavailable", { errorName: error instanceof Error ? error.name : "UnknownError" }); return []; }
}
export async function getPublicCompetitionStandings(competitionId: string) {
  const competition = await prisma.competition.findFirst({ where: { id: competitionId, publicPublished: true, isTestData: false }, select: { stages: { where: { type: "GROUP" }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { groups: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { id: true } } } } } });
  if (!competition) return [];
  const tables = await getCompetitionGroupStandings(competitionId);
  return tables.map((t) => ({ groupId: t.group.id, groupName: t.group.name, stageName: t.group.stageName, rows: t.rows, hasResults: t.hasResults, tied: t.tied, rankingConfirmed: t.rankingConfirmed, qualificationStale: t.qualificationStale, qualifiedTeamIds: t.qualifiedTeamIds }));
}
export async function getAllPublicCompetitionDetails() {
  const ids = await prisma.competition.findMany({ where: { publicPublished: true, isTestData: false }, select: { slug: true }, orderBy: [{ publicOrder: "asc" }, { id: "asc" }] });
  return (await Promise.all(ids.map((r) => getPublicCompetition(r.slug)))).filter((r): r is PublicCompetitionView => Boolean(r));
}
