import assert from "node:assert/strict";

import { newsDetailHref, newsFilter, newsListHref } from "../src/components/news/news-navigation";

// Exercise return routes, including opaque DB cursors and direct-entry fallbacks.
for (const filter of ["news", "notices", "events"] as const) {
  const detail = new URL(newsDetailHref("/news/real-article", { filter }), "https://nuaafa.test");
  assert.equal(detail.pathname, "/news/real-article");
  assert.equal(newsListHref({ filter: detail.searchParams.get("filter") }), `/news?filter=${filter}`);
}
for (const value of [null, undefined, "", "unknown", "https://external.test", "javascript:alert(1)"]) {
  assert.equal(newsFilter(value), "all");
  assert.equal(newsListHref({ filter: value }), "/news");
}
assert.equal(newsDetailHref("/news/direct-entry", {}), "/news/direct-entry");
assert.equal(newsListHref({ filter: "all" }), "/news");
const cursor = 'opaque+/=&filter=notices#片段';
const detail = new URL(newsDetailHref("/news/decision#news-attachments-title", { cursor }), "https://nuaafa.test");
assert.equal(detail.searchParams.get("cursor"), cursor);
assert.equal(detail.searchParams.get("filter"), null);
assert.equal(detail.hash, "#news-attachments-title");
const returned = new URL(newsListHref({ cursor: detail.searchParams.get("cursor") }), "https://nuaafa.test");
assert.equal(returned.pathname, "/news");
assert.equal(returned.searchParams.get("cursor"), cursor);
assert.equal(newsDetailHref("/news/story?existing=1#body", { filter: "notices" }), "/news/story?existing=1&filter=notices#body");
for (const href of ["/competitions/freshman-cup", "/referees", "/news", "https://external.test/news/story"]) {
  assert.equal(newsDetailHref(href, { filter: "events", cursor }), href);
}
console.log("PASS: news filter return routes, direct entry, cursor escaping, fragments and unrelated links.");
