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
    assert.deepEqual(await ids(), ["mens", "freshman", "womens"], "Featured fixtures retain their next-kickoff ordering");
    const fixture = (await read())[0].nextMatch;
    assert.equal(fixture.state, "scheduled");
    if (fixture.state === "scheduled") {
      assert.equal(fixture.timeLabel, "19:45", "Fixture times use Beijing time");
      assert.equal(fixture.homeTeam, "mens 主队");
    }

    await prisma.competition.update({ where: { id: "fourth" }, data: { homepageFeatured: true } });
    assert.deepEqual(await ids(), ["mens", "freshman", "fourth"], "Admin homepage priorities are preserved when there are more than three events");
    await prisma.competition.update({ where: { id: "mens" }, data: { status: "COMPLETED" } });
    assert.deepEqual(await ids(), ["freshman", "fourth", "womens"], "Completing an event frees a slot for another current public event");
    console.log("Homepage competitions passed: 0–3 events, women's fallback, publication boundaries, fixture ordering, Beijing time, featured priority and completed-event replacement.");
  } finally {
    await prisma.$disconnect();
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
