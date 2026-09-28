import { preparePreTeamDirectoryBaseline } from "./prepare-test-migration-baseline";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function expectFailure(action: () => Promise<unknown>, message: string) {
  try { await action(); } catch { return; }
  throw new Error(message);
}
async function deploy(cwd: string) {
  const migrate = spawn(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], { cwd, env: { ...process.env, RUST_LOG: "trace" }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  migrate.stdout.on("data", (chunk) => { output += String(chunk); });
  migrate.stderr.on("data", (chunk) => { output += String(chunk); });
  const exitCode = await new Promise<number>((resolve, reject) => { migrate.once("error", reject); migrate.once("exit", (code) => resolve(code ?? 1)); });
  assert(exitCode === 0, `Migration failed: ${output}`);
}

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "nuaafa-team-directory-r1-1-"));
  process.env.DATABASE_URL = `file:${path.join(root, "test.db").replaceAll("\\", "/")}`;
  process.env.NUAAFA_ISOLATED_SECURITY_TEST = "1";
  const sql = createClient({ url: process.env.DATABASE_URL });
  try {
    await deploy(await preparePreTeamDirectoryBaseline(root, process.env.DATABASE_URL));
    await deploy(process.cwd());
    const { prisma } = await import("../src/lib/prisma");
    const canonical = await import("../src/lib/referee-r1-service");
    const directory = await import("../src/lib/admin-team-directory-service");
    const publicDirectory = await import("../src/lib/team-directory-service");
    const { issueTestAdminServiceAuthorization } = await import("./security-r4a-test-capabilities");
    const write = issueTestAdminServiceAuthorization("competitions:write");
    const read = issueTestAdminServiceAuthorization("competitions:read");
    const actor = { id: "r1-1-test", role: "SUPER_ADMIN" } as const;
    try {
      const competition = await prisma.competition.create({ data: { slug: "r1-1-competition", name: "2027 新生杯", year: 2027, campus: "天目湖校区", format: "FUTSAL", status: "PREPARING" } });
      const other = await prisma.competition.create({ data: { slug: "r1-1-other", name: "2027 男子院际杯", year: 2027, campus: "天目湖校区", format: "FUTSAL", status: "PREPARING" } });
      const aviation = await prisma.affiliationUnit.findUniqueOrThrow({ where: { name: "航空学院" } });
      const material = await prisma.affiliationUnit.findUniqueOrThrow({ where: { name: "材料科学与技术学院" } });
      const house = await prisma.affiliationUnit.findUniqueOrThrow({ where: { name: "致元书院" } });

      const first = await canonical.createOrganizationTeam({ competitionId: competition.id, unitId: house.id, name: "致元书院一队", actor });
      const second = await canonical.createOrganizationTeam({ competitionId: competition.id, unitId: house.id, name: "致元书院二队", actor });
      assert(first.id !== second.id && !first.directoryIsPublic && !second.directoryIsPublic, "Same Organization multi-Team or privacy default failed.");
      assert(await prisma.teamUnitAffiliation.count({ where: { unitId: house.id } }) === 2, "Both Teams must link to the same Organization.");
      await expectFailure(() => canonical.createOrganizationTeam({ competitionId: competition.id, unitId: house.id, name: "致元书院一队", actor }), "Duplicate canonical Team name was accepted.");
      const joint = await canonical.createJointTeam({ competitionId: other.id, name: "航空—材料联队", unitIds: [aviation.id, material.id], actor });
      assert(await prisma.teamUnitAffiliation.count({ where: { teamId: joint.id } }) === 2 && !joint.directoryIsPublic, "Joint Team affiliation or privacy default failed.");
      const custom = await canonical.createTeamsBulk({ competitionId: competition.id, names: ["飞鹰 FC"], actor });
      assert(custom.createdNames.length === 1, "Custom Team not created.");
      const free = await prisma.team.findUniqueOrThrow({ where: { competitionId_name: { competitionId: competition.id, name: "飞鹰 FC" } } });
      assert(free.teamType === "FREEFORM" && await prisma.teamUnitAffiliation.count({ where: { teamId: free.id } }) === 0, "Custom Team acquired a false affiliation.");
      const bulk = await canonical.createTeamsFromUnits({ competitionId: competition.id, unitIds: [aviation.id, material.id], actor });
      assert(bulk.createdNames.length === 2, "Bulk Organization add failed.");
      const again = await canonical.createTeamsFromUnits({ competitionId: competition.id, unitIds: [aviation.id, material.id], actor });
      assert(again.createdNames.length === 0, "Bulk Organization add duplicated Teams.");

      const adminView = await directory.getAdminTeamDirectory(competition.id);
      assert(adminView.competitions.find((item) => item.id === competition.id)?.teamCount === 5, "Competition Team count incorrect.");
      assert(adminView.teams.find((item) => item.id === first.id)?.units[0]?.id === house.id, "Admin affiliation view incorrect.");
      for (const status of ["筹备中", "招募中", "已组队", "已确认参赛", "招募结束", "联合组队中"]) {
        await directory.updateTeamDirectoryEntry(first.id, competition.id, { publicStatus: ` ${status} `, publicContactName: "验收负责人", publicContactQQ: "12345678", directoryIsPublic: true, directoryPublicOrder: 1 }, write);
        assert((await prisma.team.findUniqueOrThrow({ where: { id: first.id } })).publicStatus === status, `Status ${status} not preserved.`);
      }
      await expectFailure(() => directory.updateTeamDirectoryEntry(first.id, competition.id, { publicStatus: "x".repeat(81), directoryIsPublic: true, directoryPublicOrder: 0 }, write), "Overlong custom status accepted.");
      await expectFailure(() => directory.updateTeamDirectoryEntriesBulk({ competitionId: competition.id, teamIds: [first.id], action: "publish" }, read as never), "Read-only actor wrote bulk update.");
      await expectFailure(() => directory.updateTeamDirectoryEntriesBulk({ competitionId: competition.id, teamIds: [first.id, joint.id], action: "hide" }, write), "Cross-Competition bulk selection accepted.");
      assert((await prisma.team.findUniqueOrThrow({ where: { id: first.id } })).directoryIsPublic, "Rejected bulk operation changed a Team.");
      await directory.updateTeamDirectoryEntriesBulk({ competitionId: competition.id, teamIds: [first.id, second.id], action: "formed" }, write);
      assert((await prisma.team.findUniqueOrThrow({ where: { id: second.id } })).publicStatus === "已组队", "Bulk status update failed.");
      await directory.updateTeamDirectoryEntriesBulk({ competitionId: competition.id, teamIds: [second.id], action: "publish" }, write);
      await directory.updateTeamDirectorySettings({ activeCompetitionId: competition.id, directoryPublished: true }, write);
      assert((await publicDirectory.getPublicTeamDirectory()).teams.length === 2, "Public Team list did not update.");
      await directory.updateTeamDirectoryEntriesBulk({ competitionId: competition.id, teamIds: [second.id], action: "hide" }, write);
      assert((await publicDirectory.getPublicTeamDirectory()).teams.length === 1, "Hide did not remove public card.");
      assert(await prisma.team.findUnique({ where: { id: second.id } }), "Hide deleted canonical Team.");
      await directory.updateTeamDirectorySettings({ activeCompetitionId: competition.id, directoryPublished: false }, write);
      assert((await publicDirectory.getPublicTeamDirectory()).competition === null, "Stopping publication failed.");
      assert(await prisma.auditLog.count({ where: { action: "TEAM_DIRECTORY_BULK_UPDATED" } }) === 3, "Bulk audit missing.");
      console.log("Team Directory R1.1 Organization, multi-Team, joint, custom, bulk, status, RBAC, audit, publication and privacy: PASS");
    } finally { await prisma.$disconnect(); }
  } finally { sql.close(); await rm(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 300 }).catch((error) => { console.warn("Temporary database cleanup deferred:", error); }); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
