import type { Metadata } from "next";
import Link from "next/link";

import {
  MatchCentreSectionHeading,
  MatchCentreShell,
} from "@/components/competitions/match-centre-shell";
import { CompetitionScheduleExplorer } from "@/components/competitions/competition-schedule-explorer";
import { Badge, Notice } from "@/components/ui/foundation-primitives";
import { publicMatchRecords } from "@/data/competition-center";
import { coreCompetitionDirectory } from "@/data/competition-directory";

import styles from "@/components/competitions/match-centre.module.css";

export const metadata: Metadata = {
  alternates: { canonical: "/competitions/schedule" },
  title: "赛程与赛果",
  description: "按赛事、阶段和球队筛选校园足球赛程与赛果。",
};

export default function CompetitionSchedulePage() {
  const preparingCompetitions = coreCompetitionDirectory.filter(
    (competition) => competition.status === "preparing",
  );

  return (
    <MatchCentreShell
      active="schedule"
      context={["2026 已归档赛事", `${publicMatchRecords.length} 场已发布比赛记录`]}
      description="查看已经正式发布的校园足球比赛记录；尚在筹备的赛事会明确标注发布状态。"
      eyebrow="MATCH CENTRE · FIXTURES & RESULTS"
      title="赛程与赛果"
    >
      <section className={styles.section} aria-labelledby="publication-status-title">
        <MatchCentreSectionHeading
          description="以下赛事尚无正式赛程，不显示占位对阵，也不推测开球时间或场地。"
          eyebrow="CURRENT PUBLICATION STATUS"
          id="publication-status-title"
          title="当前赛事发布状态"
        />
        <div className={styles.publicationGrid}>
          {preparingCompetitions.map((competition) => (
            <article className={styles.publicationCard} key={competition.id}>
              <header>
                <span>{competition.currentEdition} · {competition.formatLabel}</span>
                <Badge tone="warning">{competition.statusLabel}</Badge>
              </header>
              <h3>{competition.shortName}</h3>
              <strong className={styles.publicationState}>{competition.nextMatch.label}</strong>
              <p>{competition.notice}</p>
              <dl className={styles.publicationFacts}>
                <div><dt>比赛日期</dt><dd>{competition.matchWindow}</dd></div>
                <div><dt>比赛场地</dt><dd>{competition.venue}</dd></div>
              </dl>
              <Link className={styles.publicationLink} href={competition.detailHref}>查看赛事状态 →</Link>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="published-matches-title">
        <MatchCentreSectionHeading
          description="按赛事、阶段或球队筛选；结果按时间由近至远排列，每次显示 12 场。"
          eyebrow="PUBLISHED MATCH RECORDS"
          id="published-matches-title"
          title="已发布比赛记录"
        />
        <Notice className={styles.truthNotice} title="数据范围">
          <p>当前收录 2026 男子、女子足球院际杯的已完成比赛；本页不是实时比分或未来赛程服务。</p>
        </Notice>
        <CompetitionScheduleExplorer matches={publicMatchRecords} />
      </section>
    </MatchCentreShell>
  );
}
