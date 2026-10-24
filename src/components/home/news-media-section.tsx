import Image from "@/components/ui/site-image";
import Link from "next/link";

import styles from "@/components/home/home-page.module.css";
import {
  Badge,
  Card,
  LinkButton,
} from "@/components/ui/foundation-primitives";
import { getPublicDiscoveryItems, type PublicDiscoveryItem } from "@/lib/public-content-discovery";
import { PublicLoadRetry } from "@/components/public-load-retry";

function formatStoryDate(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

export async function NewsMediaSection() {
  let homeNews: PublicDiscoveryItem[] = [];
  let unavailable = false;
  try { homeNews = await getPublicDiscoveryItems({ type: "NEWS", take: 3 }); }
  catch { unavailable = true; }
  const featuredNews = homeNews[0];
  const secondaryNews = homeNews.slice(1, 3);

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
        {unavailable ? <PublicLoadRetry label="最新故事" /> : !featuredNews ? <div className="functional-empty"><strong>暂无已发布报道</strong><p>正式报道发布后将在这里显示。</p></div> : <div className={styles.storyLayout}>
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
                <time dateTime={featuredNews.publishedAt.toISOString()}>{formatStoryDate(featuredNews.publishedAt)}</time>
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
                      <time dateTime={item.publishedAt.toISOString()}>{formatStoryDate(item.publishedAt)}</time>
                    </span>
                    <strong>{item.title}</strong>
                    <span className={styles.storyArrow} aria-hidden="true">→</span>
                  </span>
                </Link>
              </Card>
            ))}
          </div>
        </div>}
      </div>
    </section>
  );
}
