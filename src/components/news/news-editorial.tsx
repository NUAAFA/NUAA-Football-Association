import Link from "next/link";
import type { ReactNode } from "react";

import { NewsImage } from "@/components/news/news-image";
import styles from "@/components/news/news-listing.module.css";
import { Badge } from "@/components/ui/foundation-primitives";

// Presentation only. Each existing source supplies its own order, labels and links.
export type EditorialItem = {
  id: string;
  href: string;
  title: string;
  summary: string;
  category: string;
  dateLabel: string;
  dateTime?: string;
  badge?: string;
  pinned?: boolean;
  discipline?: boolean;
  image?: { src: string; alt: string };
};

function StoryMeta({ item, official = false }: { item: EditorialItem; official?: boolean }) {
  return (
    <div className={styles.meta}>
      <Badge tone={official ? "neutral" : "info"}>{item.category}</Badge>
      <time dateTime={item.dateTime}>{item.dateLabel}</time>
      {item.pinned ? <span className={styles.pinned}>置顶</span> : null}
      {item.badge && item.badge !== item.category ? <span>{item.badge}</span> : null}
    </div>
  );
}

function hasPhoto(item: EditorialItem) {
  return Boolean(item.image && !item.image.src.startsWith("/brand/"));
}

function StoryRow({ item }: { item: EditorialItem }) {
  const photo = hasPhoto(item);
  return (
    <article>
      <Link className={`${styles.storyRow}${photo ? "" : ` ${styles.textRow}`}`} href={item.href}>
        {photo && item.image ? (
          <NewsImage src={item.image.src} alt={item.image.alt} variant="list" sizes="(max-width: 720px) 88px, 176px" />
        ) : null}
        <div className={styles.rowCopy}>
          <StoryMeta item={item} />
          <h3>{item.title}</h3>
          <p>{item.summary}</p>
          <span className={styles.readLink}>阅读全文 <span aria-hidden="true">→</span></span>
        </div>
      </Link>
    </article>
  );
}

export function NewsEditorial({ news, notices, controls }: {
  news: readonly EditorialItem[];
  notices: readonly EditorialItem[];
  controls?: ReactNode;
}) {
  const [lead, ...remaining] = news;
  const secondary = remaining.slice(0, 2);
  const rest = remaining.slice(2);
  const photo = lead && hasPhoto(lead);

  return (
    <>
      <div className={styles.controls}>
        {controls}
        <p className={styles.count} role="status" aria-live="polite" aria-atomic="true">
          {news.length} 篇报道 · {notices.length} 则公告
        </p>
      </div>
      <div id="news-content">
        {!lead && !notices.length ? <p className={styles.empty}>暂无已发布内容。</p> : null}
        <div className={`${styles.editorialGrid}${!lead || !notices.length ? ` ${styles.singleColumn}` : ""}`}>
          {lead ? (
            <section id="news" aria-labelledby="news-feature-title" className={styles.stories}>
              <div className={styles.sectionHeading}>
                <h2 id="news-feature-title">最新报道</h2>
                <span>赛场内外，持续记录</span>
              </div>
              <article className={`${styles.featured}${photo ? "" : ` ${styles.textFeature}`}`}>
                <Link className={styles.featuredLink} href={lead.href}>
                  {photo && lead.image ? (
                    <NewsImage src={lead.image.src} alt={lead.image.alt} variant="featured" sizes="(max-width: 1000px) calc(100vw - 40px), (max-width: 1304px) 60vw, 760px" />
                  ) : null}
                  <div className={styles.featuredCopy}>
                    <StoryMeta item={lead} />
                    <h3>{lead.title}</h3>
                    <p>{lead.summary}</p>
                    <span className={styles.readLink}>阅读完整报道 <span aria-hidden="true">→</span></span>
                  </div>
                </Link>
              </article>
              {secondary.length ? (
                <ul className={styles.secondary} aria-label="近期报道">
                  {secondary.map((item) => <li key={item.id}><StoryRow item={item} /></li>)}
                </ul>
              ) : null}
            </section>
          ) : null}
          {notices.length ? (
            <section id="notices" className={styles.official} aria-labelledby="news-notices-title">
              <div className={styles.sectionHeading}>
                <h2 id="news-notices-title">通知公告</h2>
                <span>协会正式发布</span>
              </div>
              <ul className={styles.noticeList} aria-label="正式公告与纪律决定">
                {notices.map((item) => (
                  <li key={item.id}>
                    <article>
                      <Link className={styles.noticeLink} href={item.href}>
                        <StoryMeta item={item} official />
                        <h3>{item.title}</h3>
                        <p>{item.summary}</p>
                        <span className={styles.readLink}>{item.discipline ? "查看决定" : "阅读公告"} <span aria-hidden="true">→</span></span>
                      </Link>
                    </article>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {rest.length ? (
            <section className={styles.moreStories} aria-labelledby="news-more-title">
              <div className={styles.sectionHeading}>
                <h2 id="news-more-title">更多报道</h2>
                <span>赛事战报与协会动态</span>
              </div>
              <ul className={styles.storyList}>
                {rest.map((item) => <li key={item.id}><StoryRow item={item} /></li>)}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}
