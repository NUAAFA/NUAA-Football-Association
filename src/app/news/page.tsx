import type { Metadata } from "next";

import { PublicNewsBoard } from "@/components/public-news-board";
import { DatabaseNewsBoard } from "@/components/database-news-board";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import styles from "@/components/news/news-listing.module.css";
import { SectionContactCard } from "@/components/ui/section-contact-card";
import { publicSectionContacts } from "@/data/contacts";
import { newsFeed, publicAnnouncements } from "@/data/content";
import { getPublishedContentPage } from "@/lib/admin-content-service";
import { isDatabaseContentSource } from "@/lib/content-source";

export const metadata: Metadata = {
  alternates: { canonical: "/news" },
  title: "新闻公告",
  description: "南京航空航天大学天目湖足球协会新闻报道与通知公告。",
};

export const dynamic = "force-dynamic";

export default async function NewsPage({ searchParams }: PageProps<"/news">) {
  const params = await searchParams;
  const cursor = typeof params.cursor === "string" ? params.cursor : undefined;
  const databasePage = isDatabaseContentSource()
    ? await getPublishedContentPage({ cursor, pageSize: 10 })
    : null;
  return (
    <>
      <SiteHeader />
      <main className={styles.page} id="main-content">
        <div className="page-shell">
          <header className={styles.intro}>
            <p className={styles.eyebrow}>NEWS & NOTICES</p>
            <h1>新闻公告</h1>
            <p className={styles.description}>记录赛场故事，发布协会动态与正式通知。</p>
          </header>
          {databasePage
            ? <DatabaseNewsBoard items={databasePage.items} nextCursor={databasePage.nextCursor} />
            : <PublicNewsBoard news={newsFeed} notices={publicAnnouncements} />}
          <div className={styles.contact}>
            <SectionContactCard contact={publicSectionContacts.news} note="新闻投稿与内容纠错" />
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
