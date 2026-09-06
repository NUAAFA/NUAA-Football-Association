import styles from "@/components/home/home-page.module.css";
import {
  Badge,
  Card,
  LinkButton,
} from "@/components/ui/foundation-primitives";
import { annualCompetitions } from "@/data/competitions";

export function CurrentCompetitions() {
  const featured = annualCompetitions.find((item) => item.displayStatus.key === "preparing") ?? annualCompetitions[0];
  const secondary = annualCompetitions.filter((item) => item.id !== featured.id);

  return (
    <section className={`${styles.section} ${styles.competitions}`} id="home-competitions" aria-labelledby="home-competitions-title">
      <div className={`page-shell ${styles.sectionShell}`}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.sectionEyebrow}>COMPETITIONS / 赛事体系</p>
            <h2 id="home-competitions-title">关注正在筹备的赛事，也重温完整赛季</h2>
          </div>
          <div className={styles.headingActions}>
            <LinkButton href="/competitions" size="small" tone="quiet">赛事中心 <span aria-hidden="true">→</span></LinkButton>
            <LinkButton href="/competitions/history" size="small" tone="quiet">历届赛事 <span aria-hidden="true">→</span></LinkButton>
          </div>
        </div>
        <div className={styles.competitionLayout}>
          <Card className={styles.featuredCompetition} id={featured.slug}>
            <div className={styles.featuredCompetitionTop}>
              <span>UP NEXT / 重点关注</span>
              <Badge className={styles.featuredCompetitionBadge} tone="warning">
                {featured.displayStatus.label} · {featured.displayStatus.badge}
              </Badge>
            </div>
            <p className={styles.featuredCompetitionMeta}>{featured.semesterLabel} · {featured.formatLabel} · {featured.teamFormation}</p>
            <h3>{featured.name}</h3>
            <p className={styles.featuredCompetitionSummary}>{featured.summary}</p>
            <dl className={styles.featuredCompetitionFacts}>
              <div><dt>当前阶段</dt><dd>{featured.stageLabel}</dd></div>
              <div><dt>报名安排</dt><dd>{featured.registrationWindow}</dd></div>
              <div><dt>赛程安排</dt><dd>{featured.matchWindow}</dd></div>
            </dl>
            <LinkButton className={styles.featuredCompetitionAction} href={featured.detailHref} tone="secondary">
              进入赛事主页 <span aria-hidden="true">↗</span>
            </LinkButton>
            <span className={styles.competitionYear} aria-hidden="true">2026</span>
          </Card>
          <div className={styles.competitionList}>
            {secondary.map((competition, index) => (
              <Card className={styles.competitionCard} interactive id={competition.slug} key={competition.id}>
                <div className={styles.competitionCardIndex}>0{index + 2}</div>
                <div className={styles.competitionCardCopy}>
                  <div className={styles.competitionCardMeta}>
                    <span>{competition.semesterLabel} · {competition.formatLabel}</span>
                    <Badge tone={competition.displayStatus.key === "preparing" ? "warning" : "neutral"}>
                      {competition.displayStatus.label} · {competition.displayStatus.badge}
                    </Badge>
                  </div>
                  <h3>{competition.name}</h3>
                  <p>{competition.stageLabel}</p>
                  <LinkButton href={competition.detailHref} size="small" tone="quiet">
                    {competition.displayStatus.key === "completed" ? "查看赛事档案" : "进入赛事主页"}
                    <span aria-hidden="true">→</span>
                  </LinkButton>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
