import type {
  ContentPostStatus,
  ContentPostType,
  Prisma,
} from "@/generated/prisma-v29/client";
import type { ContentPostInput, DisciplineInput } from "@/lib/admin-content-input";
import { getStructuredContentMediaIds, validateStructuredContent } from "@/lib/admin-content-input";
import { resolveMediaAssetFile } from "@/lib/admin-media-service";
import { readAttachments } from "@/lib/admin-content-input";
import { UnifiedAdminInputError } from "@/lib/unified-admin-api";
import { prisma } from "@/lib/prisma";
import {
  assertUnifiedAdminPermission,
  type UnifiedAdminActor,
} from "@/lib/unified-admin-rbac";

export const contentPostPageSize = 10;

export const contentPostTypeLabels: Record<ContentPostType, string> = {
  NEWS: "新闻",
  ANNOUNCEMENT: "公告",
  DISCIPLINE: "纪律处罚",
};

export const contentPostStatusLabels: Record<ContentPostStatus, string> = {
  DRAFT: "草稿",
  PUBLISHED: "已发布",
  ARCHIVED: "已归档",
};

const adminContentPostSelect = {
  id: true,
  type: true,
  slug: true,
  title: true,
  summary: true,
  content: true,
  status: true,
  source: true,
  publishedAt: true,
  pinned: true,
  featured: true,
  createdAt: true,
  updatedAt: true,
  attachments: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { mediaAssetId: true, displayName: true, mediaAsset: { select: { id: true, originalFilename: true, mimeType: true, size: true, visibility: true } } } },
  coverMedia: {
    select: { id: true, originalFilename: true, mimeType: true, visibility: true },
  },
  authorAdmin: { select: { id: true, displayName: true } },
  discipline: {
    select: {
      competitionId: true,
      officialMediaId: true,
      versionLabel: true,
      scopeLabel: true,
    },
  },
} satisfies Prisma.ContentPostSelect;

function normalizeSlug(value: string) {
  const slug = value.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new UnifiedAdminInputError("Slug 只能包含小写字母、数字和单个连字符。");
  }
  return slug;
}

function normalizeInput(input: ContentPostInput) {
  if (input.type !== "DISCIPLINE" && input.discipline) {
    throw new UnifiedAdminInputError("只有纪律处罚内容可以保存纪律扩展信息。");
  }
  return {
    attachments: readAttachments(input.attachments),
    type: input.type,
    slug: normalizeSlug(input.slug),
    title: input.title.trim(),
    summary: input.summary.trim(),
    content: validateStructuredContent(input.content) as Prisma.InputJsonValue,
    status: input.status,
    source: input.source?.trim() || null,
    coverMediaId: input.coverMediaId?.trim() || null,
    pinned: Boolean(input.pinned),
    featured: Boolean(input.featured),
    discipline: input.type === "DISCIPLINE" ? input.discipline ?? {} : null,
  };
}

async function assertPublishableMedia(
  tx: Prisma.TransactionClient,
  input: {
    type: ContentPostType;
    status: ContentPostStatus;
    coverMediaId: string | null;
    discipline: DisciplineInput | null;
    content: Prisma.InputJsonValue;
  },
) {
  if (input.status !== "PUBLISHED") return;
  if (input.coverMediaId) {
    const cover = await tx.mediaAsset.findUnique({
      where: { id: input.coverMediaId },
      select: { visibility: true, mimeType: true },
    });
    if (!cover || cover.visibility !== "PUBLIC" || !cover.mimeType.startsWith("image/")) {
      throw new UnifiedAdminInputError("发布内容的封面必须是存在的 PUBLIC 图片。", 409);
    }
  }
  const inlineMediaIds = getStructuredContentMediaIds(input.content);
  if (inlineMediaIds.length) {
    const media = await tx.mediaAsset.findMany({
      where: { id: { in: inlineMediaIds } },
      select: { id: true, visibility: true, mimeType: true },
    });
    if (
      media.length !== inlineMediaIds.length ||
      media.some((asset) => asset.visibility !== "PUBLIC" || !asset.mimeType.startsWith("image/"))
    ) {
      throw new UnifiedAdminInputError("发布正文引用的图片必须全部是存在的 PUBLIC 图片。", 409);
    }
  }
  if (input.type === "DISCIPLINE") {
    const officialMediaId = input.discipline?.officialMediaId?.trim();
    if (!officialMediaId) {
      throw new UnifiedAdminInputError("发布纪律处罚前必须选择正式 PDF。", 409);
    }
    const official = await tx.mediaAsset.findUnique({
      where: { id: officialMediaId },
      select: { visibility: true, mimeType: true },
    });
    if (!official || official.visibility !== "PUBLIC" || official.mimeType !== "application/pdf") {
      throw new UnifiedAdminInputError("正式纪律文件必须是存在的 PUBLIC PDF。", 409);
    }
  }
}

