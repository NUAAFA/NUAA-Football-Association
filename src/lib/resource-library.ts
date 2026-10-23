import type { Prisma } from "@/generated/prisma-v29/client";
import { publicCompetitionFiles } from "@/data/competition-center";
import { disciplineDecisions } from "@/data/public-information";
import { refereeTrainingResources } from "@/data/referee-training-resources";
import { refereeWorkFiles } from "@/data/referees";
import { resourceCategories, resourceVersionLabels, type ResourceFormValue } from "@/data/resource-options";
import { resolveMediaAssetFile } from "@/lib/admin-media-service";
import { prisma } from "@/lib/prisma";
import { UnifiedAdminInputError } from "@/lib/unified-admin-api";
import { assertUnifiedAdminPermission, type UnifiedAdminActor } from "@/lib/unified-admin-rbac";
import { isRecord } from "@/lib/referee-validation";
import type { PublicCompetitionFile } from "@/types/competition-center";

export type ResourceDocumentView = ResourceFormValue & {
  id: string;
  builtinKey: string | null;
  href: string;
  fileHref: string;
  fileType: "PDF" | "DOCX" | "PPTX";
  tags?: readonly string[];
};

const defaults = {
  description: "", source: "", scope: "", version: "", dateLabel: "", versionNote: "",
  versionStatus: "historical", playingFormat: "all", trainingLevel: "基础", status: "PUBLISHED", mediaAssetId: null,
} as const;

const builtinResources: ResourceDocumentView[] = [
  ...publicCompetitionFiles.filter((file) => resourceCategories.some((category) => category.key === file.category)).map((file, index): ResourceDocumentView => ({
    ...defaults, id: `builtin-competition-${file.id}`, builtinKey: `builtin-competition-${file.id}`,
    category: file.category as ResourceFormValue["category"], title: file.title, source: file.source, scope: file.scope,
    version: file.version, dateLabel: file.publishedAt, versionStatus: file.versionStatus, versionNote: file.versionNote,
    playingFormat: file.id.startsWith("futsal-") ? "futsal" : file.category === "regulations" ? "eleven-a-side" : "all",
    sortOrder: (index + 1) * 10, href: file.href, fileHref: disciplineDecisions.find((decision) => decision.id === file.id)?.pdfHref ?? file.href,
    fileType: file.fileType, fileLabel: file.title,
  })),
  ...refereeTrainingResources.map((file, index): ResourceDocumentView => ({
    ...defaults, id: `builtin-training-${file.id}`, builtinKey: `builtin-training-${file.id}`, category: "training",
    title: file.title, description: file.description, source: "协会提供的培训资料", scope: "裁判培训与业务学习",
    trainingLevel: file.level, versionNote: file.versionNote ?? "", tags: file.tags, sortOrder: (index + 1) * 10,
    href: file.fileHref, fileHref: file.fileHref, fileType: file.fileType, fileLabel: file.title,
  })),
  ...refereeWorkFiles.map((file, index): ResourceDocumentView => ({
    ...defaults, id: `builtin-work-${file.id}`, builtinKey: `builtin-work-${file.id}`, category: "work-files",
    title: file.title, source: file.source, scope: file.scope, version: file.version, dateLabel: file.publishedAt,
    sortOrder: (index + 1) * 10, href: file.href, fileHref: file.href, fileType: file.fileType, fileLabel: file.title,
  })),
];

const builtinByKey = new Map(builtinResources.map((resource) => [resource.id, resource]));
const includeMedia = { mediaAsset: { select: { id: true, originalFilename: true, mimeType: true, visibility: true } } } satisfies Prisma.ResourceDocumentInclude;
type ResourceRow = Prisma.ResourceDocumentGetPayload<{ include: typeof includeMedia }>;

function resourceView(row: ResourceRow): ResourceDocumentView | null {
  const builtin = row.builtinKey ? builtinByKey.get(row.builtinKey) : undefined;
  if (!row.mediaAsset && !builtin) return null;
  return {
    ...row,
    category: row.category as ResourceFormValue["category"],
    versionStatus: row.versionStatus as ResourceFormValue["versionStatus"],
    playingFormat: row.playingFormat as ResourceFormValue["playingFormat"],
    trainingLevel: row.trainingLevel as ResourceFormValue["trainingLevel"],
    href: row.mediaAsset ? `/media/${row.mediaAsset.id}` : builtin!.href,
    fileHref: row.mediaAsset ? `/media/${row.mediaAsset.id}` : builtin!.fileHref,
    fileType: row.mediaAsset ? "PDF" : builtin!.fileType,
    fileLabel: row.mediaAsset?.originalFilename ?? builtin!.fileLabel,
    tags: builtin?.tags,
  };
}

