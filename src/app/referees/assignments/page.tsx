import { RefereePage } from "@/components/referees/referee-public-layout";
import type { Metadata } from "next";
import { PublicAppointmentList, type PublicAppointment } from "@/components/referees/mvp/public-appointment-list";
import { formatRefereeDateTime } from "@/lib/referee-presenters";
import { getPublicUpcomingAppointments } from "@/lib/referee-public";

export const metadata: Metadata = {
  alternates: { canonical: "/referees/assignments" }, title: "裁判员选派公告", description: "仅展示已发布且未撤回的裁判组选派。" };
export const dynamic = "force-dynamic";

async function getItems(): Promise<PublicAppointment[]> {
  const appointments = await getPublicUpcomingAppointments();
  return appointments.map((item) => ({ id: item.id, competition: item.match.competition.name, match: `${item.match.homeTeam.name} vs ${item.match.awayTeam.name}`, stage: item.match.stage, kickoff: formatRefereeDateTime(item.match.kickoff), venue: item.match.venue, publishedAt: item.publishedAt ? formatRefereeDateTime(item.publishedAt) : "—", updatedAt: formatRefereeDateTime(item.updatedAt), note: item.publicationNote, positions: item.positions.flatMap((position) => position.referee ? [{ key: `${position.key}-${position.slot}`, label: `${position.label}${position.slot > 1 ? ` ${position.slot}` : ""}`, referee: position.referee.name }] : []) }));
}

export default async function RefereeAssignmentsPage() {
  const items = await getItems();
  return <RefereePage current="/referees/assignments" eyebrow="ASSIGNMENTS" title="裁判员选派公告" description="仅公布协会正式发布且当前有效的裁判组选派；后续调整以最新公告为准。"><PublicAppointmentList emptyTitle="当前暂无未来比赛的已发布选派。" items={items} /></RefereePage>;
}
