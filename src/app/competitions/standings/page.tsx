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
  alternates: { canonical: "/competitions/standings" }, title: "积分榜", description: "校园足球赛事积分榜入口。" };

export default function CompetitionStandingsPage() {
  return (
    <MatchCentreShell
      active="standings"
      context={["2026 已归档赛事", "2 项赛事积分记录"]}
      description="按赛季和赛事查看已经公开的分组或联赛积分，保留现有归档统计与来源说明。"
      eyebrow="MATCH CENTRE · STANDINGS"
      title="积分榜"
    >
      <section className={styles.section} aria-labelledby="standings-records-title">
        <MatchCentreSectionHeading
          description="桌面端提供完整表格，移动端保留场次、胜平负、进失球、净胜球与积分。"
          eyebrow="PUBLISHED TABLES"
          id="standings-records-title"
          title="已公开积分记录"
        />
        <Notice className={styles.truthNotice} title="统计范围">
          <p>男子赛事保留 A、B 组现有归档积分与来源说明；女子最终积分仅统计联赛阶段，淘汰赛成绩不计入积分榜。</p>
        </Notice>
        <CompetitionRecordExplorer records={competitionRecords} mode="standings" />
      </section>
    </MatchCentreShell>
  );
}
