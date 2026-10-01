import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@libsql/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import type {
  AppointmentPositionKey,
  AssignmentEligibility,
  PositionCapabilityStatus,
  RefereeStatus,
  TrainingStatus,
  UnifiedAdminRole,
} from "../src/generated/prisma-v29/client";
import { PrismaClient } from "../src/generated/prisma-v29/client";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function applyMigrations(url: string) {
  const client = createClient({ url });
  const entries = await readdir(path.resolve("prisma/migrations"), { withFileTypes: true });
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const sql = await readFile(path.resolve("prisma/migrations", entry.name, "migration.sql"), "utf8");
    await client.executeMultiple(sql);
  }
  client.close();
}

async function main() {
  const databasePath = process.env.REFEREE_R1_3A_TEST_DATABASE_PATH;
  if (!databasePath) throw new Error("REFEREE_R1_3A_TEST_DATABASE_PATH is required.");
  const url = `file:${databasePath.replaceAll("\\", "/")}`;
  process.env.DATABASE_URL = url;
  process.env.REFEREE_ADMIN_SESSION_SECRET = randomBytes(32).toString("base64url");
  process.env.REFEREE_MEMBER_SESSION_SECRET = randomBytes(32).toString("base64url");
  process.env.NUAAFA_ISOLATED_SECURITY_TEST = "1";
  await applyMigrations(url);

  const verifier = new PrismaClient({ adapter: new PrismaLibSql({ url }) });
  const admission = await import("../src/lib/referee-admission-service");
  const credentials = await import("../src/lib/referee-credentials");
  const r1 = await import("../src/lib/referee-r1-service");
  const security = await import("../src/lib/referee-security");
  const service = await import("../src/lib/referee-service");
  const capabilities = await import("./security-r4a-test-capabilities");
  const { prisma } = await import("../src/lib/prisma");

  type Actor = {
    id: string;
    displayName: string;
    isLegacy: false;
    roles: UnifiedAdminRole[];
  };

  const expectServiceError = async (
    action: () => Promise<unknown>,
    message: string,
    expectedStatus?: number,
  ) => {
    let caught: unknown;
    try {
      await action();
    } catch (error) {
      caught = error;
    }
    assert(caught instanceof Error, message);
    if (expectedStatus !== undefined) {
      assert(
        caught instanceof service.RefereeServiceError && caught.status === expectedStatus,
        `${message}（状态码不正确）`,
      );
    }
    return caught;
  };

  try {
    const createActor = async (username: string, displayName: string, roles: UnifiedAdminRole[]) => {
      const account = await verifier.adminAccount.create({
        data: {
          username,
          displayName,
          passwordHash: await security.hashPassword(`R1-3A-${username}-Password-2026`),
          role: roles.includes("SUPER_ADMIN") ? "SUPER_ADMIN" : "REFEREE_MANAGER",
          unifiedRoles: { create: roles.map((role) => ({ role })) },
        },
      });
      return { id: account.id, displayName, isLegacy: false as const, roles } satisfies Actor;
    };
    const superActor = await createActor("r13a-super", "R1-3A 超级管理员", ["SUPER_ADMIN"]);
    const refereeActor = await createActor("r13a-referee", "R1-3A 裁判管理员", ["REFEREE_ADMIN"]);
    const contentActor = await createActor("r13a-content", "R1-3A 内容管理员", ["CONTENT_EDITOR"]);
    const competitionActor = await createActor("r13a-competition", "R1-3A 赛事管理员", ["COMPETITION_ADMIN"]);
    const superRefereeAuthorization = capabilities.issueTestAdminServiceAuthorization(
      "referees:write",
      superActor,
    );
    const refereeAuthorization = capabilities.issueTestAdminServiceAuthorization(
      "referees:write",
      refereeActor,
    );

    const lookalike = await service.createRefereeAccount({
      publicCode: "R13A-LOOKALIKE",
      name: "同名申请人",
      initialPassword: "Lookalike-Initial-Password-2026",
      status: "INACTIVE",
      trainingStatus: "QUALIFIED",
      assignmentEligibility: "ELIGIBLE",
      elevenASide: false,
      futsal: false,
      phone: "13800000010",
      publicDirectoryEnabled: false,
    }, superRefereeAuthorization);

    const admissionCountBefore = await verifier.refereeAdmissionApplication.count();
    const refereeCountBefore = await verifier.referee.count();
    const pending = await admission.submitRefereeAdmissionApplication({
      name: "同名申请人",
      studentId: "16260001",
      phone: "13800000010",
      qq: "12345678",
      note: "希望参加裁判培养",
    });
    assert(pending.status === "PENDING", "合法 Admission 未进入 PENDING。");
    assert(
      await verifier.referee.count() === refereeCountBefore &&
        await verifier.refereeAdmissionApplication.count() === admissionCountBefore + 1,
      "Admission 提交错误创建了 Referee 或未创建独立申请。",
    );
    assert((await admission.listRefereeAdmissionApplications("PENDING", refereeActor)).length === 1, "REFEREE_ADMIN 无法查看 Admission。");
    assert((await admission.listRefereeAdmissionApplications("PENDING", superActor)).length === 1, "SUPER_ADMIN 无法查看 Admission。");
    for (const actor of [contentActor, competitionActor]) {
      const error = await expectServiceError(
        () => admission.listRefereeAdmissionApplications("PENDING", actor),
        `${actor.roles[0]} 越权查看了 Admission。`,
      );
      assert("status" in error && error.status === 403, `${actor.roles[0]} 未返回 403。`);
    }

    const rejectedInput = await admission.submitRefereeAdmissionApplication({
      name: "应拒绝申请人",
      studentId: "16260002",
      phone: "13800000011",
    });
    const rejectedRefereeCount = await verifier.referee.count();
    const rejected = await admission.reviewRefereeAdmissionApplication(rejectedInput.id, {
      action: "REJECT",
      reviewNote: "资料暂不符合准入要求",
    }, refereeActor);
    assert(
      rejected.status === "REJECTED" &&
        rejected.reviewedByAdmin?.id === refereeActor.id &&
        Boolean(rejected.reviewedAt) &&
        rejected.reviewNote === "资料暂不符合准入要求" &&
        await verifier.referee.count() === rejectedRefereeCount,
      "Admission REJECT 状态、追踪或 no-create 行为不正确。",
    );
    assert(
      await verifier.auditLog.count({
        where: { action: "REFEREE_ADMISSION_REJECTED", entityId: rejectedInput.id, actorId: refereeActor.id },
      }) === 1,
      "Admission REJECT 未记录 AuditLog。",
    );
    await expectServiceError(
      () => admission.reviewRefereeAdmissionApplication(rejectedInput.id, {
        action: "REJECT",
        reviewNote: "重复拒绝",
      }, superActor),
      "重复审核未被拒绝。",
      409,
    );

    const approved = await admission.reviewRefereeAdmissionApplication(pending.id, {
      action: "APPROVE",
      reviewNote: "资料完整，准入培养",
      mode: "CREATE_NEW",
    }, refereeActor);
    assert(approved.onboarding, "Admission APPROVE 未返回一次性 onboarding 结果。");
    const initialPassword = approved.onboarding.temporaryPassword;
    const approvedReferee = await verifier.referee.findUniqueOrThrow({
      where: { id: approved.referee?.id },
      include: { capabilities: true },
    });
    assert(approved.referee?.id !== lookalike.id, "Admission approval 对同名或同电话账号进行了模糊关联。");
    assert(
      approved.status === "APPROVED" &&
        approved.referee?.id === approvedReferee.id &&
        approved.reviewedByAdmin?.id === refereeActor.id &&
        approvedReferee.status === "ACTIVE" &&
        approvedReferee.trainingStatus === "IN_TRAINING" &&
        approvedReferee.assignmentEligibility === "ELIGIBLE" &&
        approvedReferee.mustChangePassword &&
        approvedReferee.capabilities.length === 10 &&
        approvedReferee.publicDirectoryEnabled,
      "Admission APPROVE 默认状态或 application-referee trace 不正确。",
    );
    assert(
      (await credentials.authenticateRefereeCredentials("16260001", initialPassword))?.id === approvedReferee.id,
      "批准后的裁判员不能进入首次登录流程。",
    );
    const approvalAudits = await verifier.auditLog.findMany({
      where: { OR: [{ entityId: pending.id }, { entityId: approvedReferee.id }] },
    });
    const serializedApprovalAudits = JSON.stringify(approvalAudits);
    assert(
      approvalAudits.some((item) => item.action === "REFEREE_ADMISSION_APPROVED") &&
        approvalAudits.some((item) => item.action === "REFEREE_ACCOUNT_CREATED") &&
        !serializedApprovalAudits.includes(initialPassword) &&
        approvedReferee.passwordHash !== initialPassword,
      "审批 AuditLog 不完整或泄露初始密码明文。",
    );
    await expectServiceError(
      () => admission.reviewRefereeAdmissionApplication(pending.id, {
        action: "APPROVE",
        reviewNote: "重复通过",
        mode: "CREATE_NEW",
        publicCode: "R13A-DUPLICATE",
        initialPassword,
      }, superActor),
      "重复 approve 未被拒绝。",
      409,
    );

    const linkTarget = await service.createRefereeAccount({
      publicCode: "R13A-LINK-TARGET",
      name: "待明确关联账号",
      initialPassword: "Link-Target-Old-Password-2026",
      status: "INACTIVE",
      trainingStatus: "QUALIFIED",
      assignmentEligibility: "SUSPENDED",
      elevenASide: true,
      futsal: false,
      publicDirectoryEnabled: false,
    }, superRefereeAuthorization);
    const linkAdmission = await admission.submitRefereeAdmissionApplication({
      name: "明确关联申请人",
      studentId: "16260003",
      phone: "13800000012",
    });
    const linked = await admission.reviewRefereeAdmissionApplication(linkAdmission.id, {
      action: "APPROVE",
      reviewNote: "管理员按 ID 确认既有账号",
      mode: "LINK_EXISTING",
      existingRefereeId: linkTarget.id,
      initialPassword: "legacy-input-is-ignored",
    }, superActor);
    const linkedReferee = await verifier.referee.findUniqueOrThrow({ where: { id: linkTarget.id } });
    assert(
      linked.referee?.id === linkTarget.id &&
        linkedReferee.status === "ACTIVE" &&
        linkedReferee.trainingStatus === "QUALIFIED" &&
        linkedReferee.assignmentEligibility === "SUSPENDED" &&
        linkedReferee.mustChangePassword,
      "明确关联既有账号时未保留独立培养/资格状态或未重新启用账号。",
    );

    const changedPassword = "R1-3A-New-Referee-Changed-2026";
    await service.changeRefereePassword(
      approvedReferee.id,
      initialPassword,
      changedPassword,
      capabilities.issueTestRefereeSelfServiceAuthorization(approvedReferee.id),
    );
    const changedReferee = await verifier.referee.findUniqueOrThrow({ where: { id: approvedReferee.id } });
    assert(
      !changedReferee.mustChangePassword &&
        !(await credentials.authenticateRefereeCredentials("16260001", initialPassword)) &&
        (await credentials.authenticateRefereeCredentials("16260001", changedPassword))?.id === approvedReferee.id,
      "首次密码修改未清除标记或未更新登录凭据。",
    );
    const availability = await r1.saveRefereeAvailability({
      refereeId: approvedReferee.id,
      startAt: new Date("2027-01-01T02:00:00.000Z"),
      endAt: new Date("2027-01-01T04:00:00.000Z"),
      kind: "AVAILABLE",
      note: "工作区自助维护测试",
      actor: { type: "REFEREE", id: approvedReferee.id },
    });
    assert(Boolean(availability.id), "NOT_ELIGIBLE 新账号完成改密后不能维护 availability。");

    const updateAccount = async (overrides: {
      status?: RefereeStatus;
      trainingStatus?: TrainingStatus;
      assignmentEligibility?: AssignmentEligibility;
      eligibilityReason?: string;
      capabilities?: Array<{
        format: "ELEVEN_A_SIDE" | "FUTSAL";
        positionKey: AppointmentPositionKey;
        status: PositionCapabilityStatus;
      }>;
    }) => {
      const current = await verifier.referee.findUniqueOrThrow({
        where: { id: approvedReferee.id },
        include: { capabilities: true },
      });
      return service.updateRefereeAccount(approvedReferee.id, {
        publicCode: current.publicCode,
        name: current.name,
        status: overrides.status ?? current.status,
        assignmentEligibility: overrides.assignmentEligibility ?? current.assignmentEligibility,
        eligibilityReason: overrides.eligibilityReason,
        elevenASide: current.elevenASide,
        futsal: current.futsal,
        trainingStatus: overrides.trainingStatus ?? current.trainingStatus,
        publicDirectoryEnabled: current.publicDirectoryEnabled,
        capabilities: overrides.capabilities ?? current.capabilities.map(({ format, positionKey, status }) => ({
          format,
          positionKey,
          status,
        })),
      }, refereeAuthorization);
    };

    await updateAccount({
      assignmentEligibility: "ELIGIBLE",
      capabilities: [{ format: "ELEVEN_A_SIDE", positionKey: "REFEREE", status: "READY" }],
    });
    const manuallyMatured = await verifier.referee.findUniqueOrThrow({ where: { id: approvedReferee.id } });
    assert(
      manuallyMatured.trainingStatus === "IN_TRAINING" &&
        manuallyMatured.assignmentEligibility === "ELIGIBLE",
      "管理员不能独立于 trainingStatus 将成熟裁判设置为 ELIGIBLE。",
    );
    await expectServiceError(
      () => updateAccount({ assignmentEligibility: "SUSPENDED" }),
      "无原因暂停资格未被拒绝。",
      400,
    );
    await updateAccount({ assignmentEligibility: "SUSPENDED", eligibilityReason: "纪律核查中" });
    await expectServiceError(
      () => updateAccount({ assignmentEligibility: "ELIGIBLE" }),
      "无原因恢复资格未被拒绝。",
      400,
    );
    await updateAccount({ assignmentEligibility: "ELIGIBLE", eligibilityReason: "核查完成" });
    assert(
      await verifier.auditLog.count({
        where: { action: "REFEREE_ASSIGNMENT_ELIGIBILITY_CHANGED", entityId: approvedReferee.id },
      }) >= 2,
      "资格暂停或恢复未完整写入 AuditLog。",
    );

    const competition = await verifier.competition.create({
      data: {
        slug: "r1-3a-eleven",
        name: "R1-3A 十一人制测试赛事",
        campus: "天目湖校区",
        format: "ELEVEN_A_SIDE",
        status: "ONGOING",
        isTestData: true,
        teams: { create: [{ name: "R1-3A 主队" }, { name: "R1-3A 客队" }] },
      },
      include: { teams: true },
    });
    const futsalCompetition = await verifier.competition.create({
      data: {
        slug: "r1-3a-futsal",
        name: "R1-3A 五人制测试赛事",
        campus: "天目湖校区",
        format: "FUTSAL",
        status: "ONGOING",
        isTestData: true,
        teams: { create: [{ name: "R1-3A 五人制主队" }, { name: "R1-3A 五人制客队" }] },
      },
      include: { teams: true },
    });
    let matchSequence = 0;
    const createMatch = async (options: {
      format?: "ELEVEN_A_SIDE" | "FUTSAL";
      open?: boolean;
      kickoff?: Date;
    } = {}) => {
      matchSequence += 1;
      const targetCompetition = options.format === "FUTSAL" ? futsalCompetition : competition;
      const kickoff = options.kickoff ?? new Date(Date.UTC(2027, 1, matchSequence + 1, 10));
      return service.createMatch({
        slug: `r1-3a-match-${matchSequence}`,
        competitionId: targetCompetition.id,
        stage: `R1-3A 场次 ${matchSequence}`,
        kickoff,
        endAt: new Date(kickoff!.getTime() + 120 * 60_000),
        venue: `R1-3A 场地 ${matchSequence}`,
        homeTeamId: targetCompetition.teams[0].id,
        awayTeamId: targetCompetition.teams[1].id,
        status: "SCHEDULED",
        applicationWindowStatus: options.open === false ? "CLOSED" : "OPEN",
        applicationDeadline: options.open === false ? undefined : new Date(kickoff!.getTime() - 24 * 60 * 60_000),
        positionCounts: { REFEREE: 1 },
      }, { id: refereeActor.id, role: "REFEREE_MANAGER" });
    };
    const setRefereeState = async (data: {
      status?: RefereeStatus;
      assignmentEligibility?: AssignmentEligibility;
      mustChangePassword?: boolean;
    }) => verifier.referee.update({ where: { id: approvedReferee.id }, data });
    const setCapabilities = async (capabilities: Array<{
      format: "ELEVEN_A_SIDE" | "FUTSAL";
      positionKey: AppointmentPositionKey;
      status: PositionCapabilityStatus;
    }>) => {
      await verifier.refereePositionCapability.deleteMany({ where: { refereeId: approvedReferee.id } });
      if (capabilities.length) {
        await verifier.refereePositionCapability.createMany({
          data: capabilities.map((item) => ({ refereeId: approvedReferee.id, ...item })),
        });
      }
    };
    const readyEleven = () => setCapabilities([
      { format: "ELEVEN_A_SIDE", positionKey: "REFEREE", status: "READY" },
    ]);
    const normalizedEligible = async () => {
      await setRefereeState({ status: "ACTIVE", assignmentEligibility: "ELIGIBLE", mustChangePassword: false });
      await readyEleven();
    };

    await normalizedEligible();
    const readyApplicationMatch = await createMatch();
    const readyApplication = await service.createRefereeApplication({
      matchId: readyApplicationMatch.id,
      refereeId: approvedReferee.id,
      preferredPositions: ["REFEREE"],
    });
    assert(readyApplication.status === "PENDING", "ACTIVE + ELIGIBLE + READY 未能报名。 ");

    const assertApplicationBlocked = async (
      prepare: () => Promise<unknown>,
      positions: AppointmentPositionKey[],
      format: "ELEVEN_A_SIDE" | "FUTSAL" = "ELEVEN_A_SIDE",
    ) => {
      await normalizedEligible();
      await prepare();
      const match = await createMatch({ format });
      await expectServiceError(
        () => service.createRefereeApplication({ matchId: match.id, refereeId: approvedReferee.id, preferredPositions: positions }),
        `报名 hard gate 未拒绝 ${format}/${positions.join(",")}。`,
      );
    };
    await assertApplicationBlocked(
      () => setRefereeState({ assignmentEligibility: "NOT_ELIGIBLE" }),
      ["REFEREE"],
    );
    await assertApplicationBlocked(
      () => setRefereeState({ assignmentEligibility: "SUSPENDED" }),
      ["REFEREE"],
    );
    await assertApplicationBlocked(
      () => setRefereeState({ status: "INACTIVE" }),
      ["REFEREE"],
    );
    await assertApplicationBlocked(
      () => setRefereeState({ mustChangePassword: true }),
      ["REFEREE"],
    );
    await assertApplicationBlocked(async () => undefined, ["REFEREE"], "FUTSAL");
    await normalizedEligible();
    await setCapabilities([{ format: "ELEVEN_A_SIDE", positionKey: "REFEREE", status: "TRAINING" }]);
    const trainingApplicationMatch = await createMatch();
    assert((await service.createRefereeApplication({ matchId: trainingApplicationMatch.id, refereeId: approvedReferee.id, preferredPositions: ["REFEREE"] })).status === "PENDING", "TRAINING 岗位未能报名。");
    await assertApplicationBlocked(
      () => setCapabilities([{ format: "ELEVEN_A_SIDE", positionKey: "REFEREE", status: "NOT_ASSIGNED" }]),
      ["REFEREE"],
    );
    await assertApplicationBlocked(async () => undefined, ["ASSISTANT_REFEREE_1"]);

    for (const eligibility of ["NOT_ELIGIBLE", "SUSPENDED"] as const) {
      await normalizedEligible();
      await setRefereeState({ assignmentEligibility: eligibility });
      const closed = await createMatch({ open: false });
      await expectServiceError(
        () => service.createAdminApplicationException({
          matchId: closed.id,
          refereeId: approvedReferee.id,
          preferredPositions: ["REFEREE"],
          exceptionReason: "测试管理员例外边界",
        }, { id: refereeActor.id, role: "REFEREE_MANAGER" }),
        `管理员例外绕过了 ${eligibility} hard gate。`,
      );
    }
    await normalizedEligible();
    const closed = await createMatch({ open: false });
    const exceptionApplication = await service.createAdminApplicationException({
      matchId: closed.id,
      refereeId: approvedReferee.id,
      preferredPositions: ["REFEREE"],
      exceptionReason: "报名窗口已关闭但资格有效",
    }, { id: refereeActor.id, role: "REFEREE_MANAGER" });
    assert(exceptionApplication.status === "REVIEWING", "管理员例外未能仅绕过报名窗口。 ");

    const saveDraft = (matchId: string, overrideReason = "") => service.saveAppointmentDraft({
      matchId,
      publicationNote: "R1-3A 自动化测试",
      overrideReason,
      positions: [{ key: "REFEREE", slot: 1, refereeId: approvedReferee.id }],
    }, refereeAuthorization);
    const assertDraftBlocked = async (prepare: () => Promise<unknown>) => {
      await normalizedEligible();
      await prepare();
      const match = await createMatch({ open: false });
      await expectServiceError(() => saveDraft(match.id), "Appointment draft hard gate 未拒绝无效裁判员。", 409);
    };

    await normalizedEligible();
    const validDraftMatch = await createMatch({ open: false });
    assert((await saveDraft(validDraftMatch.id)).appointment.status === "DRAFT", "ELIGIBLE + READY 无法保存草稿。 ");
    await assertDraftBlocked(() => setRefereeState({ assignmentEligibility: "NOT_ELIGIBLE" }));
    await assertDraftBlocked(() => setRefereeState({ assignmentEligibility: "SUSPENDED" }));
    await assertDraftBlocked(() => setRefereeState({ status: "INACTIVE" }));
    await assertDraftBlocked(() => setCapabilities([]));
    await assertDraftBlocked(() => setCapabilities([
      { format: "ELEVEN_A_SIDE", positionKey: "ASSISTANT_REFEREE_1", status: "READY" },
    ]));
    await normalizedEligible();
    await setCapabilities([{ format: "ELEVEN_A_SIDE", positionKey: "REFEREE", status: "TRAINING" }]);
    const trainingDraftMatch = await createMatch({ open: false });
    assert((await saveDraft(trainingDraftMatch.id)).appointment.status === "DRAFT", "TRAINING 岗位未能进入选派草稿。");

    await normalizedEligible();
    const unavailableMatch = await createMatch({ open: false });
    await r1.saveRefereeAvailability({
      refereeId: approvedReferee.id,
      startAt: unavailableMatch.kickoff!,
      endAt: new Date(unavailableMatch.kickoff!.getTime() + 60 * 60_000),
      kind: "UNAVAILABLE",
      note: "课程冲突",
      actor: { type: "REFEREE", id: approvedReferee.id },
    });
    const unavailableError = await expectServiceError(
      () => saveDraft(unavailableMatch.id, "管理员不能覆盖硬冲突"),
      "UNAVAILABLE 硬冲突被保存。",
      409,
    );
    assert(
      unavailableError instanceof service.RefereeServiceError &&
        unavailableError.warnings.some((warning) => warning.code === "UNAVAILABLE" && warning.severity === "HARD"),
      "UNAVAILABLE 未返回结构化 HARD 警告。",
    );
    await verifier.refereeAvailability.deleteMany({
      where: { refereeId: approvedReferee.id, kind: "UNAVAILABLE" },
    });

    await normalizedEligible();
    const overlapKickoff = new Date("2027-06-01T10:00:00.000Z");
    const publishedSource = await createMatch({ open: false, kickoff: overlapKickoff });
    await saveDraft(publishedSource.id);
    await service.publishAppointment(publishedSource.id, "", "", refereeAuthorization);
    const overlappingTarget = await createMatch({
      open: false,
      kickoff: new Date(overlapKickoff.getTime() + 30 * 60_000),
    });
    const overlapError = await expectServiceError(
      () => saveDraft(overlappingTarget.id, "管理员不能覆盖硬冲突"),
      "MATCH_OVERLAP 硬冲突被保存。",
      409,
    );
    assert(
      overlapError instanceof service.RefereeServiceError &&
        overlapError.warnings.some((warning) => warning.code === "MATCH_OVERLAP" && warning.severity === "HARD"),
      "MATCH_OVERLAP 未返回结构化 HARD 警告。",
    );

    await normalizedEligible();
    const staleEligibilityMatch = await createMatch({ open: false });
    await saveDraft(staleEligibilityMatch.id);
    await setRefereeState({ assignmentEligibility: "SUSPENDED" });
    await expectServiceError(
      () => service.publishAppointment(staleEligibilityMatch.id, "", "", refereeAuthorization),
      "Draft 后 SUSPENDED 未在 publish 时重新拒绝。",
      409,
    );

    await normalizedEligible();
    const staleCapabilityMatch = await createMatch({ open: false });
    await saveDraft(staleCapabilityMatch.id);
    await setCapabilities([{ format: "ELEVEN_A_SIDE", positionKey: "REFEREE", status: "TRAINING" }]);
    assert((await service.publishAppointment(staleCapabilityMatch.id, "", "", refereeAuthorization)).appointment.status === "PUBLISHED", "Draft 后 READY→TRAINING 不应阻断发布。");

    await normalizedEligible();
    const staleAccountMatch = await createMatch({ open: false });
    await saveDraft(staleAccountMatch.id);
    await setRefereeState({ status: "INACTIVE" });
    await expectServiceError(
      () => service.publishAppointment(staleAccountMatch.id, "", "", refereeAuthorization),
      "Draft 后 ACTIVE→INACTIVE 未在 publish 时重新拒绝。",
      409,
    );

    await normalizedEligible();
    await verifier.refereeSession.create({
      data: {
        refereeId: approvedReferee.id,
        tokenHash: "r1-3a-session-to-delete",
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      },
    });
    await updateAccount({ status: "INACTIVE" });
    assert(
      await verifier.refereeSession.count({ where: { refereeId: approvedReferee.id } }) === 0 &&
        await verifier.auditLog.count({
          where: { action: "REFEREE_ACCOUNT_DISABLED", entityId: approvedReferee.id },
        }) === 1,
      "账号停用未使会话失效或未写 AuditLog。",
    );
    assert(
      await verifier.auditLog.count({
        where: { action: "PASSWORD_CHANGED", entityId: approvedReferee.id, actorId: approvedReferee.id },
      }) === 1,
      "首次密码修改未写入裁判员 AuditLog。",
    );

    console.log(JSON.stringify({
      admissionPendingWithoutReferee: true,
      admissionRbac: true,
      admissionRejectAndRepeatConflict: true,
      approvalDefaultsAndTrace: true,
      noFuzzyMatchAndExplicitLink: true,
      initialPasswordNotPersistedInPlaintext: true,
      firstLoginAndPasswordChange: true,
      workspaceAvailabilityBeforeEligibility: true,
      trainingAndEligibilityIndependent: true,
      eligibilityReasonAndAudit: true,
      applicationHardGateMatrix: true,
      adminExceptionCannotBypassEligibility: true,
      appointmentDraftHardGateMatrix: true,
      unavailableAndOverlapHardConflicts: true,
      appointmentPublishStaleStateRevalidation: true,
      accountDisableInvalidatesSessions: true,
      auditLogCoverage: true,
    }, null, 2));
  } finally {
    await verifier.$disconnect();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : "Referee R1-3A worker failed.");
  process.exit(1);
});
