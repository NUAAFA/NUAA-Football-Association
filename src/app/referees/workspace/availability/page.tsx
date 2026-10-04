import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { RefereeAvailabilityCalendar } from "@/components/referees/mvp/referee-availability-calendar";
import { RefereeWorkspaceHero } from "@/components/referees/mvp/referee-workspace-hero";
import { RefereeWorkspaceNav } from "@/components/referees/mvp/referee-workspace-nav";
import { getRefereeMemberSession } from "@/lib/referee-member-auth";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "我的可执裁时间", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function RefereeAvailabilityPage() {
  const session = await getRefereeMemberSession();
  if (!session) redirect("/referees/login");
  if (session.referee.mustChangePassword) redirect("/referees/workspace/account");
  const records = await prisma.refereeAvailability.findMany({ where: { refereeId: session.refereeId }, orderBy: { startAt: "asc" } });
  return <><SiteHeader /><main className="functional-page" id="main-content"><RefereeWorkspaceHero description="在月历中选择日期，记录整天、不可执裁或一个以上的具体可用时段。" eyebrow="AVAILABILITY" name={session.referee.name} publicCode={session.referee.publicCode} title="我的可执裁时间" /><RefereeWorkspaceNav /><section className="functional-section referee-availability-section"><div className="detail-shell"><RefereeAvailabilityCalendar records={records.map((item) => ({ id: item.id, refereeId: item.refereeId, startAt: item.startAt.toISOString(), endAt: item.endAt.toISOString(), kind: item.kind, competitionFormat: item.competitionFormat, note: item.note ?? "" }))} /></div></section></main><SiteFooter /></>;
}
