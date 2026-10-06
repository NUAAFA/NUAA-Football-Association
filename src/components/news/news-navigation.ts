// Presentation context only; content sources and publication rules stay separate.
export type NewsFilter = "all" | "news" | "notices" | "events";
export type NewsListContext = { filter?: string | null; cursor?: string | null };

export function newsFilter(value: string | null | undefined): NewsFilter {
  return value === "news" || value === "notices" || value === "events" ? value : "all";
}

export function newsListHref(context: NewsListContext = {}) {
  const query = new URLSearchParams();
  const filter = newsFilter(context.filter);
  if (filter !== "all") query.set("filter", filter);
  if (context.cursor) query.set("cursor", context.cursor);
  return `/news${query.size ? `?${query}` : ""}`;
}

export function newsDetailHref(href: string, context: NewsListContext) {
  if (!href.startsWith("/news/")) return href;
  const listQuery = newsListHref(context).split("?")[1];
  if (!listQuery) return href;
  const [path, hash] = href.split("#");
  return `${path}${path.includes("?") ? "&" : "?"}${listQuery}${hash ? `#${hash}` : ""}`;
}
