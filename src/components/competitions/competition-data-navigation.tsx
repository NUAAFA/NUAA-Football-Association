import Link from "next/link";
import type { ReactNode } from "react";

import styles from "./competition-data-navigation.module.css";

export function dataViewHref(pathname: string, values: Record<string, string | number | undefined>, anchor: string) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  return `${pathname}${query.size ? `?${query}` : ""}#${anchor}`;
}

export function CompetitionDataModules({ items, label }: {
  label: string;
  items: readonly { id: string; title: string; meta: string; description: string; count: string; action: string; href: string; status?: string }[];
}) {
  return <nav className={styles.modules} aria-label={label}>
    {items.map((item, index) => <Link className={styles.module} href={item.href} key={item.id}>
      <div className={styles.moduleTop}><span className={styles.moduleNumber}>{String(index + 1).padStart(2, "0")}</span><span>{item.meta}</span>{item.status ? <small>{item.status}</small> : null}</div>
      <h3>{item.title}</h3>
      <p>{item.description}</p>
      <div className={styles.moduleFooter}><span>{item.count}</span><strong>{item.action}<span className={styles.arrow} aria-hidden="true">↗</span></strong></div>
    </Link>)}
  </nav>;
}

export function DataViewBack({ href, children = "返回赛事选择" }: { href: string; children?: ReactNode }) {
  return <Link className={styles.back} href={href}><span aria-hidden="true">←</span>{children}</Link>;
}
