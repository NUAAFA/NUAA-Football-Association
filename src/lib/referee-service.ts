import { assertMatchScheduled, isMatchScheduled, validateMatchSchedule } from "@/lib/match-scheduling";
import { isKnockoutPlaceholder, validMatchNumber } from "@/lib/competition-match-number";
import type {
  AdminRole,
  AssignmentEligibility,
  AppointmentPositionKey,
  AppointmentStatus,
  ApplicationStatus,
  CompetitionFormat,
  DataSource,
  MatchStatus,
  PositionCapabilityStatus,
  Prisma,
  RefereeStatus,
  TrainingStatus,
} from "@/generated/prisma-v29/client";
import { assertMatchStructure } from "@/lib/competition-structure-service";
import { prisma } from "@/lib/prisma";
import {
  requireAdminServiceAuthorization,
  requireRefereeSelfServiceAuthorization,
  type AdminServiceAuthorization,
  type RefereeSelfServiceAuthorization,
} from "@/lib/privileged-service-authorization";
import {
  detectAppointmentWarnings,
  hardAppointmentConflicts,
  warningsRequiringOverride,
} from "@/lib/referee-conflicts";
import {
  assertAppointmentPositionsEligible,
  assertRefereeCanApply,
} from "@/lib/referee-eligibility";
import { getPositionTemplate, hasPositionTemplate } from "@/lib/referee-roles";
import { isRefereeQualification, normalizeRefereeQualification } from "@/lib/referee-qualifications";
import { isRefereeGrade } from "@/lib/referee-profile-options";
import { hashPassword, verifyPassword } from "@/lib/referee-security";
import { RefereeServiceError } from "@/lib/referee-service-error";
import { resolveCompetitionTeamSelection } from "@/lib/referee-team-service";
import type { UnifiedAdminPermission } from "@/lib/unified-admin-rbac";
export { RefereeServiceError } from "@/lib/referee-service-error";

export type AdminActor = {
  id: string | null;
  role: AdminRole;
};

const missingPositionTemplateMessage = "该赛事暂未配置对应的裁判岗位模板。";

function assertPositionTemplateConfigured(format: CompetitionFormat) {
  if (!hasPositionTemplate(format)) {
    throw new RefereeServiceError(missingPositionTemplateMessage, 409);
  }
}

function authorizedAdminActor<P extends UnifiedAdminPermission>(
  authorization: AdminServiceAuthorization<P>,
  permission: P,
): AdminActor {
  const actor = requireAdminServiceAuthorization(authorization, permission);
  return {
    id: actor.id,
    role: actor.roles.includes("SUPER_ADMIN") ? "SUPER_ADMIN" : "REFEREE_MANAGER",
  };
}

type ServiceDb = Prisma.TransactionClient | typeof prisma;

