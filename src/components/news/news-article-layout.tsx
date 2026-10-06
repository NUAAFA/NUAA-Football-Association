import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { ShareActions } from "@/components/share/share-actions";
import { Badge } from "@/components/ui/foundation-primitives";
import styles from "@/components/news/news-article.module.css";

export type NewsAttachment = {
  title: string;
  href: string;
  fileType: string;
  source?: string | null;
  date?: string;
  version?: string | null;
};
type ArticleLink = { title: string; href: string; meta?: string };
type NewsArticleLayoutProps = {
  title: string;
  summary: string;
  category: string;
  dateLabel: string;
  dateTime: string;
  source?: string | null;
  formal?: boolean;
  decision?: boolean;
  context?: { label: string; href?: string };
  returnHref: string;
  moreHref: string;
  moreLabel: string;
  attachments?: readonly NewsAttachment[];
  related?: readonly ArticleLink[];
  children: ReactNode;
};

export function NewsArticleFigure({ src, alt, caption }: { src: string | StaticImageData; alt: string; caption?: string }) {
  return (
    <figure className={styles.figure}>
      {typeof src === "string" ? (
        <div className={styles.mediaFrame}><Image src={src} alt={alt} fill sizes="(max-width: 800px) calc(100vw - 40px), 760px" loading="lazy" /></div>
      ) : (
        <Image src={src} alt={alt} sizes="(max-width: 800px) calc(100vw - 40px), 760px" loading="lazy" />
      )}
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}

export function NewsArticleLayout({ title, summary, category, dateLabel, dateTime, source, formal = false, decision = false, context, returnHref, moreHref, moreLabel, attachments = [], related = [], children }: NewsArticleLayoutProps) {
  return (
    <>
      <SiteHeader />
      <main id="main-content" className={styles.page}>
        <div className={styles.shell}>
          <nav aria-label="新闻返回导航" className={styles.returnNav}>
            <Link href={returnHref}><span aria-hidden="true">←</span> 返回新闻公告</Link>
          </nav>
          <article aria-labelledby="news-article-title" className={formal ? styles.formal : undefined}>
            <header className={styles.header}>
              <div className={styles.meta}>
                <Badge tone={formal ? "neutral" : "info"}>{category}</Badge>
                <time dateTime={dateTime}>{dateLabel}</time>
                {source ? <span>{decision ? "发布单位" : "来源"}：{source}</span> : null}
              </div>
              <h1 id="news-article-title">{title}</h1>
              {context ? <p className={styles.context}>{context.href ? <Link href={context.href}>{context.label} <span aria-hidden="true">↗</span></Link> : context.label}</p> : null}
            </header>
            <div className={styles.body}>
              <p className={styles.lead}>{summary}</p>
              {children}
            </div>
            {attachments.length ? (
              <section aria-labelledby="news-attachments-title" className={styles.attachments}>
                <h2 id="news-attachments-title">{decision ? "决定原件" : "文章附件"}</h2>
                <ul>
                  {attachments.map((attachment) => (
                    <li key={attachment.href}>
                      <h3>{attachment.title}</h3>
                      <p className={styles.fileMeta}>
                        <span>{attachment.fileType}</span>
                        {attachment.source ? <span>来源：{attachment.source}</span> : null}
                        {attachment.date ? <span>{attachment.date}</span> : null}
                        {attachment.version ? <span>{attachment.version}</span> : null}
                      </p>
                      <div className={styles.actions}>
                        <a href={attachment.href} target="_blank" rel="noopener noreferrer" aria-label={`查看${attachment.fileType}：${attachment.title}（新标签页）`}>查看 {attachment.fileType} <span aria-hidden="true">↗</span></a>
                        <a href={attachment.href} download aria-label={`下载${attachment.fileType}：${attachment.title}`}>下载 {attachment.fileType}</a>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <div className={styles.share}><ShareActions title={title} text={summary} /></div>
          </article>
          <nav aria-labelledby="news-continuation-title" className={styles.continuation}>
            <h2 id="news-continuation-title">继续阅读</h2>
            <div className={styles.actions}>
              <Link href={returnHref}>返回新闻公告</Link>
              <Link href={moreHref}>{moreLabel} <span aria-hidden="true">→</span></Link>
              {context?.href ? <Link href={context.href}>查看{context.label} <span aria-hidden="true">→</span></Link> : null}
            </div>
            {related.length ? (
              <ul className={styles.related}>
                {related.map((item) => <li key={item.href}><Link href={item.href}>{item.meta ? <span>{item.meta}</span> : null}<strong>{item.title}</strong><span className={styles.readLink}>阅读全文 <span aria-hidden="true">→</span></span></Link></li>)}
              </ul>
            ) : null}
          </nav>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
