import Link from "next/link";

import { AdminMatchForm, type CompetitionOption } from "@/components/referees/admin/admin-match-form";
import { AdminMatchNavigation } from "@/components/referees/admin/admin-match-navigation";
import { AdminPageHeader, AdminPanel } from "@/components/referees/admin/admin-ui";
import { prisma } from "@/lib/prisma";
import { affiliationOptionLabel, sortAffiliationOptions } from "@/lib/referee-affiliation-options";
import { getPositionTemplate } from "@/lib/referee-roles";

export default async function NewAdminMatchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const initialCompetitionId = typeof query.competitionId === "string" ? query.competitionId : typeof query.competition === "string" ? query.competition : "";
  const fromWorkspace = query.from === "workspace";
  const [competitions, units] = await Promise.all([
    prisma.competition.findMany({ include: { teams: { include: { unitAffiliations: { select: { unitId: true } } }, orderBy: { name: "asc" } } }, orderBy: [{ year: "desc" }, { name: "asc" }] }),
    prisma.affiliationUnit.findMany({ include: { legacyCollege: { include: { codeMappings: true } } } }),
  ]);
  const options: CompetitionOption[] = competitions.map((item) => ({ id: item.id, name: item.name, format: item.format, playingFormat: item.playingFormat ?? (item.format === "FUTSAL" ? "五人制" : item.format === "ELEVEN_A_SIDE" ? "十一人制" : "比赛制式待补充"), teams: item.teams.map((team) => ({ id: team.id, name: team.name, teamType: team.teamType, unitIds: team.unitAffiliations.map((link) => link.unitId) })), positions: getPositionTemplate(item.format).map((position) => ({ key: position.key, label: position.label })) }));
  const organizationUnits = sortAffiliationOptions(units.map((unit) => ({ id: unit.id, name: unit.name, type: unit.type, prefixes: unit.legacyCollege?.codeMappings.map((mapping) => mapping.prefix) ?? [] }))).map((unit) => ({ ...unit, label: affiliationOptionLabel(unit) }));
  const fixedCompetition = fromWorkspace ? options.find((item) => item.id === initialCompetitionId) : null;
  return <><AdminPageHeader eyebrow="NEW MATCH" title="新建比赛" description={fixedCompetition ? `当前赛事：${fixedCompetition.name}` : "选择赛事后，只能从该赛事的参赛球队中选择主客队。"} /><AdminMatchNavigation active="matches" /><AdminPanel title="比赛资料">{fixedCompetition && !fixedCompetition.teams.length ? <div className="admin-empty-state"><strong>当前赛事尚无参赛球队。</strong><p>请先添加参赛球队。</p><Link className="admin-button" href={`/admin/competitions/${fixedCompetition.id}`}>前往添加球队</Link></div> : options.length ? <AdminMatchForm competitions={options} initialCompetitionId={initialCompetitionId} lockCompetition={Boolean(fixedCompetition)} organizationUnits={organizationUnits} /> : <div className="admin-empty-state"><strong>当前没有可用赛事，请先创建赛事</strong><p>赛事是球队和具体比赛的上级对象。</p><Link className="admin-button" href="/admin/competitions/new">新建赛事</Link></div>}</AdminPanel></>;
}
