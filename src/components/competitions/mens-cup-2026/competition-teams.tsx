import { mensIntercollegeCup2026 } from "@/data/mens-intercollege-cup-2026";

export function CompetitionTeams() {
  const { teams } = mensIntercollegeCup2026;

  return (
    <section className="cup-archive-section" id="teams" aria-labelledby="cup-teams-title">
      <div className="page-shell">
        <div className="cup-section-heading">
          <div><p>TEAMS & PUBLIC ROSTERS</p><h2 id="cup-teams-title">参赛球队及公开名单</h2></div>
          <span>赛事汇总记录169名注册球员，下方展示公开名单姓名与号码；公开名单覆盖与赛事汇总分别保留。</span>
        </div>
        <div className="cup-team-list">
          {teams.map((team, index) => (
            <details key={team.id} open={index === 0}>
              <summary>
                <span>{team.group}组</span>
                <div><strong>{team.displayName}</strong>{team.officialName !== team.displayName ? <small>秩序册名称：{team.officialName}</small> : null}</div>
                <p>领队：{team.leader}</p>
                <b>{team.players.length}<small>公开名单</small></b>
                <i aria-hidden="true">＋</i>
              </summary>
              <div className="cup-team-roster">
                <section><p>PLAYER ROSTER</p><h3>球员名单</h3><p>领队：{team.leader}</p><div>{team.players.map((player) => <span key={`${player.number}-${player.name}`}><b>{player.number}</b>{player.name}</span>)}</div></section>
                <aside><p>TEAM OFFICIALS</p><h3>球队工作人员</h3>{team.officials.length ? <dl>{team.officials.map((official) => <div key={`${official.role}-${official.name}`}><dt>{official.role}</dt><dd>{official.name}</dd></div>)}</dl> : <span>暂无公开球队工作人员信息。</span>}</aside>
              </div>
            </details>
          ))}
        </div>
        <p className="cup-source-note">公开名单不展示学号、手机号或邮箱。</p>
      </div>
    </section>
  );
}
