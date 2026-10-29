import Link from "next/link";
import { Badge } from "@/components/ui/foundation-primitives";
import { ApplicationWithdrawButton } from "@/components/referees/mvp/application-withdraw-button";
import { formatBeijingDateTime } from "@/lib/beijing-datetime";
import { applicationStatusLabels, formatRefereeDateTime } from "@/lib/referee-presenters";
import type { RefereeCurrentMatch } from "@/lib/referee-current-matches";
import styles from "../referee-list-browser.module.css";

export function RefereeCurrentMatchList({ items }: { items: RefereeCurrentMatch[] }) {
  if (!items.length) return <div className="functional-empty functional-empty-compact">
    <strong>当前暂无可报名场次或待进行的执裁意向</strong>
    <p>新开放比赛会显示在这里；已完成的正式任务可在历史任务中查看。</p>
  </div>;
  return <ol className={styles.rows} aria-label="当前可报名场次与我的执裁意向">
    {items.map((item) => {
      const kickoff = formatBeijingDateTime(item.kickoff);
      return <li key={item.id}><article className={styles.row} data-current-match-id={item.id}>
        <div className={styles.rowMain}>
          <time className={styles.kickoff} dateTime={item.kickoff.toISOString()}>
            <span>{kickoff.dateLabel}</span><strong>{kickoff.timeLabel}</strong>
          </time>
          <div className={styles.matchCopy}>
            <p className={styles.competitionName}>{item.competition} · {item.format}</p>
            <h3>{item.matchup}</h3>
            <p className={styles.matchMeta}><span>{item.stage}</span><span>{item.venue}</span></p>
            <p className={styles.openFacts}>
              <span>报名截止：{item.deadline ? formatRefereeDateTime(item.deadline) : "未设置"}</span>
              <span>岗位需求：{item.demand} 人</span>
            </p>
            {item.application ? <p className={styles.currentInterest} data-status={item.application.status}>
              我的执裁意向：{applicationStatusLabels[item.application.status]}
            </p> : null}
          </div>
          <div className={styles.rowActions}>
            <Badge tone={item.accepting ? "info" : "neutral"}>{item.accepting ? "开放报名" : "报名已关闭"}</Badge>
            <Link prefetch={false} className={styles.rowLink} href={item.href}>
              {item.application ? "查看岗位信息 →" : "查看岗位并报名 →"}
            </Link>
            {item.application?.canWithdraw ? <ApplicationWithdrawButton applicationId={item.application.id} /> : null}
          </div>
        </div>
      </article></li>;
    })}
  </ol>;
}
