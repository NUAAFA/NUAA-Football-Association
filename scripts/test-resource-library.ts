import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import type { UnifiedAdminActor } from "../src/lib/unified-admin-rbac";

async function main() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "nuaafa-resources-")));
  process.env.DATABASE_URL = `file:${path.join(root, "test.db")}`;
  process.env.NUAAFA_UPLOAD_DIR = path.join(root, "uploads");
  const raw = createClient({ url: process.env.DATABASE_URL });
  try {
    for (const migration of (await readdir("prisma/migrations", { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      await raw.executeMultiple(await readFile(path.join("prisma/migrations", migration.name, "migration.sql"), "utf8"));
    }
  } finally { raw.close(); }
  const { prisma } = await import("../src/lib/prisma");
  try {
    const { getResourceLibrary, getPublicCompetitionFiles, getAdminResource, saveResourceDocument } = await import("../src/lib/resource-library");
    const { storeMediaAssetUpload, storeMediaAssetUploadStream, changeMediaVisibility, mediaUsage } = await import("../src/lib/admin-media-service");
    const { canAccessUnifiedAdminRoute } = await import("../src/lib/unified-admin-routing");
    const editor: UnifiedAdminActor = { id: null, displayName: "隔离内容运营", isLegacy: true, roles: ["CONTENT_EDITOR"] };
    const referee: UnifiedAdminActor = { ...editor, roles: ["REFEREE_ADMIN"] };
    const baseline = await getResourceLibrary();
    assert.equal(baseline.length, 15);
    assert.equal(baseline.filter((item) => item.category === "regulations").length, 3);
    assert.equal(baseline.filter((item) => item.category === "training" && item.fileType === "PPTX").length, 2);
    assert.equal((await getPublicCompetitionFiles()).find((file) => file.id === "football-laws-2025-26")?.href, "/documents/rules/football/2025-26-laws-of-the-game-zh.pdf");
    assert(canAccessUnifiedAdminRoute(editor.roles, "/admin/resources/new"));
    assert(!canAccessUnifiedAdminRoute(referee.roles, "/admin/resources/new"));
    const bytes = await readFile("public/documents/templates/eleven-a-side-match-report.pdf");
    const asset = await storeMediaAssetUpload({ fileName: "隔离规则.pdf", mimeType: "application/pdf", bytes, visibility: "PRIVATE", actor: editor });
    const input = { category: "regulations", title: "隔离规则", description: "隔离资料说明", source: "测试来源", scope: "十一人制", version: "2030", dateLabel: "2030.01", versionStatus: "current", versionNote: "隔离测试", playingFormat: "eleven-a-side", trainingLevel: "基础", sortOrder: -1, status: "DRAFT", mediaAssetId: asset.id, confirmPublic: false };
    await assert.rejects(saveResourceDocument(null, input, referee), (error: unknown) => error instanceof Error && "status" in error && error.status === 403);
    await assert.rejects(saveResourceDocument(null, { ...input, category: "appointments" }, editor));
    await assert.rejects(saveResourceDocument(null, { ...input, mediaAssetId: null }, editor));
    await assert.rejects(saveResourceDocument(null, { ...input, sortOrder: 1.5 }, editor));
    await assert.rejects(saveResourceDocument(null, { ...input, status: "PUBLISHED" }, editor));
    const draft = await saveResourceDocument(null, input, editor);
    assert(!(await getResourceLibrary()).some((item) => item.id === draft.id));
    assert.equal((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).visibility, "PRIVATE");
    await saveResourceDocument(draft.id, { ...input, status: "PUBLISHED", confirmPublic: true }, editor);
    assert((await getResourceLibrary()).some((item) => item.id === draft.id));
    assert.equal((await getPublicCompetitionFiles())[0].id, draft.id);
    assert.equal((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).visibility, "PUBLIC");
    assert((await mediaUsage()).get(asset.id)?.values().next().value?.href?.startsWith("/admin/resources/"));
    await assert.rejects(changeMediaVisibility(asset.id, "PRIVATE", editor), (error: unknown) => error instanceof Error && "status" in error && error.status === 409);
    await saveResourceDocument(draft.id, { ...input, status: "ARCHIVED" }, editor);
    assert(!(await getResourceLibrary()).some((item) => item.id === draft.id));
    await changeMediaVisibility(asset.id, "PRIVATE", editor);
    const builtin = baseline.find((item) => item.category === "guidebooks")!;
    await saveResourceDocument(builtin.id, { ...builtin, title: "秩序册信息已更新", status: "PUBLISHED", confirmPublic: true }, editor);
    assert.equal((await getResourceLibrary()).filter((item) => item.category === "guidebooks").length, 1);
    assert.equal((await getAdminResource(builtin.id, editor))?.title, "秩序册信息已更新");
    await saveResourceDocument(builtin.id, { ...builtin, status: "ARCHIVED" }, editor);
    assert(!(await getResourceLibrary()).some((item) => item.builtinKey === builtin.id));
    await saveResourceDocument(builtin.id, { ...builtin, status: "PUBLISHED", confirmPublic: true, mediaAssetId: asset.id }, editor);
    assert.equal((await getPublicCompetitionFiles()).find((item) => item.category === "guidebooks")?.downloadHref, `/media/${asset.id}`);
    for (const category of ["training", "work-files", "notices", "discipline", "schedules"] as const) {
      const row = await saveResourceDocument(null, { ...input, category, status: "PUBLISHED", confirmPublic: true }, editor);
      assert((await getResourceLibrary()).some((item) => item.id === row.id && item.category === category));
    }
    await assert.rejects(storeMediaAssetUpload({ fileName: "fake.pdf", mimeType: "application/pdf", bytes: Buffer.from("not a PDF"), visibility: "PRIVATE", actor: editor }));
    await assert.rejects(storeMediaAssetUploadStream({ fileName: "huge.pdf", mimeType: "application/pdf", stream: new ReadableStream(), contentLength: 21 * 1024 * 1024, visibility: "PRIVATE", actor: editor }));
    const image = await storeMediaAssetUpload({ fileName: "image.png", mimeType: "image/png", bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), visibility: "PRIVATE", actor: editor });
    await assert.rejects(saveResourceDocument(null, { ...input, mediaAssetId: image.id }, editor));
    assert(await prisma.auditLog.count({ where: { entityType: "ResourceDocument" } }) >= 10);
    assert.equal((await prisma.$queryRawUnsafe<Array<{ integrity_check: string }>>("PRAGMA integrity_check"))[0].integrity_check, "ok");
    const expectedResources = await prisma.resourceDocument.findMany({ orderBy: { id: "asc" }, select: { id: true, title: true, category: true, status: true } });
    await prisma.$disconnect();
    const { createCombinedBackup, restoreCombinedBackup } = await import("../src/lib/combined-backup");
    const backupDirectory = path.join(root, "backup");
    await createCombinedBackup({ databaseUrl: process.env.DATABASE_URL, uploadRoot: process.env.NUAAFA_UPLOAD_DIR, outputDirectory: backupDirectory });
    const target = path.join(root, "restored");
    await mkdir(target);
    await restoreCombinedBackup({ backupDirectory, databasePath: path.join(target, "restored.db"), uploadRoot: path.join(target, "uploads"), allowedTargetRoot: target });
    const restored = createClient({ url: `file:${path.join(target, "restored.db")}` });
    try { assert.deepEqual((await restored.execute('SELECT id, title, category, status FROM ResourceDocument ORDER BY id')).rows.map((row) => ({ id: row.id, title: row.title, category: row.category, status: row.status })), expectedResources); }
    finally { restored.close(); }
    console.log("PASS: fresh migration, 15 original files, permissions, validation, private drafts, publication, withdrawal, all categories, existing-file editing/replacement, stable links, visibility reference guard, signatures/size/type, audit logs and full backup/restore of resource records.");
  } finally { await prisma.$disconnect(); await rm(root, { recursive: true, force: true }); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
