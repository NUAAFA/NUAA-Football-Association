import Link from "next/link";

import Image from "@/components/ui/site-image";
import type { CompetitionArchiveEntry } from "@/types/competition-archive";
import styles from "./archive-directory.module.css";

export function ArchiveDirectoryCards({ archives, compact = false }: { archives: readonly CompetitionArchiveEntry[]; compact?: boolean }) {
  return <div className={compact ? styles.preview : styles.list}>
    {archives.map((entry) => <article key={entry.id} className={styles.entry}>
      {entry.image ? <div className={styles.image}><Image src={entry.image.src} alt={entry.image.alt} fill sizes={compact ? "(max-width: 760px) 80px, 28vw" : "(max-width: 600px) 72px, 120px"} /></div> : <div className={styles.yearTile} aria-hidden="true">{entry.year ?? "档案"}</div>}
      <div className={styles.copy}><p className={styles.meta}><span>{entry.kind}</span><span>{entry.format}</span></p><h3><Link href={entry.href}>{entry.name}</Link></h3>{!compact ? <p className={styles.description}>{entry.summary}</p> : null}<p className={styles.campus}>{entry.campus}</p></div>
      <Link className={styles.action} href={entry.href}>{entry.kind === "完整档案" ? "进入档案" : "查看记录"} <span aria-hidden="true">→</span></Link>
    </article>)}
  </div>;
}
