"use client";

import Link from "next/link";

import type { ArchiveNavigationItem } from "./archive-section-nav";
import styles from "./rich-archive.module.css";

export function RichArchiveNavigation({ items }: { items: readonly ArchiveNavigationItem[] }) {
  const links = items.map((item) => <Link href={`#${item.id}`} key={item.id}>{item.label}</Link>);
  return (
    <nav className={styles.navigation} aria-label="赛事档案章节" id="archive-navigation">
      <div className={`page-shell ${styles.desktopNavigation}`}>{links}</div>
      <details className={`page-shell ${styles.mobileNavigation}`}>
        <summary>章节目录<span>赛果 · 球队 · 荣誉</span></summary>
        <div onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) event.currentTarget.closest("details")?.removeAttribute("open");
        }}>{links}</div>
      </details>
    </nav>
  );
}
