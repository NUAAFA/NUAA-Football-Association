import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { MediaGallery } from "@/components/media/media-gallery";
import styles from "@/components/media/album.module.css";
import mediaStyles from "@/components/media/media.module.css";
import catalogueStyles from "@/components/ui/catalogue.module.css";
import { catalogueHref, catalogueValue, type CatalogueSearchParams } from "@/lib/catalogue-navigation";
import { getMediaAlbum } from "@/lib/media-album-service";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const album = await getMediaAlbum((await params).id);
  return album ? { title: album.title, description: `${album.competitionName} · ${album.images.length} 张照片`, alternates: { canonical: `/media/albums/${album.id}` } } : { title: "相册未找到" };
}

export default async function AlbumPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<CatalogueSearchParams> }) {
  const album = await getMediaAlbum((await params).id);
  if (!album) notFound();
  const from = new URLSearchParams(catalogueValue((await searchParams).from, 4096));
  const backHref = catalogueHref("/media", Object.fromEntries(["year", "competition", "q", "page"].map((key) => [key, from.get(key) ?? ""])));
  return <><SiteHeader /><main className={mediaStyles.page} id="main-content"><div className={`${mediaStyles.shell} ${styles.detail}`}>
    <nav className={catalogueStyles.breadcrumb} aria-label="相册位置"><Link href={backHref}>← 返回相册目录</Link><span aria-hidden="true">/</span><Link href={album.competitionHref}>{album.competitionName}</Link></nav>
    <header className={styles.detailHeading}>
      <p className={styles.eyebrow}>{album.kind} · {album.year ?? "年份待补充"}</p><h1>{album.title}</h1>
      <div className={styles.detailMeta}><span>{album.campus}</span><span>{album.images.length} 张照片</span><time dateTime={album.publishedAt ?? undefined}>{album.dateLabel}</time>{album.source ? <span>来源：{album.source}</span> : null}</div>
      <div className={styles.actions}>{album.reportHref ? <Link className="ui-button ui-button-primary" href={album.reportHref}>阅读相关报道 →</Link> : null}<Link className="ui-button ui-button-secondary" href={`${album.competitionHref}#media`}>查看本届赛事 →</Link></div>
    </header>
    <MediaGallery collection={album} className={styles.gallery} />
    <aside className={styles.related}><h2>继续浏览</h2><p>查看同一届赛事的其他报道相册与历史影像。</p><Link href={catalogueHref("/media", { year: album.year ?? "undated", competition: album.competitionKey })}>本届赛事全部相册 →</Link></aside>
  </div></main><SiteFooter /></>;
}
