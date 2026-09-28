import Link from "next/link";
import { PublicStandings } from "@/components/competitions/public-standings";
import { getAllPublicCompetitionDetails } from "@/lib/public-competition-service";
import type { Metadata } from "next";

import { CompetitionRecordExplorer } from "@/components/competitions/competition-record-explorer";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { competitionRecords } from "@/data/competition-records";

export const metadata: Metadata = {
  alternates: { canonical: "/competitions/standings" }, title: "积分榜", description: "校园足球赛事积分榜入口。" };

export const dynamic = "force-dynamic";
export default async function CompetitionStandingsPage({ searchParams }: { searchParams: Promise<{ competition?: string; stage?: string; group?: string }> }) {
  const [competitions, query] = await Promise.all([getAllPublicCompetitionDetails(), searchParams]);
  const selected = competitions.filter((c) => !query.competition || c.id === query.competition);
  const stages = [...new Set(selected.flatMap((c) => (c.standings ?? []).map((t) => t.stageName)))];
  const groups = selected.flatMap((c) => (c.standings ?? []).filter((t) => !query.stage || t.stageName === query.stage));
  const archived = competitionRecords.filter((r) => !competitions.some((c) => c.detailHref === r.archiveHref));
  return (
    <>
      <SiteHeader />
      <main className="functional-page competition-record-page" id="main-content">
        <section className="functional-hero"><div className="detail-shell"><p>STANDINGS</p><h1>积分榜</h1><p>按赛季和赛事查看已经公开的积分数据。</p></div></section>
        <section className="functional-section"><div className="detail-shell">
          <form className="functional-filters"><label>赛事<select name="competition" defaultValue={query.competition ?? ""}><option value="">全部公开赛事</option>{competitions.map((c) => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label><label>阶段<select name="stage" defaultValue={query.stage ?? ""}><option value="">全部阶段</option>{stages.map((s) => <option key={s}>{s}</option>)}</select></label><label>小组<select name="group" defaultValue={query.group ?? ""}><option value="">全部小组</option>{groups.map((g) => <option key={g.groupId} value={g.groupId}>{g.stageName} · {g.groupName}</option>)}</select></label><button type="submit">筛选</button></form>{competitions.filter((c) => !query.competition || c.id === query.competition).map((c) => <section key={c.id}><h2><Link href={c.detailHref}>{c.name}</Link></h2><PublicStandings tables={(c.standings ?? []).filter((t) => !query.group || t.groupId === query.group)} /></section>)}<details><summary>历史积分档案（独立归档资料）</summary><CompetitionRecordExplorer records={archived} mode="standings" /></details>
        </div></section>
      </main>
      <SiteFooter />
    </>
  );
}
