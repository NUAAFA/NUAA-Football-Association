import Image from "@/components/ui/site-image";
import Link from "next/link";
import type { ReactNode } from "react";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";

import { ArchiveSectionNav } from "./archive-section-nav";

export const competitionArchiveNavigation = [
  { id: "overview", label: "赛事概览" },
  { id: "schedule", label: "赛程赛果" },
  { id: "standings", label: "积分榜" },
  { id: "teams", label: "球队名单" },
  { id: "officials", label: "裁判选派" },
  { id: "honours", label: "名次与奖项" },
  { id: "reports", label: "赛事报道" },
  { id: "media", label: "赛事影像" },
] as const;

type ArchiveAction = { href: string; label: string; download?: boolean };
type ArchiveSummary = { label: string; value: ReactNode };

type CompetitionArchiveLayoutProps = {
  className?: string;
  titleId: string;
  title: string;
  eyebrow: string;
  status: string;
  description: string;
  heroImage: string;
  heroAlt: string;
  actions: readonly ArchiveAction[];
  summary: readonly ArchiveSummary[];
  returnStatus: string;
  children: ReactNode;
};

export function CompetitionArchiveLayout({
  className = "",
  titleId,
  title,
  eyebrow,
  status,
  description,
  heroImage,
  heroAlt,
  actions,
  summary,
  returnStatus,
  children,
}: CompetitionArchiveLayoutProps) {
  return (
    <>
      <SiteHeader fixed />
      <main className={`cup-archive-page ${className}`.trim()} id="main-content">
        <section className="cup-archive-hero" aria-labelledby={titleId}>
          <Image className="cup-archive-hero-image" src={heroImage} alt={heroAlt} fill loading="eager" sizes="100vw" />
          <div className="cup-archive-hero-overlay" aria-hidden="true" />
          <div className="page-shell cup-archive-hero-inner">
            <div className="cup-archive-hero-copy">
              <p>{eyebrow}</p>
              <span className="cup-official-status">{status}</span>
              <h1 id={titleId}>{title}</h1>
              <p>{description}</p>
              <div>{actions.map((action) => action.download ? <a download href={action.href} key={action.href}>{action.label} <span aria-hidden="true">↓</span></a> : <Link href={action.href} key={action.href}>{action.label} <span aria-hidden="true">→</span></Link>)}</div>
            </div>
            <dl className="cup-archive-hero-summary">{summary.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
          </div>
        </section>

        <ArchiveSectionNav items={competitionArchiveNavigation} ariaLabel="赛事归档统一栏目" />
        {children}
        <div className="cup-archive-return"><div className="page-shell"><Link href="/competitions">← 返回赛事中心</Link><span>{returnStatus}</span></div></div>
      </main>
      <SiteFooter />
    </>
  );
}
