import type { Metadata } from "next";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { PublicAppointmentList, RefereeSubnav, type PublicAppointment } from "@/components/referees/mvp/public-appointment-list";
import { formatRefereeDateTime } from "@/lib/referee-presenters";
import { getPublicUpcomingAppointments } from "@/lib/referee-public";

export const metadata: Metadata = {
  alternates: { canonical: "/referees/assignments" }, title: "裁判员选派公告", description: "仅展示已发布且未撤回的裁判组选派。" };
export const dynamic = "force-dynamic";

async function getItems(): Promise<PublicAppointment[]> {
  const appointments = await getPublicUpcomingAppointments();
  return appointments.map((item) => ({ id: item.id, competition: item.match.competition.name, match: `${item.match.homeTeam.name} vs ${item.match.awayTeam.name}`, stage: item.match.stage, kickoff: formatRefereeDateTime(item.match.kickoff), venue: item.match.venue || "场地待定", publishedAt: item.publishedAt ? formatRefereeDateTime(item.publishedAt) : "—", updatedAt: formatRefereeDateTime(item.updatedAt), note: item.publicationNote, positions: item.positions.flatMap((position) => position.referee ? [{ key: `${position.key}-${position.slot}`, label: `${position.label}${position.slot > 1 ? ` ${position.slot}` : ""}`, referee: position.referee.name }] : []) }));
}

export default async function RefereeAssignmentsPage() { const items = await getItems(); return <><SiteHeader /><main className="functional-page" id="main-content"><section className="functional-hero"><div className="detail-shell"><p>PUBLISHED APPOINTMENTS</p><h1>裁判员选派公告</h1><p>仅公布协会正式发布且当前有效的裁判组选派；开球后未确认完赛仍保留，后续调整以最新公告为准。</p></div></section><RefereeSubnav /><section className="functional-section"><div className="detail-shell"><PublicAppointmentList emptyTitle="当前暂无有效的已发布选派" items={items} /></div></section></main><SiteFooter /></>; }