async function writeAudit(input: {
  action: string;
  entityType: string;
  entityId?: string;
  summary: string;
  actorType?: "ADMIN" | "REFEREE" | "SYSTEM";
  actorId?: string;
  metadata?: Record<string, unknown>;
}, db: ServiceDb = prisma) {
  return db.auditLog.create({
    data: {
      actorType: input.actorType ?? "ADMIN",
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      summary: input.summary,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });
}

export type RefereeAccountInput = {
  publicCode: string;
  name: string;
  initialPassword: string;
  status: RefereeStatus;
  assignmentEligibility?: AssignmentEligibility;
  elevenASide: boolean;
  futsal: boolean;
  certificateNote?: string;
  qualificationNote?: string;
  trainingStatus: TrainingStatus;
  publicDirectoryEnabled: boolean;
  publicBio?: string;
  internalNote?: string;
  studentId?: string;
  collegeId?: string;
  grade?: string;
  phone?: string;
  qq?: string;
  refereeLevel?: string;
  joinedAt?: Date;
  affiliationUnitIds?: string[];
  currentAffiliationUnitId?: string;
  capabilities?: Array<{ format: CompetitionFormat; positionKey: AppointmentPositionKey; status?: PositionCapabilityStatus }>;
};

export async function createRefereeAccountInTransaction(
  input: RefereeAccountInput,
  actor: AdminActor | undefined,
  tx: Prisma.TransactionClient,
  auditMetadata?: Record<string, unknown>,
) {
  const passwordHash = await hashPassword(input.initialPassword);
  const capabilities = normalizeCapabilities(input);
  if (input.refereeLevel && !isRefereeQualification(input.refereeLevel)) {
    throw new RefereeServiceError("裁判资质不在允许范围内。");
  }
  if (input.grade && !isRefereeGrade(input.grade)) throw new RefereeServiceError("年级不在允许范围内。");
  const currentAffiliationUnitId = await resolveCurrentAffiliationUnitId(tx, input);
  const referee = await tx.referee.create({
    data: {
      publicCode: input.publicCode,
      name: input.name,
      passwordHash,
      mustChangePassword: true,
      status: input.status,
      assignmentEligibility: input.assignmentEligibility ?? "NOT_ELIGIBLE",
      studentId: input.studentId || null,
      collegeId: input.collegeId || null,
      currentAffiliationUnitId,
      grade: input.grade || null,
      phone: input.phone || null,
      qq: input.qq || null,
      refereeLevel: normalizeRefereeQualification(input.refereeLevel),
      joinedAt: input.joinedAt ?? null,
      elevenASide: capabilities.some((item) => item.format === "ELEVEN_A_SIDE" && item.status !== "NOT_ASSIGNED"),
      futsal: capabilities.some((item) => item.format === "FUTSAL" && item.status !== "NOT_ASSIGNED"),
      certificateNote: input.certificateNote || null,
      qualificationNote: input.qualificationNote || null,
      trainingStatus: input.trainingStatus,
      publicDirectoryEnabled: input.publicDirectoryEnabled,
      publicBio: input.publicBio || null,
      internalNote: input.internalNote || null,
      capabilities: { create: capabilities },
      affiliations: currentAffiliationUnitId ? { create: [{ unitId: currentAffiliationUnitId }] } : undefined,
    },
  });
  await writeAudit({
    action: "REFEREE_ACCOUNT_CREATED",
    entityType: "Referee",
    entityId: referee.id,
    summary: `创建裁判员账号 ${referee.publicCode}`,
    actorId: actor?.id ?? undefined,
    metadata: {
      status: referee.status,
      trainingStatus: referee.trainingStatus,
      assignmentEligibility: referee.assignmentEligibility,
      ...(auditMetadata ?? {}),
    },
  }, tx);
  return referee;
}

export async function createRefereeAccount(
  input: RefereeAccountInput,
  authorization: AdminServiceAuthorization<"referees:write">,
) {
  const actor = authorizedAdminActor(authorization, "referees:write");
  try {
    return await prisma.$transaction((tx) =>
      createRefereeAccountInTransaction(input, actor, tx),
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      throw new RefereeServiceError("裁判员编号已存在。", 409);
    }
    throw error;
  }
}

export async function updateRefereeAccount(
  id: string,
  input: {
    publicCode: string;
    name: string;
    status: RefereeStatus;
    assignmentEligibility: AssignmentEligibility;
    eligibilityReason?: string;
    elevenASide: boolean;
    futsal: boolean;
    certificateNote?: string;
    qualificationNote?: string;
    trainingStatus: TrainingStatus;
    publicDirectoryEnabled: boolean;
    publicBio?: string;
    internalNote?: string;
    studentId?: string;
    collegeId?: string;
    grade?: string;
    phone?: string;
    qq?: string;
    refereeLevel?: string;
    joinedAt?: Date;
    affiliationUnitIds?: string[];
    currentAffiliationUnitId?: string;
    capabilities?: Array<{ format: CompetitionFormat; positionKey: AppointmentPositionKey; status?: PositionCapabilityStatus }>;
  },
  authorization: AdminServiceAuthorization<"referees:write">,
) {
  const actor = authorizedAdminActor(authorization, "referees:write");
  const existing = await prisma.referee.findUnique({ where: { id } });
  if (!existing) throw new RefereeServiceError("裁判员账号不存在。", 404);
  const capabilities = normalizeCapabilities(input);
  if (input.refereeLevel && !isRefereeQualification(input.refereeLevel)) {
    throw new RefereeServiceError("裁判资质不在允许范围内。");
  }
  if (input.grade && !isRefereeGrade(input.grade)) throw new RefereeServiceError("年级不在允许范围内。");
  if (
    existing.assignmentEligibility !== input.assignmentEligibility &&
    (existing.assignmentEligibility === "SUSPENDED" || input.assignmentEligibility === "SUSPENDED") &&
    !input.eligibilityReason?.trim()
  ) {
    throw new RefereeServiceError("暂停或恢复正式选派资格时必须填写原因。");
  }
  let referee;
  try {
    referee = await prisma.$transaction(async (tx) => {
      const currentAffiliationUnitId = await resolveCurrentAffiliationUnitId(
        tx,
        input,
        existing.currentAffiliationUnitId,
      );
      await tx.refereePositionCapability.deleteMany({ where: { refereeId: id } });
      const updated = await tx.referee.update({
        where: { id },
        data: {
          publicCode: input.publicCode,
          name: input.name,
          status: input.status,
          assignmentEligibility: input.assignmentEligibility,
          studentId: input.studentId || null,
          collegeId: input.collegeId || null,
          currentAffiliationUnitId,
          grade: input.grade || null,
          phone: input.phone || null,
          qq: input.qq || null,
          refereeLevel: normalizeRefereeQualification(input.refereeLevel),
          joinedAt: input.joinedAt ?? null,
          elevenASide: capabilities.some((item) => item.format === "ELEVEN_A_SIDE" && item.status !== "NOT_ASSIGNED"),
          futsal: capabilities.some((item) => item.format === "FUTSAL" && item.status !== "NOT_ASSIGNED"),
          certificateNote: input.certificateNote || null,
          qualificationNote: input.qualificationNote || null,
          trainingStatus: input.trainingStatus,
          publicDirectoryEnabled: input.publicDirectoryEnabled,
          publicBio: input.publicBio || null,
          internalNote: input.internalNote || null,
          capabilities: { create: capabilities },
          ...(input.status === "ACTIVE" ? {} : { sessions: { deleteMany: {} } }),
        },
      });
      if (currentAffiliationUnitId) {
        await tx.refereeAffiliation.upsert({
          where: { refereeId_unitId: { refereeId: id, unitId: currentAffiliationUnitId } },
          update: {},
          create: { refereeId: id, unitId: currentAffiliationUnitId },
        });
      }
      await writeAudit({
        action: "REFEREE_ACCOUNT_UPDATED",
        entityType: "Referee",
        entityId: updated.id,
        summary: `更新裁判员账号 ${updated.publicCode}（${updated.status}）`,
        actorId: actor?.id ?? undefined,
      }, tx);
      if (existing.status !== updated.status) {
        const action = updated.status === "INACTIVE"
          ? "REFEREE_ACCOUNT_DISABLED"
          : updated.status === "ARCHIVED"
            ? "REFEREE_ACCOUNT_ARCHIVED"
            : updated.status === "PENDING_ACTIVATION"
              ? "REFEREE_ACCOUNT_PENDING_ACTIVATION"
              : "REFEREE_ACCOUNT_REACTIVATED";
        await writeAudit({
          action,
          entityType: "Referee",
          entityId: updated.id,
          summary: `裁判员账号状态由 ${existing.status} 调整为 ${updated.status}`,
          actorId: actor?.id ?? undefined,
          metadata: { from: existing.status, to: updated.status },
        }, tx);
      }
      if (existing.trainingStatus !== updated.trainingStatus) {
        await writeAudit({
          action: "REFEREE_TRAINING_STATUS_CHANGED",
          entityType: "Referee",
          entityId: updated.id,
          summary: `裁判员培养状态由 ${existing.trainingStatus} 调整为 ${updated.trainingStatus}`,
          actorId: actor?.id ?? undefined,
          metadata: { from: existing.trainingStatus, to: updated.trainingStatus },
        }, tx);
      }
      if (existing.assignmentEligibility !== updated.assignmentEligibility) {
        await writeAudit({
          action: "REFEREE_ASSIGNMENT_ELIGIBILITY_CHANGED",
          entityType: "Referee",
          entityId: updated.id,
          summary: `裁判员正式选派资格由 ${existing.assignmentEligibility} 调整为 ${updated.assignmentEligibility}`,
          actorId: actor?.id ?? undefined,
          metadata: {
            from: existing.assignmentEligibility,
            to: updated.assignmentEligibility,
            reason: input.eligibilityReason?.trim() || null,
          },
        }, tx);
      }
      return updated;
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      throw new RefereeServiceError("裁判员编号已存在。", 409);
    }
    throw error;
  }
  return referee;
}

function normalizeCapabilities(input: {
  elevenASide: boolean;
  futsal: boolean;
  capabilities?: Array<{ format: CompetitionFormat; positionKey: AppointmentPositionKey; status?: PositionCapabilityStatus }>;
}) {
  const source = input.capabilities ?? [
    ...(input.elevenASide
      ? getPositionTemplate("ELEVEN_A_SIDE").map((item) => ({ format: "ELEVEN_A_SIDE" as const, positionKey: item.key, status: "READY" as const }))
      : []),
    ...(input.futsal
      ? getPositionTemplate("FUTSAL").map((item) => ({ format: "FUTSAL" as const, positionKey: item.key, status: "READY" as const }))
      : []),
  ];
  const allowed = new Set([
    ...getPositionTemplate("ELEVEN_A_SIDE").map((item) => `ELEVEN_A_SIDE:${item.key}`),
    ...getPositionTemplate("FUTSAL").map((item) => `FUTSAL:${item.key}`),
  ]);
  return source.filter(
    (item, index, all) =>
      allowed.has(`${item.format}:${item.positionKey}`) &&
      all.findIndex((candidate) =>
        candidate.format === item.format && candidate.positionKey === item.positionKey) === index,
  ).map((item) => ({ ...item, status: item.status ?? "READY" }));
}

async function resolveCurrentAffiliationUnitId(
  tx: Prisma.TransactionClient,
  input: {
    currentAffiliationUnitId?: string;
    affiliationUnitIds?: string[];
  },
  existingCurrentAffiliationUnitId?: string | null,
) {
  const requested = input.currentAffiliationUnitId !== undefined
    ? input.currentAffiliationUnitId || null
    : input.affiliationUnitIds !== undefined
      ? input.affiliationUnitIds[0] || null
      : existingCurrentAffiliationUnitId ?? null;
  if (!requested) return null;
  const exists = await tx.affiliationUnit.count({ where: { id: requested } });
  if (!exists) throw new RefereeServiceError("裁判员当前组织归属无效。");
  return requested;
}

export async function resetRefereePassword(
  id: string,
  initialPassword: string,
  authorization: AdminServiceAuthorization<"referees:write">,
) {
  const actor = authorizedAdminActor(authorization, "referees:write");
  const referee = await prisma.referee.findUnique({ where: { id } });
  if (!referee) throw new RefereeServiceError("裁判员账号不存在。", 404);
  const passwordHash = await hashPassword(initialPassword);
  await prisma.$transaction(async (tx) => {
    await tx.referee.update({
      where: { id },
      data: { passwordHash, mustChangePassword: true, passwordChangedAt: new Date() },
    });
    await tx.refereeSession.deleteMany({ where: { refereeId: id } });
    await writeAudit({
      action: "REFEREE_PASSWORD_RESET",
      entityType: "Referee",
      entityId: id,
      summary: `重置裁判员账号 ${referee.publicCode} 的密码`,
      actorId: actor.id ?? undefined,
    }, tx);
  });
}

export async function changeRefereePassword(
  refereeId: string,
  currentPassword: string,
  newPassword: string,
  authorization: RefereeSelfServiceAuthorization,
) {
  requireRefereeSelfServiceAuthorization(authorization, refereeId);
  const referee = await prisma.referee.findUnique({ where: { id: refereeId } });
  if (
    !referee ||
    referee.status !== "ACTIVE" ||
    !referee.passwordHash ||
    !(await verifyPassword(currentPassword, referee.passwordHash))
  ) {
    throw new RefereeServiceError("当前密码不正确。", 401);
  }
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.referee.update({
      where: { id: refereeId },
      data: {
        passwordHash,
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      },
    });
    await tx.refereeSession.deleteMany({ where: { refereeId } });
    await writeAudit({
      actorType: "REFEREE",
      actorId: refereeId,
      action: "PASSWORD_CHANGED",
      entityType: "Referee",
      entityId: refereeId,
      summary: "裁判员修改个人密码",
    }, tx);
  });
}

