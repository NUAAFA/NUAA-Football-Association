import { RefereePage } from "@/components/referees/referee-public-layout";
import type { Metadata } from "next";
import { PublicAppointmentList, type PublicAppointment } from "@/components/referees/mvp/public-appointment-list";
import { formatRefereeDateTime } from "@/lib/referee-presenters";
import { getPublicHistoricalAppointments } from "@/lib/referee-public";

export const metadata: Metadata = {
  alternates: { canonical: "/referees/history" }, title: "历史选派记录", description: "查看已结束比赛中公开发布的裁判组选派记录。" };
export const dynamic = "force-dynamic";

export default async function RefereeHistoryPage() {
  const appointments = await getPublicHistoricalAppointments();
  const items: PublicAppointment[] = appointments.map((item) => ({ id: item.id, competition: item.match.competition.name, match: `${item.match.homeTeam.name} vs ${item.match.awayTeam.name}`, stage: item.match.stage, kickoff: formatRefereeDateTime(item.match.kickoff), venue: item.match.venue, publishedAt: item.publishedAt ? formatRefereeDateTime(item.publishedAt) : "—", updatedAt: formatRefereeDateTime(item.updatedAt), note: item.publicationNote, positions: item.positions.flatMap((position) => position.referee ? [{ key: `${position.key}-${position.slot}`, label: `${position.label}${position.slot > 1 ? ` ${position.slot}` : ""}`, referee: position.referee.name }] : []) }));
  return <RefereePage current="/referees/history" eyebrow="ASSIGNMENT ARCHIVE" title="历史选派记录" description="查阅已结束比赛中经协会正式发布的裁判组选派档案。"><PublicAppointmentList emptyTitle="当前暂无已公开的历史选派。" items={items} /></RefereePage>;
}
