import { notFound } from "next/navigation";

import { AdminCompetitionForm, type AdminCompetitionRecord } from "@/components/referees/admin/admin-competition-form";
import { AdminMatchNavigation } from "@/components/referees/admin/admin-match-navigation";
import { AdminPageHeader, AdminPanel } from "@/components/referees/admin/admin-ui";
import { formatBeijingDateTimeInput } from "@/lib/beijing-datetime";
import { prisma } from "@/lib/prisma";
import { formatRefereeDateTime } from "@/lib/referee-presenters";

export default async function EditAdminCompetitionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const competition = await prisma.competition.findUnique({ where: { id } });
  if (!competition) notFound();
  const record: AdminCompetitionRecord = {
    id: competition.id,
    slug: competition.slug,
    name: competition.name,
    shortName: competition.shortName ?? "",
    year: competition.year,
    campus: competition.campus,
    format: competition.format,
    competitionSystem: competition.competitionSystem,
    playingFormat: competition.playingFormat ?? (competition.format === "FUTSAL" ? "五人制" : competition.format === "ELEVEN_A_SIDE" ? "十一人制" : ""),
    status: competition.status,
    semesterLabel: competition.semesterLabel ?? "",
    teamFormation: competition.teamFormation ?? "",
    publicPublished: competition.publicPublished,
    homepageFeatured: competition.homepageFeatured,
    publicOrder: competition.publicOrder,
    registrationStartAt: formatBeijingDateTimeInput(competition.registrationStartAt),
    registrationEndAt: formatBeijingDateTimeInput(competition.registrationEndAt),
    matchStartAt: formatBeijingDateTimeInput(competition.matchStartAt),
    matchEndAt: formatBeijingDateTimeInput(competition.matchEndAt),
    venue: competition.venue ?? "",
    host: competition.host ?? "",
    organizer: competition.organizer ?? "",
    summary: competition.summary ?? "",
    notice: competition.notice ?? "",
    registrationUrl: competition.registrationUrl ?? "",
    source: competition.source,
    externalCompetitionId: competition.externalCompetitionId ?? "",
    lastSyncedAt: competition.lastSyncedAt ? formatRefereeDateTime(competition.lastSyncedAt) : "",
  };
  return <>
    <AdminPageHeader eyebrow="EDIT COMPETITION" title="编辑赛事" description="维护赛事基础资料；既有球队、比赛和选派关系保持不变。" />
    <AdminMatchNavigation active="competitions" />
    <AdminPanel title="赛事资料"><AdminCompetitionForm competition={record} /></AdminPanel>
  </>;
}