export async function createRefereeApplication(input: {
  matchId: string;
  refereeId: string;
  preferredPositions: AppointmentPositionKey[];
  note?: string;
}) {
  const result = await prisma.$transaction(async (tx) => {
    const match = await tx.match.findUnique({
      where: { id: input.matchId },
      include: { competition: true },
    });
    if (!match) throw new RefereeServiceError("比赛不存在。", 404);
    assertMatchScheduled(match);
    if (match.status !== "SCHEDULED" || match.applicationWindowStatus !== "OPEN") {
      throw new RefereeServiceError("该场比赛当前不接受执裁意向。", 409);
    }
    if (!match.applicationDeadline || match.applicationDeadline <= new Date()) {
      throw new RefereeServiceError("该场比赛的报名时间已截止。", 409);
    }

    assertPositionTemplateConfigured(match.competition.format);

    const allowed = new Set(getPositionTemplate(match.competition.format).map((item) => item.key));
    const preferred = [...new Set(input.preferredPositions)];
    if (!preferred.length || preferred.some((key) => !allowed.has(key))) {
      throw new RefereeServiceError("请至少选择一个符合本场赛制的意向岗位。");
    }
    await assertRefereeCanApply({
      refereeId: input.refereeId,
      format: match.competition.format,
      preferredPositions: preferred,
      db: tx,
    });
    const duplicate = await tx.refereeApplication.findUnique({
      where: { matchId_refereeId: { matchId: match.id, refereeId: input.refereeId } },
    });
    if (duplicate) {
      throw new RefereeServiceError("该裁判员已经报名本场比赛，请勿重复提交。", 409);
    }

    return tx.refereeApplication.create({
      data: {
        matchId: match.id,
        refereeId: input.refereeId,
        preferredPositions: JSON.stringify(preferred),
        note: input.note || null,
      },
    });
  });
  await writeAudit({
    actorType: "REFEREE",
    actorId: input.refereeId,
    action: "APPLICATION_CREATED",
    entityType: "RefereeApplication",
    entityId: result.id,
    summary: "裁判员提交执裁意向",
    metadata: { matchId: input.matchId },
  });
  return result;
}

export async function withdrawRefereeApplication(id: string, refereeId: string) {
  const application = await prisma.refereeApplication.findUnique({
    where: { id },
    include: { match: true },
  });
  if (!application || application.refereeId !== refereeId) {
    throw new RefereeServiceError("报名记录不存在。", 404);
  }
  if (
    application.status === "APPOINTED" ||
    application.status === "WITHDRAWN" ||
    !application.match.applicationDeadline ||
    application.match.applicationDeadline <= new Date()
  ) {
    throw new RefereeServiceError("该报名记录当前不能自行撤回。", 409);
  }
  const result = await prisma.refereeApplication.update({
    where: { id },
    data: { status: "WITHDRAWN" },
  });
  await writeAudit({
    actorType: "REFEREE",
    actorId: refereeId,
    action: "APPLICATION_WITHDRAWN",
    entityType: "RefereeApplication",
    entityId: id,
    summary: "裁判员在截止前撤回执裁意向",
  });
  return result;
}

export async function createAdminApplicationException(input: {
  matchId: string;
  refereeId: string;
  preferredPositions: AppointmentPositionKey[];
  note?: string;
  exceptionReason: string;
}, actor?: AdminActor) {
  if (!input.exceptionReason.trim()) {
    throw new RefereeServiceError("请填写人工例外原因。");
  }
  const result = await prisma.$transaction(async (tx) => {
    const match = await tx.match.findUnique({
      where: { id: input.matchId },
      include: { competition: true },
    });
    if (!match) throw new RefereeServiceError("比赛不存在。", 404);
    assertMatchScheduled(match);
    assertPositionTemplateConfigured(match.competition.format);
    const allowed = new Set(getPositionTemplate(match.competition.format).map((item) => item.key));
    const preferred = [...new Set(input.preferredPositions)];
    if (!preferred.length || preferred.some((key) => !allowed.has(key))) {
      throw new RefereeServiceError("请选择符合本场赛制的意向岗位。");
    }
    await assertRefereeCanApply({
      refereeId: input.refereeId,
      format: match.competition.format,
      preferredPositions: preferred,
      requirePasswordChangeCleared: false,
      db: tx,
    });
    const duplicate = await tx.refereeApplication.findUnique({
      where: { matchId_refereeId: { matchId: input.matchId, refereeId: input.refereeId } },
    });
    if (duplicate) throw new RefereeServiceError("该裁判员已有本场报名记录。", 409);
    return tx.refereeApplication.create({
      data: {
        matchId: input.matchId,
        refereeId: input.refereeId,
        preferredPositions: JSON.stringify(preferred),
        note: input.note || null,
        status: "REVIEWING",
        reviewNote: `人工例外：${input.exceptionReason}`,
        reviewedAt: new Date(),
      },
    });
  });
  await writeAudit({
    action: "APPLICATION_EXCEPTION_CREATED",
    entityType: "RefereeApplication",
    entityId: result.id,
    summary: "管理员补录执裁意向例外",
    actorId: actor?.id ?? undefined,
    metadata: { matchId: input.matchId, reason: input.exceptionReason },
  });
  return result;
}

