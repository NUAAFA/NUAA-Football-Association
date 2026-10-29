"use client";

import Link from "next/link";
import { PublicRefereeName } from "@/components/referees/public-referee-name";
import { useState } from "react";
import { comparePublicMatches, publicMatchProgress } from "@/lib/competition-presentation";
import type { PublicCompetitionMatch } from "@/types/competition-center";
import styles from "./competition-detail.module.css";

export function CompetitionAppointments({ matches, referenceTime }: { matches: PublicCompetitionMatch[]; referenceTime: number }) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(1);
  const published = matches.filter((match) => match.appointment?.positions.length)
    .sort((a, b) => comparePublicMatches(a, b, referenceTime));
  const upcoming = published.filter((match) => match.status === "scheduled" && match.kickoff && new Date(match.kickoff).getTime() >= referenceTime);
  const visible = expanded ? published.slice((page - 1) * 6, page * 6) : upcoming.slice(0, 3);
  const pages = Math.max(1, Math.ceil(published.length / 6));
  const completedCount = published.filter((match) => match.status === "completed").length;

  return <div>
    <p className={styles.appointmentSummary} aria-live="polite">{expanded ? `全部公开选派 · 共 ${published.length} 场，含 ${completedCount} 场已完成比赛` : `近期已发布选派 · ${upcoming.length} 场即将进行${upcoming.length > 3 ? "，优先展示最近三场" : ""}`}</p>
    <div className={styles.appointments} aria-label="本赛事裁判选派">
      {visible.map((match) => <article key={match.id} className={styles.appointment}>
        <header>
          <p>{[match.stage, match.group, match.round, match.matchNumber ? `第${match.matchNumber}场` : null].filter(Boolean).join(" · ")}</p>
          <h3>{match.homeTeam.name} <span>VS</span> {match.awayTeam.name}</h3>
          <div className={styles.appointmentBadges}><span data-status={match.status}>{publicMatchProgress(match, referenceTime)}</span><span>{match.appointment?.recordSource === "POST_MATCH_ENTRY" ? "赛后执裁记录" : match.appointment?.status === "COMPLETED" ? "选派已完成" : "正式选派"}</span></div>
        </header>
        <dl className={styles.appointmentFacts}><div><dt>开赛时间 · 北京时间</dt><dd>{match.kickoff ? <time dateTime={new Date(match.kickoff).toISOString()}>{match.dateLabel} {match.timeLabel}</time> : "时间待定"}</dd></div><div><dt>比赛场地</dt><dd>{match.venue}</dd></div></dl>
        <dl className={styles.positions}>{match.appointment!.positions.map((position) => <div key={position.key}><dt>{position.label}</dt><dd><PublicRefereeName name={position.refereeName} level={position.refereeLevel} /></dd></div>)}</dl>
        <Link className={styles.appointmentLink} href={`/referees/assignments/${match.appointment!.id}/print`}>查看 / 打印{match.appointment?.recordSource === "POST_MATCH_ENTRY" ? "执裁记录" : "选派单"} →</Link>
      </article>)}
    </div>
    {!visible.length ? <div className="core-competition-empty"><strong>{published.length ? "暂无即将进行的已发布选派" : "当前暂无已发布选派"}</strong><p>{published.length ? "往期比赛的公开选派可通过下方“查看全部裁判员选派”浏览。" : "正式安排发布后将在这里显示。"}</p></div> : null}
    {published.length ? <div className={styles.appointmentControls}>
      {expanded ? <><nav aria-label="裁判选派分页"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button><span aria-live="polite">第 {page} / {pages} 页 · 每页 6 场</span><button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>下一页</button></nav><button type="button" aria-expanded="true" onClick={() => { setExpanded(false); setPage(1); }}>仅看近期选派</button></> : <button className="ui-button ui-button-secondary" type="button" aria-expanded="false" onClick={() => setExpanded(true)}>查看全部裁判员选派（共 {published.length} 场） ↓</button>}
    </div> : null}
    <Link className="text-link core-competition-section-link" href="/referees/assignments">前往裁判中心选派公告 →</Link>
  </div>;
}
