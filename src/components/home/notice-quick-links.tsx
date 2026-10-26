import Link from "next/link";

import styles from "@/components/home/home-page.module.css";
import { Badge, LinkButton } from "@/components/ui/foundation-primitives";
import { publicAnnouncements } from "@/data/content";
import { getPublishedContentPage } from "@/lib/admin-content-service";
import { isDatabaseContentSource } from "@/lib/content-source";
import { PublicLoadRetry } from "@/components/public-load-retry";
import { isPublishedStaticContent } from "@/lib/content-publication";

function getNoticeLabel(category: string) {
  return category === "纪律决定" ? "DISCIPLINE" : "NOTICE";
}

export async function NoticeQuickLinks() {
  let databasePage: Awaited<ReturnType<typeof getPublishedContentPage>> | null = null;
  let unavailable = false;
  try {
    if (isDatabaseContentSource()) databasePage = await getPublishedContentPage({ type: ["ANNOUNCEMENT", "DISCIPLINE"], pageSize: 3 });
  } catch { unavailable = true; }
  const notices = databasePage
    ? databasePage.items.map((item) => ({
        id: item.slug,
        href: `/news/${item.slug}`,
        category: item.type === "DISCIPLINE" ? "纪律决定" : "通知公告",
        title: item.title,
        summary: item.summary,
        dateLabel: item.publishedAt
          ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(item.publishedAt)
          : "待确认",
        publishedAt: item.publishedAt?.toISOString(),
      }))
    : publicAnnouncements.filter((item) => isPublishedStaticContent(item)).slice(0, 3);

  return (
    <section className={`${styles.section} ${styles.officialUpdates}`} id="home-notices" aria-labelledby="home-notice-title">
      <div className={`page-shell ${styles.sectionShell}`}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.sectionEyebrow}>OFFICIAL UPDATES / 官方信息</p>
            <h2 id="home-notice-title">公告与纪律决定</h2>
          </div>
          <LinkButton href="/news#notices" size="small" tone="quiet">
            查看全部公告 <span aria-hidden="true">→</span>
          </LinkButton>
        </div>
        {unavailable ? <PublicLoadRetry label="公告" /> : !notices.length ? <p>暂无已发布公告。</p> : null}
        <ol className={styles.noticeList}>
          {!unavailable && notices.map((notice, index) => {
            const isDiscipline = notice.category === "纪律决定";
            return (
              <li key={notice.id}>
                <Link className={styles.noticeLink} href={notice.href}>
                  <span className={styles.noticeIndex}>0{index + 1}</span>
                  <div className={styles.noticeCopy}>
                    <div className={styles.noticeMeta}>
                      <Badge tone={isDiscipline ? "danger" : "info"}>
                        {getNoticeLabel(notice.category)}
                      </Badge>
                      <span>{notice.category}</span>
                      <time dateTime={notice.publishedAt}>{notice.dateLabel}</time>
                    </div>
                    <h3>{notice.title}</h3>
                    <p>{notice.summary}</p>
                  </div>
                  <span className={styles.noticeArrow} aria-hidden="true">↗</span>
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
