import Link from "next/link";

import { ArchiveStandingTable } from "@/components/competitions/archive/archive-data-tables";
import { Badge, Notice, TableContainer } from "@/components/ui/foundation-primitives";
import type { CompetitionRecord } from "@/data/competition-records";
import { CompetitionDataModules, DataViewBack, dataViewHref } from "./competition-data-navigation";
import { CompetitionSeasonFilter } from "./competition-season-filter";
import navigation from "./competition-data-navigation.module.css";

import styles from "./match-centre.module.css";

type RecordMode = "standings" | "scorers";

export function CompetitionRecordExplorer({
  records,
  mode,
  season,
  competitionId,
  currentCompetitionId,
}: {
  records: readonly CompetitionRecord[];
  mode: RecordMode;
  season?: string;
  competitionId?: string;
  currentCompetitionId?: string;
}) {
  const seasons = Array.from(new Set(records.map((record) => record.season))).sort((a, b) => b - a);
  const selectedSeason = seasons.includes(Number(season)) ? Number(season) : seasons[0];
  const seasonRecords = records.filter((record) => record.season === selectedSeason);
  const selectedRecord = seasonRecords.find((record) => record.id === competitionId);
  const pathname = `/competitions/${mode}`;
  const anchor = mode === "standings" ? "standings-records-title" : "scoring-records-title";
  const preservedQuery: Record<string, string> = currentCompetitionId ? { competition: currentCompetitionId } : {};
  const baseQuery = { ...preservedQuery, season: selectedSeason };

  if (!seasonRecords.length) {
    return <div className={styles.emptyState}><strong>当前暂无已公开赛事数据</strong></div>;
  }

  const toolbar = <div className={navigation.toolbar}>
    <div><h3>{selectedSeason} 年赛事档案</h3><p>{seasonRecords.length} 项赛事 · {selectedRecord ? "正在查看所选赛事" : "选择赛事，查看完整记录"}</p></div>
    <CompetitionSeasonFilter seasons={seasons} selectedSeason={selectedSeason} pathname={pathname} anchor={anchor} preservedQuery={preservedQuery} />
  </div>;

  if (!selectedRecord) return <div className={styles.recordExplorer}>
    {toolbar}
    {competitionId ? <p className={styles.recordNote}>该年份下暂无此赛事，请重新选择。</p> : null}
    <CompetitionDataModules label={mode === "standings" ? "历史积分榜赛事选择" : "射手记录赛事选择"} items={seasonRecords.map((record) => ({
      id: record.id,
      title: record.shortName,
      meta: record.formatLabel,
      description: record.competitionName,
      count: mode === "standings" ? `${record.standings.length} 组归档积分` : record.scorers.some((player) => player.goals !== null) ? `公开射手 Top ${record.scorers.filter((player) => player.goals !== null).length}` : `${record.scorers.length} 位金靴得主`,
      action: mode === "standings" ? "查看积分" : "查看射手记录",
      href: dataViewHref(pathname, { ...baseQuery, archive: record.id }, anchor),
    }))} />
  </div>;

  const rankedScorers = selectedRecord.scorers.filter((player) => player.goals !== null);
  const awardScorers = selectedRecord.scorers.filter((player) => player.goals === null);

  return (
    <div className={styles.recordExplorer}>
      {toolbar}
      <DataViewBack href={dataViewHref(pathname, baseQuery, anchor)} />

      <section className={styles.recordResult} aria-live="polite">
        <header className={styles.recordHeader}>
          <div>
            <span className={styles.recordEyebrow}>{selectedRecord.season} SEASON · {selectedRecord.formatLabel}</span>
            <h3>{selectedRecord.competitionName}</h3>
          </div>
          <Link className={styles.archiveLink} href={selectedRecord.archiveHref}>进入赛事档案 →</Link>
        </header>

        <Notice className={styles.recordScope} title={mode === "standings" ? "归档统计范围" : "数据完整性"}>
          <p>{mode === "standings"
            ? selectedRecord.id === "2026-womens-intercollege-cup" ? "最终积分仅统计联赛阶段，淘汰赛成绩不计入积分榜。" : "保留现有归档积分与原始顺序，各组的统计范围及来源见表下注明。"
            : rankedScorers.length ? `以下仅为公开 Top ${rankedScorers.length}，不代表完整射手榜；来源未提供的数据不会被补算或推测。` : "公开资料仅确认金靴得主，未公开个人进球数及完整排名。"}</p>
        </Notice>

        {mode === "standings" ? (
          selectedRecord.standings.length ? (
            <div className={styles.standingGroups}>
              {selectedRecord.standings.map((group) => (
                <section className={styles.standingGroup} key={group.label}>
                  <h4>{group.label}</h4>
                  <ArchiveStandingTable
                    rows={group.rows}
                    caption={`${selectedRecord.competitionName}${group.label}积分榜`}
                  />
                  {group.note ? <p className={styles.recordNote}>{group.note}</p> : null}
                </section>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}><strong>当前暂无已公开积分榜数据</strong></div>
          )
        ) : selectedRecord.scorers.length ? (
          <div className={styles.scorerSections}>
            {rankedScorers.length ? (
              <section aria-labelledby={`${selectedRecord.id}-ranked-scorers`}>
                <header className={styles.scorerSectionHeader}>
                  <span>PUBLIC TOP {rankedScorers.length}</span>
                  <h4 id={`${selectedRecord.id}-ranked-scorers`}>公开射手 Top {rankedScorers.length}</h4>
                  <p>按现有公开记录顺序展示；这不是覆盖全部进球球员的完整射手榜。</p>
                </header>
                <TableContainer
                  className={styles.scorerTableRegion}
                  label={`${selectedRecord.competitionName}公开射手 Top ${rankedScorers.length}`}
                >
                  <table className={styles.scorerTable}>
                    <caption className="sr-only">{selectedRecord.competitionName}公开射手 Top {rankedScorers.length}</caption>
                    <thead>
                      <tr><th scope="col">排名</th><th scope="col">球员</th><th scope="col">球队</th><th scope="col">号码</th><th scope="col">进球数</th></tr>
                    </thead>
                    <tbody>
                      {rankedScorers.map((player) => (
                        <tr key={player.id}>
                          <td className={styles.rankCell}>{player.position}</td>
                          <td><strong>{player.player}</strong></td>
                          <td>{player.team ?? "—"}</td>
                          <td>{player.number ?? "—"}</td>
                          <td><b className={styles.goalCell}>{player.goals}</b></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableContainer>
                <div className={styles.scorerCards} aria-label={`${selectedRecord.competitionName}公开射手移动端列表`}>
                  {rankedScorers.map((player) => (
                    <article className={styles.scorerCard} key={player.id}>
                      <span>{String(player.position).padStart(2, "0")}</span>
                      <div>
                        <strong>{player.player}</strong>
                        <small>{player.team ?? "球队未公开"}{player.number !== undefined ? ` · #${player.number}` : " · 号码未公开"}</small>
                      </div>
                      <b>{player.goals} 球</b>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {awardScorers.length ? (
              <section aria-labelledby={`${selectedRecord.id}-scorer-awards`}>
                <header className={styles.scorerSectionHeader}>
                  <span>GOLDEN BOOT HONOURS</span>
                  <h4 id={`${selectedRecord.id}-scorer-awards`}>赛事金靴荣誉</h4>
                  <p>公开资料仅确认以下金靴得主，未公布个人进球数及完整排名。</p>
                </header>
                <div className={styles.awardGrid}>
                  {awardScorers.map((player) => (
                    <article className={styles.awardCard} key={player.id}>
                      <span>AWARD RECIPIENT</span>
                      <h5>{player.player}</h5>
                      <p>{player.basis ?? "赛事最佳射手荣誉"}</p>
                      <Badge tone="success">金靴得主</Badge>
                      <small>个人进球数未公开 · 不构成第一 / 第二名排序</small>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {selectedRecord.scorerNote ? <p className={styles.recordNote}>{selectedRecord.scorerNote}</p> : null}
          </div>
        ) : (
          <div className={styles.emptyState}><strong>当前暂无已公开射手数据</strong></div>
        )}
      </section>
    </div>
  );
}