export async function reviewApplication(
  id: string,
  status: ApplicationStatus,
  reviewNote: string,
) {
  const existing = await prisma.refereeApplication.findUnique({ where: { id } });
  if (!existing) throw new RefereeServiceError("报名记录不存在。", 404);
  const result = await prisma.refereeApplication.update({
    where: { id },
    data: { status, reviewNote: reviewNote || null, reviewedAt: new Date() },
  });
  await writeAudit({
    action: "APPLICATION_REVIEWED",
    entityType: "RefereeApplication",
    entityId: id,
    summary: `报名审核状态更新为 ${status}`,
  });
  return result;
}

export async function createMatch(input: {
  matchNumber?: number | null;
  slug: string;
  competitionId: string;
  stageId?: string | null;
  groupId?: string | null;
  roundId?: string | null;
  stage: string;
  kickoff: Date | null;
  endAt?: Date;
  venue: string | null;
  round?: string;
  source?: DataSource;
  externalMatchId?: string;
  homeTeamId: string;
  awayTeamId: string;
  status: MatchStatus;
  applicationDeadline?: Date;
  applicationWindowStatus: "OPEN" | "CLOSED";
  publicNote?: string;
  internalNote?: string;
  positionCounts: Partial<Record<AppointmentPositionKey, number>>;
}, actor?: AdminActor) {
  if (input.status === "COMPLETED") throw new RefereeServiceError("请通过确认赛果入口标记比赛完赛。", 409);
  if (!validMatchNumber(input.matchNumber)) throw new RefereeServiceError("场序须为 1–99999 的整数。");
  if (input.homeTeamId === input.awayTeamId) {
    throw new RefereeServiceError("比赛双方不能相同。");
  }
  validateMatchSchedule(input);
  const competition = await prisma.competition.findUnique({
    where: { id: input.competitionId },
    include: { teams: true },
  });
  if (!competition) throw new RefereeServiceError("赛事不存在。", 404);
  if (input.applicationWindowStatus === "OPEN") assertPositionTemplateConfigured(competition.format);
  const teamIds = new Set(competition.teams.map((team) => team.id));
  if (!teamIds.has(input.homeTeamId) || !teamIds.has(input.awayTeamId)) {
    throw new RefereeServiceError("比赛球队不属于所选赛事。");
  }
  if (competition.teams.filter((t) => [input.homeTeamId, input.awayTeamId].includes(t.id)).some((t) => isKnockoutPlaceholder(t.name))) throw new RefereeServiceError("请人工选择真实球队，不可使用淘汰赛占位球队。");
  await assertMatchStructure(prisma, input);
  const match = await prisma.match.create({
    data: {
      matchNumber: input.matchNumber ?? null,
      slug: input.slug,
      competitionId: input.competitionId,
      stage: input.stage,
      stageId: input.stageId || null, groupId: input.groupId || null, roundId: input.roundId || null,
      kickoff: input.kickoff,
      endAt: input.endAt ?? null,
      venue: input.venue,
      round: input.round || null,
      source: input.source ?? "MANUAL",
      externalMatchId: input.externalMatchId || null,
      homeTeamId: input.homeTeamId,
      awayTeamId: input.awayTeamId,
      status: input.status,
      applicationWindowStatus: input.applicationWindowStatus,
      applicationDeadline: input.applicationDeadline,
      publicNote: input.publicNote || null,
      internalNote: input.internalNote || null,
      positionRequirements: {
        create: buildPositionRequirements(competition.format, input.positionCounts),
      },
    },
  });
  await writeAudit({
    action: "MATCH_CREATED",
    entityType: "Match",
    entityId: match.id,
    summary: `创建裁判开放场次 ${match.slug}`,
    actorId: actor?.id ?? undefined,
  });
  return match;
}

export async function createMatchFromSelections(
  input: Omit<Parameters<typeof createMatch>[0], "homeTeamId" | "awayTeamId"> & {
    homeTeamSelection: string;
    awayTeamSelection: string;
  },
  actor?: AdminActor,
) {
  validateMatchSchedule(input);
  if (input.status === "COMPLETED") throw new RefereeServiceError("请通过确认赛果入口标记比赛完赛。", 409);
  if (!validMatchNumber(input.matchNumber)) throw new RefereeServiceError("场序须为 1–99999 的整数。");
  return prisma.$transaction(async (tx) => {
    const competition = await tx.competition.findUnique({
      where: { id: input.competitionId },
      select: { id: true, format: true },
    });
    if (!competition) throw new RefereeServiceError("赛事不存在。", 404);
    const selectedStage = input.stageId ? await tx.competitionStage.findUnique({ where: { id: input.stageId } }) : null;
    if (selectedStage?.type === "KNOCKOUT" && (![input.homeTeamSelection, input.awayTeamSelection].every((value) => value.startsWith("team:")))) throw new RefereeServiceError("淘汰赛只能手工选择当前赛事真实球队。", 409);
    if (input.applicationWindowStatus === "OPEN") assertPositionTemplateConfigured(competition.format);
    const home = await resolveCompetitionTeamSelection(tx, {
      competitionId: input.competitionId,
      selection: input.homeTeamSelection,
    });
    const away = await resolveCompetitionTeamSelection(tx, {
      competitionId: input.competitionId,
      selection: input.awayTeamSelection,
    });
    if ([home.team.name, away.team.name].some(isKnockoutPlaceholder)) throw new RefereeServiceError("淘汰赛占位描述不能作为真实球队。", 409);
    if (home.team.id === away.team.id) {
      throw new RefereeServiceError("比赛双方不能相同。");
    }
    await assertMatchStructure(tx, { ...input, homeTeamId: home.team.id, awayTeamId: away.team.id });
    const match = await tx.match.create({
      data: {
        matchNumber: input.matchNumber,
        slug: input.slug,
        competitionId: input.competitionId,
        stage: input.stage,
      stageId: input.stageId || null, groupId: input.groupId || null, roundId: input.roundId || null,
        kickoff: input.kickoff,
        endAt: input.endAt ?? null,
        venue: input.venue,
        round: input.round || null,
        source: input.source ?? "MANUAL",
        externalMatchId: input.externalMatchId || null,
        homeTeamId: home.team.id,
        awayTeamId: away.team.id,
        status: input.status,
        applicationWindowStatus: input.applicationWindowStatus,
        applicationDeadline: input.applicationDeadline,
        publicNote: input.publicNote || null,
        internalNote: input.internalNote || null,
        positionRequirements: {
          create: buildPositionRequirements(competition.format, input.positionCounts),
        },
      },
    });
    await writeAudit({
      action: "MATCH_CREATED",
      entityType: "Match",
      entityId: match.id,
      summary: `创建裁判开放场次 ${match.slug}`,
      actorId: actor?.id ?? undefined,
      metadata: {
        homeTeamCreatedOnDemand: home.created,
        awayTeamCreatedOnDemand: away.created,
      },
    }, tx);
    return match;
  });
}

