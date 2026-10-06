import Image from "next/image";

import { mensIntercollegeCup2026 } from "@/data/mens-intercollege-cup-2026";

import { formatMatchDateTime, formatMatchScore, formatMatchTime } from "./archive-utils";

const eventLabels: Record<string, string> = {
  goal: "进球",
  "yellow-card": "黄牌",
  "red-card": "红牌",
};

export function CompetitionFinal() {
  const { competition, matches } = mensIntercollegeCup2026;
  const knockoutMatches = matches.filter((match) => match.stage === "knockout");
  const final = matches.find((match) => match.round === "决赛");
  if (!final) throw new Error("2026 men's cup final is missing");

  const teamNames = new Map([
    [final.homeTeamId, final.homeTeam],
    [final.awayTeamId, final.awayTeam],
  ]);

  return (
    <section className="cup-archive-section cup-final-section" id="honours" aria-labelledby="cup-final-title">
      <div className="page-shell">
        <div className="cup-section-heading cup-section-heading-light">
          <div><p>HONOURS & FINAL</p><h2 id="cup-final-title">名次与奖项</h2></div>
          <span>致慧书院在决赛点球大战第八轮锁定冠军。</span>
        </div>

        <div className="cup-final-ranking" aria-label="最终名次">
          {competition.finalRanking.map((item) => <div key={item.position}><span>{String(item.position).padStart(2, "0")}</span><strong>{item.team}</strong><small>{item.position === 1 ? "冠军" : item.position === 2 ? "亚军" : item.position === 3 ? "季军" : "第四名"}</small></div>)}
        </div>
        <div className="cup-awards-panel">
          <div><p>SEASON AWARDS</p><h3>赛事奖项</h3></div>
          <div>{competition.awards.map((award, index) => <article key={award.key}><span>0{index + 1}</span><p>{award.name}</p><strong>{award.recipient}</strong><small>{award.team}</small></article>)}</div>
        </div>

        <div className="cup-knockout-grid">
          {knockoutMatches.map((match) => (
            <article className={match.round === "决赛" ? "is-final" : undefined} key={match.id}>
              <header><span>{match.round}</span><time>{formatMatchDateTime(match.dateTime)}</time></header>
              <div><strong>{match.homeTeam}</strong><b>{formatMatchScore(match)}</b><strong>{match.awayTeam}</strong></div>
            </article>
          ))}
        </div>

        <div className="cup-final-story">
          <div className="cup-final-image">
            <Image src={competition.championImage} alt="致慧书院夺得2026男子足球院际杯冠军后合影" fill sizes="(max-width: 900px) 100vw, 50vw" />
          </div>
          <article className="cup-final-scorecard">
            <p>CHAMPIONSHIP MATCH</p>
            <span>2026年5月17日 · 天目湖校区西操场</span>
            <div className="cup-final-score"><strong>{final.homeTeam}</strong><b>{final.homeScore}<i>:</i>{final.awayScore}</b><strong>{final.awayTeam}</strong></div>
            <p className="cup-final-penalty">点球大战 {final.homePenaltyScore}:{final.awayPenaltyScore} · 致慧书院总比分 10:9 夺冠</p>
            <dl><div><dt>赛前活动</dt><dd>{final.preMatchActivityTime ? formatMatchTime(final.preMatchActivityTime) : "13:30"}</dd></div><div><dt>正式开球</dt><dd>{formatMatchTime(final.dateTime)}</dd></div></dl>
          </article>
        </div>

        <div className="cup-final-detail-grid">
          <article className="cup-final-timeline">
            <header><p>MATCH TIMELINE</p><h3>决赛时间线</h3></header>
            <ol>
              <li><time>13:30</time><div><strong>赛前活动</strong><span>赛前活动时间，非正式开球时间。</span></div></li>
              <li><time>14:00</time><div><strong>正式开球</strong><span>{final.homeTeam} 对阵 {final.awayTeam}</span></div></li>
              {final.events?.map((event, index) => (
                <li key={`${event.minute}-${event.player}-${index}`}>
                  <time>{event.minute}&apos;</time>
                  <div><strong>{eventLabels[event.type] ?? event.type} · {event.player} #{event.number}</strong><span>{teamNames.get(event.teamId) ?? event.teamId}</span></div>
                </li>
              ))}
            </ol>
          </article>

          <article className="cup-shootout">
            <header><p>PENALTY SHOOTOUT</p><h3>八轮点球大战</h3></header>
            <div className="cup-shootout-head"><span>轮次</span><span>{final.homeTeam}</span><span>{final.awayTeam}</span></div>
            {final.penaltyShootout?.map((round) => (
              <div className="cup-shootout-row" key={round.order}>
                <b>{round.order}</b>
                <span>{round.homePlayer}<i className={round.homeScored ? "is-scored" : "is-missed"}>{round.homeScored ? "✓" : "×"}</i></span>
                <span>{round.awayPlayer}<i className={round.awayScored ? "is-scored" : "is-missed"}>{round.awayScored ? "✓" : "×"}</i></span>
              </div>
            ))}
          </article>
        </div>


      </div>
    </section>
  );
}
