import { notFound } from "next/navigation";

import { ContentPostForm } from "@/components/admin/content-post-form";
import { AdminPageHeader } from "@/components/referees/admin/admin-ui";
import { getAdminContentPost } from "@/lib/admin-content-service";
import { prisma } from "@/lib/prisma";
import { guardUnifiedAdminPage } from "@/lib/unified-admin-page";

export default async function EditContentPostPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await guardUnifiedAdminPage("content:write", "content");
  const { id } = await params;
  const [post, imageMedia, pdfMedia, competitions] = await Promise.all([
    getAdminContentPost(id, actor),
    prisma.mediaAsset.findMany({ where: { visibility: "PUBLIC", mimeType: { startsWith: "image/" } }, select: { id: true, originalFilename: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.mediaAsset.findMany({ where: { visibility: "PUBLIC", mimeType: "application/pdf" }, select: { id: true, originalFilename: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.competition.findMany({ select: { id: true, name: true }, orderBy: [{ year: "desc" }, { name: "asc" }], take: 200 }),
  ]);
  if (!post) notFound();
  const statusLabel = { DRAFT: "草稿", PUBLISHED: "已发布", ARCHIVED: "已归档" }[post.status];
  // Keep existing selections visible even when outside the first picker page.
  if (post.coverMedia && !imageMedia.some((asset) => asset.id === post.coverMedia!.id)) imageMedia.push(post.coverMedia);
  if (post.discipline?.officialMediaId && !pdfMedia.some((asset) => asset.id === post.discipline!.officialMediaId)) {
    const selected = await prisma.mediaAsset.findUnique({ where: { id: post.discipline.officialMediaId }, select: { id: true, originalFilename: true } });
    if (selected) pdfMedia.push(selected);
  }
  return <><AdminPageHeader eyebrow="CONTENT OPERATIONS" title="编辑内容" description={`当前状态：${statusLabel}`} /><ContentPostForm competitions={competitions} imageMedia={imageMedia} initialValue={{ attachments: post.attachments.map((a) => ({ mediaAssetId: a.mediaAssetId, displayName: a.displayName, filename: a.mediaAsset.originalFilename, visibility: a.mediaAsset.visibility, mimeType: a.mediaAsset.mimeType })), id: post.id, type: post.type, slug: post.slug, title: post.title, summary: post.summary, contentJson: JSON.stringify(post.content, null, 2), source: post.source ?? "", coverMediaId: post.coverMedia?.id ?? "", pinned: post.pinned, featured: post.featured, discipline: { competitionId: post.discipline?.competitionId ?? "", officialMediaId: post.discipline?.officialMediaId ?? "", versionLabel: post.discipline?.versionLabel ?? "", scopeLabel: post.discipline?.scopeLabel ?? "" } }} pdfMedia={pdfMedia} /></>;
}
