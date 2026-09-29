import { readFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@libsql/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../src/generated/prisma-v29/client";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function applyMigration(client: ReturnType<typeof createClient>, name: string) {
  const sql = await readFile(path.resolve("prisma/migrations", name, "migration.sql"), "utf8");
  await client.executeMultiple(sql);
}

async function main() {
  const databasePath = process.env.REFEREE_R1_TEST_DATABASE_PATH;
  if (!databasePath) throw new Error("REFEREE_R1_TEST_DATABASE_PATH is required.");
  const url = `file:${databasePath.replaceAll("\\", "/")}`;
  process.env.DATABASE_URL = url;
  process.env.NUAAFA_ISOLATED_SECURITY_TEST = "1";

  const raw = createClient({ url });
  await applyMigration(raw, "20260722013757_init_referee_center");
  await applyMigration(raw, "20260723124500_add_referee_sessions");
  await applyMigration(raw, "20260730090000_referee_operations_v24");

  await raw.executeMultiple(`
    INSERT INTO "Competition"
      ("id", "slug", "name", "campus", "format", "status", "updatedAt")
    VALUES
      ('legacy-competition', 'legacy-r1-test', '既有赛事', '天目湖校区', 'ELEVEN_A_SIDE', 'ONGOING', CURRENT_TIMESTAMP);
    INSERT INTO "Team" ("id", "competitionId", "name") VALUES
      ('legacy-home', 'legacy-competition', '既有主队'),
      ('legacy-away', 'legacy-competition', '既有客队');
    INSERT INTO "Match"
      ("id", "slug", "competitionId", "stage", "kickoff", "venue", "homeTeamId", "awayTeamId", "status", "updatedAt")
    VALUES
      ('legacy-match', 'legacy-match-r1', 'legacy-competition', '既有轮次', '2026-08-18T10:00:00.000Z', '既有场地', 'legacy-home', 'legacy-away', 'SCHEDULED', CURRENT_TIMESTAMP);
    INSERT INTO "Referee"
      ("id", "publicCode", "name", "status", "elevenASide", "futsal", "publicDirectoryEnabled", "updatedAt")
    VALUES
      ('legacy-referee', 'LEGACY-R1', '既有裁判员', 'ACTIVE', true, false, true, CURRENT_TIMESTAMP);
    INSERT INTO "RefereeAppointment"
      ("id", "matchId", "status", "publishedAt", "revision", "updatedAt")
    VALUES
      ('legacy-appointment', 'legacy-match', 'PUBLISHED', '2026-08-17T10:00:00.000Z', 1, CURRENT_TIMESTAMP);
    INSERT INTO "AppointmentPosition"
      ("id", "appointmentId", "refereeId", "key", "label", "sortOrder", "slot")
    VALUES
      ('legacy-position', 'legacy-appointment', 'legacy-referee', 'REFEREE', '裁判员', 10, 1);
    INSERT INTO "AppointmentVersion"
      ("id", "appointmentId", "revision", "status", "snapshot", "reason")
    VALUES
      ('legacy-version', 'legacy-appointment', 1, 'PUBLISHED', '{}', '既有发布');
    INSERT INTO "AdminSession" ("id", "tokenHash", "expiresAt")
    VALUES ('legacy-admin-session', 'legacy-admin-token', '2030-01-01T00:00:00.000Z');
    INSERT INTO "RefereeSession" ("id", "refereeId", "tokenHash", "expiresAt")
    VALUES ('legacy-referee-session', 'legacy-referee', 'legacy-referee-token', '2030-01-01T00:00:00.000Z');
  `);

  await applyMigration(raw, "20260819120000_referee_admin_r1");
  await applyMigration(raw, "20260820120000_referee_business_model_fix2");
  await applyMigration(raw, "20260820160000_referee_acceptance_fix3");
  await applyMigration(raw, "20260823091228_unified_admin_r1_foundation");
  await applyMigration(raw, "20260823160000_referee_admission_application_intake");
  await applyMigration(raw, "20260824120000_referee_admission_eligibility");
  await applyMigration(raw, "20260913120000_public_competition_dynamic_r1");
  await applyMigration(raw, "20260914210000_admin_operations_r2");
  await applyMigration(raw, "20260922120000_public_competition_true_dynamic_r3");
  await applyMigration(raw, "20260923120000_dynamic_public_team_directory_r1");
  await applyMigration(raw, "20260928090000_ops_r3_1");
  await applyMigration(raw, "20260929090000_ops_r3_1_1");
  raw.close();

  const verifier = new PrismaClient({ adapter: new PrismaLibSql({ url }) });
  const service = await import("../src/lib/referee-service");
  const capabilities = await import("./security-r4a-test-capabilities");
  const r1 = await import("../src/lib/referee-r1-service");
  const publicQueries = await import("../src/lib/referee-public");
  const credentials = await import("../src/lib/referee-credentials");
  const security = await import("../src/lib/referee-security");
  const { prisma } = await import("../src/lib/prisma");

  try {
    const legacyReferee = await verifier.referee.findUniqueOrThrow({
      where: { id: "legacy-referee" },
      include: { capabilities: true },
    });
    const legacyMatch = await verifier.match.findUniqueOrThrow({ where: { id: "legacy-match" } });
    const legacyAppointment = await verifier.refereeAppointment.findUniqueOrThrow({
      where: { id: "legacy-appointment" },
      include: { positions: true, versions: true },
    });
    assert(legacyReferee.id === "legacy-referee", "增量 migration 改变了既有裁判 ID。");
    assert(legacyMatch.id === "legacy-match", "增量 migration 改变了既有比赛 ID。");
    assert(legacyMatch.matchNumber === null, "增量 migration 不得推测历史比赛场序。");
    assert(legacyAppointment.id === "legacy-appointment", "增量 migration 改变了既有选派 ID。");
    assert(
      legacyAppointment.positions.some((item) => item.id === "legacy-position") &&
        legacyAppointment.versions.some((item) => item.id === "legacy-version"),
      "增量 migration 丢失了既有岗位或选派版本。",
    );
    assert(
      await verifier.adminSession.count({ where: { id: "legacy-admin-session" } }) === 1 &&
        await verifier.refereeSession.count({ where: { id: "legacy-referee-session" } }) === 1,
      "增量 migration 无故失效了既有会话。",
    );
    assert(
      legacyReferee.capabilities.length === 5,
      "既有十一人制能力未回填至规范化岗位能力表。",
    );
    assert(
      legacyReferee.trainingStatus === "PENDING_ASSESSMENT" &&
        legacyReferee.assignmentEligibility === "ELIGIBLE",
      "R1-3A migration 未按规则映射既有 ACTIVE 裁判员状态。",
    );
    assert(legacyMatch.source === "MANUAL", "既有比赛未按 MANUAL 回填来源。");
    const confirmedMappings = await verifier.collegeCodeMapping.findMany({
      include: { college: true },
    });
    const civilMapping = confirmedMappings.find((item) => item.prefix === "07");
    assert(
      confirmedMappings.length === 24 && civilMapping?.college.name === "民航学院",
      "Fix #3 权威学号映射未完整初始化。",
    );

    const adminPassword = "R1-Test-Super-Password-2026";
    const superAccount = await verifier.adminAccount.create({
      data: {
        username: "r1-super",
        displayName: "R1 最高管理员",
        passwordHash: await security.hashPassword(adminPassword),
        role: "SUPER_ADMIN",
      },
    });
    assert(
      (await credentials.authenticateAdminCredentials("r1-super", adminPassword))?.id === superAccount.id,
      "持久化管理员账号认证失败。",
    );
    const superActor = { id: superAccount.id, role: "SUPER_ADMIN" as const };
    const systemAuthorization = capabilities.issueTestAdminServiceAuthorization(
      "system:write",
      capabilities.testUnifiedAdminActor({ id: superAccount.id }),
    );
    const refereeAuthorization = capabilities.issueTestAdminServiceAuthorization(
      "referees:write",
      capabilities.testUnifiedAdminActor({ id: superAccount.id }),
    );
    const managerAccount = await r1.createAdminAccount({
      username: "r1-manager",
      displayName: "R1 裁判管理员",
      password: "R1-Test-Manager-Password-2026",
      role: "REFEREE_MANAGER",
    }, systemAuthorization);
    const managerCurrentSession = await verifier.adminSession.create({
      data: {
        adminAccountId: managerAccount.id,
        tokenHash: "r1-manager-current-session",
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      },
    });
    await verifier.adminSession.create({
      data: {
        adminAccountId: managerAccount.id,
        tokenHash: "r1-manager-other-session",
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      },
    });
    let managerPermissionBlocked = false;
    try {
      await r1.createAdminAccount({
        username: "forbidden-admin",
        displayName: "不应创建",
        password: "R1-Test-Forbidden-Password-2026",
        role: "REFEREE_MANAGER",
      }, capabilities.issueTestAdminServiceAuthorization(
        "system:write",
        capabilities.testUnifiedAdminActor({ id: managerAccount.id, roles: ["REFEREE_ADMIN"] }),
      ));
    } catch (error) {
      managerPermissionBlocked =
        error instanceof service.RefereeServiceError && error.status === 403;
    }
    assert(managerPermissionBlocked, "REFEREE_MANAGER 越权创建了管理员账号。");
    const managerPasswordAuthorization = capabilities.issueTestAdminServiceAuthorization(
      "dashboard:read",
      capabilities.testUnifiedAdminActor({ id: managerAccount.id, roles: ["REFEREE_ADMIN"] }),
    );
    await r1.changeAdminPassword({
      adminAccountId: managerAccount.id,
      currentSessionId: managerCurrentSession.id,
      currentPassword: "R1-Test-Manager-Password-2026",
      newPassword: "R1-Test-Manager-New-Password-2026",
    }, managerPasswordAuthorization);
    assert(
      (await credentials.authenticateAdminCredentials(
        "r1-manager",
        "R1-Test-Manager-New-Password-2026",
      ))?.id === managerAccount.id &&
        !(await credentials.authenticateAdminCredentials(
          "r1-manager",
          "R1-Test-Manager-Password-2026",
        )) &&
        await verifier.adminSession.count({ where: { adminAccountId: managerAccount.id } }) === 1,
      "管理员改密或其他会话失效逻辑不正确。",
    );

    const college = civilMapping.college;
    await verifier.referee.update({
      where: { id: legacyReferee.id },
      data: {
        studentId: "0700000000",
        collegeId: college.id,
        phone: "13800000000",
        qq: "123456789",
        internalNote: "内部敏感备注",
      },
    });
    const suggestion = await r1.inferCollegeSuggestion("0700000000");
    assert(suggestion?.college.id === college.id, "学号 07 前缀未返回民航学院建议。");
    assert(await r1.inferCollegeSuggestion("9900000000") === null, "未确认学号前缀被自行推断。");
    await r1.setTeamAffiliations("legacy-home", [college.id], superActor);

    const kickoff = legacyMatch.kickoff;
    const targetEnd = new Date(kickoff.getTime() + 120 * 60_000);
    await verifier.match.update({ where: { id: legacyMatch.id }, data: { endAt: targetEnd } });
    await r1.saveRefereeAvailability({
      refereeId: legacyReferee.id,
      startAt: new Date(kickoff.getTime() + 30 * 60_000),
      endAt: new Date(kickoff.getTime() + 60 * 60_000),
      kind: "UNAVAILABLE",
      note: "课程冲突",
      actor: { type: "REFEREE", id: legacyReferee.id },
    });

    const overlapMatch = await service.createMatch({
      slug: "r1-overlap-match",
      competitionId: "legacy-competition",
      stage: "重叠验证",
      kickoff: new Date(kickoff.getTime() + 60 * 60_000),
      endAt: new Date(kickoff.getTime() + 180 * 60_000),
      venue: "重叠测试场地",
      homeTeamId: "legacy-home",
      awayTeamId: "legacy-away",
      status: "SCHEDULED",
      applicationWindowStatus: "CLOSED",
      positionCounts: { REFEREE: 1 },
    });
    await verifier.refereeAppointment.create({
      data: {
        matchId: overlapMatch.id,
        status: "PUBLISHED",
        publishedAt: new Date(),
        revision: 1,
        positions: {
          create: {
            key: "REFEREE",
            label: "裁判员",
            sortOrder: 10,
            slot: 1,
            refereeId: legacyReferee.id,
          },
        },
      },
    });

    const firstAcknowledgement = await r1.acknowledgeAppointment(
      legacyAppointment.id,
      legacyReferee.id,
    );
    assert(firstAcknowledgement.versionId === "legacy-version", "首次确认未绑定既有发布版本。");
    await service.withdrawAppointment(legacyMatch.id, "R1 自动化改派", refereeAuthorization);

    let hardConflictBlocked = false;
    let hardWarnings: Array<{ code: string; severity: string }> = [];
    try {
      await service.saveAppointmentDraft({
        matchId: legacyMatch.id,
        publicationNote: "R1 警告验证",
        changeReason: "R1 自动化改派",
        overrideReason: "硬冲突不应被此原因覆盖",
        positions: [{ key: "REFEREE", slot: 1, refereeId: legacyReferee.id }],
      }, refereeAuthorization);
    } catch (error) {
      if (error instanceof service.RefereeServiceError && error.status === 409) {
        hardConflictBlocked = true;
        hardWarnings = error.warnings.map((warning) => ({
          code: warning.code,
          severity: warning.severity,
        }));
      }
    }
    assert(hardConflictBlocked, "硬冲突被覆盖原因绕过。 ");
    for (const code of ["COLLEGE_CONFLICT", "UNAVAILABLE", "MATCH_OVERLAP"]) {
      assert(hardWarnings.some((warning) => warning.code === code), `冲突检测未返回 ${code}。`);
    }
    for (const code of ["UNAVAILABLE", "MATCH_OVERLAP"]) {
      assert(
        hardWarnings.some((warning) => warning.code === code && warning.severity === "HARD"),
        `${code} 未被标记为不可覆盖的硬冲突。`,
      );
    }

    await verifier.refereeAvailability.deleteMany({ where: { refereeId: legacyReferee.id } });
    await verifier.refereeAppointment.update({
      where: { matchId: overlapMatch.id },
      data: { status: "CANCELLED" },
    });

    let overrideReasonRequired = false;
    try {
      await service.saveAppointmentDraft({
        matchId: legacyMatch.id,
        publicationNote: "R1 警告验证",
        changeReason: "R1 自动化改派",
        positions: [{ key: "REFEREE", slot: 1, refereeId: legacyReferee.id }],
      }, refereeAuthorization);
    } catch (error) {
      overrideReasonRequired =
        error instanceof service.RefereeServiceError &&
        error.status === 409 &&
        error.warnings.some(
          (warning) => warning.code === "COLLEGE_CONFLICT" && warning.severity === "OVERRIDABLE",
        );
    }
    assert(overrideReasonRequired, "组织冲突未强制要求填写覆盖原因。");

    const draftResult = await service.saveAppointmentDraft({
      matchId: legacyMatch.id,
      publicationNote: "R1 警告验证",
      changeReason: "R1 自动化改派",
      overrideReason: "经核实由管理员批准覆盖",
      positions: [{ key: "REFEREE", slot: 1, refereeId: legacyReferee.id }],
    }, refereeAuthorization);
    assert(
      draftResult.warnings.some(
        (warning) => warning.code === "COLLEGE_CONFLICT" && warning.severity === "OVERRIDABLE",
      ),
      "覆盖保存后未返回结构化组织冲突警告供界面展示。",
    );

    let publishOverrideRequired = false;
    try {
      await service.publishAppointment(legacyMatch.id, "R1 重新发布", "", refereeAuthorization);
    } catch (error) {
      publishOverrideRequired =
        error instanceof service.RefereeServiceError && error.status === 409;
    }
    assert(publishOverrideRequired, "发布时未重新检查冲突并要求覆盖原因。");
    const republished = await service.publishAppointment(
      legacyMatch.id,
      "R1 重新发布",
      "经核实由管理员批准覆盖",
      refereeAuthorization,
    );
    assert(republished.version.revision === 3, "重新发布未生成新的发布版本。");
    assert(
      await verifier.appointmentAcknowledgement.count({
        where: { versionId: republished.version.id, refereeId: legacyReferee.id },
      }) === 0 &&
        await verifier.appointmentAcknowledgement.count({
          where: { versionId: "legacy-version", refereeId: legacyReferee.id },
        }) === 1,
      "旧版本确认被错误继承到重新发布的新版本。",
    );

    const currentAcknowledgement = await r1.acknowledgeAppointment(
      legacyAppointment.id,
      legacyReferee.id,
    );
    assert(currentAcknowledgement.versionId === republished.version.id, "新确认未绑定最新发布版本。");
    const report = await r1.reportAppointmentConflict(
      legacyAppointment.id,
      legacyReferee.id,
      "与课程时间冲突",
    );
    assert(report.versionId === republished.version.id && report.status === "PENDING", "冲突报告未绑定最新发布版本。");
    const resolved = await r1.resolveAppointmentConflictReport(
      report.id,
      "RESOLVED",
      "已与裁判员确认替代安排",
      { id: managerAccount.id, role: "REFEREE_MANAGER" },
    );
    assert(
      resolved.status === "RESOLVED" && resolved.resolvedByAdminId === managerAccount.id,
      "管理员未能处理冲突报告或处理人未记录。",
    );

    await verifier.match.update({ where: { id: legacyMatch.id }, data: { status: "COMPLETED", homeScore: 0, awayScore: 0 } });
    await service.completeAppointment(legacyMatch.id, "比赛已完成", refereeAuthorization);
    const history = await publicQueries.getPublicHistoricalAppointments(new Date("2026-08-19T00:00:00.000Z"));
    const historicalAppointment = history.find((item) => item.id === legacyAppointment.id);
    assert(historicalAppointment, "COMPLETED 选派从公开历史查询中消失。");
    const publicReferee = historicalAppointment.positions[0]?.referee;
    assert(
      publicReferee && Object.keys(publicReferee).sort().join(",") === "id,name",
      "公开选派没有使用显式 public DTO。",
    );
    const serializedPublicResult = JSON.stringify(historicalAppointment);
    for (const secret of ["0700000000", "13800000000", "123456789", "内部敏感备注"]) {
      assert(!serializedPublicResult.includes(secret), "公开 DTO 泄露了裁判员敏感字段值。");
    }

    const statistics = await r1.getCompletedRefereeStatistics();
    const refereeStatistics = statistics.find((item) => item.refereeId === legacyReferee.id);
    assert(
      refereeStatistics?.totalMatches === 1 && refereeStatistics.positions.REFEREE === 1,
      "执裁统计没有只按 COMPLETED 真实选派动态计算。",
    );
    const completedVersion = await verifier.appointmentVersion.findFirstOrThrow({
      where: { appointmentId: legacyAppointment.id, status: "COMPLETED" },
    });
    assert(completedVersion.createdByAdminId === superAccount.id, "选派版本未记录具体管理员操作者。");
    const overrideAudit = await verifier.auditLog.findFirst({
      where: { action: "APPOINTMENT_REPUBLISHED", actorId: superAccount.id },
      orderBy: { createdAt: "desc" },
    });
    assert(
      overrideAudit?.metadata?.includes("经核实由管理员批准覆盖"),
      "冲突覆盖原因未进入 AuditLog。",
    );

    console.log(JSON.stringify({
      additiveMigrationPreservedIdsAndHistory: true,
      legacySessionsPreserved: true,
      normalizedCapabilitiesBackfilled: true,
      authoritativeCollegeMappingsSeeded: true,
      persistentAdminAuthentication: true,
      adminRoleAuthorization: true,
      adminPasswordChangeInvalidatesOtherSessions: true,
      collegeConflictWarning: true,
      unavailableHardConflict: true,
      matchOverlapHardConflict: true,
      hardConflictCannotBeOverridden: true,
      overrideReasonRequiredAndAudited: true,
      acknowledgementBoundToVersion: true,
      republishInvalidatesOldAcknowledgement: true,
      conflictReportLifecycle: true,
      completedHistoryVisible: true,
      completedStatistics: true,
      publicDtoDoesNotLeakSensitiveData: true,
    }, null, 2));
  } finally {
    await verifier.$disconnect();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : "Referee R1 test failed.");
  process.exit(1);
});
