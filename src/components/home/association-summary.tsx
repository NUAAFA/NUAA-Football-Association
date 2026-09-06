import Link from "next/link";

import styles from "@/components/home/home-page.module.css";
import { Card } from "@/components/ui/foundation-primitives";
import { associationIdentity, associationScope, associationStats } from "@/data/association";

const associationLinks = [
  { eyebrow: "ABOUT", label: "认识协会", description: "了解组织沿革、职责与现任团队。", href: "/association" },
  { eyebrow: "REFEREE", label: "走近裁判", description: "查看裁判招募、规则资源与公开信息。", href: "/referees" },
  { eyebrow: "PARTICIPATE", label: "参与足球", description: "获取参赛、活动与加入协会的入口。", href: "/participation" },
] as const;

export function AssociationSummary() {
  return (
    <section className={`${styles.section} ${styles.association}`} id="home-about" aria-labelledby="home-association-title">
      <div className={`page-shell ${styles.associationShell}`}>
        <div className={styles.associationIntro}>
          <p className={styles.sectionEyebrow}>THE ASSOCIATION / 关于我们</p>
          <h2 id="home-association-title">扎根天目湖，服务校园足球</h2>
          <p>{associationScope.summary} 协会以赛事组织、裁判发展、规则传播与校园影像连接每一位参与者。</p>
          <div className={styles.associationIdentity}>
            <span>{associationIdentity.establishedLabel}</span>
            <small>{associationIdentity.englishName}</small>
          </div>
        </div>
        <dl className={styles.associationStats}>
          {associationStats.slice(0, 3).map((stat) => (
            <div key={stat.id}>
              <dt>{stat.value}</dt>
              <dd>
                {stat.label}
                <small>{stat.note}</small>
              </dd>
            </div>
          ))}
        </dl>
        <nav className={styles.associationLinks} aria-label="协会延伸入口">
          {associationLinks.map((item) => (
            <Card className={styles.associationLinkCard} interactive key={item.href}>
              <Link href={item.href}>
                <small>{item.eyebrow}</small>
                <strong>{item.label}</strong>
                <span>{item.description}</span>
                <b aria-hidden="true">→</b>
              </Link>
            </Card>
          ))}
        </nav>
      </div>
    </section>
  );
}
