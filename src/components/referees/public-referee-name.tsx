import { getPublicRefereeQualification } from "@/lib/referee-qualifications";
import styles from "./public-referee-name.module.css";

export function PublicRefereeName({ name, level }: { name: string; level?: string | null }) {
  const qualification = getPublicRefereeQualification(level);
  return <span className={styles.name}><span>{name}</span>{qualification ? <small className={styles.level}>（{qualification}）</small> : null}</span>;
}
