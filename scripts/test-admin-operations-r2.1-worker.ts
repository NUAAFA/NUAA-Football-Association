import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@libsql/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../src/generated/prisma-v29/client";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectStatus(action: () => Promise<unknown>, status: number, message: string) {
  let caught: unknown;
  try { await action(); } catch (error) { caught = error; }
  assert(caught instanceof Error && "status" in caught && caught.status === status, message);
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
  const databasePath = process.env.ADMIN_OPERATIONS_R21_TEST_DATABASE_PATH;
  if (!databasePath) throw new Error("ADMIN_OPERATIONS_R21_TEST_DATABASE_PATH is required.");
  const url = `file:${databasePath.replaceAll("\\", "/")}`;
  process.env.DATABASE_URL = url;
  process.env.REFEREE_ADMIN_SESSION_SECRET = randomBytes(32).toString("base64url");
  process.env.REFEREE_MEMBER_SESSION_SECRET = randomBytes(32).toString("base64url");
  process.env.NUAAFA_ISOLATED_SECURITY_TEST = "1";
  await applyMigrations(url);

  const verifier = new PrismaClient({ adapter: new PrismaLibSql({ url }) });
  const capabilities = await import("./security-r4a-test-capabilities");
  const competitionService = await import("../src/lib/referee-competition-service");
  const r1 = await import("../src/lib/referee-r1-service");
  const refereeService = await import("../src/lib/referee-service");
  const availability = await import("../src/lib/referee-availability");
  const { prisma } = await import("../src/lib/prisma");

  try {
    const admin = await verifier.adminAccount.create({
      data: { username: "admin-r21", displayName: "R2.1 管理员", passwordHash: "isolated-test-hash", role: "SUPER_ADMIN" },
    });
    const actor = capabilities.testUnifiedAdminActor({ id: admin.id });
    const authorization = capabilities.issueTestAdminServiceAuthorization("competitions:write", actor);

    const emptyCompetition = await verifier.competition.create({
      data: { slug: "r21-empty", name: "R2.1 空白赛事", campus: "天目湖校区", format: "ELEVEN_A_SIDE", status: "PREPARING" },
    });
    await expectStatus(() => competitionService.deleteCompetitionSafely(emptyCompetition.id, emptyCompetition.name, {} as never), 403, "Competition deletion accepted forged authorization.");
    await expectStatus(() => competitionService.deleteCompetitionSafely(emptyCompetition.id, "错误名称", authorization), 409, "Competition deletion accepted mismatched confirmation.");
    await competitionService.deleteCompetitionSafely(emptyCompetition.id, emptyCompetition.name, authorization);
    assert(!await verifier.competition.findUnique({ where: { id: emptyCompetition.id } }), "Empty Competition was not deleted.");
    assert(await verifier.auditLog.count({ where: { action: "COMPETITION_DELETED", entityId: emptyCompetition.id, actorId: admin.id } }) === 1, "COMPETITION_DELETED audit is missing.");

    const protectedCompetition = await verifier.competition.create({
      data: { slug: "r21-protected", name: "R2.1 受保护赛事", campus: "天目湖校区", format: "ELEVEN_A_SIDE", status: "ONGOING" },
    });
    const [homeTeam, awayTeam] = await Promise.all([
      verifier.team.create({ data: { competitionId: protectedCompetition.id, name: "R2.1 主队" } }),
      verifier.team.create({ data: { competitionId: protectedCompetition.id, name: "R2.1 客队" } }),
    ]);
    await expectStatus(() => competitionService.deleteCompetitionSafely(protectedCompetition.id, protectedCompetition.name, authorization), 409, "Competition with Teams was hard-deleted.");
    assert(await verifier.competition.count({ where: { id: protectedCompetition.id } }) === 1 && await verifier.team.count({ where: { competitionId: protectedCompetition.id } }) === 2, "Competition refusal cascaded into Team data.");

    const unusedMatch = await verifier.match.create({
      data: { slug: "r21-unused-match", competitionId: protectedCompetition.id, stage: "测试场次", kickoff: new Date("2032-03-01T10:00:00+08:00"), endAt: new Date("2032-03-01T12:00:00+08:00"), venue: "西操场", homeTeamId: homeTeam.id, awayTeamId: awayTeam.id, status: "SCHEDULED", applicationWindowStatus: "CLOSED" },
    });
    await refereeService.deleteMatchSafely(unusedMatch.id, "重复创建", authorization);
    assert(!await verifier.match.findUnique({ where: { id: unusedMatch.id } }), "Unused Match was not deleted.");
    assert(await verifier.team.count({ where: { id: { in: [homeTeam.id, awayTeam.id] } } }) === 2, "Match deletion removed a Team.");

    const referee = await verifier.referee.create({ data: { publicCode: "991", name: "R2.1 裁判", status: "ACTIVE" } });
    const interestedMatch = await verifier.match.create({
      data: { slug: "r21-interested-match", competitionId: protectedCompetition.id, stage: "有报名记录", kickoff: new Date("2032-03-02T10:00:00+08:00"), endAt: new Date("2032-03-02T12:00:00+08:00"), venue: "西操场", homeTeamId: homeTeam.id, awayTeamId: awayTeam.id, status: "SCHEDULED", applicationWindowStatus: "CLOSED" },
    });
    const application = await verifier.refereeApplication.create({ data: { matchId: interestedMatch.id, refereeId: referee.id, preferredPositions: "[]", status: "PENDING" } });
    await expectStatus(() => refereeService.deleteMatchSafely(interestedMatch.id, "测试数据", authorization), 409, "Match with referee interest was hard-deleted.");
    assert(await verifier.refereeApplication.count({ where: { id: application.id } }) === 1, "Protected application history was deleted.");

    const colleges = [];
    for (const [id, name] of [["r21-college-a", "R2.1 航空学院"], ["r21-college-b", "R2.1 自动化学院"]] as const) {
      await verifier.college.create({ data: { id, name } });
      colleges.push(await verifier.affiliationUnit.create({ data: { id, name, type: "COLLEGE", legacyCollegeId: id } }));
    }
    const house = await r1.createHouse({ name: "R2.1 测试书院", childUnitIds: colleges.map((college) => college.id) }, authorization);
    assert(await verifier.affiliationUnitRelation.count({ where: { parentUnitId: house.id } }) === 2, "House creation did not persist selected Colleges.");
    await r1.updateHouse(house.id, "R2.1 更新书院", authorization);
    await r1.setHouseChildren(house.id, [colleges[0].id], authorization);
    assert((await verifier.affiliationUnit.findUniqueOrThrow({ where: { id: house.id } })).name === "R2.1 更新书院", "House name edit failed.");
    assert(await verifier.affiliationUnitRelation.count({ where: { parentUnitId: house.id } }) === 1, "House relationship update failed.");
    await expectStatus(() => r1.deleteHouseSafely(house.id, "R2.1 更新书院", {} as never), 403, "House deletion accepted forged authorization.");
    await r1.deleteHouseSafely(house.id, "R2.1 更新书院", authorization);
    assert(!await verifier.affiliationUnit.findUnique({ where: { id: house.id } }), "Unused House was not deleted.");
    assert(await verifier.college.count({ where: { id: { in: colleges.map((college) => college.id) } } }) === 2, "House deletion removed College entities.");
    for (const action of ["HOUSE_CREATED", "HOUSE_UPDATED", "HOUSE_RELATIONSHIP_UPDATED", "HOUSE_DELETED"]) {
      assert(await verifier.auditLog.count({ where: { action, actorId: admin.id } }) >= 1, `${action} audit is missing.`);
    }

    const referencedHouse = await r1.createHouse({ name: "R2.1 被引用书院", childUnitIds: [] }, authorization);
    const houseTeam = await verifier.team.create({ data: { competitionId: protectedCompetition.id, name: "R2.1 书院代表队", teamType: "ORGANIZATION" } });
    await verifier.teamUnitAffiliation.create({ data: { teamId: houseTeam.id, unitId: referencedHouse.id } });
    await expectStatus(() => r1.deleteHouseSafely(referencedHouse.id, referencedHouse.name, authorization), 409, "Referenced House was hard-deleted.");
    assert(await verifier.affiliationUnit.count({ where: { id: referencedHouse.id } }) === 1 && await verifier.team.count({ where: { id: houseTeam.id } }) === 1, "House refusal removed protected data.");

    const matchStart = new Date("2032-04-01T10:00:00+08:00");
    const matchEnd = new Date("2032-04-01T12:00:00+08:00");
    assert(availability.resolveMatchAvailability([], matchStart, matchEnd) === "UNSET", "Unset availability collapsed into unavailable.");
    assert(availability.resolveMatchAvailability([{ kind: "UNAVAILABLE", startAt: new Date("2032-04-01T00:00:00+08:00"), endAt: new Date("2032-04-02T00:00:00+08:00") }], matchStart, matchEnd) === "UNAVAILABLE", "Full-day unavailable was not surfaced.");
    assert(availability.resolveMatchAvailability([{ kind: "AVAILABLE", startAt: new Date("2032-04-01T09:00:00+08:00"), endAt: new Date("2032-04-01T13:00:00+08:00") }], matchStart, matchEnd) === "AVAILABLE", "Inside specified window was not available.");
    assert(availability.resolveMatchAvailability([{ kind: "AVAILABLE", startAt: new Date("2032-04-01T13:00:00+08:00"), endAt: new Date("2032-04-01T16:00:00+08:00") }], matchStart, matchEnd) === "UNAVAILABLE", "Outside specified window was not unavailable.");

    const associationSource = await readFile(path.resolve("src/data/association.ts"), "utf8");
    const associationPageSource = await readFile(path.resolve("src/app/association/page.tsx"), "utf8");
    const associationContentSource = await readFile(path.resolve("src/components/association/association-page-content.tsx"), "utf8");
    const selectorSource = await readFile(path.resolve("src/components/referees/admin/organization-checkbox-selector.tsx"), "utf8");
    const affiliationsSource = await readFile(path.resolve("src/components/referees/admin/admin-data-managers.tsx"), "utf8");
    const calendarSource = await readFile(path.resolve("src/components/referees/mvp/referee-availability-calendar.tsx"), "utf8");
    const workspaceNavSource = await readFile(path.resolve("src/components/referees/mvp/referee-workspace-nav.tsx"), "utf8");
    const workspaceHeroSource = await readFile(path.resolve("src/components/referees/mvp/referee-workspace-hero.tsx"), "utf8");
    const openMatchesShellSource = await readFile(path.resolve("src/components/referees/mvp/referee-open-matches-shell.tsx"), "utf8");
    const openMatchesPageSource = await readFile(path.resolve("src/app/referees/open-matches/page.tsx"), "utf8");
    const openMatchDetailSource = await readFile(path.resolve("src/app/referees/open-matches/[slug]/page.tsx"), "utf8");
    const competitionFormSource = await readFile(path.resolve("src/components/referees/admin/admin-competition-form.tsx"), "utf8");
    const adminStylesSource = await readFile(path.resolve("src/styles/referee-admin.css"), "utf8");
    assert(associationSource.includes("establishedYear: 2021") && associationSource.includes('period: "2021年"') && associationPageSource.includes("<AssociationPageContent />") && associationContentSource.includes("{associationIdentity.establishedYear}") && associationContentSource.includes("{associationIdentity.establishedLabel}"), "Founding-year content was not corrected to 2021.");
    assert(associationSource.includes('period: "2022-2023"') && associationSource.includes('academicYear: "2022-2023"'), "Legitimate 2022 history was corrupted.");
    assert(selectorSource.includes("type=\"search\"") && selectorSource.includes("type=\"checkbox\"") && selectorSource.includes("全选当前结果") && selectorSource.includes("已选择"), "Shared organization selector behaviors are incomplete.");
    assert(!affiliationsSource.includes("<select multiple") && affiliationsSource.includes("OrganizationCheckboxSelector"), "House or Team management still uses native multi-select.");
    assert(calendarSource.includes("referee-status-options") && calendarSource.includes('mode === "WINDOW"') && calendarSource.includes("referee-calendar-legend"), "Availability visual-state contracts are incomplete.");
    assert(!workspaceNavSource.includes("RefereeMemberLogoutButton") && workspaceHeroSource.includes("RefereeMemberLogoutButton") && workspaceHeroSource.includes("账号与安全") && workspaceHeroSource.includes("返回公开裁判中心"), "Workspace account actions were not moved out of primary navigation.");
    assert(competitionFormSource.includes("页面地址标识") && competitionFormSource.includes("用于生成赛事固定网址，仅支持小写英文字母、数字和连字符；创建后不建议修改。") && competitionFormSource.includes("admin-competition-slug-help"), "Competition slug label, help copy, or independent help region is missing.");
    const tabRule = adminStylesSource.match(/\.admin-tabs a,\s*\.admin-tabs button\s*\{([^}]*)\}/)?.[1];
    const tabDeclarations = new Map((tabRule ?? "").split(";").map((declaration) => {
      const colon = declaration.indexOf(":");
      return [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()];
    }));
    assert(adminStylesSource.includes(".admin-competition-slug-help { grid-column: 1 / -1") && tabDeclarations.get("min-height") === "40px" && tabDeclarations.get("display") === "inline-flex" && tabDeclarations.get("align-items") === "center" && tabDeclarations.get("justify-content") === "center" && adminStylesSource.includes(".admin-tabs a:focus-visible, .admin-tabs button:focus-visible"), "Competition alignment or shared admin tab alignment/focus contracts are missing.");
    assert(openMatchesShellSource.includes("if (!member) return <RefereePage") && openMatchesShellSource.includes("<RefereeWorkspaceNav />") && openMatchesShellSource.includes("RefereeWorkspaceHero") && openMatchesPageSource.includes("getRefereeMemberSession") && openMatchesPageSource.includes("RefereeOpenMatchesShell") && openMatchDetailSource.includes("RefereeOpenMatchesShell"), "Open-match routes are not using the authenticated/public session-aware shell.");
    assert(workspaceNavSource.includes('aria-current={current("/referees/open-matches")') && workspaceNavSource.includes("pathname.startsWith(`${href}/`)"), "Open-match workspace navigation does not retain its active state on list and detail routes.");

    const competitionRoute = await readFile(path.resolve("src/app/api/referees/admin/competitions/[id]/route.ts"), "utf8");
    const houseRoute = await readFile(path.resolve("src/app/api/referees/admin/affiliation-units/route.ts"), "utf8");
    assert(competitionRoute.includes('authorizeLegacyAdminRequest(request, "competitions:write")') && competitionRoute.includes("deleteCompetitionSafely"), "Competition DELETE route does not enforce unified RBAC.");
    assert(houseRoute.includes('authorizeLegacyAdminRequest(request, "competitions:write")') && houseRoute.includes("deleteHouseSafely"), "House mutations do not enforce unified RBAC.");

    const libsql = createClient({ url });
    const integrity = await libsql.execute("PRAGMA integrity_check");
    const foreignKeys = await libsql.execute("PRAGMA foreign_key_check");
    libsql.close();
    assert(integrity.rows[0].integrity_check === "ok" && foreignKeys.rows.length === 0, "R2.1 test database integrity failed.");

    console.log(JSON.stringify({
      foundingYearCorrectedAndHistoricalYearsPreserved: true,
      availabilityStatesAndAppointmentSignal: true,
      competitionSafeDeleteRbacConflictAudit: true,
      matchSafeDeletePreservesApplicationsAndParents: true,
      houseCrudRelationsSafeDeleteRbacAudit: true,
      sharedOrganizationSelectorContracts: true,
      refereeWorkspaceAccountHierarchy: true,
      competitionFormAndAdminTabsPolished: true,
      sessionAwareOpenMatchWorkspaceShell: true,
      sqliteIntegrityCheck: "ok",
      foreignKeyViolations: 0,
    }, null, 2));
  } finally {
    await verifier.$disconnect();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : "Admin Operations R2.1 worker failed.");
  process.exit(1);
});