export async function updateMatch(
  id: string,
  input: Parameters<typeof createMatch>[0] & { cancellationReason?: string; structureChangeReason?: string },
  actor?: AdminActor,
) {
  const existing = await prisma.match.findUnique({ where: { id } });
  if (!existing) throw new RefereeServiceError("比赛不存在。", 404);
  if (input.status === "COMPLETED" && (existing.status !== "COMPLETED" || (!input.kickoff || input.kickoff > new Date()) || (input.endAt && input.endAt > new Date()) || existing.homeScore === null || existing.awayScore === null)) throw new RefereeServiceError("请通过确认赛果入口标记比赛完赛，未来比赛不能结束。", 409);
  if (existing.status === "COMPLETED" && (input.status !== existing.status || input.homeTeamId !== existing.homeTeamId || input.awayTeamId !== existing.awayTeamId || input.competitionId !== existing.competitionId)) throw new RefereeServiceError("已确认赛果的比赛不可更换参赛球队或状态，请使用赛果更正。", 409);
  if (!validMatchNumber(input.matchNumber)) throw new RefereeServiceError("场序须为 1–99999 的整数。");
  if (input.homeTeamId === input.awayTeamId) {
    throw new RefereeServiceError("比赛双方不能相同。");
  }
  validateMatchSchedule(input);
  const competition = await prisma.competition.findUnique({
    where: { id: input.competitionId },
    include: { teams: true },
  });
  if (!competition) throw new RefereeServiceError("赛事不存在。", 404);
  if (input.applicationWindowStatus === "OPEN") assertPositionTemplateConfigured(competition.format);
  const teamIds = new Set(competition.teams.map((team) => team.id));
  if (!teamIds.has(input.homeTeamId) || !teamIds.has(input.awayTeamId)) {
    throw new RefereeServiceError("比赛球队不属于所选赛事。");
  }
  if (competition.teams.filter((t) => [input.homeTeamId, input.awayTeamId].includes(t.id)).some((t) => isKnockoutPlaceholder(t.name))) throw new RefereeServiceError("请人工选择真实球队，不可使用淘汰赛占位球队。");
  const match = await prisma.$transaction(async (tx) => {
    const current = await tx.match.findUnique({ where: { id } });
    if (!current) throw new RefereeServiceError("比赛不存在。", 404);
    if (input.status === "COMPLETED" && (current.status !== "COMPLETED" || (!input.kickoff || input.kickoff > new Date()) || (input.endAt && input.endAt > new Date()) || current.homeScore === null || current.awayScore === null)) throw new RefereeServiceError("请通过确认赛果入口标记比赛完赛。", 409);
    if (current.status === "COMPLETED" && (input.status !== current.status || input.homeTeamId !== current.homeTeamId || input.awayTeamId !== current.awayTeamId || input.competitionId !== current.competitionId)) throw new RefereeServiceError("已确认赛果的比赛不可更换参赛球队或状态。", 409);
    const existing = current;
    if (!isMatchScheduled(input) && await tx.refereeAppointment.count({ where: { matchId: id, status: { in: ["PUBLISHED", "COMPLETED"] } } })) throw new RefereeServiceError("已有正式裁判任务，不能清空比赛时间或场地；请先撤回选派。", 409);
    await assertMatchStructure(tx, { ...input, stageId: input.stageId === undefined ? existing.stageId : input.stageId, groupId: input.groupId === undefined ? existing.groupId : input.groupId, roundId: input.roundId === undefined ? existing.roundId : input.roundId });
    const structureChanged = input.stageId !== undefined && input.stageId !== existing.stageId || input.groupId !== undefined && input.groupId !== existing.groupId || input.roundId !== undefined && input.roundId !== existing.roundId;
    if (existing.status === "COMPLETED" && structureChanged && (!input.structureChangeReason?.trim() || input.structureChangeReason.length > 500)) throw new RefereeServiceError("已完赛比赛重新归类将影响积分及人工确认，请填写核对原因。", 409);
    await tx.matchPositionRequirement.deleteMany({ where: { matchId: id } });
    const updated = await tx.match.update({
      where: { id },
      data: {
        matchNumber: input.matchNumber,
        slug: input.slug,
        competitionId: input.competitionId,
        stage: input.stage,
      stageId: input.stageId, groupId: input.groupId, roundId: input.roundId,
        kickoff: input.kickoff,
        endAt: input.endAt ?? null,
        venue: input.venue,
        round: input.round || null,
        source: input.source ?? "MANUAL",
        externalMatchId: input.externalMatchId || null,
        homeTeamId: input.homeTeamId,
        awayTeamId: input.awayTeamId,
        status: input.status,
        applicationWindowStatus: input.applicationWindowStatus,
        applicationDeadline: input.applicationDeadline,
        publicNote: input.publicNote || null,
        internalNote: input.internalNote || null,
        cancellationReason: input.cancellationReason || null,
        cancelledAt: input.status === "CANCELLED" ? new Date() : null,
        positionRequirements: {
          create: buildPositionRequirements(competition.format, input.positionCounts),
        },
      },
    });
    if (input.status === "CANCELLED" && existing.status !== "CANCELLED") {
      const appointment = await tx.refereeAppointment.findUnique({ where: { matchId: id } });
      if (appointment && ["DRAFT", "PUBLISHED", "WITHDRAWN"].includes(appointment.status)) {
        const reason = input.cancellationReason?.trim() || "比赛取消派生撤销任务";
        const version = await saveAppointmentVersion(tx, appointment.id, "CANCELLED", reason, "", actor?.id);
        await tx.refereeAppointment.update({ where: { id: appointment.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: reason, lastChangeReason: reason } });
        await writeAudit({ action: "APPOINTMENT_CANCELLED_FROM_MATCH", entityType: "RefereeAppointment", entityId: appointment.id, actorId: actor?.id ?? undefined, summary: "比赛取消派生撤销任务", metadata: { matchId: id, versionId: version.id } }, tx);
      }
    }
    await writeAudit({ action: "MATCH_UPDATED", entityType: "Match", entityId: updated.id, summary: `更新裁判开放场次 ${updated.slug}`, actorId: actor?.id ?? undefined, metadata: structureChanged ? { structureBefore: { stageId: existing.stageId, groupId: existing.groupId, roundId: existing.roundId }, structureAfter: { stageId: updated.stageId, groupId: updated.groupId, roundId: updated.roundId }, structureChangeReason: input.structureChangeReason || null, resultsPreserved: true } : undefined }, tx);
    return updated;
  });
  return match;
}

const matchDeletionProtectedMessage =
  "该比赛已有报名意向、选派或正式历史记录，不能直接删除。请使用“取消比赛”保留业务历史。";

