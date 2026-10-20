import { mensIntercollegeCup2026 } from "@/data/mens-intercollege-cup-2026";

export function CompetitionStatistics() {
  const { statistics } = mensIntercollegeCup2026;

  return (
    <section className="cup-archive-section cup-archive-section-tint" id="statistics" aria-labelledby="cup-statistics-title">
      <div className="page-shell">
        <div className="cup-section-heading">
          <div><p>PLAYER DATA & DISCIPLINE</p><h2 id="cup-statistics-title">射手与纪律</h2></div>
          <span>赛事共记录69粒进球、36张黄牌和8张红牌。</span>
        </div>

        <div className="cup-statistics-layout">
          <article className="cup-scorers-panel">
            <header><p>TOP SCORERS</p><h3>射手榜</h3><span>已清晰核对的主要条目</span></header>
            <div className="cup-stat-table-wrap" role="region" aria-label="主要射手记录，可横向滚动查看完整表格" tabIndex={0}>
              <table className="cup-stat-table"><caption className="sr-only">已清晰核对的主要射手记录</caption><thead><tr><th scope="col">排名</th><th scope="col">球员</th><th scope="col">球队</th><th scope="col">号码</th><th scope="col">进球</th></tr></thead><tbody>{statistics.topScorers.map((item) => <tr key={`${item.player}-${item.team}`}><td>{item.position}</td><td><strong>{item.player}</strong></td><td>{item.team}</td><td>#{item.number}</td><td><b>{item.goals}</b></td></tr>)}</tbody></table>
            </div>
            <div className="cup-stat-mobile">{statistics.topScorers.map((item) => <div key={`${item.player}-${item.team}`}><span>{item.position}</span><section><strong>{item.player} <small>#{item.number}</small></strong><p>{item.team}</p></section><b>{item.goals}<small>球</small></b></div>)}</div>
          </article>

          <aside className="cup-discipline-panel">
            <div className="cup-discipline-summary"><article><strong>{statistics.summary.yellowCards}</strong><span>黄牌</span></article><article><strong>{statistics.summary.redCards}</strong><span>红牌</span></article></div>
            <section><p>DISCIPLINE LEADERS</p><h3>主要纪律记录</h3>{statistics.disciplineLeaders.map((item) => <div className="cup-discipline-row" key={`${item.player}-${item.team}`}><span>#{item.number}</span><strong>{item.player}</strong><small>{item.team}</small><b>{item.yellowCards}黄{item.redCards ? ` · ${item.redCards}红` : ""}</b></div>)}</section>
          </aside>
        </div>

        <div className="cup-red-card-panel">
          <div><p>RED CARD RECORDS</p><h3>全部红牌记录</h3></div>
          <div>{statistics.redCards.map((item) => <article key={`${item.player}-${item.team}`}><span>#{item.number}</span><strong>{item.player}</strong><small>{item.team}</small></article>)}</div>
        </div>
      </div>
    </section>
  );
}
