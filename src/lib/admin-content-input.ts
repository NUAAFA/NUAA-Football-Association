import type { ContentPostStatus, ContentPostType } from "@/generated/prisma-v29/client";
import { UnifiedAdminInputError } from "@/lib/unified-admin-api";

export type StructuredTextMark =
  | { type: "bold" | "italic" | "underline" }
  | { type: "link"; attrs: { href: string } };

export type StructuredTextNode = { type: "text"; text: string; marks?: StructuredTextMark[] };
export type StructuredContentNode =
  | { type: "paragraph"; content?: StructuredTextNode[] }
  | { type: "heading"; attrs: { level: 2 | 3 }; content?: StructuredTextNode[] }
  | { type: "blockquote"; content: StructuredContentNode[] }
  | { type: "bulletList" | "orderedList"; content: StructuredContentNode[] }
  | { type: "listItem"; content: StructuredContentNode[] }
  | { type: "horizontalRule" }
  | { type: "image"; attrs: { src: string; alt?: string } };

export type StructuredContent = {
  schemaVersion: 1;
  document: { type: "doc"; content: StructuredContentNode[] };
};

export type DisciplineInput = {
  competitionId?: string | null;
  officialMediaId?: string | null;
  versionLabel?: string | null;
  scopeLabel?: string | null;
};

export type ContentPostInput = {
  type: ContentPostType;
  slug: string;
  title: string;
  summary: string;
  content: StructuredContent;
  status: ContentPostStatus;
  source?: string | null;
  coverMediaId?: string | null;
  pinned?: boolean;
  featured?: boolean;
  discipline?: DisciplineInput | null;
  attachments?: Array<{ mediaAssetId: string; displayName?: string | null }>;
};

const maximumStructuredContentBytes = 100_000;
const maximumStructuredContentNodes = 2_000;
const maximumStructuredContentDepth = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new UnifiedAdminInputError(`${label}包含未允许的字段。`);
  }
}

function readText(value: unknown, label: string, maximum: number, required = true) {
  const result = typeof value === "string" ? value.trim() : "";
  if (required && !result) throw new UnifiedAdminInputError(`${label}不能为空。`);
  if (result.length > maximum) throw new UnifiedAdminInputError(`${label}不能超过 ${maximum} 个字符。`);
  return result || null;
}

function readEnum<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) {
    throw new UnifiedAdminInputError(`${label}不正确。`);
  }
  return value as T;
}

function normalizeLinkHref(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > 2_048) {
    throw new UnifiedAdminInputError("链接地址无效或过长。");
  }
  const href = value.trim();
  if (href.startsWith("/")) {
    if (href.startsWith("//") || href.includes("\\")) throw new UnifiedAdminInputError("链接地址协议不在允许范围内。");
    return href;
  }
  try {
    const url = new URL(href);
    if (!(["http:", "https:", "mailto:"] as string[]).includes(url.protocol)) throw new Error("unsupported protocol");
    return href;
  } catch {
    throw new UnifiedAdminInputError("链接地址协议不在允许范围内。");
  }
}

function normalizeMarks(value: unknown): StructuredTextMark[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 4) throw new UnifiedAdminInputError("正文文本标记格式不正确。");
  const seen = new Set<string>();
  const marks = value.map((candidate): StructuredTextMark => {
    if (!isRecord(candidate) || typeof candidate.type !== "string") throw new UnifiedAdminInputError("正文文本标记格式不正确。");
    if (seen.has(candidate.type)) throw new UnifiedAdminInputError("正文文本标记不能重复。");
    seen.add(candidate.type);
    if (candidate.type === "bold" || candidate.type === "italic" || candidate.type === "underline") {
      assertOnlyKeys(candidate, ["type"], "正文文本标记");
      return { type: candidate.type };
    }
    if (candidate.type === "link") {
      assertOnlyKeys(candidate, ["type", "attrs"], "链接标记");
      if (!isRecord(candidate.attrs)) throw new UnifiedAdminInputError("链接标记缺少地址。");
      return { type: "link", attrs: { href: normalizeLinkHref(candidate.attrs.href) } };
    }
    throw new UnifiedAdminInputError("正文包含尚未允许的文本标记。");
  });
  return marks.length ? marks : undefined;
}

