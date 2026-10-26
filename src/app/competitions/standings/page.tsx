import Link from "next/link";
import type { Metadata } from "next";
import { PublicStandings } from "@/components/competitions/public-standings";
import { getAllPublicCompetitionDetails } from "@/lib/public-competition-service";
import { MatchCentreSectionHeading, MatchCentreShell } from "@/components/competitions/match-centre-shell";
import { CompetitionRecordExplorer } from "@/components/competitions/competition-record-explorer";
import { Notice } from "@/components/ui/foundation-primitives";
import { competitionRecords } from "@/data/competition-records";
import styles from "@/components/competitions/match-centre.module.css";
import { CompetitionDataModules, DataViewBack, dataViewHref } from "@/components/competitions/competition-data-navigation";
import navigation from "@/components/competitions/competition-data-navigation.module.css";

export const metadata: Metadata = { alternates: { canonical: "/competitions/standings" }, title: "积分榜", description: "校园足球赛事积分榜入口。" };
export const dynamic = "force-dynamic";

export default async function CompetitionStandingsPage({ searchParams }: { searchParams: Promise<{ competition?: string; season?: string; archive?: string }> }) {
  const [competitions, query] = await Promise.all([getAllPublicCompetitionDetails(), searchParams]);
  const selected = competitions.find((competition) => competition.id === query.competition);
  const currentHref = dataViewHref("/competitions/standings", { season: query.season, archive: query.archive }, "current-standings-title");
  const archived = competitionRecords.filter((r) => !competitions.some((c) => c.detailHref === r.archiveHref));
  return <MatchCentreShell active="standings" context={[`${competitions.length} 项公开赛事`, `${archived.length} 项独立归档积分记录`]} description="查看当前公开赛事的小组积分或联赛总积分，并独立查阅原始历史归档统计。" eyebrow="MATCH CENTRE · STANDINGS" title="积分榜">
    <section className={styles.section} aria-labelledby="current-standings-title">
      <MatchCentreSectionHeading description="先选择一项赛事，再查看小组或联赛积分，也可搜索球队。" eyebrow="CURRENT PUBLISHED TABLES" id="current-standings-title" title="当前公开赛事积分" />
      {selected ? <section data-public-standings={selected.slug}>
        <DataViewBack href={currentHref} />
        <header className={navigation.detailHeading}><div><p>{selected.currentEdition} · {selected.formatLabel} · {selected.statusLabel}</p><h3>{selected.name}</h3></div><Link href={selected.detailHref}>赛事详情 →</Link></header>
        <PublicStandings key={selected.id} tables={selected.standings ?? []} isLeague={selected.competitionSystem === "LEAGUE"} />
      </section> : <>
        {query.competition ? <p className={styles.recordNote}>该赛事尚未公开，请选择以下赛事。</p> : null}
        <CompetitionDataModules label="当前积分榜赛事选择" items={competitions.map((competition) => ({
          id: competition.id,
          title: competition.shortName,
          meta: competition.formatLabel,
          status: competition.statusLabel,
          description: `${competition.currentEdition} · ${competition.campus}`,
          count: competition.standings?.length ? competition.competitionSystem === "LEAGUE" ? "联赛总积分榜" : `${competition.standings.length} 个小组积分榜` : "积分待发布",
          action: "查看积分",
          href: dataViewHref("/competitions/standings", { competition: competition.id, season: query.season, archive: query.archive }, "current-standings-title"),
        }))} />
        {!competitions.length ? <Notice title="当前暂无公开赛事"><p>赛事公开后将在这里显示积分榜入口。</p></Notice> : null}
      </>}
    </section>
    <section className={styles.section} aria-labelledby="standings-records-title">
      <MatchCentreSectionHeading description="按年份查找赛事档案，进入对应赛事查看各小组积分与统计说明。" eyebrow="HISTORICAL ARCHIVES" id="standings-records-title" title="历史归档积分" />
      <CompetitionRecordExplorer records={archived} mode="standings" season={query.season} competitionId={query.archive} currentCompetitionId={selected?.id} />
    </section>
  </MatchCentreShell>;
}
