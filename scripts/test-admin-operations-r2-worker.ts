import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@libsql/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../src/generated/prisma-v29/client";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectError(action: () => Promise<unknown>, message: string, status?: number) {
  let caught: unknown;
  try { await action(); } catch (error) { caught = error; }
  assert(caught instanceof Error, message);
  if (status !== undefined) assert("status" in caught && caught.status === status, `${message} (status)`);
  return caught;
}

async function applyMigrations(url: string) {
  const client = createClient({ url });
  const entries = await readdir(path.resolve("prisma/migrations"), { withFileTypes: true });
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    await client.executeMultiple(await readFile(path.resolve("prisma/migrations", entry.name, "migration.sql"), "utf8"));
  }
  client.close();
}

async function main() {
  const databasePath = process.env.ADMIN_OPERATIONS_R2_TEST_DATABASE_PATH;
  if (!databasePath) throw new Error("ADMIN_OPERATIONS_R2_TEST_DATABASE_PATH is required.");
  const url = `file:${databasePath.replaceAll("\\", "/")}`;
  process.env.DATABASE_URL = url;
  process.env.REFEREE_ADMIN_SESSION_SECRET = randomBytes(32).toString("base64url");
  process.env.REFEREE_MEMBER_SESSION_SECRET = randomBytes(32).toString("base64url");
  process.env.NUAAFA_ISOLATED_SECURITY_TEST = "1";
  await applyMigrations(url);

  const verifier = new PrismaClient({ adapter: new PrismaLibSql({ url }) });
  const admission = await import("../src/lib/referee-admission-service");
  const credentials = await import("../src/lib/referee-credentials");
  const dto = await import("../src/lib/referee-dto");
  const eligibility = await import("../src/lib/referee-eligibility");
  const r1 = await import("../src/lib/referee-r1-service");
  const security = await import("../src/lib/referee-security");
  const service = await import("../src/lib/referee-service");
  const student = await import("../src/lib/student-id");
  const teamService = await import("../src/lib/referee-team-service");
  const capabilities = await import("./security-r4a-test-capabilities");
  const { prisma } = await import("../src/lib/prisma");

  try {
    const admin = await verifier.adminAccount.create({
      data: {
        username: "admin-r2",
        displayName: "R2 管理员",
        passwordHash: await security.hashPassword("Admin-R2-Password-2026"),
        role: "SUPER_ADMIN",
        unifiedRoles: { create: { role: "SUPER_ADMIN" } },
      },
    });
    const actor = { id: admin.id, displayName: admin.displayName, isLegacy: false as const, roles: ["SUPER_ADMIN" as const] };
    const competitionAuthorization = capabilities.issueTestAdminServiceAuthorization("competitions:write", actor);
    const refereeAuthorization = capabilities.issueTestAdminServiceAuthorization("referees:write", actor);

    await expectError(
      () => admission.submitRefereeAdmissionApplication({ name: "缺学号", phone: "13800000001" }),
      "Admission accepted missing studentId.",
    );
    const pending = await admission.submitRefereeAdmissionApplication({ name: "新裁判", studentId: "  cg20260001 ", phone: "13800000001" });
    const approved = await admission.reviewRefereeAdmissionApplication(pending.id, { action: "APPROVE", reviewNote: "R2 审核通过", mode: "CREATE_NEW" }, actor);
    assert(approved.onboarding, "Approval did not return one-time onboarding result.");
    const onboarded = await verifier.referee.findUniqueOrThrow({ where: { id: approved.onboarding.refereeId }, include: { capabilities: true, college: true } });
    assert(onboarded.studentId === "CG20260001", "studentId was not normalized to uppercase.");
    assert(onboarded.status === "ACTIVE" && onboarded.trainingStatus === "IN_TRAINING" && onboarded.assignmentEligibility === "ELIGIBLE", "Onboarding account defaults are wrong.");
    assert(onboarded.publicDirectoryEnabled && onboarded.mustChangePassword, "Public directory / must-change defaults are wrong.");
    assert(/^\d{3}$/.test(onboarded.publicCode), "publicCode format is not canonical 3 digits.");
    assert(onboarded.college?.name === "继续教育学院", "CG college mapping failed.");
    assert(onboarded.capabilities.length === 10, "Default capabilities were not fully initialized.");
    assert(onboarded.capabilities.filter((item) => item.positionKey === "REFEREE").every((item) => item.status === "NOT_ASSIGNED"), "Referee-role defaults are not NOT_ASSIGNED.");
    assert(onboarded.capabilities.filter((item) => item.positionKey !== "REFEREE").every((item) => item.status === "TRAINING"), "Support-role defaults are not TRAINING.");
    assert(await security.verifyPassword(approved.onboarding.temporaryPassword, onboarded.passwordHash!), "Temporary password hash does not verify.");
    assert((await credentials.authenticateRefereeCredentials(" cg20260001 ", approved.onboarding.temporaryPassword))?.id === onboarded.id, "studentId login failed.");
    assert(!(await credentials.authenticateRefereeCredentials(onboarded.publicCode, approved.onboarding.temporaryPassword)), "publicCode unexpectedly remains a login identity.");
    assert(!JSON.stringify(await verifier.auditLog.findMany()).includes(approved.onboarding.temporaryPassword), "Temporary password leaked into AuditLog.");
    assert(!("studentId" in dto.publicDirectoryRefereeSelect) && !("phone" in dto.publicDirectoryRefereeSelect) && !("qq" in dto.publicDirectoryRefereeSelect) && !("passwordHash" in dto.publicDirectoryRefereeSelect), "Public DTO exposes private fields.");
    await expectError(() => admission.createOnboardedRefereeAccount({ name: "重复学号", studentId: "CG20260001" }, actor), "Duplicate studentId was accepted.", 409);
    await expectError(() => admission.createOnboardedRefereeAccount({ name: "未知学院", studentId: "ZZ20260001" }, actor), "Unknown student prefix was accepted.");
    const directOne = await admission.createOnboardedRefereeAccount({ name: "并发一", studentId: "16260011" }, actor);
    const directTwo = await admission.createOnboardedRefereeAccount({ name: "并发二", studentId: "16260012" }, actor);
    assert(directOne.publicCode !== directTwo.publicCode && Number(directTwo.publicCode) === Number(directOne.publicCode) + 1, "publicCode sequence did not allocate unique monotonic codes.");

    const missingAccount = await verifier.referee.create({ data: { publicCode: "980", name: "缺学号兼容测试", status: "ACTIVE" } });
    await verifier.referee.create({ data: { publicCode: "981", name: "归一化重复一", studentId: "czduplicate", status: "INACTIVE" } });
    await verifier.referee.create({ data: { publicCode: "982", name: "归一化重复二", studentId: "CZDUPLICATE", status: "INACTIVE" } });
    const compatibility = await student.getRefereeStudentIdCompatibility(verifier);
    assert(compatibility.activeMissingStudentId === 1 && compatibility.duplicateStudentIdGroups === 1 && compatibility.unsafeLoginMigrationBlockers === 2, "Compatibility scan did not report missing/normalized duplicates.");

    const competitions = await Promise.all([
      verifier.competition.create({ data: { slug: "r2-a", name: "R2 十一人制 A", campus: "明故宫校区", format: "ELEVEN_A_SIDE", status: "ONGOING", isTestData: true } }),
      verifier.competition.create({ data: { slug: "r2-b", name: "R2 五人制 B", campus: "天目湖校区", format: "FUTSAL", status: "ONGOING", isTestData: true } }),
    ]);
    const unit = await verifier.affiliationUnit.findFirstOrThrow({ orderBy: { name: "asc" } });
    await r1.createTeamsFromUnits({ competitionId: competitions[0].id, unitIds: [unit.id], actor: { id: admin.id, role: "SUPER_ADMIN" } });
    await r1.createTeamsFromUnits({ competitionId: competitions[0].id, unitIds: [unit.id], actor: { id: admin.id, role: "SUPER_ADMIN" } });
    await r1.createTeamsFromUnits({ competitionId: competitions[1].id, unitIds: [unit.id], actor: { id: admin.id, role: "SUPER_ADMIN" } });
    assert(await verifier.team.count({ where: { competitionId: competitions[0].id } }) === 1, "Same-competition organization duplicate was created.");
    assert(await verifier.team.count({ where: { competitionId: competitions[1].id } }) === 1, "Same organization was not allowed in a different competition.");
    await r1.createTeamsBulk({ competitionId: competitions[0].id, names: ["A2", "A2", "自由队"], actor: { id: admin.id, role: "SUPER_ADMIN" } });
    const units = await verifier.affiliationUnit.findMany({ take: 2, orderBy: { name: "asc" } });
    await r1.createJointTeam({ competitionId: competitions[0].id, name: "联合队", unitIds: units.map((item) => item.id), actor: { id: admin.id, role: "SUPER_ADMIN" } });
    const teamsA = await verifier.team.findMany({ where: { competitionId: competitions[0].id } });
    const teamsB = await verifier.team.findMany({ where: { competitionId: competitions[1].id } });
    assert(teamsA.every((team) => team.competitionId === competitions[0].id) && teamsB.every((team) => team.competitionId === competitions[1].id), "Team queries crossed competition boundaries.");
    await expectError(() => teamService.resolveCompetitionTeamSelection(verifier, { competitionId: competitions[1].id, selection: `team:${teamsA[0].id}` }), "Competition B accepted Competition A team.");
    await expectError(() => teamService.resolveCompetitionTeamSelection(verifier, { competitionId: competitions[1].id, selection: `unit:${unit.id}` }), "Match API still accepts on-demand global unit selection.");

    const unused = await verifier.team.create({ data: { competitionId: competitions[0].id, name: "待删除球队", teamType: "FREEFORM" } });
    await expectError(() => r1.deleteTeamSafely(unused.id, {} as never), "Team deletion accepted forged authorization.", 403);
    await r1.deleteTeamSafely(unused.id, competitionAuthorization);
    assert(!await verifier.team.findUnique({ where: { id: unused.id } }), "Unused team was not deleted.");
    assert(await verifier.auditLog.count({ where: { action: "TEAM_DELETED", entityId: unused.id } }) === 1, "TEAM_DELETED audit is missing.");

    const match = await service.createMatch({
      slug: "r2-match-a", competitionId: competitions[0].id, stage: "小组赛", kickoff: new Date("2027-03-01T10:00:00.000Z"), endAt: new Date("2027-03-01T12:00:00.000Z"), venue: "R2 场地",
      homeTeamId: teamsA[0].id, awayTeamId: teamsA[1].id, status: "SCHEDULED", applicationWindowStatus: "CLOSED", positionCounts: { ASSISTANT_REFEREE_1: 1 },
    }, { id: admin.id, role: "SUPER_ADMIN" });
    await expectError(() => r1.deleteTeamSafely(teamsA[0].id, competitionAuthorization), "Referenced team deletion did not return conflict.", 409);
    await expectError(() => service.createMatch({ slug: "r2-cross", competitionId: competitions[1].id, stage: "错误场次", kickoff: new Date("2027-03-02T10:00:00.000Z"), venue: "R2 场地", homeTeamId: teamsA[0].id, awayTeamId: teamsB[0].id, status: "SCHEDULED", applicationWindowStatus: "CLOSED", positionCounts: {} }, { id: admin.id, role: "SUPER_ADMIN" }), "Cross-competition match creation was accepted.");

    await eligibility.assertAppointmentPositionsEligible({ format: "ELEVEN_A_SIDE", positions: [{ refereeId: onboarded.id, key: "ASSISTANT_REFEREE_1" }], db: verifier });
    await expectError(() => eligibility.assertAppointmentPositionsEligible({ format: "ELEVEN_A_SIDE", positions: [{ refereeId: onboarded.id, key: "REFEREE" }], db: verifier }), "NOT_ASSIGNED referee role was selectable.", 409);
    const fullDay = await r1.saveRefereeAvailability({ refereeId: onboarded.id, startAt: new Date("2027-03-01T00:00:00.000Z"), endAt: new Date("2027-03-02T00:00:00.000Z"), kind: "AVAILABLE", competitionFormat: "ELEVEN_A_SIDE", note: "整天可执裁", actor: { type: "REFEREE", id: onboarded.id } });
    const unavailable = await r1.saveRefereeAvailability({ refereeId: onboarded.id, startAt: new Date("2027-03-03T00:00:00.000Z"), endAt: new Date("2027-03-04T00:00:00.000Z"), kind: "UNAVAILABLE", competitionFormat: null, note: "整天不可执裁", actor: { type: "REFEREE", id: onboarded.id } });
    const window = await r1.saveRefereeAvailability({ refereeId: onboarded.id, startAt: new Date("2027-03-05T09:00:00.000Z"), endAt: new Date("2027-03-05T12:00:00.000Z"), kind: "AVAILABLE", competitionFormat: "FUTSAL", note: "上午时段", actor: { type: "REFEREE", id: onboarded.id } });
    assert(fullDay.competitionFormat === "ELEVEN_A_SIDE" && unavailable.kind === "UNAVAILABLE" && window.note === "上午时段", "Availability type/window/note persistence failed.");

    const draft = await service.saveAppointmentDraft({ matchId: match.id, publicationNote: "R2 test", positions: [{ key: "ASSISTANT_REFEREE_1", slot: 1, refereeId: onboarded.id }] }, refereeAuthorization);
    assert(draft.appointment.status === "DRAFT", "TRAINING candidate could not be saved to a draft.");
    await service.publishAppointment(match.id, "", "", refereeAuthorization);
    const report = await r1.reportAppointmentConflict(draft.appointment.id, onboarded.id, { reasonCode: "COURSE_EXAM", explanation: "考试时间冲突" });
    assert(report.reasonCode === "COURSE_EXAM" && report.explanation === "考试时间冲突" && report.status === "PENDING", "Structured conflict report failed.");
    await r1.resolveAppointmentConflictReport(report.id, "RESOLVED", "已更换安排并关闭", { id: admin.id, role: "SUPER_ADMIN" });
    assert(await verifier.auditLog.count({ where: { action: "APPOINTMENT_CONFLICT_REPORT_RESOLVED", entityId: report.id } }) === 1, "Conflict resolution audit is missing.");
    await verifier.match.update({ where: { id: match.id }, data: { status: "COMPLETED", kickoff: new Date(Date.now() - 7200000), endAt: new Date(Date.now() - 3600000), homeScore: 0, awayScore: 0 } });
    await service.completeAppointment(match.id, "R2 completed", refereeAuthorization);
    const statistics = await r1.getCompletedRefereeStatistics({ competitionId: competitions[0].id, positionKey: "ASSISTANT_REFEREE_1" });
    assert(statistics.some((item) => item.refereeId === onboarded.id && item.totalMatches === 1 && item.elevenASideCount === 1 && item.assistantRoleCount === 1), "Completed appointment statistics are incorrect.");

    const workspaceSource = await readFile(path.resolve("src/components/referees/admin/admin-competition-workspace.tsx"), "utf8");
    const organizationSelectorSource = await readFile(path.resolve("src/components/referees/admin/organization-checkbox-selector.tsx"), "utf8");
    const matchFormSource = await readFile(path.resolve("src/components/referees/admin/admin-match-form.tsx"), "utf8");
    const calendarSource = await readFile(path.resolve("src/components/referees/mvp/referee-availability-calendar.tsx"), "utf8");
    assert(workspaceSource.includes("OrganizationCheckboxSelector") && organizationSelectorSource.includes("搜索学院或书院") && organizationSelectorSource.includes("全选当前结果") && organizationSelectorSource.includes('type="checkbox"') && workspaceSource.includes("创建联合队") && workspaceSource.includes("批量导入自由组队球队"), "Competition team checkbox/search UX is incomplete.");
    assert(!matchFormSource.includes('value={`unit:${unit.id}`}') && matchFormSource.includes("仅显示当前赛事的参赛球队"), "Match form still exposes global unit selections.");
    assert(calendarSource.includes("整天可执裁") && calendarSource.includes("整天不可执裁") && calendarSource.includes("指定时段可执裁"), "Availability calendar states are incomplete.");

    const libsql = createClient({ url });
    const integrity = await libsql.execute("PRAGMA integrity_check");
    const foreignKeys = await libsql.execute("PRAGMA foreign_key_check");
    libsql.close();
    assert(integrity.rows[0].integrity_check === "ok" && foreignKeys.rows.length === 0, "R2 test database integrity failed.");

    console.log(JSON.stringify({
      onboardingAndStudentLogin: true,
      publicCodeAndCollegeMapping: true,
      defaultsPrivacyAndPasswordHandling: true,
      compatibilityScan: compatibility,
      competitionTeamIsolation: true,
      representativeJointFreeformTeams: true,
      safeDeleteRbacConflictAudit: true,
      trainingCandidateSelectable: true,
      availabilityCalendarPersistence: true,
      structuredConflictAndStatistics: true,
      operationalUiContracts: true,
      sqliteIntegrityCheck: "ok",
      foreignKeyViolations: 0,
      cleanupProbe: missingAccount.id,
    }, null, 2));
  } finally {
    await verifier.$disconnect();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : "Admin Operations R2 worker failed.");
  process.exit(1);
});