function disciplineData(input: DisciplineInput | null) {
  return {
    competitionId: input?.competitionId?.trim() || null,
    officialMediaId: input?.officialMediaId?.trim() || null,
    versionLabel: input?.versionLabel?.trim() || null,
    scopeLabel: input?.scopeLabel?.trim() || null,
  };
}

function mapUniqueError(error: unknown): never {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
    throw new UnifiedAdminInputError("Slug 已存在，请使用另一个地址。", 409);
  }
  throw error;
}

export function parseContentPage(value: string | string[] | undefined) {
  const text = Array.isArray(value) ? value[0] : value;
  const parsed = Number(text ?? "1");
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

export async function createContentPost(input: ContentPostInput, actor: UnifiedAdminActor) {
  assertUnifiedAdminPermission(actor, "content:write");
  const data = normalizeInput(input);
  try {
    return await prisma.$transaction(async (tx) => {
      await assertPublishableMedia(tx, data);
      await assertAttachmentFiles(tx, data, actor);
      const post = await tx.contentPost.create({
        data: {
          attachments: data.attachments ? { create: data.attachments.map((a, sortOrder) => ({ ...a, sortOrder, createdByAdminId: actor.id })) } : undefined,
          type: data.type,
          slug: data.slug,
          title: data.title,
          summary: data.summary,
          content: data.content,
          coverMediaId: data.coverMediaId,
          status: data.status,
          source: data.source,
          publishedAt: data.status === "PUBLISHED" ? new Date() : null,
          pinned: data.pinned,
          featured: data.featured,
          authorAdminId: actor.id,
          ...(data.discipline ? { discipline: { create: disciplineData(data.discipline) } } : {}),
        },
        select: adminContentPostSelect,
      });
      await tx.auditLog.create({
        data: {
          actorType: "ADMIN",
          actorId: actor.id,
          action: "CONTENT_POST_CREATE",
          entityType: "ContentPost",
          entityId: post.id,
          summary: `${actor.displayName}创建了${contentPostTypeLabels[post.type]}《${post.title}》`,
          metadata: JSON.stringify({ status: post.status, slug: post.slug }),
        },
      });
      return post;
    });
  } catch (error) {
    mapUniqueError(error);
  }
}

export async function updateContentPost(
  id: string,
  input: ContentPostInput,
  actor: UnifiedAdminActor,
) {
  assertUnifiedAdminPermission(actor, "content:write");
  const data = normalizeInput(input);
  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.contentPost.findUnique({
        where: { id },
        select: { id: true, status: true, publishedAt: true, type: true, slug: true, attachments: { select: { mediaAssetId: true, displayName: true } } },
      });
      if (!current) throw new UnifiedAdminInputError("内容不存在或已被移除。", 404);
      if (current.publishedAt && data.slug !== current.slug) throw new UnifiedAdminInputError("已发布内容的固定网址不可修改。", 409);
      await assertPublishableMedia(tx, data);
      await assertAttachmentFiles(tx, { ...data, attachments: data.attachments ?? current.attachments }, actor);
      const publishedAt = data.status === "PUBLISHED"
        ? current.publishedAt ?? new Date()
        : current.publishedAt;
      const post = await tx.contentPost.update({
        where: { id },
        data: {
          attachments: data.attachments ? { deleteMany: {}, create: data.attachments.map((a, sortOrder) => ({ ...a, sortOrder, createdByAdminId: actor.id })) } : undefined,
          type: data.type,
          slug: data.slug,
          title: data.title,
          summary: data.summary,
          content: data.content,
          coverMediaId: data.coverMediaId,
          status: data.status,
          source: data.source,
          publishedAt,
          pinned: data.pinned,
          featured: data.featured,
          ...(data.discipline
            ? { discipline: { upsert: { create: disciplineData(data.discipline), update: disciplineData(data.discipline) } } }
            : current.type === "DISCIPLINE"
              ? { discipline: { delete: true } }
              : {}),
        },
        select: adminContentPostSelect,
      });
      await tx.auditLog.create({
        data: {
          actorType: "ADMIN",
          actorId: actor.id,
          action: current.status === post.status ? "CONTENT_POST_UPDATE" : "CONTENT_POST_STATUS_CHANGE",
          entityType: "ContentPost",
          entityId: post.id,
          summary: `${actor.displayName}更新了${contentPostTypeLabels[post.type]}《${post.title}》`,
          metadata: JSON.stringify({ fromStatus: current.status, toStatus: post.status, slug: post.slug }),
        },
      });
      return post;
    });
  } catch (error) {
    mapUniqueError(error);
  }
}

export async function getAdminContentPost(id: string, actor: UnifiedAdminActor) {
  assertUnifiedAdminPermission(actor, "content:read");
  return prisma.contentPost.findUnique({ where: { id }, select: adminContentPostSelect });
}

