import { PublicSchedule } from "@/components/competitions/public-schedule";
import { getAllPublicCompetitionDetails } from "@/lib/public-competition-service";
import type { Metadata } from "next";

import { CompetitionScheduleExplorer } from "@/components/competitions/competition-schedule-explorer";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { publicMatchRecords } from "@/data/competition-center";

export const metadata: Metadata = {
  alternates: { canonical: "/competitions/schedule" },
  title: "赛程与赛果",
  description: "按赛事、阶段和球队筛选校园足球赛程与赛果。",
};

export const dynamic = "force-dynamic";
export default async function CompetitionSchedulePage() {
  const competitions = await getAllPublicCompetitionDetails();
  const normalized = (s: string) => s.normalize("NFKC").replace(/\s/g, "");
  const keys = new Set(competitions.flatMap((c) => c.matches.map((m) => [c.detailHref, m.dateLabel, m.timeLabel, normalized(m.homeTeam.name), normalized(m.awayTeam.name)].join("|"))));
  const archived = publicMatchRecords.filter((m) => !keys.has([m.competitionHref, m.dateLabel, m.timeLabel, normalized(m.homeTeam), normalized(m.awayTeam)].join("|")));
  return (
    <>
      <SiteHeader />
      <main className="functional-page" id="main-content">
        <section className="functional-hero">
          <div className="detail-shell"><p>FIXTURES & RESULTS</p><h1>赛程与赛果</h1><p>按赛事查看已收录的赛程与赛果。</p></div>
        </section>
        <section className="functional-section">
          <div className="detail-shell">
            <div className="functional-section-head"><div><span>OFFICIAL MATCH RECORDS</span><h2>比赛记录</h2></div><p>公开赛事实时赛程与已确认赛果；历史档案另列。</p></div>
            <PublicSchedule competitions={competitions} /><details><summary>历史档案（独立归档资料）</summary><CompetitionScheduleExplorer matches={archived} /></details>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
