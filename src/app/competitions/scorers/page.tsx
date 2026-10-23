import type { Metadata } from "next";

import {
  MatchCentreSectionHeading,
  MatchCentreShell,
} from "@/components/competitions/match-centre-shell";
import { CompetitionRecordExplorer } from "@/components/competitions/competition-record-explorer";
import { competitionRecords } from "@/data/competition-records";

import styles from "@/components/competitions/match-centre.module.css";

export const metadata: Metadata = {
  alternates: { canonical: "/competitions/scorers" }, title: "射手记录", description: "赛事射手与奖项记录入口。" };

export default async function CompetitionScorersPage({ searchParams }: { searchParams: Promise<{ season?: string; archive?: string }> }) {
  const query = await searchParams;
  return (
    <MatchCentreShell
      active="scorers"
      context={["男子公开 Top 10", "女子金靴荣誉记录"]}
      description="查看能够核验的公开进球统计与射手奖项；页面会明确区分排名数据和仅有获奖事实的记录。"
      eyebrow="MATCH CENTRE · SCORING RECORDS"
      title="射手记录"
    >
      <section className={styles.section} aria-labelledby="scoring-records-title">
        <MatchCentreSectionHeading
          description="按年份选择赛事，查看该赛事公开的射手数据与金靴荣誉。"
          eyebrow="VERIFIED PUBLIC RECORDS"
          id="scoring-records-title"
          title="公开射手与奖项记录"
        />
        <CompetitionRecordExplorer records={competitionRecords} mode="scorers" season={query.season} competitionId={query.archive} />
      </section>
    </MatchCentreShell>
  );
}
