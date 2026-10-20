import Link from "next/link";
import type { Metadata } from "next";
import { PublicStandings } from "@/components/competitions/public-standings";
import { getAllPublicCompetitionDetails } from "@/lib/public-competition-service";
import { MatchCentreSectionHeading, MatchCentreShell } from "@/components/competitions/match-centre-shell";
import { CompetitionRecordExplorer } from "@/components/competitions/competition-record-explorer";
import { Notice } from "@/components/ui/foundation-primitives";
import { competitionRecords } from "@/data/competition-records";
import styles from "@/components/competitions/match-centre.module.css";

export const metadata: Metadata = { alternates: { canonical: "/competitions/standings" }, title: "积分榜", description: "校园足球赛事积分榜入口。" };
export const dynamic = "force-dynamic";

export default async function CompetitionStandingsPage({ searchParams }: { searchParams: Promise<{ competition?: string; stage?: string; group?: string }> }) {
  const [competitions, query] = await Promise.all([getAllPublicCompetitionDetails(), searchParams]);
  const selected = competitions.filter((c) => !query.competition || c.id === query.competition);
  const stages = [...new Set(selected.flatMap((c) => (c.standings ?? []).map((t) => t.stageName)))];
  const groups = selected.flatMap((c) => (c.standings ?? []).filter((t) => !query.stage || t.stageName === query.stage));
  const archived = competitionRecords.filter((r) => !competitions.some((c) => c.detailHref === r.archiveHref));
  return <MatchCentreShell active="standings" context={[`${competitions.length} 项公开赛事`, `${archived.length} 项独立归档积分记录`]} description="查看当前公开赛事的正式小组积分，并独立查阅原始历史归档统计。" eyebrow="MATCH CENTRE · STANDINGS" title="积分榜">
    <section className={styles.section} aria-labelledby="current-standings-title">
      <MatchCentreSectionHeading description="按赛事、阶段与小组筛选；积分计算、人工确认与待复核状态来自正式赛事记录。" eyebrow="CURRENT PUBLISHED TABLES" id="current-standings-title" title="当前公开赛事积分" />
      <form className="functional-filters">
        <label>赛事<select name="competition" defaultValue={query.competition ?? ""}><option value="">全部公开赛事</option>{competitions.map((c) => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label>
        <label>阶段<select name="stage" defaultValue={query.stage ?? ""}><option value="">全部阶段</option>{stages.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label>小组<select name="group" defaultValue={query.group ?? ""}><option value="">全部小组</option>{groups.map((g) => <option key={g.groupId} value={g.groupId}>{g.stageName} · {g.groupName}</option>)}</select></label>
        <button type="submit">筛选</button>
      </form>
      {selected.map((c) => <section key={c.id} data-public-standings={c.slug}>
        <h2><Link href={c.detailHref}>{c.name}</Link></h2>
        <PublicStandings tables={(c.standings ?? []).filter((t) => (!query.stage || t.stageName === query.stage) && (!query.group || t.groupId === query.group))} />
      </section>)}
      {!selected.length ? <p>暂无符合条件的公开赛事积分。</p> : null}
    </section>
    <section className={styles.section} aria-labelledby="standings-records-title">
      <MatchCentreSectionHeading description="查看各队场次、胜平负、进失球、净胜球与积分。" eyebrow="HISTORICAL ARCHIVES" id="standings-records-title" title="历史归档积分" />
      <Notice className={styles.truthNotice} title="归档统计范围"><p>男子赛事保留 A、B 组现有归档积分与来源说明；女子最终积分仅统计联赛阶段，淘汰赛成绩不计入积分榜。</p></Notice>
      <CompetitionRecordExplorer records={archived} mode="standings" />
    </section>
  </MatchCentreShell>;
}