export async function deleteMatchSafely(
  id: string,
  reason: string,
  authorization: AdminServiceAuthorization<"competitions:write">,
) {
  const actor = authorizedAdminActor(authorization, "competitions:write");
  const normalizedReason = reason.trim();
  if (!normalizedReason) throw new RefereeServiceError("请填写删除原因。");

  return prisma.$transaction(async (tx) => {
    const match = await tx.match.findUnique({
      where: { id },
      include: {
        competition: { select: { id: true, name: true } },
        homeTeam: { select: { id: true, name: true } },
        awayTeam: { select: { id: true, name: true } },
        applications: { select: { status: true } },
        appointment: {
          select: {
            id: true,
            status: true,
            revision: true,
            publishedAt: true,
            withdrawnAt: true,
            completedAt: true,
            cancelledAt: true,
            _count: {
              select: {
                positions: true,
                versions: true,
                acknowledgements: true,
                conflictReports: true,
              },
            },
          },
        },
        _count: { select: { positionRequirements: true } },
      },
    });
    if (!match) throw new RefereeServiceError("比赛不存在。", 404);

    const appointment = match.appointment;
    const hasApplicationHistory = match.applications.length > 0;
    const hasAppointmentHistory = Boolean(appointment);
    if (match.status !== "SCHEDULED" || hasApplicationHistory || hasAppointmentHistory) {
      throw new RefereeServiceError(matchDeletionProtectedMessage, 409);
    }

    await tx.matchPositionRequirement.deleteMany({ where: { matchId: id } });
    await tx.match.delete({ where: { id } });

    const matchLabel = `${match.homeTeam.name} vs ${match.awayTeam.name}`;
    await writeAudit({
      action: "MATCH_DELETED",
      entityType: "Match",
      entityId: match.id,
      summary: `删除比赛 ${matchLabel}`,
      actorId: actor?.id ?? undefined,
      metadata: {
        reason: normalizedReason,
        deletedAt: new Date().toISOString(),
        match: {
          id: match.id,
          slug: match.slug,
          label: matchLabel,
          competitionId: match.competition.id,
          competitionName: match.competition.name,
          homeTeamId: match.homeTeam.id,
          awayTeamId: match.awayTeam.id,
          kickoff: match.kickoff?.toISOString() ?? null,
        },
        preservedApplicationHistory: true,
        preservedAppointmentHistory: true,
        cleanedPositionRequirementCount: match._count.positionRequirements,
      },
    }, tx);

    return { id: match.id, label: matchLabel, competitionId: match.competition.id };
  });
}

function buildPositionRequirements(
  format: CompetitionFormat,
  counts: Partial<Record<AppointmentPositionKey, number>>,
) {
  return getPositionTemplate(format)
    .map((position) => ({
      key: position.key,
      label: position.label,
      sortOrder: position.order,
      count: Math.max(0, Math.min(5, Math.trunc(counts[position.key] ?? 0))),
    }))
    .filter((position) => position.count > 0);
}

type PositionInput = {
  key: AppointmentPositionKey;
  slot?: number;
  refereeId: string | null;
};

export type AppointmentTransitionState = AppointmentStatus | "NONE";
export type AppointmentTransitionAction =
  | "saveDraft"
  | "publish"
  | "withdraw"
  | "complete"
  | "cancel";

export const appointmentTransitionTable = {
  NONE: { saveDraft: "DRAFT" },
  DRAFT: { saveDraft: "DRAFT", publish: "PUBLISHED", cancel: "CANCELLED" },
  PUBLISHED: { withdraw: "WITHDRAWN", complete: "COMPLETED", cancel: "CANCELLED" },
  WITHDRAWN: { saveDraft: "DRAFT", publish: "PUBLISHED", cancel: "CANCELLED" },
  COMPLETED: {},
  CANCELLED: {},
} as const satisfies Record<
  AppointmentTransitionState,
  Partial<Record<AppointmentTransitionAction, AppointmentStatus>>
>;

function assertAppointmentTransition(
  state: AppointmentTransitionState,
  action: AppointmentTransitionAction,
) {
  const target = appointmentTransitionTable[state][action as keyof typeof appointmentTransitionTable[typeof state]];
  if (!target) {
    throw new RefereeServiceError("当前选派状态不允许执行该操作。", 409);
  }
  return target;
}

export async function saveAppointmentDraft(input: {
  matchId: string;
  publicationNote: string;
  changeReason?: string;
  overrideReason?: string;
  positions: PositionInput[];
}, authorization: AdminServiceAuthorization<"referees:write">) {
  const actor = authorizedAdminActor(authorization, "referees:write");
  const result = await prisma.$transaction(async (tx) => {
    const match = await tx.match.findUnique({
      where: { id: input.matchId },
      include: { competition: true, positionRequirements: true },
    });
    if (!match) throw new RefereeServiceError("比赛不存在。", 404);
    assertPositionTemplateConfigured(match.competition.format);
    if (match.status !== "SCHEDULED") {
      throw new RefereeServiceError("只有已安排且未取消的比赛可以配置选派。", 409);
    }
    const existingAppointment = await tx.refereeAppointment.findUnique({
      where: { matchId: match.id },
    });
    assertAppointmentTransition(existingAppointment?.status ?? "NONE", "saveDraft");
    const template = getPositionTemplate(match.competition.format);
    const allowed = new Map(template.map((item) => [item.key, item]));
    const requirements = new Map(
      match.positionRequirements.map((item) => [item.key, item.count]),
    );
    const normalized = input.positions.map((item) => ({
      ...item,
      slot: item.slot ?? 1,
    }));
    const identities = normalized.map((item) => `${item.key}:${item.slot}`);
    if (
      new Set(identities).size !== identities.length ||
      normalized.some(
        (item) =>
          !allowed.has(item.key) ||
          item.slot < 1 ||
          item.slot > (requirements.get(item.key) ?? 1),
      )
    ) {
      throw new RefereeServiceError("岗位配置包含重复、超额或不适用于本场赛制的岗位。");
    }

    const refereeIds = normalized.flatMap((item) => (item.refereeId ? [item.refereeId] : []));
    if (new Set(refereeIds).size !== refereeIds.length) {
      throw new RefereeServiceError("同一裁判员不能在同一场比赛承担多个岗位。");
    }
    await assertAppointmentPositionsEligible({
      format: match.competition.format,
      positions: normalized,
      db: tx,
    });

    if (existingAppointment?.revision && !input.changeReason?.trim()) {
      throw new RefereeServiceError("修改已发布或已撤回选派时，请填写改派原因。");
    }
    const warnings = await detectAppointmentWarnings(match.id, normalized, tx);
    if (hardAppointmentConflicts(warnings).length) {
      throw new RefereeServiceError("存在不可覆盖的选派冲突，草稿未保存。", 409, warnings);
    }
    if (warningsRequiringOverride(warnings).length && !input.overrideReason?.trim()) {
      throw new RefereeServiceError("存在可覆盖冲突，请填写覆盖原因后再保存。", 409, warnings);
    }
    const appointment = await tx.refereeAppointment.upsert({
      where: { matchId: match.id },
      update: {
        status: "DRAFT",
        publicationNote: input.publicationNote || null,
        lastChangeReason: input.changeReason || null,
        withdrawnAt: null,
      },
      create: {
        matchId: match.id,
        status: "DRAFT",
        publicationNote: input.publicationNote || null,
        lastChangeReason: input.changeReason || null,
      },
    });
    await tx.appointmentPosition.deleteMany({ where: { appointmentId: appointment.id } });
    if (normalized.length) {
      await tx.appointmentPosition.createMany({
        data: normalized.map((item) => {
          const definition = allowed.get(item.key)!;
          return {
            appointmentId: appointment.id,
            refereeId: item.refereeId,
            key: item.key,
            label: definition.label,
            sortOrder: definition.order,
            slot: item.slot,
          };
        }),
      });
    }
    const saved = await tx.refereeAppointment.findUniqueOrThrow({
      where: { id: appointment.id },
      include: { positions: true },
    });
    await writeAudit({
      action: "APPOINTMENT_DRAFT_SAVED",
      entityType: "RefereeAppointment",
      entityId: saved.id,
      summary: "保存裁判选派草稿",
      actorId: actor?.id ?? undefined,
      metadata: {
        matchId: input.matchId,
        reason: input.changeReason || null,
        overrideReason: input.overrideReason || null,
        warningCodes: warnings.map((warning) => warning.code),
      },
    }, tx);
    return { appointment: saved, warnings };
  });
  return result;
}

