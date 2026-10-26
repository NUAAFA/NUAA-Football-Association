import styles from "@/components/competitions/archive/archive-sections.module.css";
import { womensIntercollegeCup2026 } from "@/data/womens-intercollege-cup-2026";

export function WomensCompetitionStatistics() {
  const { discipline, scorers } = womensIntercollegeCup2026;
  return (
    <section className="cup-archive-section cup-archive-section-tint" id="statistics" aria-labelledby="womens-statistics-title">
      <div className="page-shell">
        <div className="cup-section-heading"><div><p>SCORERS & DISCIPLINE</p><h2 id="womens-statistics-title">射手与纪律</h2></div><span>个人奖项与平台纪律汇总分别记录。</span></div>
        <div className={styles.records}>
          <section>
            <p className={styles.eyebrow}>SCORERS</p><h3>射手记录</h3>
            {scorers.leaders.map((player) => <article key={player.name}><strong>{player.name}</strong><span>{player.basis}</span><small>个人进球数：暂未公布</small></article>)}
            <p>{scorers.note}</p>
          </section>
          <section>
            <p className={styles.eyebrow}>DISCIPLINE</p><h3>纪律记录</h3>
            <dl><div><dt>平台汇总黄牌</dt><dd>{discipline.summaryYellowCards}</dd></div><div><dt>平台汇总红牌</dt><dd>{discipline.summaryRedCards}</dd></div></dl>
            <p>以上为赛事平台汇总。现有资料中的个别纪律记录与汇总口径尚待核对，暂未列入个人纪律表。</p>
          </section>
        </div>
      </div>
    </section>
  );
}
