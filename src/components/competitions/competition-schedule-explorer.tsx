"use client";

import Link from "next/link";
import { useState } from "react";

import { Button, TableContainer } from "@/components/ui/foundation-primitives";
import type { PublicMatchRecord } from "@/types/competition-center";
import { CompetitionDataModules, DataViewBack, dataViewHref } from "./competition-data-navigation";
import { CompetitionSeasonFilter } from "./competition-season-filter";
import navigation from "./competition-data-navigation.module.css";

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

export function CompetitionScheduleExplorer({ matches, season, competitionId }: { matches: readonly PublicMatchRecord[]; season?: string; competitionId?: string }) {
  const [stage, setStage] = useState("all");
  const [team, setTeam] = useState("all");
  const [visibleCount, setVisibleCount] = useState(12);
  const seasons = Array.from(new Set(matches.map((match) => Number(match.dateTime.slice(0, 4))))).sort((a, b) => b - a);
  const selectedSeason = seasons.includes(Number(season)) ? Number(season) : seasons[0];
  const seasonMatches = matches.filter((match) => Number(match.dateTime.slice(0, 4)) === selectedSeason);
  const competitions = Array.from(new Map(seasonMatches.map((match) => [match.competitionId, match.competitionName])));
  const selectedCompetitionName = competitions.find(([id]) => id === competitionId)?.[1];
  const competitionMatches = seasonMatches.filter((match) => match.competitionId === competitionId);
  const pathname = "/competitions/schedule";
  const anchor = "archived-matches-title";
  const stages = Array.from(new Set(competitionMatches.map((match) => match.stage)));
  const teams = Array.from(new Set(competitionMatches.flatMap((match) => [match.homeTeam, match.awayTeam])))
    .sort((a, b) => a.localeCompare(b, "zh-CN"));

  const filteredMatches = competitionMatches.filter((match) => {
    if (stage !== "all" && match.stage !== stage) return false;
    if (team !== "all" && match.homeTeam !== team && match.awayTeam !== team) return false;
    return true;
  });
  const visibleMatches = filteredMatches.slice(0, visibleCount);
  const toolbar = <div className={navigation.toolbar}>
    <div><h3>{selectedSeason} 年赛事档案</h3><p>{competitions.length} 项赛事 · {selectedCompetitionName ? "历史赛果 · 按时间由近至远" : "选择赛事，查看已完成比赛"}</p></div>
    <CompetitionSeasonFilter seasons={seasons} selectedSeason={selectedSeason} pathname={pathname} anchor={anchor} />
  </div>;

  if (!matches.length) return <div className={styles.emptyState}><strong>当前暂无历史归档比赛</strong></div>;
  if (!selectedCompetitionName) return <>
    {toolbar}
    {competitionId ? <p className={styles.recordNote}>该年份下暂无此赛事，请重新选择。</p> : null}
    <CompetitionDataModules label="历史赛程赛事选择" items={competitions.map(([id, name]) => ({
      id, title: name.replace(/^\d{4}/, ""), meta: `${selectedSeason} 年归档`,
      description: "已完成比赛与原始赛果，进入后可查看比赛详情及裁判选派。",
      count: `${seasonMatches.filter((match) => match.competitionId === id).length} 场比赛`, action: "查看比赛",
      href: dataViewHref(pathname, { season: selectedSeason, archive: id }, anchor),
    }))} />
  </>;

  return (
    <>
      {toolbar}
      <DataViewBack href={dataViewHref(pathname, { season: selectedSeason }, anchor)} />
      <p className={styles.archiveScope}>历史档案保留原始已完成比赛记录，不代表当前或未来赛程。</p>

      <section className={styles.matchGroup} aria-labelledby="visible-archived-matches">
        <header className={styles.matchGroupHeader}>
          <div><span className={styles.matchGroupEyebrow}>ARCHIVED MATCHES</span><h3 id="visible-archived-matches">{selectedCompetitionName}</h3></div>
          <Link className={styles.archiveLink} href={competitionMatches[0].competitionHref}>进入赛事档案 →</Link>
        </header>
      <div className={navigation.inlineFilters} role="group" aria-label="历史赛程筛选">
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
        <p aria-live="polite">
          共 {filteredMatches.length} 场 · 当前显示 {visibleMatches.length} 场
        </p>
      </div>

      {filteredMatches.length ? (
        <>
              <TableContainer className={styles.tableRegion} label={`${selectedCompetitionName}已发布比赛记录`}>
                <table className={styles.matchTable}>
                  <caption className="sr-only">{selectedCompetitionName}已发布比赛记录</caption>
                  <thead>
                    <tr>
                      <th scope="col">日期 / 时间</th>
                      <th scope="col">阶段</th>
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
                        <td className={styles.stageCell}>{match.stage}</td>
                        <td className={styles.teamCell}>{match.homeTeam}</td>
                        <td><MatchScore match={match} /></td>
                        <td className={styles.teamCell}>{match.awayTeam}</td>
                        <td>{match.venue}</td>
                        <td><span className={styles.statusLabel}>{match.statusLabel}</span></td>
                        <td><div className={styles.tableActions}>
                          <Link href={match.detailHref}>比赛详情</Link>
                          {match.refereeHref ? <Link href={match.refereeHref}>裁判选派</Link> : null}
                        </div></td>
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
          <p>请调整阶段或球队筛选条件。</p>
        </div>
      )}
      </section>
    </>
  );
}
