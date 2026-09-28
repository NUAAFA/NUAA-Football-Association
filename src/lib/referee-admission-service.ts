import { createHash } from "node:crypto";

import type { Prisma, RefereeAdmissionApplicationStatus } from "@/generated/prisma-v29/client";
import { prisma } from "@/lib/prisma";
import {
  createRefereeAccountInTransaction,
  type AdminActor,
} from "@/lib/referee-service";
import { RefereeServiceError } from "@/lib/referee-service-error";
import {
  allocateRefereePublicCode,
  defaultRefereeCapabilities,
  generateTemporaryRefereePassword,
  onboardingCapabilitySummary,
} from "@/lib/referee-onboarding";
import { hashPassword } from "@/lib/referee-security";
import {
  assertUnifiedAdminPermission,
  type UnifiedAdminActor,
} from "@/lib/unified-admin-rbac";
import { isRecord, readShortText } from "@/lib/referee-validation";
import { normalizeStudentId, resolveStudentIdCollege } from "@/lib/student-id";

function readAdmissionApplicationInput(input: unknown) {
  if (!isRecord(input)) {
    throw new RefereeServiceError("提交内容格式不正确。");
  }

  try {
    const name = readShortText(input.name, "姓名", 48).normalize("NFKC").replace(/\s+/gu, " ");
    const studentId = normalizeStudentId(readShortText(input.studentId, "学号", 32));
    const phone = readShortText(input.phone, "手机号", 32, false);
    const qq = readShortText(input.qq, "QQ", 32, false);
    const note = readShortText(input.note, "补充说明", 240, false);

    if (phone && !/^\d{11}$/.test(phone)) {
      throw new RefereeServiceError("手机号须为 11 位纯数字。");
    }
    if (qq && !/^\d{5,12}$/.test(qq)) {
      throw new RefereeServiceError("QQ 须为 5 至 12 位纯数字。");
    }
    if (!phone && !qq) {
      throw new RefereeServiceError("请至少填写手机号或 QQ。");
    }

    return { name, studentId, phone, qq, note };
  } catch (error) {
    if (error instanceof RefereeServiceError) throw error;
    throw new RefereeServiceError(
      error instanceof Error ? error.message : "提交内容格式不正确。",
    );
  }
}

export const admissionDuplicateCooldownMs = 7 * 24 * 60 * 60 * 1000;
export const admissionAddressWindowMs = 15 * 60 * 1000;
export const admissionAddressMaximumSubmissions = 30;
const admissionRateLimitScope = "referee-admission-address";
const admissionSubmissionLocks = new Map<string, Promise<unknown>>();

function admissionIdentityKeys(input: ReturnType<typeof readAdmissionApplicationInput>) {
  return [
    input.studentId ? `student:${input.studentId}` : null,
    input.phone ? `name-phone:${input.name}:${input.phone}` : null,
    input.qq ? `name-qq:${input.name}:${input.qq}` : null,
  ]
    .filter((item): item is string => item !== null)
    .map((item) => createHash("sha256").update(item).digest("hex"))
    .sort();
}

async function withAdmissionIdentityLocks<T>(keys: string[], work: () => Promise<T>) {
  const previous = [...new Set(keys.map((key) => admissionSubmissionLocks.get(key)).filter(Boolean))];
  const current = Promise.all(previous.map((promise) => promise?.catch(() => undefined))).then(work);
  for (const key of keys) admissionSubmissionLocks.set(key, current);
  try {
    return await current;
  } finally {
    for (const key of keys) {
      if (admissionSubmissionLocks.get(key) === current) admissionSubmissionLocks.delete(key);
    }
  }
}

async function consumeAdmissionAddressQuota(
  tx: Prisma.TransactionClient,
  rateLimitKey: string,
  now: Date,
) {
  const current = await tx.loginAttempt.findUnique({
    where: { scope_keyHash: { scope: admissionRateLimitScope, keyHash: rateLimitKey } },
  });
  if (current?.blockedUntil && current.blockedUntil > now) {
    if (current.failures >= admissionAddressMaximumSubmissions) {
      throw new RefereeServiceError("申请提交过于频繁，请稍后再试。", 429);
    }
    await tx.loginAttempt.update({
      where: { id: current.id },
      data: { failures: current.failures + 1 },
    });
    return;
  }
  const windowEnd = new Date(now.getTime() + admissionAddressWindowMs);
  await tx.loginAttempt.upsert({
    where: { scope_keyHash: { scope: admissionRateLimitScope, keyHash: rateLimitKey } },
    create: {
      scope: admissionRateLimitScope,
      keyHash: rateLimitKey,
      failures: 1,
      blockedUntil: windowEnd,
    },
    update: { failures: 1, blockedUntil: windowEnd },
  });
}

