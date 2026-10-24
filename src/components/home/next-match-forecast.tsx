import { PublicLoadRetry } from "@/components/public-load-retry";
import Link from "next/link";
import styles from "@/components/home/home-page.module.css";
import { Badge, LinkButton, Panel } from "@/components/ui/foundation-primitives";
import { getHomepagePublicCompetitions } from "@/lib/public-competition-service";
import type { PublicCompetitionView } from "@/types/competition-center";

function ForecastCard({ competition, index }: { competition: PublicCompetitionView; index: number }) {
  const forecast = competition.nextMatch;
  const summary = forecast.state === "scheduled"
    ? `${forecast.homeTeam} 对阵 ${forecast.awayTeam}，${forecast.dateLabel} ${forecast.timeLabel}。`
    : forecast.summary;
  return <article className={styles.currentCompetitionCard} data-home-forecast={competition.slug}>
    <header className={styles.currentCompetitionHeader}>
      <span>{String(index + 1).padStart(2, "0")} / {competition.formatLabel}</span>
      <Badge className={styles.currentBadge} tone={forecast.state === "scheduled" ? "success" : "neutral"}>{competition.statusLabel} · {forecast.label}</Badge>
    </header>
    <p className={styles.currentCompetitionMeta}>{competition.semesterLabel} · {competition.teamFormation}</p>
    <h3>{competition.name}</h3>
    <p className={styles.currentCompetitionSummary}>{summary}</p>
    <dl className={styles.currentCompetitionFacts}>
      <div><dt>当前阶段</dt><dd>{competition.stageLabel}</dd></div>
      <div><dt>比赛时间</dt><dd>{forecast.state === "scheduled" ? `${forecast.dateLabel} ${forecast.timeLabel}` : forecast.state === "pending" ? forecast.dateLabel : competition.matchWindow}</dd></div>
      <div><dt>比赛场地</dt><dd>{forecast.state === "scheduled" || forecast.state === "pending" ? forecast.venue : competition.venue}</dd></div>
    </dl>
    <Link className={styles.inlineLink} href={forecast.state === "scheduled" ? forecast.detailHref : competition.detailHref}>进入赛事主页 <span aria-hidden="true">→</span></Link>
  </article>;
}

export async function NextMatchForecast() {
  let competitions: PublicCompetitionView[] = [];
  let unavailable = false;
  try { competitions = await getHomepagePublicCompetitions(); } catch { unavailable = true; }
  return <section aria-labelledby="home-next-match-title" className={`${styles.section} ${styles.currentFootball}`} id="home-current-football">
    <div className={`page-shell ${styles.sectionShell}`}>
      <Panel className={styles.currentFootballPanel}>
        <div className={styles.currentFootballIntro}>
          <p className={styles.sectionEyebrow}>CURRENT FOOTBALL / 当前赛事</p>
          <h2 id="home-next-match-title">关注当前赛事最新安排</h2>
          <p>查看首页重点赛事的真实状态与下一场安排；未确认的时间、对阵和场地以正式公告为准。</p>
          <LinkButton className={styles.currentFootballAction} href="/competitions/schedule#published-matches" tone="secondary">查看赛程与赛果 <span aria-hidden="true">→</span></LinkButton>
        </div>
        <div className={styles.currentCompetitionGrid} data-count={competitions.length}>
          {unavailable ? <PublicLoadRetry label="当前赛事安排" /> : competitions.length ? competitions.map((competition, index) => <ForecastCard competition={competition} index={index} key={competition.id} />) : <div className="functional-empty"><strong>当前暂无首页重点赛事</strong><p>请前往赛事中心查看全部赛事与最新安排。</p></div>}
        </div>
      </Panel>
    </div>
  </section>;
}