function normalizeInlineContent(value: unknown): StructuredTextNode[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new UnifiedAdminInputError("正文文本节点格式不正确。");
  const content = value.map((candidate): StructuredTextNode => {
    if (!isRecord(candidate) || candidate.type !== "text" || typeof candidate.text !== "string") {
      throw new UnifiedAdminInputError("正文文本节点格式不正确。");
    }
    assertOnlyKeys(candidate, ["type", "text", "marks"], "正文文本节点");
    if (!candidate.text || candidate.text.length > 10_000) throw new UnifiedAdminInputError("正文单个文本节点为空或过长。");
    const marks = normalizeMarks(candidate.marks);
    return { type: "text", text: candidate.text, ...(marks ? { marks } : {}) };
  });
  return content.length ? content : undefined;
}

function normalizeNode(candidate: unknown, context: { count: number }, depth: number): StructuredContentNode {
  context.count += 1;
  if (context.count > maximumStructuredContentNodes || depth > maximumStructuredContentDepth) {
    throw new UnifiedAdminInputError("正文节点数量或嵌套深度超过限制。");
  }
  if (!isRecord(candidate) || typeof candidate.type !== "string") throw new UnifiedAdminInputError("正文节点格式不正确。");
  if (candidate.type === "paragraph") {
    assertOnlyKeys(candidate, ["type", "content"], "段落节点");
    const content = normalizeInlineContent(candidate.content);
    return { type: "paragraph", ...(content ? { content } : {}) };
  }
  if (candidate.type === "heading") {
    assertOnlyKeys(candidate, ["type", "attrs", "content"], "标题节点");
    if (!isRecord(candidate.attrs) || (candidate.attrs.level !== 2 && candidate.attrs.level !== 3)) throw new UnifiedAdminInputError("标题节点级别不正确。");
    const content = normalizeInlineContent(candidate.content);
    return { type: "heading", attrs: { level: candidate.attrs.level }, ...(content ? { content } : {}) };
  }
  if (candidate.type === "horizontalRule") {
    assertOnlyKeys(candidate, ["type"], "分隔线节点");
    return { type: "horizontalRule" };
  }
  if (candidate.type === "image") {
    assertOnlyKeys(candidate, ["type", "attrs"], "图片节点");
    if (!isRecord(candidate.attrs) || typeof candidate.attrs.src !== "string" || !/^\/media\/[A-Za-z0-9_-]{1,64}$/.test(candidate.attrs.src)) {
      throw new UnifiedAdminInputError("正文图片必须引用媒体库中的媒体 ID。");
    }
    const alt = readText(candidate.attrs.alt, "图片替代文字", 240, false);
    return { type: "image", attrs: { src: candidate.attrs.src, ...(alt ? { alt } : {}) } };
  }
  if (["blockquote", "bulletList", "orderedList", "listItem"].includes(candidate.type)) {
    assertOnlyKeys(candidate, ["type", "content"], "嵌套正文节点");
    if (!Array.isArray(candidate.content) || !candidate.content.length) throw new UnifiedAdminInputError("嵌套正文节点不能为空。");
    const content = candidate.content.map((child) => normalizeNode(child, context, depth + 1));
    if ((candidate.type === "bulletList" || candidate.type === "orderedList") && content.some((child) => child.type !== "listItem")) {
      throw new UnifiedAdminInputError("列表只能包含列表项。");
    }
    if (candidate.type === "listItem" && content.some((child) => child.type !== "paragraph" && child.type !== "bulletList" && child.type !== "orderedList")) {
      throw new UnifiedAdminInputError("列表项包含未允许的子节点。");
    }
    if (candidate.type === "blockquote" && content.some((child) => child.type === "listItem")) {
      throw new UnifiedAdminInputError("引用块包含未允许的子节点。");
    }
    return { type: candidate.type as "blockquote" | "bulletList" | "orderedList" | "listItem", content };
  }
  throw new UnifiedAdminInputError("正文包含尚未允许的节点类型。");
}

