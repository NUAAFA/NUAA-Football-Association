import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import type { ContentPostInput } from "../src/lib/admin-content-input";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "nuaafa-competition-reports-"));
  const url = `file:${path.join(root, "isolated.db")}`;
  process.env.DATABASE_URL = url;
  process.env.NUAAFA_CONTENT_SOURCE = "database";
  process.env.NUAAFA_UPLOAD_DIR = path.join(root, "uploads");
  const raw = createClient({ url });
  for (const entry of (await readdir("prisma/migrations", { withFileTypes: true })).filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const migrationCheck = entry.name === "20261023090000_competition_reports";
    if (migrationCheck) await raw.execute({ sql: 'INSERT INTO "ContentPost" ("id", "slug", "title", "summary", "content", "updatedAt") VALUES (?, ?, ?, ?, ?, ?)', args: ["legacy-post", "legacy-post", "已有新闻", "迁移保留检查", "{}", "2026-10-20T00:00:00Z"] });
    const before = migrationCheck ? (await raw.execute('SELECT * FROM "ContentPost" WHERE "id" = \'legacy-post\'')).rows[0] : null;
    await raw.executeMultiple(await readFile(path.join("prisma/migrations", entry.name, "migration.sql"), "utf8"));
    if (migrationCheck) {
      const { competitionId, ...after } = (await raw.execute('SELECT * FROM "ContentPost" WHERE "id" = \'legacy-post\'')).rows[0];
      assert.equal(competitionId, null);
      assert.deepEqual(after, { ...before }, "migration must preserve existing news content and status");
      assert.equal((await raw.execute("PRAGMA foreign_key_check")).rows.length, 0);
      await raw.execute('DELETE FROM "ContentPost" WHERE "id" = \'legacy-post\'');
    }
  }
  raw.close();
  const { prisma } = await import("../src/lib/prisma");
  const { createContentPost, updateContentPost, getAdminContentPost } = await import("../src/lib/admin-content-service");
  const { createEmptyStructuredContent, readContentPostInput } = await import("../src/lib/admin-content-input");
  const { getPublishedCompetitionReports, getPublishedCompetitionImages, getPublicCompetitionAlbums } = await import("../src/lib/competition-report-service");
  const { hashPassword } = await import("../src/lib/referee-security");
  const editor = { id: null, displayName: "隔离内容编辑", isLegacy: false, roles: ["CONTENT_EDITOR" as const] };
  const denied = { ...editor, roles: ["COMPETITION_ADMIN" as const] };
  const input = (slug: string, extra: Partial<ContentPostInput> = {}): ContentPostInput => ({ type: "NEWS", slug, title: slug, summary: "隔离模拟数据，仅供功能验收。", content: createEmptyStructuredContent("这不是官网真实新闻的副本。"), status: "PUBLISHED", ...extra });
  try {
    const a = await prisma.competition.create({ data: { slug: "reports-demo-cup", name: "2026新生杯 · 隔离功能演示", campus: "天目湖校区", format: "ELEVEN_A_SIDE", status: "ONGOING", publicPublished: true } });
    const b = await prisma.competition.create({ data: { slug: "reports-other-cup", name: "其他赛事 · 隔离示例", campus: "天目湖校区", format: "FUTSAL", status: "ONGOING", publicPublished: true } });
    const test = await prisma.competition.create({ data: { slug: "reports-excluded-test", name: "不应关联的测试赛事", campus: "测试", format: "FUTSAL", status: "ONGOING", publicPublished: true, isTestData: true } });
    assert.deepEqual(await getPublishedCompetitionReports(a.id), []);
    await assert.rejects(() => createContentPost(input("denied", { competitionId: a.id }), denied));
    await assert.rejects(() => createContentPost(input("invalid", { competitionId: "missing" }), editor));
    await assert.rejects(() => createContentPost(input("test-link", { competitionId: test.id }), editor));
    for (const bad of [42, [], {}, " ", "x".repeat(65)]) assert.throws(() => readContentPostInput({ ...input("bad"), competitionId: bad }));
    assert.equal(await prisma.contentPost.count(), 0, "rejections must not leave partial posts");
    const unlinked = await createContentPost(input("unlinked"), editor);
    const oneInput = input("2026-freshman-cup-shouwang", { title: "守望｜绿茵场上的温情（隔离演示）", competitionId: a.id });
    const twoInput = input("2026-freshman-cup-round-2", { title: "2026年新生足球联赛第二轮圆满收官（隔离演示）", competitionId: a.id });
    const one = await createContentPost(oneInput, editor);
    const two = await createContentPost(twoInput, editor);
    await prisma.contentPost.update({ where: { id: one.id }, data: { publishedAt: new Date("2026-10-20T12:00:00Z") } });
    await prisma.contentPost.update({ where: { id: two.id }, data: { publishedAt: new Date("2026-10-21T12:00:00Z") } });
    const now = new Date("2026-10-23T12:00:00Z");
    for (const status of ["DRAFT", "ARCHIVED"] as const) await createContentPost(input(`hidden-${status.toLowerCase()}`, { competitionId: a.id, status }), editor);
    const future = await createContentPost(input("future", { competitionId: a.id }), editor);
    await prisma.contentPost.update({ where: { id: future.id }, data: { publishedAt: new Date("2099-01-01") } });
    await createContentPost(input("other-event", { competitionId: b.id }), editor);
    assert.deepEqual((await getPublishedCompetitionReports(a.id, now)).map((p) => p.id), [two.id, one.id]);
    assert.equal((await getPublishedCompetitionReports(a.id, now))[0].href, `/news/${two.slug}`);
    assert.equal((await getAdminContentPost(one.id, editor))?.competitionId, a.id);
    assert.equal((await getAdminContentPost(one.id, editor))?.publishedAt?.toISOString(), "2026-10-20T12:00:00.000Z", "relinking must preserve the original publication date");
    // Older API clients omit the new property: preserve the existing association.
    await updateContentPost(one.id, input(one.slug, { title: one.title }), editor);
    assert.equal((await getAdminContentPost(one.id, editor))?.competitionId, a.id);
    await updateContentPost(one.id, { ...oneInput, competitionId: b.id }, editor);
    assert.deepEqual((await getPublishedCompetitionReports(a.id, now)).map((p) => p.id), [two.id]);
    await updateContentPost(one.id, { ...oneInput, competitionId: null }, editor);
    assert.equal((await getAdminContentPost(one.id, editor))?.competitionId, null);
    await updateContentPost(two.id, { ...twoInput, status: "DRAFT" }, editor);
    assert.deepEqual(await getPublishedCompetitionReports(a.id, now), []);
    await updateContentPost(one.id, oneInput, editor);
    await updateContentPost(two.id, twoInput, editor);
    await prisma.competition.update({ where: { id: a.id }, data: { publicPublished: false } });
    assert.deepEqual(await getPublishedCompetitionReports(a.id, now), []);
    await prisma.competition.update({ where: { id: a.id }, data: { publicPublished: true, isTestData: true } });
    assert.deepEqual(await getPublishedCompetitionReports(a.id, now), []);
    await prisma.competition.update({ where: { id: a.id }, data: { isTestData: false } });
    const ephemeral = await prisma.competition.create({ data: { slug: "ephemeral", name: "临时", campus: "隔离", format: "FUTSAL", status: "PREPARING" } });
    await updateContentPost(unlinked.id, input(unlinked.slug, { competitionId: ephemeral.id }), editor);
    await prisma.competition.delete({ where: { id: ephemeral.id } });
    assert.equal((await getAdminContentPost(unlinked.id, editor))?.competitionId, null, "deleting an event must preserve the article");
    assert.equal(await prisma.auditLog.count({ where: { action: "CONTENT_POST_UPDATE", entityId: one.id } }) > 0, true);
    const audits = await prisma.auditLog.findMany({ where: { entityId: one.id, action: "CONTENT_POST_UPDATE" }, select: { metadata: true } });
    assert.equal(audits.some((audit) => {
      const metadata = JSON.parse(audit.metadata ?? "{}");
      return metadata.fromCompetitionId === a.id && metadata.competitionId === b.id;
    }), true, "audit history must identify both sides of a relink");
    const before = await prisma.contentPost.findUniqueOrThrow({ where: { id: two.id } });
    await assert.rejects(() => updateContentPost(two.id, { ...twoInput, competitionId: "missing" }, editor));
    assert.deepEqual(await prisma.contentPost.findUniqueOrThrow({ where: { id: two.id } }), before, "invalid relinking must be atomic");
    process.env.NUAAFA_CONTENT_SOURCE = "static";
    assert.deepEqual(await getPublishedCompetitionReports(a.id, now), [], "static news mode must not generate dangling database links");
    process.env.NUAAFA_CONTENT_SOURCE = "database";
    await mkdir(path.join(root, "uploads", "2026", "10"), { recursive: true });
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    const assets = [];
    for (let index = 1; index <= 3; index++) {
      const filename = `00000000-0000-4000-8000-00000000000${index}.png`;
      await writeFile(path.join(root, "uploads", "2026", "10", filename), bytes);
      assets.push(await prisma.mediaAsset.create({ data: { storageKey: `2026/10/${filename}`, storedFilename: filename, originalFilename: `synthetic-${index}.png`, mimeType: "image/png", size: bytes.length, visibility: "PUBLIC", altText: `隔离示例照片 ${index}` } }));
    }
    oneInput.coverMediaId = assets[0].id;
    for (const asset of assets) oneInput.content.document.content.push({ type: "image", attrs: { src: `/media/${asset.id}` } });
    await updateContentPost(one.id, oneInput, editor);
    twoInput.coverMediaId = assets[0].id;
    await updateContentPost(two.id, twoInput, editor);
    await prisma.mediaAsset.update({ where: { id: assets[2].id }, data: { visibility: "PRIVATE" } });
    assert.deepEqual((await getPublishedCompetitionImages(a.id, now)).map((image) => image.id).sort(), assets.slice(0, 2).map((asset) => asset.id).sort(), "deduplicate shared cover/body references and exclude newly private media");
    assert.deepEqual(await getPublishedCompetitionImages(b.id, now), [], "another event must not inherit photos");
    assert.equal((await getPublicCompetitionAlbums(now)).find((album) => album.id === a.id)?.images.length, 2);
    await prisma.contentPost.updateMany({ where: { id: { in: [one.id, two.id] } }, data: { status: "DRAFT" } });
    assert.deepEqual(await getPublishedCompetitionImages(a.id, now), [], "withdrawing all source reports must remove photos");
    await prisma.contentPost.updateMany({ where: { id: { in: [one.id, two.id] } }, data: { status: "PUBLISHED" } });
    await prisma.competition.update({ where: { id: a.id }, data: { publicPublished: false } });
    assert.deepEqual(await getPublishedCompetitionImages(a.id, now), []);
    assert.equal((await getPublicCompetitionAlbums(now)).some((album) => album.id === a.id), false);
    await prisma.competition.update({ where: { id: a.id }, data: { publicPublished: true } });
    // Leave a valid editable fixture for browser acceptance after privacy checks.
    oneInput.content.document.content.pop();
    await updateContentPost(one.id, oneInput, editor);
    const account = await prisma.adminAccount.create({ data: { username: "reports-editor", displayName: "隔离新闻编辑", passwordHash: await hashPassword("Reports-Demo-2026!"), role: "REFEREE_MANAGER", unifiedRoles: { create: { role: "CONTENT_EDITOR" } } } });
    await writeFile(path.join(root, "fixture.json"), JSON.stringify({ root, databaseUrl: url, competitionId: a.id, postIds: [one.id, two.id], editorId: account.id }, null, 2));
    console.log(JSON.stringify({ status: "PASS", scope: "isolated synthetic data only", root, databaseUrl: url, competitionId: a.id, postIds: [one.id, two.id] }, null, 2));
  } finally { await prisma.$disconnect(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
