import { preparePreTeamDirectoryBaseline } from "./prepare-test-migration-baseline";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../src/generated/prisma-v29/client";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function runPrisma(url: string, args: string[], cwd = process.cwd()) {
  const child = spawn(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), ...args], {
    cwd, env: { ...process.env, DATABASE_URL: url, RUST_LOG: "trace" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (data) => { output += String(data); });
  child.stderr.on("data", (data) => { output += String(data); });
  const code = await new Promise<number>((resolve, reject) => { child.once("error", reject); child.once("exit", (exit) => resolve(exit ?? 1)); });
  assert(code === 0, `prisma ${args.join(" ")} failed: ${output}`);
  return output;
}

async function expectFailure(action: () => Promise<unknown>, label: string) {
  let failed = false;
  try { await action(); } catch { failed = true; }
  assert(failed, label);
}

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "nuaafa-team-directory-"));
  const databaseUrl = `file:${path.join(root, "rehearsal.db").replaceAll("\\", "/")}`;
  const baseline = await preparePreTeamDirectoryBaseline(root, databaseUrl);
  process.env.DATABASE_URL = databaseUrl;
  process.env.NUAAFA_ISOLATED_SECURITY_TEST = "1";
  const sql = createClient({ url: databaseUrl });
  try {
    await runPrisma(databaseUrl, ["migrate", "deploy"], baseline);
    await sql.executeMultiple(`
      INSERT INTO "Competition" ("id","slug","name","year","campus","format","status","isTestData","source","createdAt","updatedAt")
      VALUES ('legacy','legacy','旧赛事',2026,'天目湖校区','FUTSAL','ONGOING',0,'MANUAL',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
      INSERT INTO "Team" ("id","competitionId","name","teamType","source") VALUES ('legacy-team','legacy','旧球队','FREEFORM','MANUAL');
      INSERT INTO "Match" ("id","slug","competitionId","stage","kickoff","venue","source","homeTeamId","awayTeamId","status","applicationWindowStatus","isTestData","createdAt","updatedAt")
      VALUES ('legacy-match','legacy-match','legacy','小组赛','2030-09-01T10:00:00.000Z','球场','MANUAL','legacy-team','legacy-team','SCHEDULED','CLOSED',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
      INSERT INTO "Referee" ("id","publicCode","name","createdAt","updatedAt") VALUES ('legacy-referee','997','旧裁判',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
    `);
    const before = await Promise.all(["Competition", "Team", "Match", "Referee"].map(async (table) => Number((await sql.execute(`SELECT COUNT(*) AS count FROM "${table}"`)).rows[0]?.count)));
    await runPrisma(databaseUrl, ["migrate", "deploy"]);
    assert((await runPrisma(databaseUrl, ["migrate", "deploy"])).includes("No pending migrations"), "Second migrate deploy was not a no-op.");
    assert((await runPrisma(databaseUrl, ["migrate", "status"])).includes("Database schema is up to date"), "Prisma migration status was not clean.");
    const after = await Promise.all(["Competition", "Team", "Match", "Referee"].map(async (table) => Number((await sql.execute(`SELECT COUNT(*) AS count FROM "${table}"`)).rows[0]?.count)));
    assert(JSON.stringify(before) === JSON.stringify(after), "Migration changed legacy row counts.");
    assert((await sql.execute("PRAGMA foreign_key_check")).rows.length === 0, "Foreign key violations after migration.");
    assert((await sql.execute("PRAGMA integrity_check")).rows[0]?.integrity_check === "ok", "SQLite integrity check failed.");

    const db = new PrismaClient({ adapter: new PrismaLibSql({ url: databaseUrl }) });
    const { prisma } = await import("../src/lib/prisma");
    const publicService = await import("../src/lib/team-directory-service");
    const adminService = await import("../src/lib/admin-team-directory-service");
    const testAuth = await import("./security-r4a-test-capabilities");
    const write = testAuth.issueTestAdminServiceAuthorization("competitions:write");
    const readOnly = testAuth.issueTestAdminServiceAuthorization("competitions:read");
    try {
      const competitionA = await db.competition.create({ data: { slug: "fixture-a", name: "2027 男子院际杯", year: 2027, campus: "天目湖校区", format: "FUTSAL", status: "PREPARING" } });
      const competitionB = await db.competition.create({ data: { slug: "fixture-b", name: "2027 新生杯", year: 2027, campus: "天目湖校区", format: "FUTSAL", status: "PREPARING" } });
      const testCompetition = await db.competition.create({ data: { slug: "fixture-test", name: "测试赛事", campus: "天目湖校区", format: "FUTSAL", status: "PREPARING", isTestData: true } });
      const a1 = await db.team.create({ data: { competitionId: competitionA.id, name: "航空学院", publicDirectoryNote: "", directoryIsPublic: false } });
      const a2 = await db.team.create({ data: { competitionId: competitionA.id, name: "民航学院" } });
      const b1 = await db.team.create({ data: { competitionId: competitionB.id, name: "材料学院" } });
      await db.team.create({ data: { competitionId: competitionB.id, name: "机电学院" } });
      const testTeam = await db.team.create({ data: { competitionId: testCompetition.id, name: "测试球队" } });
      await db.referee.create({ data: { publicCode: "996", name: "PRIVATE_REFEREE_MARKER", studentId: "PRIVATE_STUDENT_MARKER", phone: "PRIVATE_PHONE_MARKER", internalNote: "PRIVATE_NOTE_MARKER" } });
      await db.auditLog.create({ data: { actorType: "SYSTEM", action: "PRIVATE_FIXTURE", entityType: "Team", entityId: a1.id, summary: "PRIVATE_AUDIT_MARKER" } });
      const initial = await publicService.getPublicTeamDirectory();
      assert(initial.competition === null && initial.teams.length === 0, "Unpublished initial state leaked teams.");
      await expectFailure(() => adminService.updateTeamDirectorySettings({ activeCompetitionId: testCompetition.id, directoryPublished: true }, write), "Test Competition could be selected.");
      await expectFailure(() => adminService.updateTeamDirectoryEntry(testTeam.id, testCompetition.id, { directoryIsPublic: true, directoryPublicOrder: 0 }, write), "Test Team could be published.");
      await expectFailure(() => adminService.updateTeamDirectoryEntry(a1.id, competitionB.id, { directoryIsPublic: true, directoryPublicOrder: 0 }, write), "Cross-Competition Team update succeeded.");
      await expectFailure(() => adminService.updateTeamDirectorySettings({ activeCompetitionId: competitionA.id, directoryPublished: true }, readOnly as never), "Read-only authorization wrote settings.");
      await adminService.updateTeamDirectoryEntry(a1.id, competitionA.id, { publicStatus: "招募中", publicContactName: "张三", publicContactQQ: "123456", directoryIsPublic: true, directoryPublicOrder: 1 }, write);
      await adminService.updateTeamDirectoryEntry(a2.id, competitionA.id, { publicStatus: "已组队", publicContactName: "李四", directoryIsPublic: true, directoryPublicOrder: 2 }, write);
      await adminService.updateTeamDirectoryEntry(b1.id, competitionB.id, { publicStatus: "筹备中", publicContactName: "王五", directoryIsPublic: true, directoryPublicOrder: 1 }, write);
      await adminService.updateTeamDirectorySettings({ activeCompetitionId: competitionA.id, directoryPublished: true, contactName: "负责人 A", contactTitle: "组队联络", contactQQ: "654321", contactEmail: "a@example.com" }, write);
      const showA = await publicService.getPublicTeamDirectory();
      assert(showA.competition?.title === "2027 男子院际杯组队目录", "A title incorrect.");
      assert(showA.teams.length === 2 && showA.teams[0]?.publicContactName === "张三" && showA.teams[1]?.publicContactName === "李四", "A directory incorrect.");
      assert(showA.contact.name === "负责人 A", "A contact incorrect.");
      assert(!/PRIVATE_(REFEREE|STUDENT|PHONE|NOTE|AUDIT)_MARKER/u.test(JSON.stringify(showA)) && !JSON.stringify(showA).includes("isTestData") && !JSON.stringify(showA).includes("source"), "Public DTO exposed internal fields.");
      await adminService.updateTeamDirectorySettings({ activeCompetitionId: competitionB.id, directoryPublished: true, contactName: "负责人 B", contactEmail: "b@example.com" }, write);
      const showB = await publicService.getPublicTeamDirectory();
      assert(showB.competition?.title === "2027 新生杯组队目录" && showB.teams.length === 1 && showB.teams[0]?.name === "材料学院", "B switch failed or A leaked.");
      assert(showB.contact.name === "负责人 B" && showB.contact.email === "b@example.com", "Contact switch failed.");
      await db.team.delete({ where: { id: b1.id } });
      assert((await publicService.getPublicTeamDirectory()).teams.length === 0, "Deleted Team remained public.");
      await db.competition.delete({ where: { id: competitionB.id } });
      assert((await publicService.getPublicTeamDirectory()).competition === null, "Deleted active Competition remained public.");
      const settings = await db.teamDirectorySettings.findUniqueOrThrow({ where: { id: "current" } });
      assert(settings.activeCompetitionId === null, "SetNull deletion safety failed.");
      assert(await db.auditLog.count({ where: { action: "TEAM_DIRECTORY_SETTINGS_UPDATED" } }) === 2, "Settings audit missing.");
      assert(await db.auditLog.count({ where: { action: "TEAM_DIRECTORY_COMPETITION_SWITCHED" } }) === 2, "Competition switch audit missing.");
      assert(await db.auditLog.count({ where: { action: "TEAM_DIRECTORY_ENTRY_UPDATED" } }) === 3, "Team audit missing.");
      assert(!JSON.stringify(await db.auditLog.findMany({ where: { action: { startsWith: "TEAM_DIRECTORY" } } })).includes("a@example.com"), "Audit captured public contact snapshot.");
      assert(publicService.formatTeamDirectoryTitle("2027 新生杯", 2027) === "2027 新生杯组队目录", "Year duplicated.");
      console.log("Team Directory R1 pre-change Prisma migration, no-op redeploy, switching, contact, privacy, deletion, RBAC, and audit: PASS");
    } finally { await db.$disconnect(); await prisma.$disconnect(); }
  } finally { sql.close(); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