export function validateStructuredContent(value: unknown): StructuredContent {
  let parsed = value;
  if (typeof parsed === "string") {
    if (Buffer.byteLength(parsed, "utf8") > maximumStructuredContentBytes) throw new UnifiedAdminInputError("正文不能超过 100,000 字节。");
    try { parsed = JSON.parse(parsed) as unknown; } catch { throw new UnifiedAdminInputError("正文必须是有效的结构化 JSON。"); }
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1) throw new UnifiedAdminInputError("正文 JSON envelope 不正确。");

  // R1-1 used { schemaVersion, type, content }. Normalize it without an in-place DB rewrite.
  const document = isRecord(parsed.document) ? parsed.document : parsed.type === "doc" ? { type: parsed.type, content: parsed.content } : null;
  if (!document || document.type !== "doc" || !Array.isArray(document.content)) throw new UnifiedAdminInputError("正文 JSON document 不正确。");
  assertOnlyKeys(document, ["type", "content"], "正文 document");
  const context = { count: 0 };
  const content = document.content.map((candidate) => normalizeNode(candidate, context, 1));
  const normalized: StructuredContent = { schemaVersion: 1, document: { type: "doc", content } };
  if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > maximumStructuredContentBytes) throw new UnifiedAdminInputError("正文不能超过 100,000 字节。");
  return normalized;
}

export function getStructuredContentMediaIds(value: unknown) {
  const structured = validateStructuredContent(value);
  const ids = new Set<string>();
  const visit = (node: StructuredContentNode) => {
    if (node.type === "image") ids.add(node.attrs.src.slice("/media/".length));
    if ("content" in node && Array.isArray(node.content) && node.type !== "paragraph" && node.type !== "heading") {
      for (const child of node.content) visit(child);
    }
  };
  for (const node of structured.document.content) visit(node);
  return [...ids];
}

function readDiscipline(value: unknown): DisciplineInput | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw new UnifiedAdminInputError("纪律处罚扩展格式不正确。");
  return {
    competitionId: readText(value.competitionId, "关联赛事", 64, false),
    officialMediaId: readText(value.officialMediaId, "正式 PDF", 64, false),
    versionLabel: readText(value.versionLabel, "版本标签", 80, false),
    scopeLabel: readText(value.scopeLabel, "适用范围", 160, false),
  };
}

export function readContentPostInput(value: unknown): ContentPostInput {
  if (!isRecord(value)) throw new UnifiedAdminInputError("内容格式不正确。");
  return {
    type: readEnum(value.type, ["NEWS", "ANNOUNCEMENT", "DISCIPLINE"] as const, "内容类型"),
    slug: readText(value.slug, "Slug", 120)!,
    title: readText(value.title, "标题", 160)!,
    summary: readText(value.summary, "摘要", 500)!,
    content: validateStructuredContent(value.content),
    status: readEnum(value.status, ["DRAFT", "PUBLISHED", "ARCHIVED"] as const, "发布状态"),
    source: readText(value.source, "来源", 120, false),
    coverMediaId: readText(value.coverMediaId, "封面媒体", 64, false),
    pinned: value.pinned === true,
    featured: value.featured === true,
    discipline: readDiscipline(value.discipline),
    attachments: readAttachments(value.attachments),
  };
}

export function createEmptyStructuredContent(text = ""): StructuredContent {
  return {
    schemaVersion: 1,
    document: { type: "doc", content: [{ type: "paragraph", ...(text ? { content: [{ type: "text", text }] } : {}) }] },
  };
}

export function readAttachments(value: unknown): ContentPostInput["attachments"] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 100) throw new UnifiedAdminInputError("附件最多 100 个。");
  const result = value.map((item) => {
    if (!isRecord(item)) throw new UnifiedAdminInputError("附件格式无效。");
    return { mediaAssetId: readText(item.mediaAssetId, "附件", 64)!, displayName: readText(item.displayName, "附件显示名称", 180, false) };
  });
  if (new Set(result.map((r) => r.mediaAssetId)).size !== result.length) throw new UnifiedAdminInputError("附件不能重复。");
  return result;
}