export async function getAdminContentPage(input: {
  actor: UnifiedAdminActor;
  page: number;
  query?: string;
  status?: ContentPostStatus;
  type?: ContentPostType;
}) {
  assertUnifiedAdminPermission(input.actor, "content:read");
  const query = input.query?.trim();
  const where: Prisma.ContentPostWhereInput = {
    ...(input.status ? { status: input.status } : {}),
    ...(input.type ? { type: input.type } : {}),
    ...(query ? { OR: [{ title: { contains: query } }, { slug: { contains: query } }] } : {}),
  };
  const page = Math.max(1, input.page);
  const { type: _selectedType, ...countWhere } = where;
  void _selectedType;
  const [total, items, groups] = await Promise.all([
    prisma.contentPost.count({ where }),
    prisma.contentPost.findMany({
      where,
      select: adminContentPostSelect,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * contentPostPageSize,
      take: contentPostPageSize,
    }),
    prisma.contentPost.groupBy({ by: ["type"], where: countWhere, _count: true }),
  ]);
  return {
    counts: Object.fromEntries(groups.map((g) => [g.type, g._count])),
    items: items.map((p) => ({ ...p, attachmentCount: new Set([...p.attachments.map((a) => a.mediaAssetId), ...(p.discipline?.officialMediaId ? [p.discipline.officialMediaId] : [])]).size })),
    page,
    pageSize: contentPostPageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / contentPostPageSize)),
  };
}

type PublicCursor = { pinned: boolean; publishedAt: string; id: string };

function decodeCursor(value: string | undefined): PublicCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      typeof parsed === "object" && parsed !== null &&
      "pinned" in parsed && typeof parsed.pinned === "boolean" &&
      "publishedAt" in parsed && typeof parsed.publishedAt === "string" &&
      "id" in parsed && typeof parsed.id === "string" &&
      !Number.isNaN(Date.parse(parsed.publishedAt))
    ) {
      return { pinned: parsed.pinned, publishedAt: parsed.publishedAt, id: parsed.id };
    }
  } catch {
    // Invalid cursors are rejected below.
  }
  throw new UnifiedAdminInputError("分页 cursor 不正确。");
}

function encodeCursor(value: PublicCursor) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export async function getPublishedContentPage(input: {
  cursor?: string;
  type?: ContentPostType;
  year?: number;
  now?: Date;
  pageSize?: number;
}) {
  const now = input.now ?? new Date();
  const pageSize = Math.min(50, Math.max(1, input.pageSize ?? contentPostPageSize));
  const cursor = decodeCursor(input.cursor);
  const yearRange = input.year
    ? { gte: new Date(Date.UTC(input.year, 0, 1)), lt: new Date(Date.UTC(input.year + 1, 0, 1)) }
    : null;
  const baseWhere: Prisma.ContentPostWhereInput = {
    status: "PUBLISHED",
    publishedAt: { lte: now, ...(yearRange ?? {}) },
    ...(input.type ? { type: input.type } : {}),
  };
  const where: Prisma.ContentPostWhereInput = cursor
    ? {
        AND: [
          baseWhere,
          cursor.pinned
            ? { OR: [
                { pinned: true, publishedAt: { lt: new Date(cursor.publishedAt) } },
                { pinned: true, publishedAt: new Date(cursor.publishedAt), id: { lt: cursor.id } },
                { pinned: false },
              ] }
            : { AND: [
                { pinned: false },
                { OR: [
                    { publishedAt: { lt: new Date(cursor.publishedAt) } },
                    { publishedAt: new Date(cursor.publishedAt), id: { lt: cursor.id } },
                  ] },
              ] },
        ],
      }
    : baseWhere;
  const rows = await prisma.contentPost.findMany({
    where,
    select: {
      id: true,
      type: true,
      slug: true,
      title: true,
      summary: true,
      source: true,
      publishedAt: true,
      pinned: true,
      coverMedia: {
        select: { id: true, mimeType: true, altText: true, visibility: true },
      },
    },
    orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }, { id: "desc" }],
    take: pageSize + 1,
  });
  const hasNext = rows.length > pageSize;
  const items = rows.slice(0, pageSize).map((row) => ({
    type: row.type,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    source: row.source,
    publishedAt: row.publishedAt,
    pinned: row.pinned,
    cover: row.coverMedia?.visibility === "PUBLIC"
      ? { url: `/media/${row.coverMedia.id}`, mimeType: row.coverMedia.mimeType, altText: row.coverMedia.altText }
      : null,
  }));
  const last = items.at(-1);
  return {
    items,
    pageSize,
    nextCursor: hasNext && last?.publishedAt
      ? encodeCursor({ pinned: last.pinned, publishedAt: last.publishedAt.toISOString(), id: rows[pageSize - 1]!.id })
      : null,
  };
}

