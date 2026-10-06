import Link from "next/link";
import type { ReactNode } from "react";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { Badge } from "@/components/ui/foundation-primitives";
import styles from "./referee-public.module.css";

const publicLinks = [
  ["/referees", "中心"],
  ["/referees/directory", "裁判名录"],
  ["/referees/assignments", "选派公告"],
  ["/referees/open-matches", "公开场次"],
  ["/referees/history", "历史选派"],
  ["/referees/resources/competition-rules", "竞赛规则"],
  ["/referees/resources/training", "培训资料"],
  ["/referees/resources/work-files", "工作资料"],
  ["/referees/recruitment", "加入裁判队伍"],
] as const;

export function RefereePage({ title, description, eyebrow, current, children, actions, headerAside }: {
  title: ReactNode; description: ReactNode; eyebrow: string; current: string;
  children: ReactNode; actions?: ReactNode; headerAside?: ReactNode;
}) {
  const headerCopy = <>
    <p className={styles.eyebrow}>{eyebrow}</p>
    <h1>{title}</h1>
    <p className={styles.lead}>{description}</p>
    {actions ? <div className={styles.actions}>{actions}</div> : null}
  </>;

  return <>
    <SiteHeader />
    <main className={styles.page} id="main-content">
      <header className={headerAside ? `${styles.header} ${styles.headerWithAside}` : styles.header}>
        <div className={headerAside ? `${styles.shell} ${styles.headerGrid}` : styles.shell}>
          {headerAside ? <><div className={styles.headerCopy}>{headerCopy}</div>{headerAside}</> : headerCopy}
        </div>
      </header>
      <nav className={styles.nav} aria-label="裁判中心公开导航">
        <ul role="list" className={styles.shell}>
          {publicLinks.map(([href, label]) => <li key={href}>
            <Link href={href} aria-current={current === href ? "page" : undefined}>{label}</Link>
          </li>)}
        </ul>
      </nav>
      <div className={`${styles.shell} ${styles.content}`}>{children}</div>
    </main>
    <SiteFooter />
  </>;
}

export function RefereeSection({ title, description, id, children, action }: {
  title: string; description?: string; id: string; children: ReactNode; action?: ReactNode;
}) {
  return <section className={styles.section} id={id} aria-labelledby={`${id}-title`}>
    <div className={styles.sectionHead}>
      <div><h2 id={`${id}-title`}>{title}</h2>{description ? <p>{description}</p> : null}</div>
      {action}
    </div>
    {children}
  </section>;
}

export function RefereeEmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <div className={styles.empty}><p className={styles.emptyTitle}>{title}</p><p>{children}</p></div>;
}

export function RefereeResource({ title, type, children, actions }: {
  title: string; type: string; children: ReactNode; actions: ReactNode;
}) {
  return <li className={styles.resource}>
    <div><Badge tone="neutral">{type}</Badge></div>
    <div className={styles.resourceCopy}><h3>{title}</h3>{children}</div>
    <div className={styles.resourceActions}>{actions}</div>
  </li>;
}
