import Image from "next/image";

import styles from "@/components/home/home-page.module.css";
import { LinkButton } from "@/components/ui/foundation-primitives";
import { associationIdentity, associationScope } from "@/data/association";

export function Hero() {
  return (
    <section className={styles.hero} id="top" aria-labelledby="hero-title">
      <Image
        className={styles.heroImage}
        src="/images/competitions/2026-mens-intercollege-cup/final-celebration-zhihui.jpg"
        alt="致慧书院球员在2026男子足球院际杯决赛点球大战获胜后庆祝"
        fill
        loading="eager"
        sizes="100vw"
      />
      <div className={styles.heroOverlay} aria-hidden="true" />
      <div className={styles.heroFieldLines} aria-hidden="true" />

      <div className={`page-shell ${styles.heroShell}`}>
        <div className={styles.heroCopy}>
          <p className={styles.heroEyebrow}>NUAA CAMPUS FOOTBALL</p>
          <p className={styles.heroAssociation}>
            南京航空航天大学
            <span>天目湖足球协会</span>
          </p>
          <h1 id="hero-title" aria-label={associationIdentity.slogan}>
            因热爱，
            <span>奔赴绿茵</span>
          </h1>
          <p className={styles.heroSummary}>
            {associationScope.summary} 关注真实赛事、官方信息与校园足球故事。
          </p>
          <div className={styles.heroActions}>
            <LinkButton className={styles.heroPrimaryAction} href="/competitions">
              进入赛事中心 <span aria-hidden="true">↗</span>
            </LinkButton>
            <LinkButton className={styles.heroSecondaryAction} href="/news" tone="secondary">
              最新动态 <span aria-hidden="true">→</span>
            </LinkButton>
          </div>
        </div>
      </div>
    </section>
  );
}
