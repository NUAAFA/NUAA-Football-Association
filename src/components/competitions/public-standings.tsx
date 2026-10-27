"use client";

import { useState } from "react";
import type { PublicCompetitionView } from "@/types/competition-center";
import styles from "./public-standings.module.css";

type StandingsTable = NonNullable<PublicCompetitionView["standings"]>[number];

function tableNote(table: StandingsTable) {
  return table.kind === "LEAGUE" ? !table.hasResults ? "尚未开赛，积分将在赛果确认后更新" : "胜 3 分 · 平 1 分 · 负 0 分；按积分、净胜球、进球数暂列，最终次序以赛事规程为准"
    : !table.hasResults ? "尚未开赛，积分将在赛果确认后更新"
    : table.tied && !table.rankingConfirmed ? "存在同分，当前次序为暂列，最终排名待确认"
    : table.rankingConfirmed ? "小组次序已人工确认" : "胜 3 分 · 平 1 分 · 负 0 分";
}

export function PublicStandings({ tables, isLeague = false }: { tables: StandingsTable[]; isLeague?: boolean }) {
  const [groupId, setGroupId] = useState("");
  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase("zh-CN");
  const visible = tables.filter((table) => (!groupId || table.groupId === groupId)
    && [table.groupName, table.stageName, ...table.rows.map((row) => row.name)].some((value) => value.toLocaleLowerCase("zh-CN").includes(query)));
  if (!tables.length) return <div className={styles.empty}><strong>{isLeague ? "联赛积分暂未发布" : "小组积分暂未发布"}</strong><p>{isLeague ? "参赛球队和联赛阶段确认后将在这里展示总积分。" : "正式小组和赛果确认后将在这里展示。"}</p></div>;

  return <div className={styles.standings}>
    <div className={styles.toolbar}>
      <nav className={styles.groups} aria-label="积分榜切换">
        <button type="button" aria-pressed={!groupId} onClick={() => setGroupId("")}>{isLeague ? "联赛积分" : "全部小组"}</button>
        {tables.map((table) => <button type="button" key={table.groupId} aria-pressed={groupId === table.groupId} onClick={() => setGroupId(table.groupId)}>{tables.some((other) => other.groupId !== table.groupId && other.groupName === table.groupName) ? `${table.stageName} · ` : ""}{table.groupName}<span>{table.rows.length}</span></button>)}
      </nav>
      <label className={styles.search}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg><input type="search" aria-label={isLeague ? "搜索球队" : "搜索小组或球队"} placeholder={isLeague ? "搜索球队" : "搜索小组或球队"} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
    </div>
    <div className={styles.tables} aria-live="polite">
      {visible.map((table) => <section className={styles.group} key={table.groupId} aria-label={`${table.stageName} · ${table.groupName}积分榜`}>
        <header className={styles.groupHeading}><div><span>{table.stageName}</span><h3>{table.groupName}<small>{table.rows.length} 支球队</small></h3></div><span className={styles.tableState}>{table.hasResults ? "当前积分" : "等待开赛"}</span></header>
        <div className={styles.tableScroll} role="region" tabIndex={0} aria-label={`${table.groupName}积分数据，可横向滚动`}>
          <table><caption className="sr-only">{table.stageName} · {table.groupName}积分榜</caption><thead><tr>{["排名", "球队", "场次", "胜", "平", "负", "进球", "失球", "净胜球", "积分"].map((heading) => <th scope="col" key={heading}>{heading}</th>)}</tr></thead>
            <tbody>{table.rows.map((row, index) => <tr key={row.id} className={query && row.name.toLocaleLowerCase("zh-CN").includes(query) ? styles.matched : undefined}>
              <td className={styles.rank}><span>{index + 1}</span></td><th scope="row" className={styles.team}>{row.name}{table.qualifiedTeamIds.includes(row.id) ? <small>{table.qualificationStale ? "出线待复核" : "人工确认出线"}</small> : null}</th>
              {[row.played, row.won, row.drawn, row.lost, row.goalsFor, row.goalsAgainst, row.goalDifference].map((value, column) => <td key={column}>{value}</td>)}<td className={styles.points}>{row.points}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <footer className={styles.note}><span>{tableNote(table)}</span>{table.qualificationStale ? <strong>出线确认待复核</strong> : null}</footer>
      </section>)}
    </div>
    {!visible.length ? <div className={styles.empty}><strong>{isLeague ? "没有找到对应的球队" : "没有找到对应的小组或球队"}</strong><button type="button" onClick={() => { setSearch(""); setGroupId(""); }}>清除筛选</button></div> : null}
  </div>;
}