export async function submitRefereeAdmissionApplication(
  input: unknown,
  options: { rateLimitKey?: string; now?: Date } = {},
) {
  const { name, studentId, phone, qq, note } = readAdmissionApplicationInput(input);
  const normalized = { name, studentId, phone, qq, note };
  const now = options.now ?? new Date();
  return withAdmissionIdentityLocks(admissionIdentityKeys(normalized), () => prisma.$transaction(async (tx) => {
    const duplicateIdentifiers = [
      studentId ? { studentId } : null,
      phone ? { name, phone } : null,
      qq ? { name, qq } : null,
    ].filter((item): item is NonNullable<typeof item> => item !== null);
    const duplicate = await tx.refereeAdmissionApplication.findFirst({
      where: {
        status: "PENDING",
        createdAt: { gte: new Date(now.getTime() - admissionDuplicateCooldownMs) },
        OR: duplicateIdentifiers,
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new RefereeServiceError("相同申请信息近期已有待审核记录，请勿重复提交。", 409);
    }
    if (options.rateLimitKey) {
      await consumeAdmissionAddressQuota(tx, options.rateLimitKey, now);
    }
    return tx.refereeAdmissionApplication.create({
      data: {
        name,
        studentId: studentId || null,
        phone: phone || null,
        qq: qq || null,
        note: note || null,
        status: "PENDING",
      },
      select: {
        id: true,
        status: true,
      },
    });
  }));
}

function assertAdmissionRead(actor: UnifiedAdminActor) {
  assertUnifiedAdminPermission(actor, "referees:read");
}

function assertAdmissionWrite(actor: UnifiedAdminActor) {
  assertUnifiedAdminPermission(actor, "referees:write");
}

function refereeAdminActor(actor: UnifiedAdminActor): AdminActor {
  return {
    id: actor.id,
    role: actor.roles.includes("SUPER_ADMIN") ? "SUPER_ADMIN" : "REFEREE_MANAGER",
  };
}

const admissionDetailSelect = {
  id: true,
  name: true,
  studentId: true,
  phone: true,
  qq: true,
  note: true,
  status: true,
  reviewedAt: true,
  reviewNote: true,
  createdAt: true,
  updatedAt: true,
  reviewedByAdmin: {
    select: { id: true, username: true, displayName: true },
  },
  referee: {
    select: {
      id: true,
      publicCode: true,
      name: true,
      status: true,
      trainingStatus: true,
      assignmentEligibility: true,
    },
  },
} satisfies Prisma.RefereeAdmissionApplicationSelect;

export async function listRefereeAdmissionApplications(
  status: RefereeAdmissionApplicationStatus | undefined,
  actor: UnifiedAdminActor,
) {
  assertAdmissionRead(actor);
  return prisma.refereeAdmissionApplication.findMany({
    where: status ? { status } : undefined,
    select: admissionDetailSelect,
    orderBy: { createdAt: "desc" },
    take: 300,
  });
}

export async function getAdmissionQueuePage(status: RefereeAdmissionApplicationStatus, page: number, actor: UnifiedAdminActor) {
  assertAdmissionRead(actor);
  const pageSize = 30;
  const counts = await prisma.refereeAdmissionApplication.groupBy({ by: ["status"], _count: true });
  const totals = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
  for (const row of counts) totals[row.status] = row._count;
  const totalPages = Math.max(1, Math.ceil(totals[status] / pageSize));
  const currentPage = Math.min(totalPages, Math.max(1, Number.isSafeInteger(page) ? page : 1));
  const items = await prisma.refereeAdmissionApplication.findMany({ where: { status }, select: admissionDetailSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (currentPage - 1) * pageSize, take: pageSize });
  return { items, counts: totals, page: currentPage, totalPages };
}

export async function getRefereeAdmissionApplication(
  id: string,
  actor: UnifiedAdminActor,
) {
  assertAdmissionRead(actor);
  const application = await prisma.refereeAdmissionApplication.findUnique({
    where: { id },
    select: admissionDetailSelect,
  });
  if (!application) throw new RefereeServiceError("裁判准入申请不存在。", 404);
  return application;
}

type AdmissionReviewInput =
  | { action: "REJECT"; reviewNote: string }
  | {
      action: "APPROVE";
      reviewNote: string;
      mode: "CREATE_NEW";
      /** Legacy callers may still send these fields; R2 deliberately ignores them. */
      publicCode?: string;
      initialPassword?: string;
    }
  | {
      action: "APPROVE";
      reviewNote: string;
      mode: "LINK_EXISTING";
      existingRefereeId: string;
      /** Legacy callers may still send this field; R2 generates the password server-side. */
      initialPassword?: string;
    };

function validateReviewInput(input: AdmissionReviewInput) {
  if (!input.reviewNote.trim()) throw new RefereeServiceError("请填写审核意见。");
  if (input.action === "APPROVE" && input.mode === "LINK_EXISTING" && !input.existingRefereeId.trim()) {
    throw new RefereeServiceError("请选择要明确关联的裁判员账号。");
  }
}

export async function reviewRefereeAdmissionApplication(
  id: string,
  input: AdmissionReviewInput,
  actor: UnifiedAdminActor,
) {
  assertAdmissionWrite(actor);
  validateReviewInput(input);

  try {
    return await prisma.$transaction(async (tx) => {
      const application = await tx.refereeAdmissionApplication.findUnique({ where: { id } });
      if (!application) throw new RefereeServiceError("裁判准入申请不存在。", 404);
      if (application.status !== "PENDING") {
        throw new RefereeServiceError("该准入申请已经完成审核，不能重复处理。", 409);
      }

      const claimed = await tx.refereeAdmissionApplication.updateMany({ where: { id, status: "PENDING" }, data: { status: input.action === "REJECT" ? "REJECTED" : "APPROVED" } });
      if (claimed.count !== 1) throw new RefereeServiceError("该准入申请已被其他管理员处理，请刷新。", 409);
      const reviewedAt = new Date();
      const reviewNote = input.reviewNote.trim();
      if (input.action === "REJECT") {
        const rejected = await tx.refereeAdmissionApplication.update({
          where: { id },
          data: {
            status: "REJECTED",
            reviewedAt,
            reviewNote,
            reviewedByAdminId: actor.id,
          },
          select: admissionDetailSelect,
        });
        await tx.auditLog.create({
          data: {
            actorType: "ADMIN",
            actorId: actor.id,
            action: "REFEREE_ADMISSION_REJECTED",
            entityType: "RefereeAdmissionApplication",
            entityId: id,
            summary: `拒绝裁判准入申请：${application.name}`,
            metadata: JSON.stringify({
              applicationId: id,
              reviewer: actor.displayName,
              result: "REJECTED",
              reason: reviewNote,
              refereeId: null,
            }),
          },
        });
        return { ...rejected, onboarding: null };
      }

      if (!application.studentId?.trim()) {
        throw new RefereeServiceError("该申请缺少学号，不能创建或启用登录账号。请先核验申请资料。", 409);
      }
      const college = await resolveStudentIdCollege(tx, application.studentId);
      const temporaryPassword = generateTemporaryRefereePassword();
      let refereeId: string;
      let publicCode: string;
      if (input.mode === "LINK_EXISTING") {
        const existing = await tx.referee.findUnique({
          where: { id: input.existingRefereeId },
          select: { id: true, publicCode: true, status: true, studentId: true, collegeId: true },
        });
        if (!existing) throw new RefereeServiceError("明确选择的裁判员账号不存在。", 404);
        if (existing.studentId && normalizeStudentId(existing.studentId) !== college.studentId) {
          throw new RefereeServiceError("所选现有账号已有不同学号，不能关联该申请。", 409);
        }
        const passwordHash = await hashPassword(temporaryPassword);
        await tx.referee.update({
          where: { id: existing.id },
          data: {
            status: "ACTIVE",
            studentId: college.studentId,
            collegeId: existing.collegeId ?? college.collegeId,
            publicDirectoryEnabled: true,
            passwordHash,
            mustChangePassword: true,
            passwordChangedAt: reviewedAt,
            sessions: { deleteMany: {} },
          },
        });
        await tx.auditLog.create({
          data: {
            actorType: "ADMIN",
            actorId: actor.id,
            action: "REFEREE_ACCOUNT_ENABLED",
            entityType: "Referee",
            entityId: existing.id,
            summary: `准入审核明确关联并启用裁判员账号 ${existing.publicCode}`,
            metadata: JSON.stringify({
              admissionApplicationId: id,
              from: existing.status,
              to: "ACTIVE",
              mustChangePassword: true,
            }),
          },
        });
        refereeId = existing.id;
        publicCode = existing.publicCode;
      } else {
        const studentIdOwner = await tx.referee.findUnique({
          where: { studentId: college.studentId },
          select: { id: true, publicCode: true },
        });
        if (studentIdOwner) {
          throw new RefereeServiceError(
            `该学号已对应裁判员 ${studentIdOwner.publicCode}，请明确选择关联现有账号。`,
            409,
          );
        }
        publicCode = await allocateRefereePublicCode(tx);
        const referee = await createRefereeAccountInTransaction({
          publicCode,
          name: application.name,
          initialPassword: temporaryPassword,
          status: "ACTIVE",
          trainingStatus: "IN_TRAINING",
          assignmentEligibility: "ELIGIBLE",
          elevenASide: true,
          futsal: true,
          publicDirectoryEnabled: true,
          studentId: college.studentId,
          collegeId: college.collegeId,
          phone: application.phone ?? undefined,
          qq: application.qq ?? undefined,
          capabilities: defaultRefereeCapabilities.map(([format, positionKey, status]) => ({
            format,
            positionKey,
            status,
          })),
        }, refereeAdminActor(actor), tx, {
          admissionApplicationId: id,
          source: "REFEREE_ADMISSION_APPROVAL",
        });
        refereeId = referee.id;
      }

      const approved = await tx.refereeAdmissionApplication.update({
        where: { id },
        data: {
          status: "APPROVED",
          reviewedAt,
          reviewNote,
          reviewedByAdminId: actor.id,
          refereeId,
        },
        select: admissionDetailSelect,
      });
      await tx.auditLog.create({
        data: {
          actorType: "ADMIN",
          actorId: actor.id,
          action: "REFEREE_ADMISSION_APPROVED",
          entityType: "RefereeAdmissionApplication",
          entityId: id,
          summary: `通过裁判准入申请：${application.name}`,
          metadata: JSON.stringify({
            applicationId: id,
            reviewer: actor.displayName,
            result: "APPROVED",
            reason: reviewNote,
            refereeId,
            accountMode: input.mode,
          }),
        },
      });
      return {
        ...approved,
        onboarding: {
          refereeId,
          name: application.name,
          studentId: college.studentId,
          publicCode,
          temporaryPassword,
          college: college.collegeName,
          trainingStatus: "IN_TRAINING" as const,
          assignmentEligibility: "ELIGIBLE" as const,
          publicDirectoryEnabled: true,
          capabilitySummary: onboardingCapabilitySummary(),
          accountMode: input.mode,
        },
      };
    });
  } catch (error) {
    if (error instanceof RefereeServiceError) throw error;
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      throw new RefereeServiceError("裁判员编号或学号已存在，请改为明确关联现有账号。", 409);
    }
    throw error;
  }
}

export async function createOnboardedRefereeAccount(
  input: { name: string; studentId: string },
  actor: UnifiedAdminActor,
) {
  assertAdmissionWrite(actor);
  const name = input.name.trim().normalize("NFKC").replace(/\s+/gu, " ");
  if (!name) throw new RefereeServiceError("请填写姓名。");
  return prisma.$transaction(async (tx) => {
    const college = await resolveStudentIdCollege(tx, input.studentId);
    const existing = await tx.referee.findUnique({
      where: { studentId: college.studentId },
      select: { publicCode: true },
    });
    if (existing) {
      throw new RefereeServiceError(`该学号已对应裁判员 ${existing.publicCode}，请维护现有账号。`, 409);
    }
    const publicCode = await allocateRefereePublicCode(tx);
    const temporaryPassword = generateTemporaryRefereePassword();
    const referee = await createRefereeAccountInTransaction({
      publicCode,
      name,
      initialPassword: temporaryPassword,
      status: "ACTIVE",
      trainingStatus: "IN_TRAINING",
      assignmentEligibility: "ELIGIBLE",
      elevenASide: true,
      futsal: true,
      publicDirectoryEnabled: true,
      studentId: college.studentId,
      collegeId: college.collegeId,
      capabilities: defaultRefereeCapabilities.map(([format, positionKey, status]) => ({
        format,
        positionKey,
        status,
      })),
    }, refereeAdminActor(actor), tx, { source: "ADMIN_DIRECT_ONBOARDING" });
    return {
      refereeId: referee.id,
      name,
      studentId: college.studentId,
      publicCode,
      temporaryPassword,
      college: college.collegeName,
      trainingStatus: "IN_TRAINING" as const,
      assignmentEligibility: "ELIGIBLE" as const,
      publicDirectoryEnabled: true,
      capabilitySummary: onboardingCapabilitySummary(),
      accountMode: "CREATE_NEW" as const,
    };
  });
}
