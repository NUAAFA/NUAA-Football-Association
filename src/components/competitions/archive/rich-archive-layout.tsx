import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";

import type { ArchiveNavigationItem } from "./archive-section-nav";
import { competitionArchiveNavigation } from "./competition-archive-layout";
import { RichArchiveNavigation } from "./rich-archive-navigation";
import styles from "./rich-archive.module.css";

type RichArchiveLayoutProps = {
  className?: string;
  titleId: string;
  title: string;
  eyebrow: string;
  status: string;
  description: string;
  heroImage: string;
  heroAlt: string;
  actions: readonly { href: string; label: string; download?: boolean }[];
  summary: readonly { label: string; value: string }[];
  returnStatus: string;
  hasDocuments?: boolean;
  hasStatistics?: boolean;
  children: ReactNode;
};

// Only the two rich archives opt in; preview pages retain their approved layout.
export function RichArchiveLayout({
  className = "", titleId, title, eyebrow, status, description, heroImage,
  heroAlt, actions, summary, returnStatus, hasDocuments, hasStatistics, children,
}: RichArchiveLayoutProps) {
  const navigation: ArchiveNavigationItem[] = competitionArchiveNavigation.flatMap((item) =>
    item.id === "honours" && hasStatistics
      ? [item, { id: "statistics", label: "射手与纪律" }]
      : [item],
  );
  if (hasDocuments) navigation.push({ id: "documents", label: "赛事文件" });

  return (
    <>
      <SiteHeader fixed />
      <main className={`cup-archive-page ${styles.page} ${className}`} id="main-content">
        <section className={styles.header} aria-labelledby={titleId}>
          <div className="page-shell">
            <nav className={styles.breadcrumbs} aria-label="当前位置">
              <Link href="/competitions">赛事中心</Link><span aria-hidden="true">/</span><span>2026 赛事档案</span>
            </nav>
            <div className={styles.identity}>
              <div>
                <div className={styles.identityMeta}><p>{eyebrow}</p><span>{status}</span></div>
                <h1 id={titleId}>{title}</h1>
                <p className={styles.description}>{description}</p>
                <div className={styles.actions}>
                  {actions.map((action) => action.download
                    ? <a download href={action.href} key={action.href}>{action.label}<span aria-hidden="true">↓</span></a>
                    : <Link href={action.href} key={action.href}>{action.label}<span aria-hidden="true">→</span></Link>)}
                </div>
              </div>
              <figure className={styles.headerImage}>
                <Image src={heroImage} alt={heroAlt} fill loading="eager" sizes="(max-width: 820px) 1px, 360px" />
                <figcaption>2026 · 天目湖校区</figcaption>
              </figure>
            </div>
            <dl className={styles.summary} aria-label="赛事归档摘要">
              {summary.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
            </dl>
          </div>
        </section>
        <RichArchiveNavigation items={navigation} />
        {children}
        <div className={styles.returnLinks}><div className="page-shell">
          <Link href="/competitions">← 返回赛事中心</Link><a href="#main-content">回到档案开头 ↑</a><span>{returnStatus}</span>
        </div></div>
      </main>
      <SiteFooter />
    </>
  );
}