async function saveAppointmentVersion(
  tx: Prisma.TransactionClient,
  appointmentId: string,
  status: AppointmentStatus,
  reason?: string,
  overrideReason?: string,
  actorId?: string | null,
) {
  const appointment = await tx.refereeAppointment.findUniqueOrThrow({
    where: { id: appointmentId },
    include: { positions: { orderBy: [{ sortOrder: "asc" }, { slot: "asc" }] } },
  });
  const revision = appointment.revision + 1;
  await tx.refereeAppointment.update({
    where: { id: appointmentId },
    data: { revision, lastChangeReason: reason || null },
  });
  return tx.appointmentVersion.create({
    data: {
      appointmentId,
      revision,
      status,
      reason: reason || null,
      overrideReason: overrideReason || null,
      createdByAdminId: actorId ?? null,
      snapshot: JSON.stringify({
        publicationNote: appointment.publicationNote,
        positions: appointment.positions.map(({ key, slot, refereeId, label }) => ({
          key,
          slot,
          refereeId,
          label,
        })),
      }),
    },
  });
}

export async function publishAppointment(
  matchId: string,
  reason: string,
  overrideReason: string,
  authorization: AdminServiceAuthorization<"referees:write">,
) {
  const actor = authorizedAdminActor(authorization, "referees:write");
  return prisma.$transaction(async (tx) => {
    const appointment = await tx.refereeAppointment.findUnique({
      where: { matchId },
      include: { positions: true, match: { include: { competition: true } } },
    });
    if (!appointment) throw new RefereeServiceError("请先保存选派草稿。", 409);
    assertMatchScheduled(appointment.match);
    assertPositionTemplateConfigured(appointment.match.competition.format);
    assertAppointmentTransition(appointment.status, "publish");
    if (appointment.match.status !== "SCHEDULED") {
      throw new RefereeServiceError("比赛已结束或取消，不能发布选派。", 409);
    }
    if (!appointment.positions.length || appointment.positions.some((item) => !item.refereeId)) {
      throw new RefereeServiceError("发布前须为所有已启用岗位分配裁判员。", 409);
    }
    if (appointment.revision > 0 && !reason.trim()) {
      throw new RefereeServiceError("重新发布选派时必须填写明确的修改原因。", 400);
    }
    const refereeIds = appointment.positions.flatMap((item) => item.refereeId ? [item.refereeId] : []);
    if (new Set(refereeIds).size !== refereeIds.length) {
      throw new RefereeServiceError("同一裁判员不能在同一场比赛承担多个岗位。", 409);
    }
    await assertAppointmentPositionsEligible({
      format: appointment.match.competition.format,
      positions: appointment.positions,
      db: tx,
    });
    const warnings = await detectAppointmentWarnings(matchId, appointment.positions, tx);
    if (hardAppointmentConflicts(warnings).length) {
      throw new RefereeServiceError("发布前检测到不可覆盖的选派冲突。", 409, warnings);
    }
    if (warningsRequiringOverride(warnings).length && !overrideReason.trim()) {
      throw new RefereeServiceError("发布前检测到可覆盖冲突，请填写覆盖原因。", 409, warnings);
    }
    const version = await saveAppointmentVersion(
      tx,
      appointment.id,
      "PUBLISHED",
      reason,
      overrideReason,
      actor?.id,
    );
    const selectedIds = refereeIds;
    const reconciledAt = new Date();
    await tx.refereeApplication.updateMany({
      where: {
        matchId,
        refereeId: { in: selectedIds },
        status: { in: ["PENDING", "REVIEWING", "APPROVED", "NOT_SELECTED", "APPOINTED"] },
      },
      data: { status: "APPOINTED", reviewedAt: reconciledAt },
    });
    await tx.refereeApplication.updateMany({
      where: {
        matchId,
        refereeId: { notIn: selectedIds },
        status: { in: ["PENDING", "REVIEWING", "APPROVED", "NOT_SELECTED", "APPOINTED"] },
      },
      data: { status: "NOT_SELECTED", reviewedAt: reconciledAt },
    });
    const updated = await tx.refereeAppointment.update({
      where: { id: appointment.id },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
        withdrawnAt: null,
        completedAt: null,
        cancelledAt: null,
        cancellationReason: null,
        lastChangeReason: reason || null,
      },
    });
    await writeAudit({
      action: appointment.revision > 0 ? "APPOINTMENT_REPUBLISHED" : "APPOINTMENT_PUBLISHED",
      entityType: "RefereeAppointment",
      entityId: appointment.id,
      summary: "发布裁判选派公示",
      actorId: actor?.id ?? undefined,
      metadata: {
        matchId,
        versionId: version.id,
        reason: reason || null,
        overrideReason: overrideReason || null,
        warningCodes: warnings.map((warning) => warning.code),
      },
    }, tx);
    return { appointment: updated, version, warnings };
  });
}

export async function withdrawAppointment(
  matchId: string,
  reason: string,
  authorization: AdminServiceAuthorization<"referees:write">,
) {
  const actor = authorizedAdminActor(authorization, "referees:write");
  return prisma.$transaction(async (tx) => {
    const appointment = await tx.refereeAppointment.findUnique({ where: { matchId } });
    assertAppointmentTransition(appointment?.status ?? "NONE", "withdraw");
    if (!appointment) throw new RefereeServiceError("当前没有可撤回的已发布选派。", 409);
    if (!reason.trim()) throw new RefereeServiceError("请填写撤回或改派原因。");
    const version = await saveAppointmentVersion(tx, appointment.id, "WITHDRAWN", reason, "", actor?.id);
    const updated = await tx.refereeAppointment.update({
      where: { id: appointment.id },
      data: {
        status: "WITHDRAWN",
        withdrawnAt: new Date(),
        lastChangeReason: reason,
      },
    });
    await writeAudit({
      action: "APPOINTMENT_WITHDRAWN",
      entityType: "RefereeAppointment",
      entityId: appointment.id,
      summary: "撤回裁判选派公示",
      actorId: actor?.id ?? undefined,
      metadata: { matchId, versionId: version.id, reason },
    }, tx);
    return { appointment: updated, version };
  });
}

