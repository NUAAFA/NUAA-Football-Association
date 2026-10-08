"use client";

import { useSearchParams } from "next/navigation";

import { NewsEditorial, type EditorialItem } from "@/components/news/news-editorial";
import styles from "@/components/news/news-listing.module.css";
import type { NewsItem, NoticeItem } from "@/types";

import { newsDetailHref, newsFilter, newsListHref, type NewsFilter } from "@/components/news/news-navigation";

const filters: readonly { id: NewsFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "news", label: "新闻" },
  { id: "notices", label: "通知公告" },
  { id: "events", label: "赛事" },
];

export function PublicNewsBoard({ news, notices }: { news: readonly NewsItem[]; notices: readonly NoticeItem[] }) {
  const searchParams = useSearchParams();
  const filter = newsFilter(searchParams.get("filter"));
  const listContext = { filter };
  function setFilter(value: NewsFilter) {
    // Supported Next.js URL-state integration; avoid adding filter-only history entries.
    window.history.replaceState(null, "", newsListHref({ filter: value }));
  }
  const visibleNews = filter === "notices" ? [] : filter === "events"
    ? news.filter((item) => item.category === "比赛战报" || item.category === "赛事新闻")
    : news;
  const visibleNotices = filter === "all" || filter === "notices" ? notices : [];
  const stories: EditorialItem[] = visibleNews.map((item) => ({
    ...item,
    href: newsDetailHref(item.href, listContext),
    dateTime: item.publishedAt ?? item.dateLabel.replaceAll(".", "-").replace(" ", "T"),
    image: { src: item.image, alt: item.imageAlt },
  }));
  const announcements: EditorialItem[] = visibleNotices.map((item) => ({
    ...item,
    href: newsDetailHref(item.href, listContext),
    dateTime: item.publishedAt ?? item.dateLabel.replaceAll(".", "-"),
    pinned: item.publicationStatus === "置顶",
    discipline: item.category === "纪律决定",
  }));

  return (
    <NewsEditorial
      news={stories}
      notices={announcements}
      controls={(
        <div className={styles.filters} role="group" aria-label="内容分类">
          {filters.map((item) => (
            <button
              aria-controls="news-content"
              aria-pressed={filter === item.id}
              key={item.id}
              onClick={() => setFilter(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    />
  );
}
