import type { CompetitionNextMatch } from "@/types/competition-center";

import styles from "./competition-fixture.module.css";

export function CompetitionFixture({ fixture, dark = false }: {
  fixture: CompetitionNextMatch;
  dark?: boolean;
}) {
  return (
    <div className={`${styles.fixture}${dark ? ` ${styles.dark}` : ""}`}>
      <span className={styles.label}>{fixture.label}</span>
      {fixture.state === "scheduled" ? (
        <>
          <strong className={styles.teams}>
            <span>{fixture.homeTeam}</span>
            <span className={styles.versus}>VS</span>
            <span>{fixture.awayTeam}</span>
          </strong>
          <p>{fixture.dateLabel} {fixture.timeLabel} · 北京时间</p>
          <p>{fixture.venue}</p>
        </>
      ) : <p className={styles.summary}>{fixture.summary}</p>}
    </div>
  );
}
