import type { ContentPostType, Prisma } from "@/generated/prisma-v29/client";

/** One eligibility rule for lists, detail, homepage and machine-readable feeds. */
export function publishedContentWhere(now: Date, type?: ContentPostType | ContentPostType[]): Prisma.ContentPostWhereInput {
  return {
    status: "PUBLISHED",
    publishedAt: { lte: now },
    ...(type ? { type: Array.isArray(type) ? { in: type } : type } : {}),
  };
}

function validCalendarParts(year: number, month: number, day: number, hour: number, minute: number, second: number) {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    && date.getUTCHours() === hour && date.getUTCMinutes() === minute && date.getUTCSeconds() === second;
}

export function staticContentPublishedAt(item: { publishedAt?: string; dateLabel: string }): Date | null {
  if (item.publishedAt !== undefined) {
    // Explicit timestamps must carry their timezone; never use the host timezone.
    const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(item.publishedAt);
    if (!parts || !validCalendarParts(Number(parts[1]), Number(parts[2]), Number(parts[3]), Number(parts[4]), Number(parts[5]), Number(parts[6] ?? 0))) return null;
    const date = new Date(item.publishedAt);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  // Existing labels support YYYY.MM.DD / YYYY-MM-DD, optionally HH:mm[:ss].
  // Day-only labels retain noon in Beijing; labels with a time retain that time.
  const parts = /^(\d{4})[.-](\d{2})[.-](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(item.dateLabel.trim());
  if (!parts) return null;
  const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
  const hour = Number(parts[4] ?? 12), minute = Number(parts[5] ?? 0), second = Number(parts[6] ?? 0);
  if (!validCalendarParts(year, month, day, hour, minute, second)) return null;
  const pad = (value: number) => String(value).padStart(2, "0");
  return new Date(`${parts[1]}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}+08:00`);
}

export function isPublishedStaticContent(item: { dataStatus: string; publishedAt?: string; dateLabel: string }, now = new Date()) {
  const publishedAt = staticContentPublishedAt(item);
  return item.dataStatus === "confirmed" && publishedAt !== null && publishedAt <= now;
}
