import { cache } from "react";

import { mensCupGallery, officialMensCupNews } from "@/data/mens-intercollege-cup-2026";
import { womensCupGallery, officialWomensCupNews } from "@/data/womens-intercollege-cup-2026";
import { getStructuredContentMediaIds } from "@/lib/admin-content-input";
import { isDatabaseContentSource } from "@/lib/content-source";
import { publishedContentWhere } from "@/lib/content-publication";
import { prisma } from "@/lib/prisma";
import { readPublicData } from "@/lib/public-read";
import type { MediaAlbum } from "@/types/media-album";

/** Existing collections remain complete even when their CMS reports are withdrawn. */
export function getLegacyMediaAlbums(): MediaAlbum[] {
  const showReport = !isDatabaseContentSource();
  return [
    {
      id: "womens-cup-2026", title: "2026女子足球院际杯 · 比赛与颁奖",
      competitionKey: "2026-womens-intercollege-cup", competitionName: "2026女子足球院际杯（天目湖校区）",
      competitionHref: "/competitions/2026-womens-intercollege-cup", year: 2026, campus: "天目湖校区", kind: "赛事影像",
      publishedAt: "2026-06-22T08:53:00.000Z", dateLabel: "2026-06-22", source: officialWomensCupNews[0].source ?? null,
      reportHref: showReport ? officialWomensCupNews[0].href : null,
      images: [...womensCupGallery], cover: womensCupGallery.find((image) => image.src === officialWomensCupNews[0].image) ?? womensCupGallery[0],
    },
    {
      id: "mens-cup-2026", title: "2026男子足球院际杯 · 赛场与冠军时刻",
      competitionKey: "2026-mens-intercollege-cup", competitionName: "2026男子足球院际杯（天目湖校区）",
      competitionHref: "/competitions/2026-mens-intercollege-cup", year: 2026, campus: "天目湖校区", kind: "赛事影像",
      publishedAt: null, dateLabel: "2026 赛季", source: officialMensCupNews[0].source ?? null,
      reportHref: showReport ? officialMensCupNews.find((item) => item.id === "2026-mens-cup-closing")?.href ?? null : null, images: [...mensCupGallery],
      cover: mensCupGallery.find((image) => image.src.endsWith("champion-zhihui-team.jpg")) ?? mensCupGallery[0],
    },
  ];
}

export async function getPublishedReportAlbums(now = new Date(), reportId?: string): Promise<MediaAlbum[]> {
  if (!isDatabaseContentSource()) return [];
  return readPublicData("report-albums", async () => {
    const posts = await prisma.contentPost.findMany({
      where: {
        ...publishedContentWhere(now, ["NEWS", "ANNOUNCEMENT"]),
        ...(reportId ? { id: reportId } : {}),
        competition: { publicPublished: true, isTestData: false },
      },
      select: {
        id: true, title: true, slug: true, publishedAt: true, source: true, coverMediaId: true, content: true,
        competition: { select: { id: true, slug: true, name: true, year: true, campus: true } },
      },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    });
    // Deduplicate within a report. A shared photograph may still belong to two distinct reports.
    const references = posts.map((post) => ({ post, ids: [...new Set([
      ...getStructuredContentMediaIds(post.content), ...(post.coverMediaId ? [post.coverMediaId] : []),
    ])] }));
    const ids = [...new Set(references.flatMap((reference) => reference.ids))];
    const publicImages = new Map<string, { id: string; altText: string | null }>();
    // Stay below SQLite's variable limit as the archive grows.
    for (let offset = 0; offset < ids.length; offset += 400) {
      const assets = await prisma.mediaAsset.findMany({
        where: { id: { in: ids.slice(offset, offset + 400) }, visibility: "PUBLIC", mimeType: { in: ["image/jpeg", "image/png", "image/webp"] } },
        select: { id: true, altText: true },
      });
      for (const asset of assets) publicImages.set(asset.id, asset);
    }
    const albums: MediaAlbum[] = [];
    for (const { post, ids: photoIds } of references) {
      if (!post.competition || !post.publishedAt) continue;
      const images = photoIds.flatMap((id) => {
        const asset = publicImages.get(id);
        return asset ? [{ src: `/media/${id}`, alt: asset.altText || post.title, width: 1600, height: 1200 }] : [];
      });
      if (!images.length) continue;
      albums.push({
        id: `report-${post.id}`, title: post.title, competitionKey: post.competition.slug,
        competitionName: post.competition.name, competitionHref: `/competitions/${post.competition.slug}`,
        year: post.competition.year, campus: post.competition.campus || "校区待补充", kind: "报道相册",
        publishedAt: post.publishedAt.toISOString(),
        dateLabel: new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(post.publishedAt),
        source: post.source, reportHref: `/news/${post.slug}`, images,
        cover: images.find((image) => image.src === `/media/${post.coverMediaId}`) ?? images[0],
      });
    }
    return albums;
  });
}

export const getMediaAlbums = cache(async () => {
  const albums = [...await getPublishedReportAlbums(), ...getLegacyMediaAlbums()];
  return albums.sort((a, b) => (b.year ?? 0) - (a.year ?? 0)
    || (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "") || a.id.localeCompare(b.id));
});

export async function getMediaAlbum(id: string) {
  const legacy = getLegacyMediaAlbums().find((album) => album.id === id);
  if (legacy) return legacy;
  if (!id.startsWith("report-") || id.length > 200) return undefined;
  return (await getPublishedReportAlbums(new Date(), id.slice(7)))[0];
}
