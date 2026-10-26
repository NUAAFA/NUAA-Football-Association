import assert from "node:assert/strict";
import { publishedNews, publicAnnouncements } from "../src/data/content";
import { staticContentPublishedAt, isPublishedStaticContent } from "../src/lib/content-publication";
import { visibleConflictSnapshot, isConflictSnapshot, type RefereeConflictSnapshot } from "../src/lib/referee-conflict-snapshot";
import { expectedStaticHistory } from "./static-history-expectations";

const records = [...publishedNews, ...publicAnnouncements.filter(item => item.href.startsWith("/news/"))];
assert.deepEqual(records.map(item => item.id).sort(), expectedStaticHistory.map(([id]) => id).sort());
for (const [id, timestamp] of expectedStaticHistory) {
  const row = records.find(item => item.id === id)!;
  assert.equal(row.dataStatus, "confirmed");
  assert.equal(staticContentPublishedAt(row)?.toISOString(), timestamp, id);
  assert(isPublishedStaticContent(row, new Date("2026-10-24T00:00:00Z")));
  assert(!isPublishedStaticContent(row, new Date("2000-01-01T00:00:00Z")));
}
for (const dateLabel of ["bad", "2026-02-30", "2026.13.01", "2026-06-22 24:00", "2026-06-22 16:60"]) assert.equal(staticContentPublishedAt({ dateLabel }), null, dateLabel);
for (const publishedAt of ["bad", "2026-02-30T16:53:00+08:00", "2026-06-22T16:53:00"]) assert.equal(staticContentPublishedAt({ publishedAt, dateLabel: "2026-06-22" }), null);
assert.equal(staticContentPublishedAt({ dateLabel: "2026.06.22 16:53:14" })?.toISOString(), "2026-06-22T08:53:14.000Z");
assert(!isPublishedStaticContent({ dataStatus: "demo", dateLabel: "2026-06-22 16:53" }));
console.log(`PASS R1: complete ${expectedStaticHistory.length}-record independent manifest, Beijing timestamps, future/demo/invalid safeguards; TZ=${process.env.TZ}`);

const pending: RefereeConflictSnapshot = { id: "synthetic-report", reportedAt: "2026-10-24T10:00:00.000Z", resolvedAt: null, status: "PENDING", reasonCode: "OTHER", explanation: "first" };
const resolved = { ...pending, resolvedAt: "2026-10-24T10:01:00.000Z", status: "RESOLVED" };
const local = { versionId: "v1", report: pending };
assert.equal(visibleConflictSnapshot(null, local, "v1")?.status, "PENDING");
assert.equal(visibleConflictSnapshot(resolved, local, "v1")?.status, "RESOLVED");
const fresh = { ...pending, reportedAt: "2026-10-24T10:02:00.000Z", explanation: "new report" };
assert.equal(visibleConflictSnapshot(resolved, { versionId: "v1", report: fresh }, "v1")?.status, "PENDING");
assert.equal(visibleConflictSnapshot(resolved, { versionId: "v1", report: { ...fresh, reportedAt: pending.reportedAt } }, "v1")?.status, "PENDING", "equal timestamps with different content cannot prove resolution of the fresh report");
assert.equal(visibleConflictSnapshot({ ...fresh, resolvedAt: "2026-10-24T10:03:00.000Z", status: "DISMISSED" }, { versionId: "v1", report: fresh }, "v1")?.status, "DISMISSED");
assert.equal(visibleConflictSnapshot(pending, { versionId: "v1", report: resolved }, "v1")?.status, "RESOLVED", "older pending payload cannot reopen a known resolved generation");
assert.equal(visibleConflictSnapshot(pending, { versionId: "old", report: resolved }, "v1")?.status, "PENDING", "task versions do not share local state");
assert(isConflictSnapshot(pending));assert(!isConflictSnapshot({ ...pending, reportedAt: "invalid" }));
console.log("PASS R2: same-generation resolution, stale resolved/pending payloads, same-timestamp content changes and task-version isolation");
