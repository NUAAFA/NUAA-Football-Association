import type { ContentPostType, Prisma } from "@/generated/prisma-v29/client";

/** One eligibility rule for lists, detail, homepage and machine-readable feeds. */
export function publishedContentWhere(now: Date, type?: ContentPostType | ContentPostType[]): Prisma.ContentPostWhereInput {
  return {
    status: "PUBLISHED",
    publishedAt: { lte: now },
    ...(type ? { type: Array.isArray(type) ? { in: type } : type } : {}),
  };
}

export function staticContentPublishedAt(item: { publishedAt?: string; dateLabel: string }): Date | null {
  // Legacy day-only dates have always denoted noon in Beijing, never host-local time.
  const value = item.publishedAt ?? `${item.dateLabel.replaceAll(".", "-")}T12:00:00+08:00`;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function isPublishedStaticContent(item: { dataStatus: string; publishedAt?: string; dateLabel: string }, now = new Date()) {
  const publishedAt = staticContentPublishedAt(item);
  return item.dataStatus === "confirmed" && publishedAt !== null && publishedAt <= now;
}
