import { PublicLoadRetry } from "@/components/public-load-retry";
import { CompetitionFixture } from "@/components/competitions/competition-fixture";
import styles from "@/components/home/home-page.module.css";
import { Badge, Card, LinkButton } from "@/components/ui/foundation-primitives";
import { getHomepagePublicCompetitions } from "@/lib/public-competition-service";

export async function CurrentCompetitions() {
  let competitions: Awaited<ReturnType<typeof getHomepagePublicCompetitions>> = [];
  let unavailable = false;
  try { competitions = await getHomepagePublicCompetitions(); } catch { unavailable = true; }
  const [featured, ...secondary] = competitions;
  return <section className={`${styles.section} ${styles.competitions}`} id="home-competitions" aria-labelledby="home-competitions-title">
    <div className={`page-shell ${styles.sectionShell}`}>
      <div className={styles.sectionHeading}>
        <div><p className={styles.sectionEyebrow}>COMPETITIONS / 赛事体系</p><h2 id="home-competitions-title">关注当前赛事，也重温完整赛季</h2></div>
        <div className={styles.headingActions}>
          <LinkButton href="/competitions" size="small" tone="quiet">赛事中心 <span aria-hidden="true">→</span></LinkButton>
          <LinkButton href="/competitions/history" size="small" tone="quiet">历届赛事 <span aria-hidden="true">→</span></LinkButton>
        </div>
      </div>
      {unavailable ? <PublicLoadRetry label="当前赛事" /> : featured ? <div className={styles.competitionLayout} data-count={secondary.length + 1}>
        <Card className={styles.featuredCompetition} id={featured.slug}>
          <div className={styles.featuredCompetitionTop}>
            <span>FEATURED / 重点关注</span>
            <Badge className={styles.featuredCompetitionBadge} tone={featured.status === "ongoing" ? "success" : "warning"}>{featured.statusLabel} · {featured.badge}</Badge>
          </div>
          <p className={styles.featuredCompetitionMeta}>{featured.semesterLabel} · {featured.formatLabel} · {featured.teamFormation}</p>
          <h3>{featured.name}</h3>
          <p className={styles.featuredCompetitionSummary}>{featured.summary}</p>
          <dl className={styles.featuredCompetitionFacts}>
            <div><dt>当前阶段</dt><dd>{featured.stageLabel}</dd></div>
            <div><dt>比赛周期</dt><dd>{featured.matchWindow}</dd></div>
            <div><dt>下一项安排</dt><dd>{featured.nextMatch.state === "scheduled" ? `${featured.nextMatch.homeTeam} vs ${featured.nextMatch.awayTeam} · ${featured.nextMatch.dateLabel} ${featured.nextMatch.timeLabel}` : featured.nextMatch.summary}</dd></div>
          </dl>
          <LinkButton className={styles.featuredCompetitionAction} href={featured.detailHref} tone="secondary">进入赛事主页 <span aria-hidden="true">↗</span></LinkButton>
          {featured.year !== null ? <span className={styles.competitionYear} aria-hidden="true">{featured.year}</span> : null}
        </Card>
        {secondary.length ? <div className={styles.competitionList}>{secondary.map((competition, index) => <Card className={styles.competitionCard} interactive id={competition.slug} key={competition.id}>
          <div className={styles.competitionCardIndex}>{String(index + 2).padStart(2, "0")}</div>
          <div className={styles.competitionCardCopy}>
            <div className={styles.competitionCardMeta}><span>{competition.semesterLabel} · {competition.formatLabel}</span><Badge tone={competition.status === "ongoing" ? "success" : "warning"}>{competition.statusLabel} · {competition.badge}</Badge></div>
            <h3>{competition.name}</h3><p>{competition.stageLabel}</p>
            {secondary.length === 1 ? <div className={styles.competitionExpandedDetails}>
              <p>{competition.summary}</p>
              <CompetitionFixture fixture={competition.nextMatch} />
            </div> : null}
            <LinkButton href={competition.detailHref} size="small" tone="quiet">进入赛事主页 <span aria-hidden="true">→</span></LinkButton>
          </div>
        </Card>)}</div> : null}
      </div> : <div className="functional-empty"><strong>当前暂无首页重点赛事</strong><p>赛事由管理员公开发布且尚未结束时，将在这里同步呈现。</p></div>}
    </div>
  </section>;
}
