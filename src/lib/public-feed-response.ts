export const publicFeedHeaders = { "cache-control": "no-store, max-age=0", "x-content-type-options": "nosniff" };

export function xmlText(value: string) {
  // XML 1.0 cannot represent control characters or isolated UTF-16 surrogates.
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/gu, "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function unavailableFeed() {
  return new Response("公开资料暂时无法加载，请稍后重试。", {
    status: 503,
    headers: { ...publicFeedHeaders, "content-type": "text/plain; charset=utf-8", "retry-after": "30" },
  });
}
