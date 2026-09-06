import Link from "next/link";

import styles from "@/components/home/home-page.module.css";
import { Badge, LinkButton } from "@/components/ui/foundation-primitives";
import { publicAnnouncements } from "@/data/content";

function getNoticeLabel(category: string) {
  return category === "纪律决定" ? "DISCIPLINE" : "NOTICE";
}

export function NoticeQuickLinks() {
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
        <ol className={styles.noticeList}>
          {publicAnnouncements.slice(0, 3).map((notice, index) => {
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
                      <time>{notice.dateLabel}</time>
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
