import Image from "next/image";
import Link from "next/link";

import styles from "@/components/home/home-page.module.css";
import { LinkButton } from "@/components/ui/foundation-primitives";

const mediaMoments = [
  {
    src: "/images/competitions/2026-womens-intercollege-cup/05-sunset-match-action.jpg",
    alt: "晚霞下进行的女足院际杯比赛",
    label: "2026 女子足球院际杯",
    title: "晚霞下的女足赛场",
    href: "/competitions/2026-womens-intercollege-cup",
    size: "wide",
  },
  {
    src: "/images/competitions/2026-mens-intercollege-cup/final-corner-zhihui.jpg",
    alt: "致慧书院在2026男子足球院际杯决赛中准备角球",
    label: "2026 男子足球院际杯",
    title: "决赛角球时刻",
    href: "/competitions/2026-mens-intercollege-cup",
    size: "standard",
  },
  {
    src: "/images/competitions/2026-mens-intercollege-cup/assistant-referee-action.jpg",
    alt: "助理裁判员在2026男子足球院际杯边线执裁",
    label: "赛场秩序",
    title: "边线上的裁判员",
    href: "/referees",
    size: "standard",
  },
  {
    src: "/images/competitions/2026-womens-intercollege-cup/16-event-group-photo.jpg",
    alt: "2026天目湖校区女足赛事集体合影",
    label: "校园足球共同体",
    title: "赛事结束后的共同留影",
    href: "/competitions/2026-womens-intercollege-cup",
    size: "wide",
  },
] as const;

export function MediaPreview() {
  return (
    <section className={`${styles.section} ${styles.mediaPreview}`} id="home-media" aria-labelledby="home-media-title">
      <div className={`page-shell ${styles.sectionShell}`}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.sectionEyebrow}>CAMPUS FOOTBALL MOMENTS / 赛场瞬间</p>
            <h2 id="home-media-title">真实影像，记录每一次投入</h2>
          </div>
          <LinkButton href="/media" size="small" tone="quiet">
            进入影像资料 <span aria-hidden="true">→</span>
          </LinkButton>
        </div>
        <div className={styles.mediaGrid}>
          {mediaMoments.map((moment) => (
            <Link
              className={styles.mediaItem}
              href={moment.href}
              key={moment.src}
            >
              <Image
                src={moment.src}
                alt={moment.alt}
                fill
                sizes={moment.size === "wide" ? "(max-width: 860px) 100vw, 58vw" : "(max-width: 860px) 50vw, 29vw"}
              />
              <span className={styles.mediaCaption}>
                <small>{moment.label}</small>
                <strong>{moment.title}</strong>
              </span>
              <span className={styles.mediaArrow} aria-hidden="true">↗</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
