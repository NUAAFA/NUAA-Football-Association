import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createMediaHistoryFixtureDatabase, seedMediaHistoryFixture } from "./lib/media-history-fixture";
import { catalogueHref, cataloguePage, catalogueValue, catalogueYear } from "../src/lib/catalogue-navigation";

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "nuaafa-album-catalogues-"));
  process.env.DATABASE_URL = `file:${path.join(root, "isolated.db")}`;
  process.env.NUAAFA_CONTENT_SOURCE = "database";
  process.env.NUAAFA_UPLOAD_DIR = path.join(root, "uploads");
  await createMediaHistoryFixtureDatabase(process.env.DATABASE_URL);
  const { prisma } = await import("../src/lib/prisma");
  try {
    const fixture = await seedMediaHistoryFixture(prisma, process.env.NUAAFA_UPLOAD_DIR, 8);
    const { getPublishedReportAlbums, getLegacyMediaAlbums, getMediaAlbum } = await import("../src/lib/media-album-service");
    const { getPublishedCompetitionImages } = await import("../src/lib/competition-report-service");
    const { getCompetitionArchives, getStaticCompetitionArchives } = await import("../src/lib/competition-archive-service");
    const { historicalCompetitionYears } = await import("../src/data/historical-competitions");
    const { mensCupGallery } = await import("../src/data/mens-intercollege-cup-2026");
    const { womensCupGallery } = await import("../src/data/womens-intercollege-cup-2026");
    const originalContent = JSON.stringify(historicalCompetitionYears);
    const originalPhoto = await readFile(path.join(process.env.NUAAFA_UPLOAD_DIR, fixture.assets[0].storageKey));
    const now = new Date("2026-10-26T12:00:00Z");
    const base = { type: "NEWS" as const, title: "隔离检查条目", summary: "fixture", competitionId: fixture.competition.id,
      status: "PUBLISHED" as const, publishedAt: new Date("2026-10-25T12:00:00Z"), content: fixture.posts[0].content!, coverMediaId: fixture.assets[0].id };
    await prisma.contentPost.create({ data: { ...base, id: "draft", slug: "draft", status: "DRAFT" } });
    await prisma.contentPost.create({ data: { ...base, id: "future", slug: "future", publishedAt: new Date("2027-01-01T00:00:00Z") } });
    await prisma.contentPost.create({ data: { ...base, id: "archived", slug: "archived", status: "ARCHIVED" } });
    await prisma.contentPost.create({ data: { ...base, id: "discipline", slug: "discipline", type: "DISCIPLINE" } });
    for (const id of ["hidden", "test"]) {
      const c = await prisma.competition.create({ data: { slug: id, name: id, year: 2026, campus: "隔离", format: "FUTSAL", status: "COMPLETED", publicPublished: id !== "hidden", isTestData: id === "test" } });
      await prisma.contentPost.create({ data: { ...base, id: `post-${id}`, slug: `post-${id}`, competitionId: c.id } });
    }
    const privatePhoto = await prisma.mediaAsset.create({ data: { storageKey: "2026/10/private.jpg", storedFilename: "private.jpg", originalFilename: "private.jpg", mimeType: "image/jpeg", size: 1, visibility: "PRIVATE" } });
    const pdf = await prisma.mediaAsset.create({ data: { storageKey: "2026/10/document.pdf", storedFilename: "document.pdf", originalFilename: "document.pdf", mimeType: "application/pdf", size: 1, visibility: "PUBLIC" } });
    for (const [id, media] of [["private-only", privatePhoto], ["pdf-only", pdf]] as const) await prisma.contentPost.create({ data: { ...base, id, slug: id, coverMediaId: media.id, content: { schemaVersion: 1, document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "只有封面" }] }] } } } });
    await prisma.contentPost.update({ where: { id: fixture.posts[0].id }, data: { coverMediaId: fixture.assets[2].id } });
    const snapshot = async () => JSON.stringify(await Promise.all([prisma.contentPost.findMany({ orderBy: { id: "asc" } }), prisma.mediaAsset.findMany({ orderBy: { id: "asc" } }), prisma.competition.findMany({ orderBy: { id: "asc" } })]));
    const before = await snapshot();
    const albums = await getPublishedReportAlbums(now);
    assert.equal(albums.length, 8, "Only published reports in public non-test competitions form albums");
    assert.equal(albums[0].id, `report-${fixture.posts[0].id}`, "Album ordering uses report publication time");
    const first = albums.find((album) => album.id === `report-${fixture.posts[0].id}`)!;
    assert.equal(first.images.length, 6, "Six photos form one report album; cover is not duplicated");
    assert.equal(first.cover.src, `/media/${fixture.assets[2].id}`, "The public report cover is used");
    assert(albums[1].images.some((image) => first.images.some((other) => other.src === image.src)), "Shared photos remain available in each source report");
    assert(!JSON.stringify(albums).includes(privatePhoto.id) && !JSON.stringify(albums).includes(pdf.id), "Private media and PDFs cannot leak through covers");
    const oldPhotos = await getPublishedCompetitionImages(fixture.competition.id, now);
    assert.deepEqual(new Set(albums.flatMap((album) => album.images.map((image) => image.src))), new Set(oldPhotos.map((image) => image.src)), "All previously public report photos remain reachable");
    assert.equal((await getMediaAlbum(`report-${fixture.posts[0].id}`))?.images.length, 6);
    assert.equal(await getMediaAlbum("report-draft"), undefined);
    const legacy = getLegacyMediaAlbums();
    assert.deepEqual(new Set(legacy.flatMap((album) => album.images.map((image) => image.src))), new Set([...mensCupGallery, ...womensCupGallery].map((image) => image.src)), "All 40 legacy photos are retained");
    assert(legacy.every((album) => album.reportHref === null), "Database mode cannot revive retired static report links");
    const records = getStaticCompetitionArchives();
    for (const year of historicalCompetitionYears) for (const record of year.competitions) assert(records.some((entry) => entry.id === record.id && entry.year === year.year && entry.href.endsWith(record.id)), "Every historical record has a detail route");
    assert.equal(records.length, 8);
    assert.equal(JSON.stringify(historicalCompetitionYears), originalContent, "History records are read without mutation");
    assert.equal(await snapshot(), before, "Catalogue and detail reads do not mutate database records");
    assert((await readFile(path.join(process.env.NUAAFA_UPLOAD_DIR, fixture.assets[0].storageKey))).equals(originalPhoto), "Original photo bytes do not change");
    await prisma.competition.create({ data: { slug: "public-completed", name: "隔离已结束赛事", year: 2027, campus: "隔离", format: "FUTSAL", status: "COMPLETED", publicPublished: true } });
    const futureArchive = await getCompetitionArchives();
    assert.equal(futureArchive[0].year, 2027);
    assert(futureArchive.some((entry) => entry.href === "/competitions/public-completed"));
    assert(!futureArchive.some((entry) => ["/competitions/hidden", "/competitions/test", "/competitions/catalogue-preview-freshman"].includes(entry.href)), "Unpublished, test and ongoing events stay out of history");
    await prisma.contentPost.update({ where: { id: fixture.posts[0].id }, data: { status: "ARCHIVED" } });
    assert.equal(await getMediaAlbum(`report-${fixture.posts[0].id}`), undefined, "Withdrawn reports also disappear from direct album URLs");
    const requested = cataloguePage(Array.from({ length: 53 }, (_, index) => index), "9999");
    assert.equal(requested.page, 9); assert.equal(requested.items.length, 5);
    assert.equal(cataloguePage(albums, "-2").page, 1); assert.equal(cataloguePage(albums, "2").items.length, 2);
    assert.equal(catalogueYear("nonsense", ["2027", "2026"]), "2027");
    assert.equal(catalogueValue(["2026", "2025"]), "2026");
    assert.equal(new URL(catalogueHref("/media", { q: "第二轮 & 天目湖", page: 2 }), "http://localhost").searchParams.get("q"), "第二轮 & 天目湖");
    console.log("PASS: report grouping, public visibility, full photo preservation, withdrawal, history completeness, pagination and read-only invariants.");
  } finally { await prisma.$disconnect(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
