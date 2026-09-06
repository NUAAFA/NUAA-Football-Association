import Link from "next/link";

import styles from "@/components/home/home-page.module.css";
import {
  Badge,
  LinkButton,
  Panel,
} from "@/components/ui/foundation-primitives";
import { getCoreCompetition } from "@/data/competition-directory";
import type { CoreCompetitionDirectoryEntry } from "@/types/competition-center";

const forecastCompetitionIds = [
  "freshman-cup",
  "tianmuhu-futsal-league",
] as const;

function ForecastCard({
  competition,
  index,
}: {
  competition: CoreCompetitionDirectoryEntry;
  index: number;
}) {
  const forecast = competition.nextMatch;
  const forecastSummary = "summary" in forecast
    ? forecast.summary
    : `${forecast.homeTeam} 对阵 ${forecast.awayTeam}，${forecast.dateLabel} ${forecast.timeLabel}。`;

  return (
    <article className={styles.currentCompetitionCard}>
      <header className={styles.currentCompetitionHeader}>
        <span>0{index + 1} / {competition.formatLabel}</span>
        <Badge className={styles.currentBadge} tone="warning">
          {forecast.label}
        </Badge>
      </header>
      <p className={styles.currentCompetitionMeta}>
        {competition.semesterLabel} · {competition.teamFormation}
      </p>
      <h3>{competition.name}</h3>
      <p className={styles.currentCompetitionSummary}>{forecastSummary}</p>
      <dl className={styles.currentCompetitionFacts}>
        <div><dt>当前阶段</dt><dd>{competition.statusLabel}</dd></div>
        <div><dt>赛程安排</dt><dd>{competition.matchWindow}</dd></div>
        <div><dt>比赛场地</dt><dd>{competition.venue}</dd></div>
      </dl>
      <Link className={styles.inlineLink} href={competition.detailHref}>
        进入赛事主页 <span aria-hidden="true">→</span>
      </Link>
    </article>
  );
}

export function NextMatchForecast() {
  const competitions = forecastCompetitionIds.map((id) => {
    const competition = getCoreCompetition(id);
    if (!competition) throw new Error(`Missing homepage competition: ${id}`);
    return competition;
  });

  return (
    <section
      aria-labelledby="home-next-match-title"
      className={`${styles.section} ${styles.currentFootball}`}
      id="home-current-football"
    >
      <div className={`page-shell ${styles.sectionShell}`}>
        <Panel className={styles.currentFootballPanel}>
          <div className={styles.currentFootballIntro}>
            <p className={styles.sectionEyebrow}>CURRENT FOOTBALL / 当前赛事</p>
            <h2 id="home-next-match-title">赛事筹备已启动，赛程待正式发布</h2>
            <p>
              当前暂无已正式发布的下一场比赛。所有时间、对阵与场地信息以协会后续正式公告为准。
            </p>
            <LinkButton className={styles.currentFootballAction} href="/competitions/schedule" tone="secondary">
              查看赛程与赛果 <span aria-hidden="true">→</span>
            </LinkButton>
          </div>
          <div className={styles.currentCompetitionGrid}>
            {competitions.map((competition, index) => (
              <ForecastCard competition={competition} index={index} key={competition.id} />
            ))}
          </div>
        </Panel>
      </div>
    </section>
  );
}
