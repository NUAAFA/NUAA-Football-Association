import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import Module from "node:module";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "nuaafa-homepage-competitions-"));
  process.env.DATABASE_URL = `file:${path.join(root, "synthetic.db")}`;
  const raw = createClient({ url: process.env.DATABASE_URL });
  try {
    for (const migration of (await readdir("prisma/migrations", { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      await raw.executeMultiple(await readFile(path.join("prisma/migrations", migration.name, "migration.sql"), "utf8"));
    }
  } finally {
    raw.close();
  }

  // Next provides this build-time marker. Service tests run directly in Node.
  const loader = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
  const originalLoad = loader._load;
  loader._load = function (request, parent, isMain) { return request === "server-only" ? {} : originalLoad.call(this, request, parent, isMain); };
  const { prisma } = await import("../src/lib/prisma");
  const { getHomepagePublicCompetitions, getPublicCompetitionCatalog } = await import("../src/lib/public-competition-service");
  loader._load = originalLoad;
  const asOf = new Date("2030-10-26T00:00:00Z");
  const read = () => getHomepagePublicCompetitions(asOf);
  const ids = async () => (await read()).map((competition) => competition.id);
  const competition = (id: string, publicOrder: number, homepageFeatured = false) => ({
    id, slug: id, name: `隔离展示赛事 ${id}`, campus: "天目湖", format: "FUTSAL" as const,
    status: "ONGOING" as const, publicPublished: true, publicOrder, homepageFeatured,
  });

  try {
    const orderSql = await readFile("prisma/migrations/20261027120000_current_competition_order/migration.sql", "utf8");
    const applyOrderCorrection = async () => {
      const client = createClient({ url: process.env.DATABASE_URL! });
      try { await client.executeMultiple(orderSql); } finally { client.close(); }
    };
    const corrected = ["fresherscup", "2026futsal", "women"];
    for (const [index, slug] of corrected.entries()) {
      await prisma.competition.create({ data: { ...competition(slug, 3 - index), year: 2026, summary: "保留赛事资料" } });
    }
    const beforeCorrection = await prisma.competition.findMany({ orderBy: { id: "asc" } });
    await applyOrderCorrection();
    assert.deepEqual(await ids(), corrected, "The current 2026 events must display freshman, men's, then women's");
    assert.deepEqual((await getPublicCompetitionCatalog()).map((item) => item.id), corrected, "Homepage and competition centre must agree");
    const afterCorrection = await prisma.competition.findMany({ orderBy: { id: "asc" } });
    assert.deepEqual(afterCorrection.map((row) => ({ ...row, publicOrder: 0 })), beforeCorrection.map((row) => ({ ...row, publicOrder: 0 })), "The correction must preserve every other competition field");
    await applyOrderCorrection();
    assert.deepEqual(await prisma.competition.findMany({ orderBy: { id: "asc" } }), afterCorrection, "The data correction is idempotent");
    for (const slug of corrected) {
      for (const boundary of [{ year: 2025 }, { year: null }, { publicPublished: false }, { isTestData: true }]) {
        await prisma.competition.update({ where: { slug }, data: { year: 2026, publicPublished: true, isTestData: false, publicOrder: -99, ...boundary } });
        await applyOrderCorrection();
        assert.equal((await prisma.competition.findUniqueOrThrow({ where: { slug } })).publicOrder, -99, "Other years, drafts and test records must not be reordered");
      }
    }
    await prisma.competition.deleteMany();

    assert.deepEqual(await ids(), []);
    await prisma.competition.create({ data: competition("freshman", 0, true) });
    assert.deepEqual(await ids(), ["freshman"]);
    await prisma.competition.create({ data: competition("mens", 1, true) });
    assert.deepEqual(await ids(), ["freshman", "mens"]);
    await prisma.competition.create({ data: competition("womens", 2) });
    assert.deepEqual(await ids(), ["freshman", "mens", "womens"], "An unfeatured public women's competition must fill the third slot");
    assert.equal((await read())[2].nextMatch.state, "pending", "A competition without fixtures still appears with pending schedule text");

    await prisma.competition.createMany({ data: [
      { ...competition("draft", -10, true), publicPublished: false },
      { ...competition("test", -9, true), isTestData: true },
      { ...competition("finished", -8, true), status: "COMPLETED" },
      competition("fourth", 3),
    ] });
    assert.deepEqual(await ids(), ["freshman", "mens", "womens"], "The homepage must stay within three eligible competitions");
    assert.deepEqual(new Set((await getPublicCompetitionCatalog()).map((item) => item.id)), new Set(["freshman", "mens", "womens", "finished", "fourth"]), "The catalogue retains all public records, excluding drafts and test data");

    for (const [id, kickoff] of [["freshman", "2030-10-28T07:00:00Z"], ["mens", "2030-10-27T11:45:00Z"]]) {
      await prisma.team.createMany({ data: [
        { id: `${id}-home`, competitionId: id, name: `${id} 主队` },
        { id: `${id}-away`, competitionId: id, name: `${id} 客队` },
      ] });
      await prisma.match.create({ data: {
        id: `${id}-match`, slug: `${id}-match`, competitionId: id, stage: "小组赛", status: "SCHEDULED",
        homeTeamId: `${id}-home`, awayTeamId: `${id}-away`, kickoff: new Date(kickoff), venue: "隔离场地",
      } });
    }
    assert.deepEqual(await ids(), ["freshman", "mens", "womens"], "An earlier men's fixture must not overtake the freshman competition");
    const fixture = (await read())[1].nextMatch;
    assert.equal(fixture.state, "scheduled");
    if (fixture.state === "scheduled") {
      assert.equal(fixture.timeLabel, "19:45", "Fixture times use Beijing time");
      assert.equal(fixture.homeTeam, "mens 主队");
    }

    await prisma.competition.update({ where: { id: "womens" }, data: { publicOrder: -5 } });
    assert.deepEqual(await ids(), ["womens", "freshman", "mens"], "Admin public order controls display even when a fallback event is not featured");
    assert.deepEqual((await getPublicCompetitionCatalog()).filter((item) => item.status !== "completed").slice(0, 3).map((item) => item.id), await ids(), "Both homepage sections share the catalogue display order");
    await prisma.competition.update({ where: { id: "womens" }, data: { publicOrder: 2 } });
    await prisma.competition.update({ where: { id: "fourth" }, data: { homepageFeatured: true } });
    assert.deepEqual(await ids(), ["freshman", "mens", "fourth"], "Admin homepage priorities choose slots without changing their public order");
    await prisma.competition.update({ where: { id: "mens" }, data: { status: "COMPLETED" } });
    assert.deepEqual(await ids(), ["freshman", "womens", "fourth"], "Completing an event frees a slot while preserving public order");
    await prisma.competition.update({ where: { id: "fourth" }, data: { status: "COMPLETED" } });
    assert.deepEqual(await ids(), ["freshman", "womens"], "Three events can shrink to two");
    await prisma.competition.update({ where: { id: "womens" }, data: { publicPublished: false } });
    assert.deepEqual(await ids(), ["freshman"], "Unpublishing an event leaves only eligible cards");
    await prisma.competition.update({ where: { id: "freshman" }, data: { status: "COMPLETED" } });
    assert.deepEqual(await ids(), [], "Completing the final event shows the empty state");
    await prisma.competition.update({ where: { id: "mens" }, data: { status: "ONGOING" } });
    await prisma.competition.update({ where: { id: "womens" }, data: { status: "ONGOING", publicPublished: true } });
    assert.deepEqual(await ids(), ["mens", "womens"], "A semester with only men's and women's events needs no layout or selection switch");
    console.log("Homepage competitions passed: current-event data correction, field preservation, idempotence, publication boundaries, shared public order, schedule independence, admin override, Beijing time, featured selection and 3→2→1→0 events.");
  } finally {
    await prisma.$disconnect();
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
