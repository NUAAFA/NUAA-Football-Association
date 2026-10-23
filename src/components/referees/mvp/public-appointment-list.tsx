"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/foundation-primitives";
import { formatBeijingDateTime } from "@/lib/beijing-datetime";
import { formatRefereeDateTime } from "@/lib/referee-presenters";
import type { PublicRefereeListItem } from "@/types/referee-public-list";
import styles from "../referee-list-browser.module.css";

const date = (value?: string | null) => value ? new Date(value) : null;

export function PublicAppointmentList({ items, emptyTitle }: { items: PublicRefereeListItem[]; emptyTitle: string }) {
  if (!items.length) return <p className={styles.empty}>{emptyTitle}，可调整或清除筛选条件。</p>;
  return <ol className={styles.rows} aria-label="按时间排序的比赛">{items.map((item) => {
    const openMatch = item.badge === "开放报名";
    const kickoff = formatBeijingDateTime(date(item.kickoff));
    return <li key={item.id}><article className={styles.row} data-match-id={item.id}>
      <div className={styles.rowMain}>
        <time className={styles.kickoff} dateTime={item.kickoff ?? undefined}><span>{kickoff.dateLabel}</span><strong>{kickoff.timeLabel}</strong></time>
        <div className={styles.matchCopy}>
          <p className={styles.competitionName}>{item.competition} · {item.format}</p>
          <h3>{item.match}</h3>
          <p className={styles.matchMeta}><span>{item.stage}</span><span>{item.venue}</span>
            {!openMatch ? <span className={styles.referees}>裁判组：{[...new Set(item.positions.map((position) => position.referee))].join("、")}</span> : null}
          </p>
          {openMatch ? <p className={styles.openFacts}><span>报名截止：{formatRefereeDateTime(date(item.deadline))}</span><span>岗位需求：{item.demand} 人</span></p> : null}
        </div>
        <div className={styles.rowActions}><Badge tone={openMatch ? "info" : "neutral"}>{item.badge}</Badge>
          <Link prefetch={false} className={styles.rowLink} href={item.href}>{openMatch ? "查看岗位信息 →" : item.badge === "赛后执裁记录" ? "查看 / 打印记录 →" : "查看 / 打印选派单 →"}</Link>
        </div>
      </div>
      {!openMatch ? <details className={styles.details}><summary>岗位与公告详情</summary><div className={styles.detailsBody}>
        <dl className={styles.positions} aria-label="裁判组岗位">{item.positions.map((position) => <div key={position.key}><dt>{position.label}</dt><dd>{position.referee}</dd></div>)}</dl>
        <dl className={styles.publication}><div><dt>{item.badge === "赛后执裁记录" ? "实际录入时间" : "发布时间"}</dt><dd>{formatRefereeDateTime(date(item.publishedAt))}</dd></div><div><dt>最后更新</dt><dd>{formatRefereeDateTime(date(item.updatedAt))}</dd></div></dl>
        {item.note ? <p className={styles.note}>{item.note}</p> : null}
      </div></details> : null}
    </article></li>;
  })}</ol>;
}

export function RefereeSubnav({ showWorkspace = false }: { showWorkspace?: boolean }) {
  return <nav aria-label="裁判中心功能导航" className="referee-subnav"><Link href="/referees">裁判中心</Link><Link href="/referees/directory">裁判员名录</Link><Link href="/referees/open-matches">公开场次</Link><Link href="/referees/assignments">裁判选派公示</Link><Link href="/referees/history">历史选派记录</Link>{showWorkspace ? <Link href="/referees/workspace">个人工作区</Link> : null}</nav>;
}
