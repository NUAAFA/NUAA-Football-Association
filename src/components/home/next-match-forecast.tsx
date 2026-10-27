import { PublicLoadRetry } from "@/components/public-load-retry";
import Link from "next/link";
import { CompetitionFixture } from "@/components/competitions/competition-fixture";
import styles from "@/components/home/home-page.module.css";
import { Badge, LinkButton, Panel } from "@/components/ui/foundation-primitives";
import { getHomepagePublicCompetitions } from "@/lib/public-competition-service";
import type { PublicCompetitionView } from "@/types/competition-center";

function ForecastCard({ competition, index }: { competition: PublicCompetitionView; index: number }) {
  const forecast = competition.nextMatch;
  return <article className={styles.currentCompetitionCard} data-home-forecast={competition.slug}>
    <header className={styles.currentCompetitionHeader}>
      <span>{String(index + 1).padStart(2, "0")} / {competition.formatLabel}</span>
      <Badge className={styles.currentBadge} tone={competition.status === "ongoing" ? "success" : "neutral"}>{competition.statusLabel}</Badge>
    </header>
    <p className={styles.currentCompetitionMeta}>{competition.semesterLabel} · {competition.teamFormation}</p>
    <h3>{competition.name}</h3>
    <CompetitionFixture fixture={forecast} dark />
    <Link className={styles.inlineLink} href={competition.detailHref}>进入赛事主页 <span aria-hidden="true">→</span></Link>
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
          <div>
            <p className={styles.sectionEyebrow}>CURRENT FOOTBALL / 当前赛事</p>
            <h2 id="home-next-match-title">当前赛事，一览即达</h2>
            <p>关注正在开展的赛事，查看最新状态与下一场安排。</p>
          </div>
          <LinkButton className={styles.currentFootballAction} href="/competitions" tone="secondary">进入赛事中心 <span aria-hidden="true">→</span></LinkButton>
        </div>
        <div className={styles.currentCompetitionGrid} data-count={competitions.length}>
          {unavailable ? <PublicLoadRetry label="当前赛事安排" /> : competitions.length ? competitions.map((competition, index) => <ForecastCard competition={competition} index={index} key={competition.id} />) : <div className="functional-empty"><strong>当前暂无开展中的公开赛事</strong><p>请前往赛事中心查看全部赛事与最新安排。</p></div>}
        </div>
      </Panel>
    </div>
  </section>;
}
