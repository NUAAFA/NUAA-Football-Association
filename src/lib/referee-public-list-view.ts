import { getPublicRefereeQualification } from "@/lib/referee-qualifications";
import { getPublicAppointmentPage, getPublicOpenMatchPage } from "@/lib/referee-public-list-service";
import type { RefereeListFilters } from "@/lib/referee-list-filters";
import { formatLabels } from "@/lib/referee-roles";
import type { PublicRefereeListItem, RefereeListKind } from "@/types/referee-public-list";

export async function getPublicRefereeList(kind: RefereeListKind, filters: RefereeListFilters, now = new Date()) {
  if (kind === "open-matches") {
    const data = await getPublicOpenMatchPage(filters, now);
    const items: PublicRefereeListItem[] = data.items.map((item) => ({
      id: item.id, competition: item.competition.name, format: item.competition.playingFormat ?? formatLabels[item.competition.format],
      match: `${item.homeTeam.name} vs ${item.awayTeam.name}`, kickoff: item.kickoff?.toISOString() ?? null,
      venue: item.venue ?? "场地待定", stage: [item.structureStage?.name ?? item.stage, item.structureGroup?.name, item.structureRound?.name ?? item.round].filter(Boolean).join(" · "), href: `/referees/open-matches/${item.slug}`, badge: "开放报名",
      positions: [], deadline: item.applicationDeadline?.toISOString(), demand: item.positionRequirements.reduce((sum, position) => sum + position.count, 0),
    }));
    return { ...data, items };
  }
  const data = await getPublicAppointmentPage(kind, filters, now);
  // This is also the public API allow-list. Internal backfill notes and raw
  // database relations must never cross the Server/Client Component boundary.
  const items: PublicRefereeListItem[] = data.items.map((item) => {
    const postMatch = item.recordSource === "POST_MATCH_ENTRY";
    return {
      id: item.id, competition: item.match.competition.name,
      format: item.match.competition.playingFormat ?? formatLabels[item.match.competition.format],
      match: `${item.match.homeTeam.name} vs ${item.match.awayTeam.name}`, kickoff: item.match.kickoff?.toISOString() ?? null,
      venue: item.match.venue ?? "历史场地未记录", stage: [item.match.structureStage?.name ?? item.match.stage, item.match.structureGroup?.name, item.match.structureRound?.name ?? item.match.round].filter(Boolean).join(" · "),
      href: `/referees/assignments/${item.id}/print`, badge: postMatch ? "赛后执裁记录" : "正式选派",
      positions: item.positions.map((position) => ({ key: `${position.key}-${position.slot}`, label: `${position.label}${position.slot > 1 ? ` ${position.slot}` : ""}`, referee: position.referee?.name ?? (postMatch ? "实际执裁人员未记录" : "—"), refereeLevel: getPublicRefereeQualification(position.referee?.refereeLevel) })),
      publishedAt: (postMatch ? item.recordedAt : item.publishedAt)?.toISOString(), updatedAt: item.updatedAt.toISOString(),
      note: postMatch ? null : item.publicationNote,
    };
  });
  return { ...data, items };
}
