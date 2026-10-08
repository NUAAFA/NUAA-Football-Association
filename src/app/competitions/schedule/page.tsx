import type { Metadata } from "next";
import Link from "next/link";
import { PublicSchedule } from "@/components/competitions/public-schedule";
import { MatchCentreSectionHeading, MatchCentreShell } from "@/components/competitions/match-centre-shell";
import { CompetitionScheduleExplorer } from "@/components/competitions/competition-schedule-explorer";
import { Badge, Notice } from "@/components/ui/foundation-primitives";
import { publicMatchRecords } from "@/data/competition-center";
import { getAllPublicCompetitionDetails } from "@/lib/public-competition-service";
import styles from "@/components/competitions/match-centre.module.css";

export const metadata: Metadata = {
  alternates: { canonical: "/competitions/schedule" }, title: "赛程与赛果",
  description: "按赛事、阶段和球队筛选校园足球赛程与赛果。",
};
export const dynamic = "force-dynamic";

export default async function CompetitionSchedulePage() {
  const competitions = await getAllPublicCompetitionDetails();
  const normalized = (s: string) => s.normalize("NFKC").replace(/\s/g, "");
  const keys = new Set(competitions.flatMap((c) => c.matches.map((m) => [c.detailHref, m.dateLabel, m.timeLabel, normalized(m.homeTeam.name), normalized(m.awayTeam.name)].join("|"))));
  const archived = publicMatchRecords.filter((m) => !keys.has([m.competitionHref, m.dateLabel, m.timeLabel, normalized(m.homeTeam), normalized(m.awayTeam)].join("|")));
  return <MatchCentreShell active="schedule" context={[`${competitions.length} 项公开赛事`, `${archived.length} 场独立归档记录`]} description="查看当前公开赛事的正式安排与赛果，并独立查阅历史归档记录。" eyebrow="MATCH CENTRE · FIXTURES & RESULTS" title="赛程与赛果">
    <Link className={`${styles.siblingLink} ${styles.publishedJump}`} href="#published-matches">查看已发布比赛 ↓</Link>
    <section className={styles.section} aria-labelledby="publication-status-title">
      <MatchCentreSectionHeading description="状态来自已公开发布的赛事资料；具体时间和场地未确认时保留待定。" eyebrow="CURRENT PUBLICATION STATUS" id="publication-status-title" title="当前赛事发布状态" />
      <div className={styles.publicationGrid}>
        {competitions.map((competition) => <article className={styles.publicationCard} key={competition.id}>
          <header><span>{competition.currentEdition} · {competition.formatLabel}</span><Badge tone={competition.status === "ongoing" || competition.status === "completed" ? "success" : "warning"}>{competition.statusLabel}</Badge></header>
          <h3>{competition.shortName}</h3><strong className={styles.publicationState}>{competition.nextMatch.label}</strong><p>{competition.notice}</p>
          <dl className={styles.publicationFacts}><div><dt>比赛日期</dt><dd>{competition.matchWindow}</dd></div><div><dt>比赛场地</dt><dd>{competition.venue}</dd></div></dl>
          <Link className={styles.publicationLink} href={competition.detailHref}>查看赛事状态 →</Link>
        </article>)}
      </div>
      {!competitions.length ? <Notice title="当前暂无公开赛事"><p>赛事资料将在正式发布后显示。</p></Notice> : null}
    </section>
    <section className={`${styles.section} ${styles.publishedSection}`} id="published-matches" aria-labelledby="published-matches-title">
      <MatchCentreSectionHeading description="当前公开赛事的正式比赛安排、待排期记录与已确认赛果；时间按北京时间显示。" eyebrow="PUBLISHED MATCH RECORDS" id="published-matches-title" title="已发布比赛记录" />
      <PublicSchedule competitions={competitions} />
      <section className={styles.section} aria-labelledby="archived-matches-title">
        <MatchCentreSectionHeading description="与当前公开比赛去重后列出的独立历史资料，按赛事、阶段或球队筛选，每次显示 12 场。" eyebrow="HISTORICAL ARCHIVES" id="archived-matches-title" title="历史归档比赛" />
        <Notice className={styles.truthNotice} title="归档范围"><p>以下保留 2026 男子、女子足球院际杯的原始已完成比赛记录；历史档案不代表当前或未来赛程。</p></Notice>
        <CompetitionScheduleExplorer matches={archived} />
      </section>
    </section>
  </MatchCentreShell>;
}
