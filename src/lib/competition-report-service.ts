import { prisma } from "@/lib/prisma";
import { isDatabaseContentSource } from "@/lib/content-source";
import { getStructuredContentMediaIds } from "@/lib/admin-content-input";

export async function getPublishedCompetitionReports(competitionId: string, now = new Date()) {
  if (!isDatabaseContentSource()) return [];
  const posts = await prisma.contentPost.findMany({
    where: {
      competitionId,
      competition: { publicPublished: true, isTestData: false },
      type: { in: ["NEWS", "ANNOUNCEMENT"] },
      status: "PUBLISHED",
      publishedAt: { lte: now },
    },
    select: { id: true, slug: true, title: true, type: true, publishedAt: true },
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
  });
  return posts.map((post) => ({
    id: post.id,
    title: post.title,
    href: `/news/${post.slug}`,
    category: post.type === "NEWS" ? "新闻" : "公告",
    dateTime: post.publishedAt!.toISOString(),
    dateLabel: new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(post.publishedAt!),
  }));
}

export async function getPublishedCompetitionImages(competitionId: string, now = new Date()) {
  if (!isDatabaseContentSource()) return [];
  const posts = await prisma.contentPost.findMany({
    where: { competitionId, competition: { publicPublished: true, isTestData: false }, type: { in: ["NEWS", "ANNOUNCEMENT"] }, status: "PUBLISHED", publishedAt: { lte: now } },
    select: { slug: true, title: true, source: true, coverMediaId: true, content: true },
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
  });
  const references = new Map<string, { reportHref: string; reportTitle: string; source: string | null }>();
  for (const post of posts) {
    for (const id of [...getStructuredContentMediaIds(post.content), ...(post.coverMediaId ? [post.coverMediaId] : [])]) {
      if (!references.has(id)) references.set(id, { reportHref: `/news/${post.slug}`, reportTitle: post.title, source: post.source });
    }
  }
  if (!references.size) return [];
  const media = await prisma.mediaAsset.findMany({
    where: { id: { in: [...references.keys()] }, visibility: "PUBLIC", mimeType: { in: ["image/jpeg", "image/png", "image/webp"] } },
    select: { id: true, altText: true },
  });
  const publicImages = new Map(media.map((asset) => [asset.id, asset]));
  return [...references].flatMap(([id, reference]) => {
    const asset = publicImages.get(id);
    return asset ? [{ id, src: `/media/${id}`, alt: asset.altText || reference.reportTitle, ...reference }] : [];
  });
}

export async function getPublicCompetitionAlbums(now = new Date()) {
  if (!isDatabaseContentSource()) return [];
  const competitions = await prisma.competition.findMany({
    where: { publicPublished: true, isTestData: false, reports: { some: { type: { in: ["NEWS", "ANNOUNCEMENT"] }, status: "PUBLISHED", publishedAt: { lte: now } } } },
    select: { id: true, name: true, slug: true, campus: true }, orderBy: [{ year: "desc" }, { id: "asc" }],
  });
  const albums = await Promise.all(competitions.map(async (competition) => ({ ...competition, images: await getPublishedCompetitionImages(competition.id, now) })));
  return albums.filter((album) => album.images.length > 0);
}