export async function getResourceLibrary(actor?: UnifiedAdminActor): Promise<ResourceDocumentView[]> {
  if (actor) assertUnifiedAdminPermission(actor, "content:read");
  const rows = await prisma.resourceDocument.findMany({ include: includeMedia, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
  const resources = new Map(builtinResources.map((resource) => [resource.id, resource]));
  for (const row of rows) {
    if (row.builtinKey) resources.delete(row.builtinKey);
    const resource = resourceView(row);
    if (resource && (actor || (resource.status === "PUBLISHED" && (!row.mediaAsset || row.mediaAsset.visibility === "PUBLIC")))) resources.set(resource.id, resource);
  }
  return [...resources.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

export async function getAdminResource(id: string, actor: UnifiedAdminActor) {
  return (await getResourceLibrary(actor)).find((resource) => resource.id === id || resource.builtinKey === id) ?? null;
}

function textField(value: Record<string, unknown>, key: string, limit: number, required = false) {
  const field = value[key];
  if (field !== undefined && field !== null && typeof field !== "string") throw new UnifiedAdminInputError(`${key}格式不正确。`);
  const text = typeof field === "string" ? field.trim() : "";
  if ((required && !text) || text.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) throw new UnifiedAdminInputError(`${key}为空、过长或包含无效字符。`);
  return text;
}

export function readResourceDocumentInput(value: unknown) {
  if (!isRecord(value)) throw new UnifiedAdminInputError("资料格式不正确。");
  const category = textField(value, "category", 30, true);
  const status = textField(value, "status", 20, true);
  const versionStatus = textField(value, "versionStatus", 20, true);
  const playingFormat = textField(value, "playingFormat", 20, true);
  const trainingLevel = textField(value, "trainingLevel", 10, true);
  if (!resourceCategories.some((option) => option.key === category) || !["DRAFT", "PUBLISHED", "ARCHIVED"].includes(status) || !Object.hasOwn(resourceVersionLabels, versionStatus) || !["all", "eleven-a-side", "futsal"].includes(playingFormat) || !["基础", "专项", "进阶"].includes(trainingLevel)) throw new UnifiedAdminInputError("资料分类、状态或适用分组无效。");
  if (!Number.isSafeInteger(value.sortOrder) || Math.abs(value.sortOrder as number) > 10000) throw new UnifiedAdminInputError("排序须为 -10000 到 10000 的整数。");
  if (value.confirmPublic !== undefined && typeof value.confirmPublic !== "boolean") throw new UnifiedAdminInputError("公开确认格式不正确。");
  return {
    category, status: status as ResourceFormValue["status"], versionStatus, playingFormat, trainingLevel,
    title: textField(value, "title", 160, true), description: textField(value, "description", 1000),
    source: textField(value, "source", 120), scope: textField(value, "scope", 160), version: textField(value, "version", 80),
    dateLabel: textField(value, "dateLabel", 40), versionNote: textField(value, "versionNote", 500),
    mediaAssetId: textField(value, "mediaAssetId", 120) || null, sortOrder: value.sortOrder as number,
    confirmPublic: value.confirmPublic === true,
  };
}

export async function saveResourceDocument(id: string | null, value: unknown, actor: UnifiedAdminActor) {
  assertUnifiedAdminPermission(actor, "content:write");
  assertUnifiedAdminPermission(actor, "media:write");
  const { confirmPublic, ...input } = readResourceDocumentInput(value);
  if (input.status === "PUBLISHED" && !confirmPublic) throw new UnifiedAdminInputError("请确认资料及原文件可以公开后再发布。");
  return prisma.$transaction(async (tx) => {
    const existing = id ? await tx.resourceDocument.findFirst({ where: { OR: [{ id }, { builtinKey: id }] } }) : null;
    const builtinKey = existing?.builtinKey ?? (id && builtinByKey.has(id) ? id : null);
    if (id && !existing && !builtinKey) throw new UnifiedAdminInputError("资料不存在。", 404);
    if (!input.mediaAssetId && !builtinKey) throw new UnifiedAdminInputError("请上传或选择 PDF 文件。");
    if (input.mediaAssetId) {
      const asset = await resolveMediaAssetFile(input.mediaAssetId, actor, { db: tx });
      if (asset.mimeType !== "application/pdf") throw new UnifiedAdminInputError("资料库新上传的文件须为 PDF。", 415);
      if (input.status === "PUBLISHED" && asset.visibility !== "PUBLIC") {
        await tx.mediaAsset.update({ where: { id: asset.id }, data: { visibility: "PUBLIC" } });
        await tx.auditLog.create({ data: { actorType: "ADMIN", actorId: actor.id, action: "MEDIA_VISIBILITY_CHANGED", entityType: "MediaAsset", entityId: asset.id, summary: "管理员发布资料时明确确认原文件公开" } });
      }
    }
    const record = existing
      ? await tx.resourceDocument.update({ where: { id: existing.id }, data: input })
      : await tx.resourceDocument.create({ data: { ...input, builtinKey } });
    await tx.auditLog.create({ data: { actorType: "ADMIN", actorId: actor.id, action: "RESOURCE_DOCUMENT_SAVE", entityType: "ResourceDocument", entityId: record.id, summary: `${actor.displayName}保存资料《${record.title}》`, metadata: JSON.stringify({ status: record.status, category: record.category, mediaAssetId: record.mediaAssetId, builtinKey }) } });
    return record;
  });
}

export async function getPublicCompetitionFiles(): Promise<PublicCompetitionFile[]> {
  return (await getResourceLibrary()).filter((resource) => !["training", "work-files"].includes(resource.category)).map((resource) => ({
    id: resource.builtinKey?.replace(/^builtin-competition-/, "") ?? resource.id, title: resource.title, category: resource.category as PublicCompetitionFile["category"],
    categoryLabel: resourceCategories.find((category) => category.key === resource.category)!.label,
    fileType: resource.fileType === "DOCX" ? "DOCX" : "PDF", version: resource.version, publishedAt: resource.dateLabel,
    scope: resource.scope, href: resource.href, downloadHref: resource.fileHref, source: resource.source,
    versionStatus: resource.versionStatus, versionStatusLabel: resourceVersionLabels[resource.versionStatus], versionNote: resource.versionNote,
  }));
}
