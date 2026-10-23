import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "nuaafa-directory-order-"));
  process.env.DATABASE_URL = `file:${path.join(root, "synthetic.db")}`;
  process.env.NUAAFA_ISOLATED_SECURITY_TEST = "1";
  await writeFile(path.join(root, "synthetic.db"), "");
  const migrated = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: process.env, encoding: "utf8" });
  assert.equal(migrated.status, 0, migrated.stdout + migrated.stderr);
  const { prisma } = await import("../src/lib/prisma");
  const { getAdminTeamDirectory } = await import("../src/lib/admin-team-directory-service");
  const { getPublicTeamDirectory } = await import("../src/lib/team-directory-service");
  const { createOrganizationTeam, createJointTeam, createTeamsBulk } = await import("../src/lib/referee-r1-service");
  const actor = { id: "synthetic-directory-admin", role: "SUPER_ADMIN" } as const;
  try {
    async function college(name: string, prefix?: string) {
      const record = await prisma.college.upsert({ where: { name }, create: { name }, update: {} });
      const unit = await prisma.affiliationUnit.upsert({ where: { name }, create: { name, type: "COLLEGE", legacyCollegeId: record.id }, update: { legacyCollegeId: record.id } });
      if (prefix) await prisma.collegeCodeMapping.upsert({ where: { prefix }, create: { prefix, collegeId: record.id }, update: { collegeId: record.id } });
      return unit;
    }
    async function house(name: string) {
      return prisma.affiliationUnit.upsert({ where: { name }, create: { name, type: "SHUYUAN" }, update: {} });
    }
    const aviation = await college("航空学院", "01");
    const energy = await college("能源与动力学院", "02");
    const automation = await college("自动化学院", "03");
    const mechanical = await college("机电学院", "05");
    const humanities = await college("人文与社会科学学院", "10");
    const astronautics = await college("航天学院", "15");
    const changkong = await college("长空学院", "18");
    const international = await college("国际教育学院", "19");
    const london = await college("伦敦国际学院", "26");
    const continuing = await college("继续教育学院", "CG");
    const unmapped = await college("未配置编号学院");
    // Even a configured numeric SQA prefix must not move it ahead of colleges.
    const sqa = await college("SQA项目", "00");
    const houses = await Promise.all(["致慧书院二队", "致和书院", "致微书院", "致元书院", "致慧书院一队"].map(house));
    async function competition(slug: string) {
      return prisma.competition.create({ data: { slug, name: `虚构排序验收 ${slug}`, year: 2027, campus: "隔离测试", format: "FUTSAL", status: "PREPARING" } });
    }
    const first = await competition("directory-order-a");
    const second = await competition("directory-order-b");
    const create = (competitionId: string, unitId: string, name: string) => createOrganizationTeam({ competitionId, unitId, name, actor });
    for (const unit of [...houses, sqa, london, unmapped, international, continuing, changkong, astronautics, humanities, mechanical, energy]) {
      await create(first.id, unit.id, unit.name);
    }
    await createJointTeam({ competitionId: first.id, name: "航空能动联队", unitIds: [energy.id, aviation.id], actor });
    await createTeamsBulk({ competitionId: first.id, names: ["自由队10", "自由队2", "航空学院"], actor });
    const initialTeams = await prisma.team.findMany({ where: { competitionId: first.id } });
    // Deliberately conflicting historical manual orders must be ignored.
    for (const [index, team] of initialTeams.entries()) await prisma.team.update({ where: { id: team.id }, data: { directoryIsPublic: true, directoryPublicOrder: initialTeams.length - index } });
    await prisma.teamDirectorySettings.upsert({ where: { id: "current" }, create: { activeCompetitionId: first.id, directoryPublished: true }, update: { activeCompetitionId: first.id, directoryPublished: true } });
    const expected = ["航空能动联队", "能源与动力学院", "机电学院", "人文与社会科学学院", "航天学院", "长空学院", "国际教育学院", "伦敦国际学院", "继续教育学院", "未配置编号学院", "SQA项目", "致慧书院一队", "致慧书院二队", "致元书院", "致微书院", "致和书院", "航空学院", "自由队2", "自由队10"];
    async function check(expectedNames: string[]) {
      const admin = await getAdminTeamDirectory();
      const publicView = await getPublicTeamDirectory();
      assert.deepEqual(admin.teams.map((team) => team.name), expectedNames);
      assert.deepEqual(publicView.teams.map((team) => team.name), admin.teams.filter((team) => team.directoryIsPublic).map((team) => team.name));
      for (const team of publicView.teams) assert.deepEqual(Object.keys(team).sort(), ["id", "name", "publicStatus", "publicContactName", "publicContactRole", "publicContactQQ", "publicContactEmail", "publicDirectoryNote"].sort());
      return { admin, publicView };
    }
    const beforeRead = await prisma.team.findMany({ where: { competitionId: first.id }, orderBy: { id: "asc" } });
    await check(expected);
    assert.deepEqual(await prisma.team.findMany({ where: { competitionId: first.id }, orderBy: { id: "asc" } }), beforeRead);
    console.log("PASS shared admin/public ordering: numeric prefixes, joint minimum, SQA boundary, house multi-teams, freeform fallback, legacy orders ignored, safe public DTO, read-only sorting");

    const added = await create(first.id, automation.id, "自动化学院新增队");
    assert.equal(added.directoryPublicOrder, 0);
    assert.equal(added.directoryIsPublic, false);
    expected.splice(2, 0, added.name);
    assert(!(await check(expected)).publicView.teams.some((team) => team.id === added.id));
    await prisma.team.update({ where: { id: added.id }, data: { directoryIsPublic: true } });
    await check(expected);
    await prisma.collegeCodeMapping.update({ where: { prefix: "05" }, data: { prefix: "27" } });
    const changed = expected.filter((name) => name !== "机电学院");
    changed.splice(changed.indexOf("继续教育学院"), 0, "机电学院");
    await check(changed);
    console.log("PASS newly created default-order team, hidden/public subset consistency, live mapping change without re-saving teams");

    for (const unit of [houses[0], sqa, london, aviation]) await create(second.id, unit.id, unit.name);
    await prisma.team.updateMany({ where: { competitionId: second.id }, data: { directoryIsPublic: true } });
    await prisma.teamDirectorySettings.update({ where: { id: "current" }, data: { activeCompetitionId: second.id } });
    await check(["航空学院", "伦敦国际学院", "SQA项目", "致慧书院二队"]);
    assert.equal((await getAdminTeamDirectory(first.id)).teams.length, expected.length);
    console.log("PASS second competition automatically sorted and competition switch isolated");
  } finally {
    await prisma.$disconnect();
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
