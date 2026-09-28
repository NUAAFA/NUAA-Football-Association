import Link from "next/link";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { PageIntro } from "@/components/templates/page-intro";

type DetailMeta = { source: string; published: string; updated: string; sourceLabel?: string };
type RelatedItem = { title: string; href: string; meta: string };
type DetailAttachment = string | { label: string; href: string; external?: boolean };

type DetailPageLayoutProps = {
  eyebrow: string;
  title: string;
  description: string;
  meta: DetailMeta;
  attachments?: readonly DetailAttachment[];
  related?: readonly RelatedItem[];
  attachmentsAfterBody?: boolean;
  statusLabel?: string;
  children: React.ReactNode;
};

export function DetailPageLayout({ eyebrow, title, description, meta, attachments = [], related = [], statusLabel = "演示详情 · 非正式发布", attachmentsAfterBody = false, children }: DetailPageLayoutProps) {
  const aside = (
    <dl className="detail-meta-panel">
      <div><dt>{meta.sourceLabel ?? "来源"}</dt><dd>{meta.source}</dd></div>
      <div><dt>发布日期</dt><dd>{meta.published}</dd></div>
      <div><dt>更新时间</dt><dd>{meta.updated}</dd></div>
    </dl>
  );
  const attachmentSection = (<section><p>ATTACHMENTS</p><h2>附件</h2>{attachments.length ? <ul>{attachments.map((item) => typeof item === "string" ? <li key={item}>{item}</li> : <li key={item.href}><a href={item.href} target={item.external ? "_blank" : undefined} rel={item.external ? "noopener noreferrer" : undefined}>{item.label}</a></li>)}</ul> : <span>当前没有可下载附件。</span>}</section>);
  return (
    <>
      <SiteHeader />
      <main className="template-page template-detail-page" id="main-content">
        <PageIntro eyebrow={eyebrow} title={title} description={description} statusLabel={statusLabel} variant="detail" aside={aside} />
        <article className="template-section detail-article">
          <div className="page-shell detail-article-grid">
            <div className="detail-prose">{children}{attachmentsAfterBody ? <div className="detail-article-aside ops-content-attachments">{attachmentSection}</div> : null}</div>
            <aside className="detail-article-aside">
              {!attachmentsAfterBody ? attachmentSection : null}

              <section><p>RELATED</p><h2>相关内容</h2>{related.length ? <ul>{related.map((item) => <li key={item.title}><Link href={item.href}><span>{item.meta}</span><strong>{item.title}</strong></Link></li>)}</ul> : <span>暂无相关内容。</span>}</section>
            </aside>
          </div>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
