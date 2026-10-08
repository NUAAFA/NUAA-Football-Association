import Link from "next/link";
import styles from "./formal-services.module.css";

export function FormalPageHeader({ title, eyebrow, description }: {
  title: string;
  eyebrow: string;
  description: string;
}) {
  return (
    <header className={styles.header}>
      <div className="page-shell">
        <nav className={styles.breadcrumb} aria-label="当前位置">
          <Link href="/competitions">赛事中心</Link><span aria-hidden="true">/</span><span aria-current="page">{title}</span>
        </nav>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1>{title}</h1>
        <p className={styles.description}>{description}</p>
      </div>
    </header>
  );
}
