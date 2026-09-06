import Link from "next/link";

import { TableContainer } from "@/components/ui/foundation-primitives";

export type ArchiveMatchRow = {
  id: string;
  number: string;
  stage: string;
  date: string;
  time: string;
  homeTeam: string;
  awayTeam: string;
  score: string;
  scoreNote?: string;
  venue: string;
};

export function ArchiveMatchTable({ rows, caption }: { rows: readonly ArchiveMatchRow[]; caption: string }) {
  return (
    <>
      <TableContainer className="cup-results-table-wrap" label={caption}>
        <table className="cup-results-table">
          <caption>{caption}</caption>
          <thead><tr><th scope="col">场次</th><th scope="col">阶段</th><th scope="col">日期 / 时间</th><th scope="col">主队</th><th scope="col">比分</th><th scope="col">客队</th><th scope="col">场地</th><th scope="col">入口</th></tr></thead>
          <tbody>{rows.map((row) => <tr id={row.id} key={row.id}><td>{row.number}</td><td>{row.stage}</td><td><strong>{row.date}</strong><small>{row.time}</small></td><td><strong>{row.homeTeam}</strong></td><td><b>{row.score}</b>{row.scoreNote ? <small>{row.scoreNote}</small> : null}</td><td><strong>{row.awayTeam}</strong></td><td>{row.venue}</td><td><Link href={`#${row.id}`}>比赛详情</Link><Link href="#officials">裁判选派</Link></td></tr>)}</tbody>
        </table>
      </TableContainer>
      <div className="cup-results-mobile" aria-label={`${caption}移动端列表`}>
        {rows.map((row) => <article id={`mobile-${row.id}`} key={row.id}><header><span>{row.number} · {row.stage}</span><time>{row.date} {row.time}</time></header><div><strong>{row.homeTeam}</strong><b>{row.score}{row.scoreNote ? <small>{row.scoreNote}</small> : null}</b><strong>{row.awayTeam}</strong></div><footer><span>{row.venue}</span><Link href="#officials">裁判选派 →</Link></footer></article>)}
      </div>
    </>
  );
}

export type ArchiveStandingRow = {
  id: string;
  position: number;
  team: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
};

export function ArchiveStandingTable({ rows, caption }: { rows: readonly ArchiveStandingRow[]; caption: string }) {
  return (
    <>
      <TableContainer className="cup-standing-table-wrap" label={caption}>
        <table className="cup-standing-table">
          <caption className="sr-only">{caption}</caption>
          <thead><tr><th scope="col">排名</th><th scope="col">球队</th><th scope="col">赛</th><th scope="col">胜</th><th scope="col">平</th><th scope="col">负</th><th scope="col">进</th><th scope="col">失</th><th scope="col">净胜</th><th scope="col">积分</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id}><td>{row.position}</td><td><strong>{row.team}</strong></td><td>{row.played}</td><td>{row.won}</td><td>{row.drawn}</td><td>{row.lost}</td><td>{row.goalsFor}</td><td>{row.goalsAgainst}</td><td>{row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}</td><td><b>{row.points}</b></td></tr>)}</tbody>
        </table>
      </TableContainer>
      <div className="cup-standing-mobile" aria-label={`${caption}移动端列表`}>
        {rows.map((row) => <div key={row.id}><span>{row.position}</span><section><strong>{row.team}</strong><small>{row.played}场 · {row.won}胜 {row.drawn}平 {row.lost}负 · 净胜{row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}</small></section><b>{row.points}<small>分</small></b></div>)}
      </div>
    </>
  );
}
