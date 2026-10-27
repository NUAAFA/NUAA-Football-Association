import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@libsql/client";
import type { PrismaClient } from "../../src/generated/prisma-v29/client";

export async function createMediaHistoryFixtureDatabase(url: string) {
  if (!url.startsWith("file:")) throw new Error("Preview fixtures require a local SQLite file.");
  const client = createClient({ url });
  try {
    const migrations = (await readdir("prisma/migrations", { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of migrations) await client.executeMultiple(await readFile(path.join("prisma/migrations", entry.name, "migration.sql"), "utf8"));
  } finally { client.close(); }
}

/** Fictional records for an isolated local database; never used by application code. */
export async function seedMediaHistoryFixture(prisma: PrismaClient, uploadRoot: string, reportCount = 2) {
  const competition = await prisma.competition.create({ data: {
    id: "catalogue-preview-current", slug: "catalogue-preview-freshman", name: "本地预览示例 · 新生杯（布局演示）",
    shortName: "本地预览示例", year: 2026, campus: "天目湖校区", format: "ELEVEN_A_SIDE", playingFormat: "十一人制",
    status: "ONGOING", publicPublished: true, summary: "仅用于本地检验相册归组与展示，不代表真实赛事动态。",
  } });
  const sources = [
    "2026-mens-intercollege-cup/zhihui-lineup-night.jpg", "2026-mens-intercollege-cup/final-action-civil-aviation.jpg",
    "2026-mens-intercollege-cup/final-huddle-zhihui.jpg", "2026-mens-intercollege-cup/champion-zhihui-team.jpg",
    "2026-womens-intercollege-cup/13-trophy-and-medals.jpg", "2026-womens-intercollege-cup/16-event-group-photo.jpg",
  ];
  const assets = [];
  await mkdir(path.join(uploadRoot, "2026/10"), { recursive: true });
  for (const [index, source] of sources.entries()) {
    const sourcePath = path.resolve("public/images/competitions", source);
    const storageKey = `2026/10/${randomUUID()}.jpg`;
    await copyFile(sourcePath, path.join(uploadRoot, storageKey));
    assets.push(await prisma.mediaAsset.create({ data: {
      id: `catalogue-preview-photo-${index}`, storageKey, storedFilename: path.basename(storageKey),
      originalFilename: path.basename(source), mimeType: "image/jpeg", size: (await stat(sourcePath)).size,
      visibility: "PUBLIC", altText: `本地预览配图 ${index + 1}：取自原有院际杯影像`, metadata: { localPreviewOnly: true },
    } }));
  }
  const posts = [];
  for (let index = 0; index < reportCount; index++) {
    const photos = index === 0 ? assets : [assets[index % assets.length]];
    posts.push(await prisma.contentPost.create({ data: {
      id: `catalogue-preview-report-${index}`, slug: `catalogue-preview-report-${index}`, type: "NEWS",
      title: index === 0 ? "本地预览示例｜同一篇报道的六张照片" : `本地预览示例｜比赛日影像 ${index + 1}`,
      summary: "本条仅为相册布局示例，配图来自保留的院际杯历史影像。",
      competitionId: competition.id, source: "本地布局演示，配图为原有院际杯照片", status: "PUBLISHED",
      publishedAt: new Date(`2026-10-${String(24 - index).padStart(2, "0")}T10:00:00Z`), coverMediaId: photos[0].id,
      content: { schemaVersion: 1, document: { type: "doc", content: [
        { type: "paragraph", content: [{ type: "text", text: "这是一条本地预览示例，用于检验一篇报道的照片归为一个相册，不代表实际赛事报道。" }] },
        ...photos.map((asset) => ({ type: "image", attrs: { src: `/media/${asset.id}`, alt: asset.altText } })),
      ] } },
    } }));
  }
  return { competition, assets, posts };
}
