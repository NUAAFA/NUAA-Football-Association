import { mensIntercollegeCup2026 } from "@/data/mens-intercollege-cup-2026";

import { formatArchiveDate } from "./archive-utils";

export function CompetitionOverview() {
  const { competition } = mensIntercollegeCup2026;
  const overviewStats = [
    [competition.summary.teams, "参赛球队"],
    [competition.summary.registeredPlayers, "注册球员（赛事汇总）"],
    [competition.summary.matches, "完成比赛"],
    [competition.summary.goals, "赛事进球"],
  ] as const;

  return (
    <section className="cup-archive-section cup-overview-section" id="overview" aria-labelledby="cup-overview-title">
      <div className="page-shell">
        <div className="cup-section-heading">
          <div><p>COMPETITION PROFILE</p><h2 id="cup-overview-title">赛事概览</h2></div>
          <span>2025—2026学年第二学期 · 天目湖校区 · 十一人制院系赛事</span>
        </div>

        <div className="cup-overview-grid">
          <article className="cup-overview-primary">
            <p>OFFICIAL ARCHIVE</p>
            <h3>{competition.shortName}</h3>
            <dl>
              <div><dt>比赛日期</dt><dd>{formatArchiveDate(competition.startDate)}—{formatArchiveDate(competition.endDate)}</dd></div>
              <div><dt>比赛地点</dt><dd>{competition.venue}</dd></div>
              <div><dt>竞赛形式</dt><dd>{competition.formatLabel} · {competition.teamFormation}</dd></div>
              <div><dt>承办单位</dt><dd>{competition.organizers.organizer}</dd></div>
            </dl>
            <a className="cup-document-link" href={competition.guidebook} download>
              <span>PDF</span><strong>下载赛事秩序册</strong><b aria-hidden="true">↓</b>
            </a>
          </article>

          <div className="cup-overview-secondary">
            <section>
              <p>COMPETITION FORMAT</p>
              <h3>赛制与时间</h3>
              <ul>
                <li>{competition.structure.groupStage}</li>
                <li>{competition.structure.knockoutStage}</li>
                <li>比赛时间：{competition.structure.matchDuration}</li>
              </ul>
            </section>
            <section>
              <p>HOSTS</p>
              <h3>主办单位</h3>
              <ul>{competition.organizers.hosts.map((host) => <li key={host}>{host}</li>)}</ul>
            </section>
          </div>
        </div>

        <div className="cup-overview-stats" aria-label="赛事核心数据">
          {overviewStats.map(([value, label]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}
        </div>
        <p className="cup-source-note">资料来源：{competition.source}。169为赛事汇总人数，不代表下方公开名单的逐人列举总数。</p>
      </div>
    </section>
  );
}
