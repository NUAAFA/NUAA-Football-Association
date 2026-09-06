import Link from "next/link";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { PageIntro } from "@/components/templates/page-intro";
import { Notice } from "@/components/ui/foundation-primitives";
import { StatusBadge } from "@/components/ui/status-badge";

export type CategoryEntry = {
  id?: string;
  title: string;
  description: string;
  meta: string;
  status?: string;
  href?: string;
  actionLabel?: string;
  featured?: boolean;
  links?: readonly { label: string; href: string }[];
};

type CategoryEntryLayoutProps = {
  eyebrow: string;
  title: string;
  description: string;
  sectionTitle: string;
  sectionDescription: string;
  notice?: string;
  entries: readonly CategoryEntry[];
};

function CategoryRoute({ entry, index }: { entry: CategoryEntry; index: number }) {
  const content = (
    <>
      <span className="category-route-index">{String(index + 1).padStart(2, "0")}</span>
      <div className="category-route-copy">
        <p>{entry.meta}</p>
        <h3>{entry.title}</h3>
        <span>{entry.description}</span>
      </div>
      <div className="category-route-action">
        {entry.status ? <StatusBadge tone="neutral">{entry.status}</StatusBadge> : null}
        {entry.href ? <b>{entry.actionLabel ?? "查看入口"} <span aria-hidden="true">→</span></b> : null}
        {entry.links ? <span className="category-route-links">{entry.links.map((link) => <Link href={link.href} key={link.href}>{link.label} →</Link>)}</span> : null}
      </div>
    </>
  );

  const className = entry.featured ? "category-route category-route-featured" : "category-route";
  return entry.href ? <Link className={className} id={entry.id} href={entry.href}>{content}</Link> : <article className={className} id={entry.id}>{content}</article>;
}

export function CategoryEntryLayout({ eyebrow, title, description, sectionTitle, sectionDescription, notice, entries }: CategoryEntryLayoutProps) {
  return (
    <>
      <SiteHeader />
      <main className="template-page template-category-page" id="main-content">
        <PageIntro eyebrow={eyebrow} title={title} description={description} statusLabel="栏目服务入口" variant="category" />
        <section className="template-section" aria-labelledby="category-entry-title">
          <div className="page-shell">
            <div className="template-section-heading">
              <div><p>SECTION ROUTES</p><h2 id="category-entry-title">{sectionTitle}</h2></div>
              <span>{sectionDescription}</span>
            </div>
            {notice ? <Notice className="template-notice">{notice}</Notice> : null}
            <div className="category-route-list">
              {entries.map((entry, index) => <CategoryRoute entry={entry} index={index} key={entry.title} />)}
            </div>
            <Link className="template-back-link" href="/">← 返回首页</Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
