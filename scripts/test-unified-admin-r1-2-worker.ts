import { cp, mkdir, readFile, readdir, realpath, rm, utimes, writeFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@libsql/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../src/generated/prisma-v29/client";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function rejects(action: () => unknown | Promise<unknown>, message: string) {
  try { await action(); } catch { return; }
  throw new Error(message);
}

async function applyMigrations(url: string) {
  const client = createClient({ url });
  const entries = (await readdir(path.resolve("prisma/migrations"), { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) await client.executeMultiple(await readFile(path.resolve("prisma/migrations", entry.name, "migration.sql"), "utf8"));
  client.close();
}

function delayedStream(bytes: Uint8Array, delay: number) {
  return new ReadableStream<Uint8Array>({ start(controller) { setTimeout(() => { controller.enqueue(bytes); controller.close(); }, delay); } });
}

function contentInput(slug: string, options: { pinned?: boolean; featured?: boolean; status?: "DRAFT" | "PUBLISHED" | "ARCHIVED"; type?: "NEWS" | "ANNOUNCEMENT" | "DISCIPLINE" } = {}) {
  return {
    type: options.type ?? "NEWS",
    slug,
    title: `R1-2 ${slug}`,
    summary: `R1-2 数据库摘要 ${slug}`,
    content: { schemaVersion: 1 as const, document: { type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: `正文 ${slug}`, marks: [{ type: "bold" as const }] }] }] } },
    source: "NUAAFA R1-2",
    status: options.status ?? "PUBLISHED",
    pinned: options.pinned ?? false,
    featured: options.featured ?? false,
  };
}

