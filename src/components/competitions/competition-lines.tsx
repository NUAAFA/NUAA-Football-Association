import { splitCompetitionLines } from "@/lib/competition-presentation";
import styles from "./competition-detail.module.css";

export function CompetitionLines({ value }: { value: string }) {
  return <span className={styles.lines}>{splitCompetitionLines(value).map((line, index) => <span key={index}>{line}</span>)}</span>;
}
