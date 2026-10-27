export type CatalogueSearchParams = Record<string, string | string[] | undefined>;

export function catalogueValue(value: string | string[] | undefined, maxLength = 200) {
  return (Array.isArray(value) ? value[0] : value)?.trim().slice(0, maxLength) ?? "";
}

export function catalogueHref(path: string, filters: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "" && !(key === "page" && value === 1)) query.set(key, String(value));
  }
  return `${path}${query.size ? `?${query}` : ""}`;
}

export function cataloguePage<T>(items: readonly T[], requestedPage: string, pageSize = 6) {
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const parsed = /^\d+$/.test(requestedPage) ? Number(requestedPage) : 1;
  const page = Math.min(pages, Math.max(1, Number.isFinite(parsed) ? parsed : 1));
  return { page, pages, total: items.length, pageSize, items: items.slice((page - 1) * pageSize, page * pageSize) };
}

export function catalogueYear(requested: string, years: readonly string[]) {
  return requested === "all" || years.includes(requested) ? requested : years[0] ?? "all";
}