export async function getFeaturedPublishedContent(input: { type?: ContentPostType; now?: Date; take?: number } = {}) {
  const now = input.now ?? new Date();
  const rows = await prisma.contentPost.findMany({
    where: {
      status: "PUBLISHED",
      featured: true,
      publishedAt: { lte: now },
      ...(input.type ? { type: input.type } : {}),
    },
    select: {
      type: true,
      slug: true,
      title: true,
      summary: true,
      source: true,
      publishedAt: true,
      pinned: true,
      coverMedia: { select: { id: true, mimeType: true, altText: true, visibility: true } },
    },
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    take: Math.min(10, Math.max(1, input.take ?? 3)),
  });
  return rows.map((row) => ({
    type: row.type,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    source: row.source,
    publishedAt: row.publishedAt!,
    pinned: row.pinned,
    cover: row.coverMedia?.visibility === "PUBLIC"
      ? { url: `/media/${row.coverMedia.id}`, mimeType: row.coverMedia.mimeType, altText: row.coverMedia.altText }
      : null,
  }));
}

export async function getPublishedContentDetailBySlug(slug: string, now = new Date()) {
  const row = await prisma.contentPost.findFirst({
    where: { slug, status: "PUBLISHED", publishedAt: { lte: now } },
    select: {
      attachments: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }], where: { mediaAsset: { visibility: "PUBLIC" } }, select: { displayName: true, mediaAsset: { select: { id: true, originalFilename: true, mimeType: true, size: true } } } },
      type: true,
      slug: true,
      title: true,
      summary: true,
      content: true,
      source: true,
      publishedAt: true,
      updatedAt: true,
      pinned: true,
      featured: true,
      coverMedia: { select: { id: true, mimeType: true, altText: true, visibility: true } },
      discipline: {
        select: {
          versionLabel: true,
          scopeLabel: true,
          competition: { select: { name: true } },
          officialMedia: { select: { id: true, originalFilename: true, mimeType: true, visibility: true } },
        },
      },
    },
  });
  if (!row) return null;
  const official = row.discipline?.officialMedia;
  return {
    attachments: row.attachments.map((a) => ({ url: `/media/${a.mediaAsset.id}`, filename: a.displayName || a.mediaAsset.originalFilename, mimeType: a.mediaAsset.mimeType, size: a.mediaAsset.size })),
    type: row.type,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    content: validateStructuredContent(row.content),
    source: row.source,
    publishedAt: row.publishedAt!,
    updatedAt: row.updatedAt,
    pinned: row.pinned,
    featured: row.featured,
    cover: row.coverMedia?.visibility === "PUBLIC"
      ? { url: `/media/${row.coverMedia.id}`, mimeType: row.coverMedia.mimeType, altText: row.coverMedia.altText }
      : null,
    discipline: row.type === "DISCIPLINE" ? {
      versionLabel: row.discipline?.versionLabel ?? null,
      scopeLabel: row.discipline?.scopeLabel ?? null,
      competitionName: row.discipline?.competition?.name ?? null,
      officialMedia: official?.visibility === "PUBLIC" && official.mimeType === "application/pdf"
        ? { url: `/media/${official.id}`, filename: official.originalFilename, mimeType: official.mimeType }
        : null,
    } : null,
  };
}

async function assertAttachmentFiles(tx: Prisma.TransactionClient, input: ReturnType<typeof normalizeInput>, actor: UnifiedAdminActor) {
  const attachments = input.attachments ?? [];
  const ids = [...new Set([...attachments.map((a) => a.mediaAssetId), ...(input.status === "PUBLISHED" ? [input.coverMediaId, input.discipline?.officialMediaId, ...getStructuredContentMediaIds(input.content)].filter((id): id is string => Boolean(id)) : [])])];
  if (!ids.length) return;
  const assets = await tx.mediaAsset.findMany({ where: { id: { in: ids } }, select: { id: true, originalFilename: true, visibility: true, mimeType: true } });
  for (const id of ids) {
    const asset = assets.find((a) => a.id === id);
    if (!asset) throw new UnifiedAdminInputError(`附件或图片不存在：${id}`, 409);
    if (attachments.some((a) => a.mediaAssetId === id) && !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(asset.mimeType)) throw new UnifiedAdminInputError(`文件格式不支持：${asset.originalFilename}`, 409);
    if (input.status === "PUBLISHED" && asset.visibility !== "PUBLIC") throw new UnifiedAdminInputError(`文件“${asset.originalFilename}”仅后台可见，请显式确认公开后再发布。`, 409);
    try { await resolveMediaAssetFile(id, actor, { db: tx }); } catch { throw new UnifiedAdminInputError(`文件“${asset.originalFilename}”缺失、大小异常或不可访问。`, 409); }
  }
}
