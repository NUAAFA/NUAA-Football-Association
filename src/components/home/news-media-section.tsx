import Image from "next/image";
import Link from "next/link";

import styles from "@/components/home/home-page.module.css";
import {
  Badge,
  Card,
  LinkButton,
} from "@/components/ui/foundation-primitives";
import { homeNews } from "@/data/content";

export function NewsMediaSection() {
  const featuredNews = homeNews.find((item) => !item.image.startsWith("/brand/")) ?? homeNews[0];
  const secondaryNews = homeNews.filter((item) => item.id !== featuredNews.id).slice(0, 2);

  return (
    <section className={`${styles.section} ${styles.latestStories}`} id="home-news" aria-labelledby="home-news-media-title">
      <div className={`page-shell ${styles.sectionShell}`}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.sectionEyebrow}>LATEST STORIES / 最新故事</p>
            <h2 id="home-news-media-title">从赛场，到每一次共同奔赴</h2>
          </div>
          <LinkButton href="/news" size="small" tone="quiet">
            查看全部新闻 <span aria-hidden="true">→</span>
          </LinkButton>
        </div>
        <div className={styles.storyLayout}>
          <article className={styles.featuredStory}>
            <Link className={styles.featuredStoryImage} href={featuredNews.href} aria-label={`阅读：${featuredNews.title}`}>
              <Image
                src={featuredNews.image}
                alt={featuredNews.imageAlt}
                fill
                sizes="(max-width: 1100px) 100vw, 62vw"
              />
              <span className={styles.featuredStoryMarker}>FEATURED STORY</span>
            </Link>
            <div className={styles.featuredStoryCopy}>
              <div className={styles.storyMeta}>
                <Badge>{featuredNews.badge}</Badge>
                <span>{featuredNews.category}</span>
                <time>{featuredNews.dateLabel}</time>
              </div>
              <h3><Link href={featuredNews.href}>{featuredNews.title}</Link></h3>
              <p>{featuredNews.summary}</p>
              <Link className={styles.inlineLink} href={featuredNews.href}>
                阅读完整报道 <span aria-hidden="true">→</span>
              </Link>
            </div>
          </article>
          <div className={styles.secondaryStories}>
            {secondaryNews.map((item) => (
              <Card className={styles.secondaryStory} interactive key={item.id}>
                <Link href={item.href}>
                  <span className={styles.secondaryStoryImage}>
                    <Image
                      className={item.image.startsWith("/brand/") ? styles.brandImage : undefined}
                      src={item.image}
                      alt={item.imageAlt}
                      fill
                      sizes="(max-width: 720px) 34vw, (max-width: 1100px) 26vw, 15vw"
                    />
                  </span>
                  <span className={styles.secondaryStoryCopy}>
                    <span className={styles.storyMeta}>
                      <span>{item.category}</span>
                      <time>{item.dateLabel}</time>
                    </span>
                    <strong>{item.title}</strong>
                    <span className={styles.storyArrow} aria-hidden="true">→</span>
                  </span>
                </Link>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
