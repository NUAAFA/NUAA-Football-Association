import Link from "next/link";
import type { ReactNode } from "react";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";

import styles from "./match-centre.module.css";

type MatchCentreRoute = "schedule" | "standings" | "scorers";

const matchCentreRoutes = [
  { id: "schedule", href: "/competitions/schedule", label: "赛程" },
  { id: "standings", href: "/competitions/standings", label: "积分榜" },
  { id: "scorers", href: "/competitions/scorers", label: "射手记录" },
] as const;

export function MatchCentreShell({
  active,
  children,
  context,
  description,
  eyebrow,
  title,
}: {
  active: MatchCentreRoute;
  children: ReactNode;
  context: readonly string[];
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <>
      <SiteHeader />
      <main className={styles.page} id="main-content">
        <header className={styles.pageHeader}>
          <div className={`detail-shell ${styles.pageHeaderInner}`}>
            <nav className={styles.breadcrumbs} aria-label="面包屑导航">
              <Link href="/competitions">赛事中心</Link>
              <span aria-hidden="true">/</span>
              <span>比赛数据</span>
            </nav>
            <p className={styles.eyebrow}>{eyebrow}</p>
            <h1>{title}</h1>
            <p className={styles.lede}>{description}</p>
            <ul className={styles.contextList} aria-label="页面数据范围">
              {context.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </header>

        <nav className={styles.localNavigation} aria-label="比赛中心页面">
          <div className={`detail-shell ${styles.localNavigationInner}`}>
            <Link className={styles.hubLink} href="/competitions">赛事中心</Link>
            <span className={styles.navigationDivider} aria-hidden="true" />
            <div className={styles.siblingLinks}>
              {matchCentreRoutes.map((route) => (
                <Link
                  aria-current={route.id === active ? "page" : undefined}
                  className={styles.siblingLink}
                  href={route.href}
                  key={route.id}
                >
                  {route.label}
                </Link>
              ))}
            </div>
          </div>
        </nav>

        <div className={`detail-shell ${styles.content}`}>{children}</div>
      </main>
      <SiteFooter />
    </>
  );
}

export function MatchCentreSectionHeading({
  description,
  eyebrow,
  id,
  title,
}: {
  description: string;
  eyebrow: string;
  id: string;
  title: string;
}) {
  return (
    <div className={styles.sectionHeading}>
      <div>
        <span>{eyebrow}</span>
        <h2 id={id}>{title}</h2>
      </div>
      <p>{description}</p>
    </div>
  );
}
