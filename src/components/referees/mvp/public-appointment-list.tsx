import Link from "next/link";
import { Badge } from "@/components/ui/foundation-primitives";
import { RefereeEmptyState } from "../referee-public-layout";
import styles from "../referee-public.module.css";

export type PublicAppointment = {
  id: string; competition: string; match: string; stage: string; kickoff: string; venue: string;
  publishedAt: string; updatedAt: string; note: string | null; positions: { key: string; label: string; referee: string }[];
};

export function PublicAppointmentList({ items, emptyTitle }: { items: PublicAppointment[]; emptyTitle: string }) {
  if (!items.length) return <RefereeEmptyState title={emptyTitle}>只有已发布且未撤回的选派会出现在公开页面。</RefereeEmptyState>;
  return <ul role="list" className={styles.matchList} aria-label="公开选派记录">{items.map((item) => <li key={item.id}><article className={styles.match}>
    <header><div><p className={styles.meta}>{item.competition} · {item.stage}</p><h2>{item.match}</h2></div><Badge tone="neutral">已发布</Badge></header>
    <dl className={styles.facts}><div><dt>开球时间</dt><dd>{item.kickoff}</dd></div><div><dt>比赛场地</dt><dd>{item.venue}</dd></div><div><dt>发布时间</dt><dd>{item.publishedAt}</dd></div><div><dt>最后更新</dt><dd>{item.updatedAt}</dd></div></dl>
    <dl className={styles.positions} aria-label="裁判组岗位">{item.positions.map((position) => <div key={position.key}><dt>{position.label}</dt><dd>{position.referee}</dd></div>)}</dl>
    {item.note ? <p>{item.note}</p> : null}<Link className={styles.textLink} href={`/referees/assignments/${item.id}/print`}>查看 / 打印选派单 →</Link>
  </article></li>)}</ul>;
}

export function RefereeSubnav({ showWorkspace = false }: { showWorkspace?: boolean }) {
  return <nav aria-label="裁判中心功能导航" className="referee-subnav"><Link href="/referees">裁判中心</Link><Link href="/referees/directory">裁判员名录</Link><Link href="/referees/open-matches">公开场次</Link><Link href="/referees/assignments">裁判选派公示</Link><Link href="/referees/history">历史选派记录</Link>{showWorkspace ? <Link href="/referees/workspace">个人工作区</Link> : null}</nav>;
}
