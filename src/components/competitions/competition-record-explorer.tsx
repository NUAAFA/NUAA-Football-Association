"use client";

import Link from "next/link";
import { useState } from "react";

import { ArchiveStandingTable } from "@/components/competitions/archive/archive-data-tables";
import { Badge, TableContainer } from "@/components/ui/foundation-primitives";
import type { CompetitionRecord } from "@/data/competition-records";

import styles from "./match-centre.module.css";

type RecordMode = "standings" | "scorers";

export function CompetitionRecordExplorer({
  records,
  mode,
}: {
  records: readonly CompetitionRecord[];
  mode: RecordMode;
}) {
  const seasons = Array.from(new Set(records.map((record) => record.season))).sort((a, b) => b - a);
  const [selectedSeason, setSelectedSeason] = useState(seasons[0] ?? 0);
  const initialRecord = records.find((record) => record.season === selectedSeason) ?? records[0];
  const [selectedCompetitionId, setSelectedCompetitionId] = useState(initialRecord?.id ?? "");
  const seasonRecords = records.filter((record) => record.season === selectedSeason);
  const selectedRecord =
    seasonRecords.find((record) => record.id === selectedCompetitionId) ?? seasonRecords[0];

  if (!selectedRecord) {
    return <div className={styles.emptyState}><strong>当前暂无已公开赛事数据</strong></div>;
  }

  const rankedScorers = selectedRecord.scorers.filter((player) => player.goals !== null);
  const awardScorers = selectedRecord.scorers.filter((player) => player.goals === null);

  function handleSeasonChange(value: string) {
    const season = Number(value);
    const firstRecord = records.find((record) => record.season === season);
    setSelectedSeason(season);
    setSelectedCompetitionId(firstRecord?.id ?? "");
  }

  return (
    <div className={styles.recordExplorer}>
      <div className={styles.recordFilters} aria-label="赛事数据筛选">
        <label>
          <span>赛季</span>
          <select value={selectedSeason} onChange={(event) => handleSeasonChange(event.target.value)}>
            {seasons.map((season) => <option key={season} value={season}>{season}</option>)}
          </select>
        </label>
        <label>
          <span>赛事</span>
          <select value={selectedRecord.id} onChange={(event) => setSelectedCompetitionId(event.target.value)}>
            {seasonRecords.map((record) => <option key={record.id} value={record.id}>{record.shortName}</option>)}
          </select>
        </label>
      </div>

      <section className={styles.recordResult} aria-live="polite">
        <header className={styles.recordHeader}>
          <div>
            <span className={styles.recordEyebrow}>{selectedRecord.season} SEASON · {selectedRecord.formatLabel}</span>
            <h3>{selectedRecord.competitionName}</h3>
          </div>
          <Link className={styles.archiveLink} href={selectedRecord.archiveHref}>进入赛事档案 →</Link>
        </header>

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
