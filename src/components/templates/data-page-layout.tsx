import Link from "next/link";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { PageIntro } from "@/components/templates/page-intro";
import { Notice } from "@/components/ui/foundation-primitives";

type DataPageLayoutProps = {
  eyebrow: string;
  title: string;
  description: string;
  dataTitle: string;
  dataDescription: string;
  filters?: React.ReactNode;
  note?: string;
  children: React.ReactNode;
};

export function DataPageLayout({ eyebrow, title, description, dataTitle, dataDescription, filters, note, children }: DataPageLayoutProps) {
  return (
    <>
      <SiteHeader />
      <main className="template-page template-data-page" id="main-content">
        <PageIntro eyebrow={eyebrow} title={title} description={description} statusLabel="数据模板 · 演示数据" variant="data" />
        <section className="template-section" aria-labelledby="data-page-title">
          <div className="page-shell">
            <div className="template-section-heading">
              <div><p>MATCH DATA</p><h2 id="data-page-title">{dataTitle}</h2></div>
              <span>{dataDescription}</span>
            </div>
            {filters ? <div className="data-filter-bar">{filters}</div> : null}
            {note ? <Notice className="template-notice">{note}</Notice> : null}
            {children}
            <Link className="template-back-link" href="/competitions">← 返回赛事中心</Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
