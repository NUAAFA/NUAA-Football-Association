import styles from "@/components/competitions/archive/archive-sections.module.css";
import { womensIntercollegeCup2026 } from "@/data/womens-intercollege-cup-2026";

export function WomensCompetitionStatistics() {
  const { discipline, scorers } = womensIntercollegeCup2026;
  return (
    <section className="cup-archive-section cup-archive-section-tint" id="statistics" aria-labelledby="womens-statistics-title">
      <div className="page-shell">
        <div className="cup-section-heading"><div><p>SCORERS & DISCIPLINE</p><h2 id="womens-statistics-title">射手与纪律</h2></div><span>金靴奖按{scorers.scope}进球统计。</span></div>
        <div className={styles.records}>
          <section>
            <p className={styles.eyebrow}>SCORERS</p><h3>金靴奖射手记录</h3>
            {scorers.leaders.map((player) => <article key={player.name}><strong>{player.name} · {player.basis}</strong><span>#{player.number} · {player.team}</span><small>{scorers.scope}进球：{player.goals}球</small></article>)}
            <p>{scorers.note}</p>
          </section>
          <section>
            <p className={styles.eyebrow}>DISCIPLINE</p><h3>纪律记录</h3>
            <dl><div><dt>平台汇总黄牌</dt><dd>{discipline.summaryYellowCards}</dd></div><div><dt>平台汇总红牌</dt><dd>{discipline.summaryRedCards}</dd></div></dl>
            {discipline.publishedRecords.map((record) => <article key={`${record.team}-${record.role}-${record.name}`}><strong>{record.name} · {record.role}</strong><span>{record.team}</span><small>工作人员累计：{record.yellowCards}黄 / {record.redCards}红</small></article>)}
            <p>{discipline.note}</p>
          </section>
        </div>
      </div>
    </section>
  );
}
