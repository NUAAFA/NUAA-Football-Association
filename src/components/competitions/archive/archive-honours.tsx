import styles from "./archive-sections.module.css";

type ArchiveHonoursProps = {
  rankings: readonly { position: number; team: string; note?: string }[];
  awards: readonly { name: string; recipient: string; team?: string }[];
};

export function ArchiveHonours({ rankings, awards }: ArchiveHonoursProps) {
  return (
    <>
      <div className={styles.rankings} aria-label="最终名次">
        {rankings.map((item) => <article key={item.position}>
          <span>{String(item.position).padStart(2, "0")}</span>
          <p>{["冠军", "亚军", "季军", "第四名"][item.position - 1] ?? `第${item.position}名`}</p>
          <h3>{item.team}</h3>
          {item.note ? <small>{item.note}</small> : null}
        </article>)}
      </div>
      <div className={styles.awards}>
        <div><p className={styles.eyebrow}>SEASON AWARDS</p><h3>赛事奖项</h3></div>
        <div className={styles.awardGrid}>{awards.map((award, index) => <article key={award.name}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <h4>{award.name}</h4><strong>{award.recipient}</strong>
          {award.team ? <small>{award.team}</small> : null}
        </article>)}</div>
      </div>
    </>
  );
}
