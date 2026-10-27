import type { HistoricalCompetition } from "@/data/historical-competitions";
import styles from "@/app/competitions/history/history.module.css";

export function HistoricalRecordDetails({ competition, year }: { competition: HistoricalCompetition; year: number }) {
  return <div className={styles.recordBody}>
    {competition.teamCount || competition.startDate || competition.venue ? <dl className={styles.facts}>
      {competition.teamCount ? <div><dt>参赛队伍</dt><dd>{competition.teamCount}支</dd></div> : null}
      {competition.startDate ? <div><dt>赛事起始日期</dt><dd>{competition.startDate}</dd></div> : null}
      {competition.venue ? <div><dt>决赛场地</dt><dd>{competition.venue}</dd></div> : null}
    </dl> : null}
    {competition.final ? <section className={styles.final}><span>决赛</span><div><strong>{competition.final.home}</strong><b>{competition.final.score}</b><strong>{competition.final.away}</strong></div><small>{competition.final.date}</small></section> : null}
    {competition.standings?.length ? <section className={styles.ranking}><h2>{year === 2024 ? "公开名次" : "最终名次"}</h2><ol>
      {competition.standings.map((standing) => <li key={`${competition.id}-${standing.position}`}><span>{standing.position}</span><div><strong>{standing.team}</strong>{standing.record ? <small>{standing.record}{standing.goals ? ` · 进/失 ${standing.goals}` : ""}</small> : null}</div>{standing.points !== undefined ? <b>{standing.points}分</b> : null}</li>)}
    </ol></section> : null}
    {competition.officials?.length ? <section className={styles.officials}><h2>决赛裁判组</h2><dl>{competition.officials.map((official) => <div key={official.role}><dt>{official.role}</dt><dd>{official.name}</dd></div>)}</dl></section> : null}
    {competition.note ? <p className={styles.note}>{competition.note}</p> : null}
  </div>;
}
