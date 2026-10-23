import Link from "next/link";
import type { ReactNode } from "react";
import type { CompetitionFormat } from "@/generated/prisma-v29/client";
import { refereeListHref, type RefereeListFilters } from "@/lib/referee-list-filters";
import styles from "./referee-list-browser.module.css";

type Competition = { id: string; name: string; format: CompetitionFormat; playingFormat: string | null };
type ListInfo = { total: number; nextCursor: string | null; competitions: Competition[] };

export function RefereeListBrowser({ base, filters, info, history = false, openMatches = false, children }: {
  base: string; filters: RefereeListFilters; info: ListInfo; history?: boolean; openMatches?: boolean; children: ReactNode;
}) {
  const hasAdvancedFilters = Boolean(filters.format || filters.from || filters.to || filters.q || filters.error);
  const selectedCompetition = info.competitions.find((item) => item.id === filters.competition);
  return <div className={styles.browser}>
    <form key={JSON.stringify(filters)} className={styles.filters} action={`${base}#referee-results`} method="get" aria-label="筛选比赛">
      <div className={styles.filterIntro}><h2>查找场次</h2><p>按赛事、赛制或比赛日期缩小范围，时间均为北京时间。</p></div>
      <div className={styles.primaryFields}>
        <label className={styles.competitionField}><span id="referee-competition-label">赛事</span><select name="competition" aria-labelledby="referee-competition-label" defaultValue={filters.competition}>
          <option value="">全部赛事</option>
          {filters.competition && !selectedCompetition ? <option value={filters.competition}>所选赛事暂无公开场次</option> : null}
          {info.competitions.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select></label>
        <div className={styles.filterActions}><button type="submit">筛选</button><Link href={base}>清除筛选</Link></div>
      </div>
      <details className={styles.moreFilters} open={hasAdvancedFilters}>
        <summary>更多筛选 <span>赛制、日期、{openMatches ? "球队" : "球队 / 裁判员"}</span></summary>
        <div className={styles.fields}>
        <label className={styles.formatField}><span id="referee-format-label">赛制</span><select name="format" aria-labelledby="referee-format-label" defaultValue={filters.format}>
          <option value="">全部赛制</option><option value="ELEVEN_A_SIDE">十一人制</option><option value="FUTSAL">五人制</option>
          {!openMatches ? <option value="CUSTOM">自定义赛制</option> : null}
        </select></label>
        <label className={styles.dateField}><span>开始日期</span><input type="date" name="from" defaultValue={filters.from} /></label>
        <label className={styles.dateField}><span>结束日期</span><input type="date" name="to" defaultValue={filters.to} /></label>
        <label className={styles.searchField}><span>{openMatches ? "球队关键词" : "球队 / 裁判员"}</span><input type="search" name="q" maxLength={100} placeholder={openMatches ? "输入球队名称" : "输入球队或裁判员姓名"} defaultValue={filters.q} /></label>
        </div>
      </details>
      {filters.error ? <p className={styles.error} role="alert">{filters.error}</p> : null}
    </form>
    <section id="referee-results" className={styles.results} aria-label="比赛查询结果" tabIndex={-1}>
      <div className={styles.resultHeading}><p><strong>共 {info.total} 场</strong></p>
        <p>{history ? "最近结束的比赛在前" : "离当前时间最近的比赛在前"} · 北京时间</p></div>
      {children}
      {info.nextCursor ? <noscript><a className={styles.rowLink} href={refereeListHref(base, filters, info.nextCursor)}>继续查看比赛 →</a></noscript> : null}
    </section>
  </div>;
}

