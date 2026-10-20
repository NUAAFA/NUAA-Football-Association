"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Button, TableContainer } from "@/components/ui/foundation-primitives";
import type { PublicMatchRecord } from "@/types/competition-center";

import styles from "./match-centre.module.css";

function MatchScore({ match }: { match: PublicMatchRecord }) {
  return (
    <span
      aria-label={`${match.homeTeam} ${match.homeScore} 比 ${match.awayScore} ${match.awayTeam}${match.penaltyScore ? `，点球 ${match.penaltyScore}` : ""}`}
      className={styles.score}
    >
      <strong aria-hidden="true">{match.homeScore} : {match.awayScore}</strong>
      {match.penaltyScore ? <small aria-hidden="true">点球 {match.penaltyScore}</small> : null}
    </span>
  );
}

export function CompetitionScheduleExplorer({ matches }: { matches: readonly PublicMatchRecord[] }) {
  const [competition, setCompetition] = useState("all");
  const [stage, setStage] = useState("all");
  const [team, setTeam] = useState("all");
  const [visibleCount, setVisibleCount] = useState(12);

  const competitions = useMemo(
    () => Array.from(new Map(matches.map((match) => [match.competitionId, match.competitionName]))),
    [matches],
  );
  const stages = useMemo(
    () => Array.from(new Set(matches
      .filter((match) => competition === "all" || match.competitionId === competition)
      .map((match) => match.stage))),
    [competition, matches],
  );
  const teams = useMemo(
    () => Array.from(new Set(matches
      .filter((match) => competition === "all" || match.competitionId === competition)
      .flatMap((match) => [match.homeTeam, match.awayTeam])))
      .sort((a, b) => a.localeCompare(b, "zh-CN")),
    [competition, matches],
  );

  const filteredMatches = matches.filter((match) => {
    if (competition !== "all" && match.competitionId !== competition) return false;
    if (stage !== "all" && match.stage !== stage) return false;
    if (team !== "all" && match.homeTeam !== team && match.awayTeam !== team) return false;
    return true;
  });
  const visibleMatches = filteredMatches.slice(0, visibleCount);
  const selectedCompetitionName = competition === "all"
    ? "全部赛事"
    : competitions.find(([id]) => id === competition)?.[1] ?? "已发布比赛";

  function resetDependentFilters() {
    setStage("all");
    setTeam("all");
    setVisibleCount(12);
  }

  return (
    <>
      <div className={styles.filters} aria-label="赛程筛选">
        <label>
          <span>赛事</span>
          <select
            value={competition}
            onChange={(event) => {
              setCompetition(event.target.value);
              resetDependentFilters();
            }}
          >
            <option value="all">全部赛事</option>
            {competitions.map(([id, name]) => <option value={id} key={id}>{name}</option>)}
          </select>
        </label>
        <label>
          <span>阶段</span>
          <select
            value={stage}
            onChange={(event) => {
              setStage(event.target.value);
              setVisibleCount(12);
            }}
          >
            <option value="all">全部阶段</option>
            {stages.map((item) => <option value={item} key={item}>{item}</option>)}
          </select>
        </label>
        <label>
          <span>球队</span>
          <select
            value={team}
            onChange={(event) => {
              setTeam(event.target.value);
              setVisibleCount(12);
            }}
          >
            <option value="all">全部球队</option>
            {teams.map((item) => <option value={item} key={item}>{item}</option>)}
          </select>
        </label>
        <p className={styles.filterSummary} aria-live="polite">
          按时间由近至远 · 共 {filteredMatches.length} 场比赛 · 当前显示 {visibleMatches.length} 场
        </p>
      </div>

      {filteredMatches.length ? (
        <>
          <div className={styles.matchGroups}>
            <section className={styles.matchGroup} aria-labelledby="visible-published-matches">
              <header className={styles.matchGroupHeader}>
                <div>
                  <span className={styles.matchGroupEyebrow}>PUBLISHED MATCHES</span>
                  <h3 id="visible-published-matches">{selectedCompetitionName}</h3>
                </div>
                <span>{visibleMatches.length} 场当前结果</span>
              </header>

              <TableContainer className={styles.tableRegion} label={`${selectedCompetitionName}已发布比赛记录`}>
                <table className={styles.matchTable}>
                  <caption className="sr-only">{selectedCompetitionName}已发布比赛记录</caption>
                  <thead>
                    <tr>
                      <th scope="col">日期 / 时间</th>
                      <th scope="col">赛事 / 阶段</th>
                      <th scope="col">主队</th>
                      <th scope="col">比分</th>
                      <th scope="col">客队</th>
                      <th scope="col">场地</th>
                      <th scope="col">状态</th>
                      <th scope="col">入口</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleMatches.map((match) => (
                      <tr key={match.id}>
                        <td className={styles.dateCell}><strong>{match.dateLabel}</strong><small>{match.timeLabel}</small></td>
                        <td className={styles.stageCell}><Link href={match.competitionHref}>{match.competitionName}</Link><small>{match.stage}</small></td>
                        <td className={styles.teamCell}>{match.homeTeam}</td>
                        <td><MatchScore match={match} /></td>
                        <td className={styles.teamCell}>{match.awayTeam}</td>
                        <td>{match.venue}</td>
                        <td><span className={styles.statusLabel}>{match.statusLabel}</span></td>
                        <td className={styles.tableActions}>
                          <Link href={match.detailHref}>比赛详情</Link>
                          {match.refereeHref ? <Link href={match.refereeHref}>裁判选派</Link> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableContainer>

              <div className={styles.matchCards} aria-label={`${selectedCompetitionName}移动端比赛记录`}>
                {visibleMatches.map((match) => (
                  <article className={styles.matchCard} key={match.id}>
                    <header>
                      <span>{match.competitionName} · {match.stage}</span>
                      <time dateTime={match.dateTime}>{match.dateLabel} {match.timeLabel}</time>
                    </header>
                    <div className={styles.mobileMatchup}>
                      <strong>{match.homeTeam}</strong>
                      <MatchScore match={match} />
                      <strong>{match.awayTeam}</strong>
                    </div>
                    <div className={styles.mobileMeta}>
                      <span>{match.venue}</span>
                      <span className={styles.statusLabel}>{match.statusLabel}</span>
                    </div>
                    <footer>
                      <Link href={match.detailHref}>比赛详情 →</Link>
                      {match.refereeHref ? <Link href={match.refereeHref}>裁判选派 →</Link> : null}
                    </footer>
                  </article>
                ))}
              </div>
            </section>
          </div>
          {visibleCount < filteredMatches.length ? (
            <Button
              className={styles.loadMore}
              tone="secondary"
              onClick={() => setVisibleCount((count) => count + 12)}
            >
              查看更多比赛（剩余 {filteredMatches.length - visibleCount} 场）
            </Button>
          ) : null}
        </>
      ) : (
        <div className={styles.emptyState}>
          <strong>没有符合条件的比赛</strong>
          <p>请调整赛事、阶段或球队筛选条件。</p>
        </div>
      )}
    </>
  );
}
