import Link from "next/link";

import { NewsEditorial, type EditorialItem } from "@/components/news/news-editorial";
import styles from "@/components/news/news-listing.module.css";

type PublicListItem = {
  type: "NEWS" | "ANNOUNCEMENT" | "DISCIPLINE";
  slug: string;
  title: string;
  summary: string;
  source: string | null;
  publishedAt: Date | null;
  pinned: boolean;
  cover: { url: string; altText: string | null } | null;
};

function dateLabel(value: Date | null) {
  if (!value) return "待确认";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

export function DatabaseNewsBoard({ items, nextCursor }: { items: PublicListItem[]; nextCursor: string | null }) {
  const present = (item: PublicListItem): EditorialItem => ({
    id: item.slug,
    href: `/news/${item.slug}`,
    title: item.title,
    summary: item.summary,
    category: item.type === "DISCIPLINE" ? "纪律决定" : item.type === "ANNOUNCEMENT" ? "通知公告" : "新闻",
    dateLabel: dateLabel(item.publishedAt),
    dateTime: item.publishedAt?.toISOString(),
    pinned: item.pinned,
    discipline: item.type === "DISCIPLINE",
    image: item.cover ? { src: item.cover.url, alt: item.cover.altText ?? item.title } : undefined,
  });

  return (
    <>
      <NewsEditorial
        news={items.filter((item) => item.type === "NEWS").map(present)}
        notices={items.filter((item) => item.type !== "NEWS").map(present)}
        controls={<span>本页发布</span>}
      />
      <nav aria-label="新闻分页" className={styles.pagination}>
        <Link href="/news">返回第一页</Link>
        {nextCursor
          ? <Link href={`/news?cursor=${encodeURIComponent(nextCursor)}`}>下一页 <span aria-hidden="true">→</span></Link>
          : <span>已到最后一页</span>}
      </nav>
    </>
  );
}