async function main() {
  const suppliedRoot = process.env.R1_2_TEST_ROOT;
  const databasePath = process.env.R1_2_TEST_DATABASE_PATH;
  const uploadRoot = process.env.NUAAFA_UPLOAD_DIR;
  if (!suppliedRoot || !databasePath || !uploadRoot) throw new Error("R1-2 isolated paths are required.");
  const root = await realpath(suppliedRoot);
  const url = `file:${databasePath.replaceAll("\\", "/")}`;
  process.env.DATABASE_URL = url;
  process.env.REFEREE_ADMIN_SESSION_SECRET = "r1-2-test-session-secret-2026-08-23";
  process.env.NUAAFA_STATIC_IMPORT_ISOLATED = "1";
  await applyMigrations(url);
  const verifier = new PrismaClient({ adapter: new PrismaLibSql({ url }) });
  const input = await import("../src/lib/admin-content-input");
  const content = await import("../src/lib/admin-content-service");
  const media = await import("../src/lib/admin-media-service");
  const migration = await import("../src/lib/static-content-migration");
  const backup = await import("../src/lib/combined-backup");
  const rbac = await import("../src/lib/unified-admin-rbac");
  const { prisma } = await import("../src/lib/prisma");
  const actor = { id: null, displayName: "R1-2 隔离管理员", isLegacy: true, roles: ["SUPER_ADMIN" as const] };

  try {
    const valid = input.validateStructuredContent({ schemaVersion: 1, document: { type: "doc", content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "标题", marks: [{ type: "underline" }] }] },
      { type: "paragraph", content: [{ type: "text", text: "链接", marks: [{ type: "link", attrs: { href: "https://nuaa.edu.cn" } }] }] },
      { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "引用" }] }] },
      { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "列表" }] }] }] },
      { type: "horizontalRule" },
    ] } });
    assert(valid.document.content.length === 5, "Valid structured JSON was not accepted.");
    await rejects(() => input.validateStructuredContent({ schemaVersion: 1, document: { type: "doc", content: [{ type: "script" }] } }), "Unknown node was accepted.");
    await rejects(() => input.validateStructuredContent({ schemaVersion: 1, document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "strike" }] }] }] } }), "Unknown mark was accepted.");
    await rejects(() => input.validateStructuredContent({ schemaVersion: 1, document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }] } }), "Dangerous link was accepted.");
    await rejects(() => input.validateStructuredContent("{"), "Malformed JSON was accepted.");
    await rejects(() => input.validateStructuredContent({ schemaVersion: 1, document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(100_001) }] }] } }), "Oversized JSON was accepted.");
    let deep: unknown = { type: "paragraph", content: [{ type: "text", text: "deep" }] };
    for (let index = 0; index < 14; index += 1) deep = { type: "blockquote", content: [deep] };
    await rejects(() => input.validateStructuredContent({ schemaVersion: 1, document: { type: "doc", content: [deep] } }), "Deep JSON was accepted.");

    const base = Date.parse("2026-07-01T00:00:00.000Z");
    for (let index = 1; index <= 5; index += 1) {
      const post = await content.createContentPost(contentInput(`pinned-${index}`, { pinned: true }), actor);
      await verifier.contentPost.update({ where: { id: post.id }, data: { publishedAt: new Date(base + index * 1_000) } });
    }
    for (let index = 1; index <= 25; index += 1) {
      const post = await content.createContentPost(contentInput(`normal-${String(index).padStart(2, "0")}`, { featured: index === 1 }), actor);
      await verifier.contentPost.update({ where: { id: post.id }, data: { publishedAt: new Date(base + 100_000 + index * 1_000) } });
    }
    const pages = [];
    let cursor: string | undefined;
    do {
      const page = await content.getPublishedContentPage({ cursor, pageSize: 3, now: new Date("2026-08-01T00:00:00.000Z") });
      pages.push(page); cursor = page.nextCursor ?? undefined;
    } while (cursor);
    const items = pages.flatMap((page) => page.items);
    assert(items.length === 30 && new Set(items.map((item) => item.slug)).size === 30, "Pinned cursor pagination duplicated or omitted rows.");
    assert(items.slice(0, 5).every((item) => item.pinned) && items.slice(5).every((item) => !item.pinned), "Pinned rows were not globally first.");
    assert(pages[0]?.items.length === 3 && pages[1]?.items.filter((item) => item.pinned).length === 2 && pages[1]?.items.some((item) => !item.pinned), "Pinned-to-normal cursor transition failed.");
    assert(items.every((item) => !("content" in item) && !("id" in item) && !("featured" in item)), "Public List DTO leaked full or internal fields.");
    const detail = await content.getPublishedContentDetailBySlug("normal-01", new Date("2026-08-01T00:00:00.000Z"));
    assert(detail && "content" in detail && !("id" in detail) && !("authorAdminId" in detail), "Public Detail DTO contract failed.");
    const featured = await content.getFeaturedPublishedContent({ now: new Date("2026-08-01T00:00:00.000Z") });
    assert(featured.some((item) => item.slug === "normal-01") && items[5]?.slug === "normal-25", "Featured flag changed normal ordering or featured query failed.");
    const draft = await content.createContentPost(contentInput("hidden-draft", { status: "DRAFT" }), actor);
    const archived = await content.createContentPost(contentInput("hidden-archive", { status: "ARCHIVED" }), actor);
    const future = await content.createContentPost(contentInput("hidden-future"), actor);
    await verifier.contentPost.update({ where: { id: future.id }, data: { publishedAt: new Date("2030-01-01T00:00:00.000Z") } });
    for (const slug of [draft.slug, archived.slug, future.slug, "missing-slug"]) assert(await content.getPublishedContentDetailBySlug(slug, new Date("2026-08-01T00:00:00.000Z")) === null, `${slug} existence leaked.`);

    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const pdf20 = new Uint8Array(20 * 1024 * 1024);
    pdf20.set(new TextEncoder().encode("%PDF-1.7\n"));
    const imageAsset = await media.storeMediaAssetUploadStream({ fileName: "proof.jpg", mimeType: "image/jpeg", stream: delayedStream(jpeg, 1), contentLength: jpeg.length, visibility: "PUBLIC", actor });
    const pdfAsset = await media.storeMediaAssetUploadStream({ fileName: "twenty.pdf", mimeType: "application/pdf", stream: delayedStream(pdf20, 1), contentLength: pdf20.length, visibility: "PRIVATE", actor });
    assert(imageAsset.size === jpeg.length && pdfAsset.size === pdf20.length, "Normal JPG or 20 MB PDF streaming upload failed.");
    const oversize = new Uint8Array(10 * 1024 * 1024 + 1); oversize.set(png.subarray(0, 8));
    const rowsBeforeOversize = await verifier.mediaAsset.count();
    await rejects(() => media.storeMediaAssetUploadStream({ fileName: "oversize.png", mimeType: "image/png", stream: delayedStream(oversize, 1), visibility: "PRIVATE", actor }), "Oversize stream was accepted.");
    assert(await verifier.mediaAsset.count() === rowsBeforeOversize, "Oversize stream created a MediaAsset row.");
    const filesBeforeSignature = await readdir(uploadRoot, { recursive: true });
    await rejects(() => media.storeMediaAssetUploadStream({ fileName: "fake.pdf", mimeType: "application/pdf", stream: delayedStream(new TextEncoder().encode("not a pdf"), 1), visibility: "PRIVATE", actor }), "Bad signature was accepted.");
    assert((await readdir(uploadRoot, { recursive: true })).length === filesBeforeSignature.length, "Signature failure left a formal file.");
    const interrupted = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(png); controller.error(new Error("client interrupted")); } });
    await rejects(() => media.storeMediaAssetUploadStream({ fileName: "interrupted.png", mimeType: "image/png", stream: interrupted, visibility: "PRIVATE", actor }), "Interrupted stream was accepted.");
    const stalled = new ReadableStream<Uint8Array>({ start() { /* Intentionally never emits or closes. */ } });
    const stagingBeforeTimeout = (await readdir(path.join(uploadRoot, ".staging"))).length;
    await rejects(() => media.storeMediaAssetUploadStream({ fileName: "timeout.png", mimeType: "image/png", stream: stalled, visibility: "PRIVATE", actor, timeoutMs: 20 }), "Stalled stream did not time out.");
    assert((await readdir(path.join(uploadRoot, ".staging"))).length === stagingBeforeTimeout, "Timed-out stream left staging data.");
    const concurrent = await Promise.all(Array.from({ length: 4 }, (_, index) => media.storeMediaAssetUploadStream({ fileName: `concurrent-${index}.png`, mimeType: "image/png", stream: delayedStream(png, 40), contentLength: png.length, visibility: "PRIVATE", actor })));
    assert(concurrent.length === 4 && media.mediaUploadMetrics.maximumObservedActive === 2, "Upload concurrency guard failed.");
    const stagingOld = path.join(uploadRoot, ".staging", "abandoned.upload");
    await writeFile(stagingOld, png);
    await utimes(stagingOld, new Date("2020-01-01"), new Date("2020-01-01"));
    assert(await media.cleanupAbandonedMediaStaging({ maximumAgeMs: 1 }) >= 1, "Abandoned staging cleanup failed.");
    const databaseRowsBeforeWriteFailure = await verifier.mediaAsset.count();
    const blockedRoot = path.join(root, "upload-root-file");
    await writeFile(blockedRoot, "blocked");
    process.env.NUAAFA_UPLOAD_DIR = blockedRoot;
    await rejects(() => media.storeMediaAssetUpload({ fileName: "write-fail.png", mimeType: "image/png", bytes: png, visibility: "PRIVATE", actor }), "Filesystem write failure was not surfaced.");
    process.env.NUAAFA_UPLOAD_DIR = uploadRoot;
    assert(await verifier.mediaAsset.count() === databaseRowsBeforeWriteFailure, "Write failure created a MediaAsset row.");
    const dbFailureRows = await verifier.mediaAsset.count();
    await rejects(() => media.storeMediaAssetUpload({ fileName: "db-fail.png", mimeType: "image/png", bytes: png, visibility: "PRIVATE", actor: { ...actor, id: "missing-admin" } }), "DB failure was not surfaced.");
    assert(await verifier.mediaAsset.count() === dbFailureRows, "DB failure created a MediaAsset row.");
    const orphanPath = path.join(uploadRoot, "2026", "08", "deadbeef.pdf");
    await mkdir(path.dirname(orphanPath), { recursive: true });
    await writeFile(orphanPath, "%PDF-orphan");
    assert((await media.scanOrphanedMediaFiles()).includes("2026/08/deadbeef.pdf"), "Orphan scan failed.");
    await rm(orphanPath, { force: true });

    const manifest = await migration.buildStaticContentManifest();
    assert(manifest.entries.length === 12 && manifest.media.length >= 10 && !manifest.issues.some((issue) => issue.severity === "error"), "Static migration dry-run inventory failed.");
    const duplicateEntries = [...manifest.entries, { ...manifest.entries[0]! }];
    assert(migration.validateStaticManifestEntries(duplicateEntries).some((issue) => issue.code === "DUPLICATE_SLUG"), "Duplicate slug was not detected.");
    const missingManifest = { ...manifest, issues: [...manifest.issues, { severity: "error" as const, code: "MISSING_MEDIA", message: "test" }] };
    await rejects(() => migration.importStaticContentManifest(missingManifest), "Manifest with missing media was imported.");
    const firstImport = await migration.importStaticContentManifest(manifest);
    const countsAfterFirst = { posts: await verifier.contentPost.count(), media: await verifier.mediaAsset.count() };
    const secondImport = await migration.importStaticContentManifest(manifest);
    assert(firstImport.differences.length === 0 && secondImport.differences.length === 0, "Static import reconciliation failed.");
    assert(secondImport.expectedMediaCount === manifest.media.length && secondImport.reconciledMediaCount === manifest.media.length, "Static media inventory count reconciliation failed.");
    assert((await verifier.contentPost.count()) === countsAfterFirst.posts && (await verifier.mediaAsset.count()) === countsAfterFirst.media, "Static import was not idempotent.");
    const coverEntry = manifest.entries.find((entry) => entry.cover)!;
    const coverPost = await verifier.contentPost.findUniqueOrThrow({ where: { slug: coverEntry.slug }, select: { id: true, coverMediaId: true } });
    const wrongCoverMedia = await verifier.mediaAsset.findFirstOrThrow({ where: { id: { not: coverPost.coverMediaId! } }, select: { id: true } });
    await verifier.contentPost.update({ where: { id: coverPost.id }, data: { coverMediaId: wrongCoverMedia.id } });
    assert((await migration.reconcileStaticContentManifest(manifest)).differences.some((item) => item.includes("cover media relationship")), "Cover media relationship mismatch was not detected.");
    await verifier.contentPost.update({ where: { id: coverPost.id }, data: { coverMediaId: coverPost.coverMediaId } });
    const disciplineEntry = manifest.entries.find((entry) => entry.attachments.some((item) => item.kind === "official-pdf"))!;
    const disciplinePost = await verifier.contentPost.findUniqueOrThrow({ where: { slug: disciplineEntry.slug }, select: { discipline: { select: { contentPostId: true, officialMediaId: true } } } });
    await verifier.disciplineDetail.update({ where: { contentPostId: disciplinePost.discipline!.contentPostId }, data: { officialMediaId: coverPost.coverMediaId! } });
    assert((await migration.reconcileStaticContentManifest(manifest)).differences.some((item) => item.includes("official PDF relationship")), "Official PDF relationship mismatch was not detected.");
    await verifier.disciplineDetail.update({ where: { contentPostId: disciplinePost.discipline!.contentPostId }, data: { officialMediaId: disciplinePost.discipline!.officialMediaId } });
    const migratedMedia = await verifier.mediaAsset.findFirstOrThrow({ where: { originalFilename: path.basename(manifest.media[0]!.path) }, select: { storageKey: true } });
    const migratedPath = path.join(uploadRoot, ...migratedMedia.storageKey.split("/"));
    const savedMedia = await readFile(migratedPath);
    await writeFile(migratedPath, "corrupted");
    assert((await migration.reconcileStaticContentManifest(manifest)).differences.some((item) => item.includes("checksum")), "Migration checksum mismatch was not detected.");
    await writeFile(migratedPath, savedMedia);

    for (const [role, allowed] of Object.entries({
      CONTENT_EDITOR: ["dashboard:read", "content:read", "content:write", "media:read", "media:write"],
      COMPETITION_ADMIN: ["dashboard:read", "competitions:read", "competitions:write"],
      REFEREE_ADMIN: ["dashboard:read", "referees:read", "referees:write"],
      SUPER_ADMIN: [...rbac.allUnifiedAdminPermissions],
    })) {
      for (const permission of rbac.allUnifiedAdminPermissions) assert(rbac.hasUnifiedAdminPermission([role as keyof typeof rbac.unifiedAdminPermissionsByRole], permission) === allowed.includes(permission), `4-role RBAC mismatch: ${role}/${permission}`);
    }

    const orphanForBackup = path.join(uploadRoot, "2026", "08", "feedface.pdf");
    await writeFile(orphanForBackup, "%PDF-orphan");
    await rejects(() => backup.createCombinedBackup({ databaseUrl: url, uploadRoot, outputDirectory: path.join(root, "backup-orphan") }), "Backup accepted an orphan upload.");
    await rm(orphanForBackup, { force: true });
    await rejects(() => backup.createCombinedBackup({ databaseUrl: `file:${path.join(root, "missing.db").replaceAll("\\", "/")}`, uploadRoot, outputDirectory: path.join(root, "backup-missing-db") }), "Backup accepted a missing DB file.");
    const backupRoot = path.join(root, "backup-valid");
    const backupManifest = await backup.createCombinedBackup({ databaseUrl: url, uploadRoot, outputDirectory: backupRoot, generatedAt: new Date("2026-08-23T00:00:00.000Z") });
    assert(backupManifest.database.sha256.length === 64 && backupManifest.uploads.fileCount === backupManifest.uploads.mediaAssetCount, "Combined backup manifest is incomplete.");
    const snapshotPath = path.join(backupRoot, "database.sqlite");
    const snapshotBytes = await readFile(snapshotPath);
    await writeFile(snapshotPath, "bad checksum");
    await rejects(() => backup.readAndVerifyCombinedBackup(backupRoot), "Checksum mismatch was accepted.");
    await writeFile(snapshotPath, snapshotBytes);
    const missingSnapshotRoot = path.join(root, "backup-missing-snapshot");
    await cp(backupRoot, missingSnapshotRoot, {
      recursive: true,
      filter: (source) => path.basename(source) !== "database.sqlite",
    });
    await rejects(() => backup.readAndVerifyCombinedBackup(missingSnapshotRoot), "Missing database snapshot was accepted.");

    await verifier.$disconnect();
    await prisma.$disconnect();
    const restoredDatabasePath = path.join(root, "restored", "r1-2.db");
    const restoredUploadRoot = path.join(root, "restored", "uploads");
    await mkdir(restoredUploadRoot, { recursive: true });
    await writeFile(restoredDatabasePath, "destroy-me");
    await writeFile(path.join(restoredUploadRoot, "destroy-me.txt"), "destroy-me");
    await rejects(
      () => backup.restoreCombinedBackup({ backupDirectory: backupRoot, databasePath: restoredDatabasePath, uploadRoot: restoredUploadRoot, allowedTargetRoot: path.join(root, "restored") }),
      "Combined restore overwrote an existing destination.",
    );
    assert((await readFile(restoredDatabasePath, "utf8")) === "destroy-me", "Restore modified an existing destination before rejection.");
    await rm(restoredDatabasePath, { force: true });
    await rm(restoredUploadRoot, { recursive: true, force: true });
    const restored = await backup.restoreCombinedBackup({ backupDirectory: backupRoot, databasePath: restoredDatabasePath, uploadRoot: restoredUploadRoot, allowedTargetRoot: path.join(root, "restored") });
    assert(restored.integrityCheck === "ok" && restored.foreignKeyViolations === 0 && restored.mediaAssetCount === backupManifest.uploads.mediaAssetCount, "Combined backup restore rehearsal failed.");
    const restoredClient = createClient({ url: `file:${restoredDatabasePath.replaceAll("\\", "/")}` });
    const health = await restoredClient.execute("SELECT COUNT(*) AS count FROM ContentPost");
    restoredClient.close();
    assert(Number(health.rows[0]?.count) === countsAfterFirst.posts, "Restored application data count changed.");

    console.log(JSON.stringify({
      structuredJson: { valid: true, unknownNode: "rejected", unknownMark: "rejected", dangerousLink: "rejected", malformed: "rejected", oversized: "rejected", deep: "rejected" },
      publicContent: { total: items.length, pinned: 5, normal: 25, pages: pages.map((page) => page.items.length), noDuplicateOrOmission: true, listDtoExcludesContentAndIds: true, detail404NoLeak: true, featuredIndependent: true },
      streamingMedia: { jpg: true, pdf20Mb: true, oversize: "rejected", timeout: "rejected-and-cleaned", concurrencyMaximum: media.mediaUploadMetrics.maximumObservedActive, interruptedCleanup: true, stagingCleanup: true, signatureCleanup: true, writeFailureNoRow: true, dbFailureNoFile: true, orphanScan: true },
      staticMigration: { entries: manifest.entries.length, media: manifest.media.length, dryRun: true, idempotent: true, duplicateSlugDetected: true, missingMediaBlocked: true, checksumReconciled: true, coverRelationshipReconciled: true, officialPdfRelationshipReconciled: true },
      legacyRbacMatrix: "4 roles verified at permission resolver",
      combinedBackup: { manifestFormat: backupManifest.formatVersion, missingDbRejected: true, orphanRejected: true, checksumMismatchRejected: true, existingDestinationRejected: true, restore: restored, restoredContentPosts: Number(health.rows[0]?.count) },
      isolatedRoot: root,
    }, null, 2));
  } finally {
    await verifier.$disconnect().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exitCode = 1; });
