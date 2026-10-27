import type { Metadata } from "next";
import Link from "next/link";

import { ArchiveDirectoryCards } from "@/components/competitions/archive-directory-cards";
import { FormalPageHeader } from "@/components/competitions/formal-page-header";
import formal from "@/components/competitions/formal-services.module.css";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { PublicLoadRetry } from "@/components/public-load-retry";
import { CataloguePagination } from "@/components/ui/catalogue-pagination";
import styles from "@/components/ui/catalogue.module.css";
import { getCompetitionArchives, getStaticCompetitionArchives } from "@/lib/competition-archive-service";
import { catalogueHref, cataloguePage, catalogueValue, catalogueYear, type CatalogueSearchParams } from "@/lib/catalogue-navigation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  alternates: { canonical: "/competitions/history" }, title: "历届赛事",
  description: "按年份浏览南京航空航天大学天目湖足球协会赛事档案与已核实的历史赛事记录。",
};

export default async function CompetitionHistoryPage({ searchParams }: { searchParams: Promise<CatalogueSearchParams> }) {
  const query = await searchParams;
  let archives = getStaticCompetitionArchives();
  let unavailable = false;
  try { archives = await getCompetitionArchives(); } catch { unavailable = true; }
  const years = [...new Set(archives.map((entry) => String(entry.year ?? "undated")))].sort((a, b) => Number(b === "undated" ? 0 : b) - Number(a === "undated" ? 0 : a));
  const year = catalogueYear(catalogueValue(query.year), years);
  const format = catalogueValue(query.format);
  const q = catalogueValue(query.q);
  const formats = [...new Set(archives.map((entry) => entry.format))];
  const filtered = archives.filter((entry) => (year === "all" || String(entry.year ?? "undated") === year)
    && (!format || entry.format === format) && `${entry.name} ${entry.campus}`.toLocaleLowerCase().includes(q.toLocaleLowerCase()));
  const page = cataloguePage(filtered, catalogueValue(query.page));
  const filters = { year, format, q };
  return <><SiteHeader /><main className={formal.page} id="main-content">
    <FormalPageHeader title="历届赛事" eyebrow="COMPETITION ARCHIVES" description="按年份进入赛事档案，查阅赛果、球队、报道与影像。" />
    <div className="page-shell"><div className={styles.yearLayout}>
      <nav className={styles.years} aria-label="赛事年度索引">
        {years.map((item) => <Link key={item} href={catalogueHref("/competitions/history", { year: item, format, q })} aria-current={year === item ? "page" : undefined}>{item === "undated" ? "年份待补充" : `${item} 年`}</Link>)}
        <Link href={catalogueHref("/competitions/history", { year: "all", format, q })} aria-current={year === "all" ? "page" : undefined}>全部年份</Link>
      </nav>
      <section className={styles.content} id={year === "all" ? "history-all" : `history-${year}`} aria-labelledby="archive-year-title">
        <form key={catalogueHref("/competitions/history", filters)} className={styles.filters} action="/competitions/history" method="get" role="search" aria-label="筛选历届赛事">
          <input type="hidden" name="year" value={year} />
          <label>赛制<select name="format" defaultValue={format}><option value="">全部赛制</option>{formats.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label className={styles.search}>查找赛事<input name="q" type="search" defaultValue={q} placeholder="输入赛事名称或场地" maxLength={200} /></label>
          <div className={styles.filterAction}><button className="ui-button ui-button-primary" type="submit">筛选赛事</button><Link className="ui-button ui-button-quiet" href={catalogueHref("/competitions/history", { year })}>重置</Link></div>
        </form>
        <div className={styles.heading}><h2 id="archive-year-title">{year === "all" ? "全部历届赛事" : year === "undated" ? "年份待补充的赛事" : `${year} 年度赛事`}</h2><p>完整专题与历史记录按资料情况标注</p></div>
        {unavailable ? <PublicLoadRetry label="已结束赛事记录" /> : null}
        {page.items.length ? <ArchiveDirectoryCards archives={page.items} /> : <div className={styles.empty}><p>暂无符合条件的赛事记录。</p><Link href={catalogueHref("/competitions/history", { year })}>查看本年度全部赛事</Link></div>}
        <CataloguePagination path="/competitions/history" filters={filters} {...page} unit="项赛事" />
      </section>
    </div></div>
  </main><SiteFooter /></>;
}
