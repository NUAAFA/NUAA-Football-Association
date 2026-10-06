import type { Metadata } from "next";

import {
  MatchCentreSectionHeading,
  MatchCentreShell,
} from "@/components/competitions/match-centre-shell";
import { CompetitionRecordExplorer } from "@/components/competitions/competition-record-explorer";
import { Notice } from "@/components/ui/foundation-primitives";
import { competitionRecords } from "@/data/competition-records";

import styles from "@/components/competitions/match-centre.module.css";

export const metadata: Metadata = {
  alternates: { canonical: "/competitions/scorers" }, title: "射手记录", description: "赛事射手与奖项记录入口。" };

export default function CompetitionScorersPage() {
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
          description="保留公开顺序、姓名、球队、号码和进球数；来源未提供的数据不会被补算或推测。"
          eyebrow="VERIFIED PUBLIC RECORDS"
          id="scoring-records-title"
          title="公开射手与奖项记录"
        />
        <Notice className={styles.truthNotice} title="数据完整性">
          <p>男子数据仅为公开 Top 10，不代表完整射手榜；女子资料只确认两位金靴得主，未公开个人进球数及完整排名。</p>
        </Notice>
        <CompetitionRecordExplorer records={competitionRecords} mode="scorers" />
      </section>
    </MatchCentreShell>
  );
}