export async function completeAppointment(
  matchId: string,
  reason: string,
  authorization: AdminServiceAuthorization<"referees:write">,
) {
  const actor = authorizedAdminActor(authorization, "referees:write");
  return prisma.$transaction(async (tx) => {
    const appointment = await tx.refereeAppointment.findUnique({ where: { matchId }, include: { match: true } });
    assertAppointmentTransition(appointment?.status ?? "NONE", "complete");
    if (!appointment) throw new RefereeServiceError("只有已发布选派可以标记完成。", 409);
    assertMatchScheduled(appointment.match);
    if (appointment.match.status !== "COMPLETED" || (!appointment.match.kickoff || appointment.match.kickoff > new Date()) || appointment.match.homeScore === null || appointment.match.awayScore === null) throw new RefereeServiceError("须先确认真实完赛及双方比分，不能提前标记执裁完成。", 409);
    if (!reason.trim()) throw new RefereeServiceError("请填写人工完成原因。");
    const version = await saveAppointmentVersion(tx, appointment.id, "COMPLETED", reason, "", actor?.id);
    const updated = await tx.refereeAppointment.update({
      where: { id: appointment.id },
      data: { status: "COMPLETED", completedAt: new Date(), lastChangeReason: reason || null },
    });
    await writeAudit({
      action: "APPOINTMENT_COMPLETED",
      entityType: "RefereeAppointment",
      entityId: appointment.id,
      summary: "完成裁判选派",
      actorId: actor?.id ?? undefined,
      metadata: { matchId, versionId: version.id, reason: reason || null },
    }, tx);
    return { appointment: updated, version };
  });
}

export async function cancelAppointment(
  matchId: string,
  reason: string,
  authorization: AdminServiceAuthorization<"referees:write">,
) {
  const actor = authorizedAdminActor(authorization, "referees:write");
  return prisma.$transaction(async (tx) => {
    const appointment = await tx.refereeAppointment.findUnique({ where: { matchId } });
    assertAppointmentTransition(appointment?.status ?? "NONE", "cancel");
    if (!appointment) throw new RefereeServiceError("当前选派不能取消。", 409);
    if (!reason.trim()) throw new RefereeServiceError("请填写取消原因。");
    const version = await saveAppointmentVersion(tx, appointment.id, "CANCELLED", reason, "", actor?.id);
    const updated = await tx.refereeAppointment.update({
      where: { id: appointment.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancellationReason: reason,
        lastChangeReason: reason,
      },
    });
    await writeAudit({
      action: "APPOINTMENT_CANCELLED",
      entityType: "RefereeAppointment",
      entityId: appointment.id,
      summary: "取消裁判选派",
      actorId: actor?.id ?? undefined,
      metadata: { matchId, versionId: version.id, reason },
    }, tx);
    return { appointment: updated, version };
  });
}

export async function confirmMatchResult(matchId: string, input: { homeScore: number; awayScore: number; homePenaltyScore: number | null; awayPenaltyScore: number | null; expectedVersion: number; actualEnded: boolean; reason: string }, authorization: AdminServiceAuthorization<"competitions:write">) {
  const actor = requireAdminServiceAuthorization(authorization, "competitions:write");
  if (![input.homeScore, input.awayScore].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 999)) throw new RefereeServiceError("双方比分必须是 0 至 999 的整数。");
  if ((input.homePenaltyScore === null) !== (input.awayPenaltyScore === null) || [input.homePenaltyScore, input.awayPenaltyScore].some((n) => n !== null && (!Number.isSafeInteger(n) || n < 0 || n > 999))) throw new RefereeServiceError("点球比分必须成对填写非负整数。");
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) throw new RefereeServiceError("赛果版本无效。");
  return prisma.$transaction(async (tx) => {
    const match = await tx.match.findUnique({ where: { id: matchId }, include: { structureStage: true, appointment: true } });
    if (!match) throw new RefereeServiceError("比赛不存在。", 404);
    if (match.status === "CANCELLED" || !isMatchScheduled(match) || !match.kickoff || match.kickoff > new Date() || !input.actualEnded || (match.endAt && match.endAt > new Date())) throw new RefereeServiceError("取消、未来或尚未确认结束的比赛不能确认赛果。", 409);
    if (input.homePenaltyScore !== null && (match.structureStage?.type !== "KNOCKOUT" || input.homeScore !== input.awayScore || input.homePenaltyScore === input.awayPenaltyScore)) throw new RefereeServiceError("点球仅用于淘汰赛场上平局，且点球比分应分出胜负。");
    const unchanged = match.status === "COMPLETED" && match.homeScore === input.homeScore && match.awayScore === input.awayScore && match.homePenaltyScore === input.homePenaltyScore && match.awayPenaltyScore === input.awayPenaltyScore;
    if (unchanged && (input.expectedVersion === match.resultVersion || input.expectedVersion + 1 === match.resultVersion)) return match;
    if (match.resultVersion !== input.expectedVersion) throw new RefereeServiceError("赛果已被其他管理员更新，请刷新后核对。", 409);
    if (match.status === "COMPLETED" && !input.reason.trim()) throw new RefereeServiceError("更正已确认赛果必须填写原因。");
    if (input.reason.length > 500) throw new RefereeServiceError("原因不能超过 500 字。");
    const updated = await tx.match.update({ where: { id: matchId, resultVersion: input.expectedVersion }, data: { status: "COMPLETED", homeScore: input.homeScore, awayScore: input.awayScore, homePenaltyScore: input.homePenaltyScore, awayPenaltyScore: input.awayPenaltyScore, resultVersion: { increment: 1 }, resultConfirmedAt: new Date(), applicationWindowStatus: "CLOSED" } });
    if (match.appointment?.status === "PUBLISHED") {
      assertAppointmentTransition(match.appointment.status, "complete");
      const version = await saveAppointmentVersion(tx, match.appointment.id, "COMPLETED", "确认赛果派生完成", "", actor.id);
      await tx.refereeAppointment.update({ where: { id: match.appointment.id }, data: { status: "COMPLETED", completedAt: new Date(), lastChangeReason: "确认赛果派生完成" } });
      await writeAudit({ actorId: actor.id ?? undefined, action: "APPOINTMENT_COMPLETED_FROM_RESULT", entityType: "RefereeAppointment", entityId: match.appointment.id, summary: "确认赛果后完成已发布执裁任务", metadata: { matchId, versionId: version.id, derivedFrom: "MATCH_RESULT_CONFIRMED" } }, tx);
    }
    await writeAudit({ actorId: actor.id ?? undefined, action: "MATCH_RESULT_CONFIRMED", entityType: "Match", entityId: matchId, summary: input.reason || "确认比赛真实完赛及比分", metadata: { before: { homeScore: match.homeScore, awayScore: match.awayScore, homePenaltyScore: match.homePenaltyScore, awayPenaltyScore: match.awayPenaltyScore, version: match.resultVersion }, after: input } }, tx);
    return updated;
  });
}
