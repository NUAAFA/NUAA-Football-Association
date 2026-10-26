import "server-only";

import type { ContentPostType, Prisma } from "@/generated/prisma-v29/client";
import { publishedNews, publicAnnouncements } from "@/data/content";
import { isDatabaseContentSource } from "@/lib/content-source";
import { isPublishedStaticContent, publishedContentWhere, staticContentPublishedAt } from "@/lib/content-publication";
import { prisma } from "@/lib/prisma";
import { readPublicData } from "@/lib/public-read";

export type PublicDiscoveryItem = {
  id: string;
  type: ContentPostType;
  href: string;
  title: string;
  summary: string;
  publishedAt: Date;
  updatedAt: Date;
  image: string;
  imageAlt: string;
  category: string;
  badge: string;
};

const discoverySelect = {
  id: true, type: true, slug: true, title: true, summary: true, publishedAt: true, updatedAt: true,
  coverMedia: { select: { id: true, altText: true, visibility: true, mimeType: true } },
} satisfies Prisma.ContentPostSelect;

function staticDiscovery(now: Date, type?: ContentPostType): PublicDiscoveryItem[] {
  const records = [
    ...publishedNews.map((item) => ({ item, type: "NEWS" as const })),
    ...publicAnnouncements.filter((item) => item.href.startsWith("/news/")).map((item) => ({ item, type: item.category === "纪律决定" ? "DISCIPLINE" as const : "ANNOUNCEMENT" as const })),
  ];
  return records.flatMap(({ item, type: itemType }) => {
    const publishedAt = staticContentPublishedAt(item);
    if (!publishedAt || !isPublishedStaticContent(item, now) || (type && type !== itemType)) return [];
    const updatedAt = "updatedAt" in item && item.updatedAt ? new Date(item.updatedAt) : publishedAt;
    return [{
      id: item.id, type: itemType, href: item.href, title: item.title, summary: item.summary,
      publishedAt, updatedAt: Number.isFinite(updatedAt.getTime()) ? updatedAt : publishedAt,
      image: "image" in item ? item.image : "/brand/nuaa-fa-logo.jpg",
      imageAlt: "imageAlt" in item ? item.imageAlt : item.title,
      category: item.category, badge: item.badge,
    }];
  });
}

/** Database mode is authoritative: no static fallback can resurrect an archived CMS slug. */
export async function getPublicDiscoveryItems(input: { now?: Date; type?: ContentPostType; take?: number } = {}): Promise<PublicDiscoveryItem[]> {
  const now = input.now ?? new Date();
  const limit = input.take === undefined ? undefined : Math.max(1, Math.min(100, input.take));
  const items = !isDatabaseContentSource() ? staticDiscovery(now, input.type) : await readPublicData("content-discovery", async () => {
    const rows: Array<Prisma.ContentPostGetPayload<{ select: typeof discoverySelect }>> = [];
    let cursor: string | undefined;
    do {
      const pageSize = Math.min(200, limit === undefined ? 200 : limit - rows.length);
      if (pageSize <= 0) break;
      const page = await prisma.contentPost.findMany({
        where: publishedContentWhere(now, input.type), select: discoverySelect,
        orderBy: [{ publishedAt: "desc" }, { id: "desc" }], take: pageSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      rows.push(...page);
      if (page.length < pageSize) break;
      cursor = page.at(-1)!.id;
    } while (limit === undefined || rows.length < limit);
    return rows.map((row) => ({
      id: row.id, type: row.type, href: `/news/${row.slug}`, title: row.title, summary: row.summary,
      publishedAt: row.publishedAt!, updatedAt: row.updatedAt,
      image: row.coverMedia?.visibility === "PUBLIC" && row.coverMedia.mimeType.startsWith("image/") ? `/media/${row.coverMedia.id}` : "/brand/nuaa-fa-logo.jpg",
      imageAlt: row.coverMedia?.visibility === "PUBLIC" ? row.coverMedia.altText || row.title : row.title,
      category: row.type === "NEWS" ? "新闻" : row.type === "DISCIPLINE" ? "纪律决定" : "通知公告",
      badge: row.type === "NEWS" ? "最新报道" : row.type === "DISCIPLINE" ? "纪律决定" : "正式公告",
    }));
  });
  const unique = [...new Map(items.map((item) => [item.href, item])).values()];
  unique.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  return limit === undefined ? unique : unique.slice(0, limit);
}
