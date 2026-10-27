import type { Metadata } from "next";
import Link from "next/link";

import { DouyinQrCard } from "@/components/media/douyin-qr-card";
import { AlbumCards } from "@/components/media/album-cards";
import albumStyles from "@/components/media/album.module.css";
import catalogueStyles from "@/components/ui/catalogue.module.css";
import { CataloguePagination } from "@/components/ui/catalogue-pagination";
import { PublicLoadRetry } from "@/components/public-load-retry";
import styles from "@/components/media/media.module.css";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { publicSectionContacts } from "@/data/contacts";
import { bilibiliPlatform } from "@/data/platforms";
import { catalogueHref, cataloguePage, catalogueValue, catalogueYear, type CatalogueSearchParams } from "@/lib/catalogue-navigation";
import { getLegacyMediaAlbums, getMediaAlbums } from "@/lib/media-album-service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: "/media" },
  title: "影像资料",
  description: "按报道浏览校园足球相册，按赛事与年份查找比赛照片和完整赛事影像。",
  openGraph: {
    title: "影像资料｜南京航空航天大学天目湖足球协会",
    description: "浏览南航校园足球赛事照片、完整赛事影像与官方影像平台。",
    url: "/media",
  },
};

export default async function MediaPage({ searchParams }: { searchParams: Promise<CatalogueSearchParams> }) {
  const query = await searchParams;
  let albums = getLegacyMediaAlbums();
  let unavailable = false;
  try { albums = await getMediaAlbums(); } catch { unavailable = true; }
  const years = [...new Set(albums.map((album) => String(album.year ?? "undated")))].sort((a, b) => Number(b === "undated" ? 0 : b) - Number(a === "undated" ? 0 : a));
  const year = catalogueYear(catalogueValue(query.year), years);
  const competition = catalogueValue(query.competition);
  const q = catalogueValue(query.q);
  const options = [...new Map(albums.map((album) => [album.competitionKey, album.competitionName])).entries()];
  const filtered = albums.filter((album) => (year === "all" || String(album.year ?? "undated") === year)
    && (!competition || album.competitionKey === competition)
    && `${album.title} ${album.competitionName} ${album.campus}`.toLocaleLowerCase().includes(q.toLocaleLowerCase()));
  const page = cataloguePage(filtered, catalogueValue(query.page));
  const filters = { year, competition, q };
  const returnQuery = catalogueHref("/media", { ...filters, page: page.page }).split("?")[1] ?? "";
  const contact = publicSectionContacts.media;

  return (
    <>
      <SiteHeader />
      <main className={styles.page} id="main-content">
        <header className={styles.header}>
          <div className={styles.shell}>
            <p className={styles.eyebrow}>NUAA CAMPUS FOOTBALL / MEDIA</p>
            <h1>影像资料</h1>
            <p className={styles.lead}>按相册收录赛场故事，按赛事与年份查找。</p>
          </div>
        </header>
        <section className={`${styles.shell} ${albumStyles.catalogue}`} aria-labelledby="media-albums-title">
          <form key={catalogueHref("/media", filters)} className={catalogueStyles.filters} action="/media" method="get" role="search" aria-label="筛选影像相册">
            <label>年份<select name="year" defaultValue={year}><option value="all">全部年份</option>{years.map((item) => <option key={item} value={item}>{item === "undated" ? "年份待补充" : `${item} 年`}</option>)}</select></label>
            <label>赛事<select name="competition" defaultValue={competition}><option value="">全部赛事</option>{options.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className={catalogueStyles.search}>查找相册<input type="search" name="q" defaultValue={q} placeholder="输入报道标题、赛事或校区" maxLength={200} /></label>
            <div className={catalogueStyles.filterAction}><button className="ui-button ui-button-primary" type="submit">筛选相册</button><Link className="ui-button ui-button-quiet" href="/media">重置</Link></div>
          </form>
          <div className={catalogueStyles.heading}><h2 id="media-albums-title">赛事相册</h2><p>一篇报道，一本相册 · 历史赛事影像完整保留</p></div>
          {unavailable ? <PublicLoadRetry label="已发布报道相册" /> : null}
          {page.items.length ? <AlbumCards albums={page.items} returnQuery={returnQuery} /> : <div className={catalogueStyles.empty}><p>暂无符合条件的已发布相册。</p><Link href="/media">查看全部相册</Link></div>}
          <CataloguePagination path="/media" filters={filters} {...page} unit="组相册" />
        </section>
        <div className={`${styles.shell} ${styles.pageEnd}`}>
          <section className={styles.platforms} aria-labelledby="media-platforms-title">
            <h2 id="media-platforms-title">官方影像平台</h2>
            <div className={styles.platformList}>
              <DouyinQrCard />
              <article className={styles.platform} aria-labelledby="bilibili-title">
                <p className={styles.platformKind}>BILIBILI / 共享视频平台</p>
                <h3 id="bilibili-title">{bilibiliPlatform.name}</h3>
                <p className={styles.platformDescription}>{bilibiliPlatform.description}</p>
                <a className={styles.platformLink} href={bilibiliPlatform.href} rel={bilibiliPlatform.rel} target={bilibiliPlatform.target}>
                  {bilibiliPlatform.linkLabel} <span className={styles.externalNotice}>（新窗口）<span aria-hidden="true">↗</span></span>
                </a>
              </article>
            </div>
          </section>
          <aside className={styles.contact} aria-labelledby="media-contact-title">
            <div>
              <h2 id="media-contact-title">影像投稿 / 内容纠错</h2>
              <p>{contact.label}：<strong>{contact.name}</strong> · {contact.role}</p>
            </div>
            <dl>
              <div><dt>咨询 QQ</dt><dd>{contact.qq}</dd></div>
              <div><dt>联系邮箱</dt><dd><a href={`mailto:${contact.email}`}>{contact.email}</a></dd></div>
            </dl>
          </aside>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
