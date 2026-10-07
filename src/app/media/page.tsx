import type { Metadata } from "next";

import { DouyinQrCard } from "@/components/media/douyin-qr-card";
import { MediaCollection } from "@/components/media/media-collection";
import styles from "@/components/media/media.module.css";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { SectionContactCard } from "@/components/ui/section-contact-card";
import { publicSectionContacts } from "@/data/contacts";
import { mediaCollections } from "@/data/media-collections";
import { bilibiliPlatform } from "@/data/platforms";
import { isDatabaseContentSource } from "@/lib/content-source";

export const metadata: Metadata = {
  alternates: { canonical: "/media" },
  title: "影像资料",
  description: "校园足球赛事影像发现入口：浏览2026女子与男子足球院际杯精选照片，继续查看完整赛事影像与官方影像平台。",
  openGraph: {
    title: "影像资料｜南京航空航天大学天目湖足球协会",
    description: "浏览南航校园足球赛事照片、完整赛事影像与官方影像平台。",
    url: "/media",
  },
};

export default function MediaPage() {
  const showReports = !isDatabaseContentSource();

  return (
    <>
      <SiteHeader />
      <main className={styles.page} id="main-content">
        <header className={styles.header}>
          <div className={styles.shell}>
            <p className={styles.eyebrow}>NUAA CAMPUS FOOTBALL / MEDIA</p>
            <h1>影像资料</h1>
            <p className={styles.lead}>校园足球赛事影像发现入口</p>
          </div>
        </header>
        <nav className={styles.navigation} aria-label="影像资料页内导航">
          <ul className={styles.shell}>
            <li><a href="#womens-cup-2026">女子院际杯</a></li>
            <li><a href="#mens-cup-2026">男子院际杯</a></li>
            <li><a href="#douyin">官方影像平台</a></li>
          </ul>
        </nav>
        <div className={`${styles.shell} ${styles.collections}`}>
          {mediaCollections.map((collection) => (
            <MediaCollection key={collection.id} collection={collection} showReport={showReports} />
          ))}
        </div>
        <section className="media-platform-section">
          <div className="page-shell">
            <DouyinQrCard />
            <article className="media-shared-platform">
              <span>BILIBILI / 共享视频平台</span>
              <h2>{bilibiliPlatform.name}</h2>
              <p>{bilibiliPlatform.description}</p>
              <a href={bilibiliPlatform.href} rel="noopener noreferrer" target="_blank">
                前往哔哩哔哩主页 ↗
              </a>
            </article>
            <SectionContactCard contact={publicSectionContacts.media} note="影像投稿与内容纠错" />
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
