import type { ReactNode } from "react";

import styles from "./archive-sections.module.css";

type ArchiveProfileProps = {
  titleId: string;
  name: string;
  context: string;
  introduction: string;
  facts: readonly { label: string; value: string }[];
  format: readonly string[];
  hosts: readonly string[];
  statistics: readonly { label: string; value: number }[];
  source: string;
  children?: ReactNode;
};

export function ArchiveProfile({ titleId, name, context, introduction, facts, format, hosts, statistics, source, children }: ArchiveProfileProps) {
  return (
    <section className="cup-archive-section cup-overview-section" id="overview" aria-labelledby={titleId}>
      <div className="page-shell">
        <div className="cup-section-heading">
          <div><p>COMPETITION PROFILE</p><h2 id={titleId}>赛事概览</h2></div>
          <span>{context}</span>
        </div>
        <div className={styles.profile}>
          <article className={styles.facts}>
            <p className={styles.eyebrow}>OFFICIAL ARCHIVE</p>
            <h3>{name}</h3>
            <p className={styles.introduction}>{introduction}</p>
            <dl>{facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>
          </article>
          <div className={styles.profileSide}>
            <section><p className={styles.eyebrow}>COMPETITION FORMAT</p><h3>赛制与时间</h3><ul>{format.map((item) => <li key={item}>{item}</li>)}</ul></section>
            <section><p className={styles.eyebrow}>HOSTS</p><h3>主办单位</h3><ul>{hosts.map((host) => <li key={host}>{host}</li>)}</ul></section>
          </div>
        </div>
        <div className={styles.statistics} aria-label="赛事核心数据">
          {statistics.map((item) => <div key={item.label}><strong>{item.value}</strong><span>{item.label}</span></div>)}
        </div>
        {children}
        <p className="cup-source-note">{source}</p>
      </div>
    </section>
  );
}
