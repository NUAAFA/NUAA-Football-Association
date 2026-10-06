import type { Metadata } from "next";
import { RefereeEmptyState, RefereePage } from "@/components/referees/referee-public-layout";
import styles from "@/components/referees/referee-public.module.css";
import { formatRefereeDateTime } from "@/lib/referee-presenters";
import { getPublicRefereeDirectory } from "@/lib/referee-public";

export const metadata: Metadata = {
  alternates: { canonical: "/referees/directory" }, title: "裁判员名录", description: "展示允许公开的已登记裁判员编号、姓名及登记赛制。" };
export const dynamic = "force-dynamic";

export default async function RefereeDirectoryPage() {
  const referees = await getPublicRefereeDirectory();
  const updatedAt = referees.reduce<Date | null>((latest, item) => !latest || item.updatedAt > latest ? item.updatedAt : latest, null);
  return <RefereePage current="/referees/directory" eyebrow="OFFICIALS" title="注册裁判员公开名录" description="经协会确认公开的裁判员编号、姓名、登记赛制和公开简介。">
    {updatedAt ? <p className={styles.meta}>最后更新时间：{formatRefereeDateTime(updatedAt)}</p> : null}
    {referees.length ? <ul role="list" className={styles.directory} aria-label="公开裁判员名录">{referees.map((referee) => <li key={referee.id}>
      <div><span className={styles.meta}>裁判员编号</span><br /><code>{referee.publicCode}</code></div>
      <div><h2>{referee.name}</h2>{referee.publicBio ? <p>{referee.publicBio}</p> : null}</div>
      <div><span className={styles.meta}>登记赛制</span><p>{[referee.elevenASide ? "十一人制" : null, referee.futsal ? "五人制" : null].filter(Boolean).join(" / ") || "—"}</p></div>
    </li>)}</ul> : <RefereeEmptyState title="当前暂无经协会确认可公开的裁判员名录。">名录更新后将在此发布。</RefereeEmptyState>}
  </RefereePage>;
}
