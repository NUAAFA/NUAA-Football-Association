import { womensIntercollegeCup2026 } from "@/data/womens-intercollege-cup-2026";

export function WomensCompetitionTeams() {
  const { rosters } = womensIntercollegeCup2026;

  return (
    <section className="cup-archive-section" id="teams" aria-labelledby="womens-teams-title">
      <div className="page-shell">
        <div className="cup-section-heading">
          <div><p>TEAMS & PUBLIC ROSTERS</p><h2 id="womens-teams-title">参赛球队及公开名单</h2></div>
          <span>赛事汇总记录24名注册球员，公开名单来源尚不完整，下方仅展示已公开信息。</span>
        </div>
        <div className="cup-team-list cup-womens-roster-list">
          {rosters.map((roster, index) => (
            <details key={roster.team} open={index === 0}>
              <summary>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div><strong>{roster.team}</strong><small>{roster.coverage === "verified" ? "公开名单" : roster.players.length ? "部分名单" : "名单待补充"}</small></div>
                <p>领队：{roster.staff.find((person) => person.role === "领队")?.name ?? "暂未公布"}</p>
                <b>{roster.players.length}<small>公开球员</small></b>
                <i aria-hidden="true">+</i>
              </summary>
              <div className="cup-team-roster">
                <section>
                  <p>PLAYER ROSTER</p>
                  <h3>球员名单</h3>
                  {roster.players.length ? <div>{roster.players.map((player) => <span key={`${roster.team}-${player.number}`}><b>{player.number}</b>{player.name}</span>)}</div> : <p>暂无公开球员姓名。</p>}
                </section>
                <aside>
                  <p>TEAM OFFICIALS</p><h3>球队工作人员</h3>
                  {roster.staff.length ? <dl>{roster.staff.map((person) => <div key={`${person.role}-${person.name}`}><dt>{person.role}</dt><dd>{person.name}</dd></div>)}</dl> : <span>暂无公开工作人员姓名。</span>}
                </aside>
              </div>
            </details>
          ))}
        </div>
        <p className="cup-source-note">公开名单不展示学号、手机号或邮箱。</p>

      </div>
    </section>
  );
}
