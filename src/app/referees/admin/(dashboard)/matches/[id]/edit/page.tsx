import { notFound } from "next/navigation";

import { AdminMatchForm, type AdminMatchRecord, type CompetitionOption } from "@/components/referees/admin/admin-match-form";
import { AdminMatchNavigation } from "@/components/referees/admin/admin-match-navigation";
import { toShanghaiDateTimeInput } from "@/components/referees/admin/admin-presenters";
import { AdminPageHeader, AdminPanel } from "@/components/referees/admin/admin-ui";
import { getPositionTemplate } from "@/lib/referee-roles";
import { prisma } from "@/lib/prisma";
import { affiliationOptionLabel, sortAffiliationOptions } from "@/lib/referee-affiliation-options";

export default async function EditAdminMatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [match, competitions, units] = await Promise.all([
    prisma.match.findUnique({ where: { id }, include: { positionRequirements: true } }),
    prisma.competition.findMany({ include: { teams: { include: { unitAffiliations: { select: { unitId: true } } }, orderBy: { name: "asc" } } }, orderBy: [{ year: "desc" }, { name: "asc" }] }),
    prisma.affiliationUnit.findMany({ include: { legacyCollege: { include: { codeMappings: true } } } }),
  ]);
  if (!match) notFound();
  const options: CompetitionOption[] = competitions.map((item) => ({ id: item.id, name: item.name, format: item.format, playingFormat: item.playingFormat ?? (item.format === "FUTSAL" ? "五人制" : item.format === "ELEVEN_A_SIDE" ? "十一人制" : "比赛制式待补充"), teams: item.teams.map((team) => ({ id: team.id, name: team.name, teamType: team.teamType, unitIds: team.unitAffiliations.map((link) => link.unitId) })), positions: getPositionTemplate(item.format).map((position) => ({ key: position.key, label: position.label })) }));
  const organizationUnits = sortAffiliationOptions(units.map((unit) => ({ id: unit.id, name: unit.name, type: unit.type, prefixes: unit.legacyCollege?.codeMappings.map((mapping) => mapping.prefix) ?? [] }))).map((unit) => ({ ...unit, label: affiliationOptionLabel(unit) }));
  const record: AdminMatchRecord = {
    stageId: match.stageId, groupId: match.groupId, roundId: match.roundId, id: match.id, slug: match.slug, competitionId: match.competitionId, stage: match.stage,
    kickoff: toShanghaiDateTimeInput(match.kickoff), endAt: toShanghaiDateTimeInput(match.endAt), venue: match.venue,
    round: match.round ?? "", source: match.source, externalMatchId: match.externalMatchId ?? "", homeTeamId: match.homeTeamId,
    awayTeamId: match.awayTeamId, status: match.status, applicationWindowStatus: match.applicationWindowStatus,
    applicationDeadline: toShanghaiDateTimeInput(match.applicationDeadline), publicNote: match.publicNote ?? "", internalNote: match.internalNote ?? "",
    cancellationReason: match.cancellationReason ?? "", positionCounts: Object.fromEntries(match.positionRequirements.map((position) => [position.key, position.count])),
  };
  return <><AdminPageHeader eyebrow="EDIT MATCH" title="编辑比赛" description="调整赛程与报名配置；选派业务在比赛详情中处理。" /><AdminMatchNavigation active="matches" /><AdminPanel title="比赛资料"><AdminMatchForm competitions={options} match={record} organizationUnits={organizationUnits} /></AdminPanel></>;
}
