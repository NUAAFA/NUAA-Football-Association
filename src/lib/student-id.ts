import type { Prisma } from "@/generated/prisma-v29/client";
import { prisma } from "@/lib/prisma";
import { RefereeServiceError } from "@/lib/referee-service-error";

type StudentIdDb = Prisma.TransactionClient | typeof prisma;

export function normalizeStudentId(value: string) {
  return value.trim().normalize("NFKC").toUpperCase();
}

export function getStudentIdPrefix(value: string) {
  const normalized = normalizeStudentId(value);
  return normalized.length >= 2 ? normalized.slice(0, 2) : "";
}

export async function resolveStudentIdCollege(db: StudentIdDb, value: string) {
  const studentId = normalizeStudentId(value);
  if (!studentId) throw new RefereeServiceError("请填写学号。");
  const prefix = getStudentIdPrefix(studentId);
  const mapping = prefix ? await db.collegeCodeMapping.findUnique({
    where: { prefix },
    select: {
      prefix: true,
      college: {
        select: {
          id: true,
          name: true,
          affiliationUnit: { select: { id: true } },
        },
      },
    },
  }) : null;
  if (!mapping) {
    throw new RefereeServiceError(`学号前缀“${prefix || "不足两位"}”无法匹配学院，请管理员核验后处理。`);
  }
  return {
    studentId,
    prefix: mapping.prefix,
    collegeId: mapping.college.id,
    collegeName: mapping.college.name,
    affiliationUnitId: mapping.college.affiliationUnit?.id ?? null,
  };
}

export async function getRefereeStudentIdCompatibility(db: StudentIdDb = prisma) {
  const referees = await db.referee.findMany({
    select: { id: true, status: true, studentId: true },
  });
  const normalizedCounts = new Map<string, number>();
  for (const referee of referees) {
    if (!referee.studentId?.trim()) continue;
    const normalized = normalizeStudentId(referee.studentId);
    normalizedCounts.set(normalized, (normalizedCounts.get(normalized) ?? 0) + 1);
  }
  const missingStudentId = referees.filter((referee) => !referee.studentId?.trim()).length;
  const activeMissingStudentId = referees.filter(
    (referee) => referee.status === "ACTIVE" && !referee.studentId?.trim(),
  ).length;
  const activeNonNormalizedStudentId = referees.filter(
    (referee) => referee.status === "ACTIVE" && referee.studentId?.trim() &&
      referee.studentId !== normalizeStudentId(referee.studentId),
  ).length;
  const duplicateStudentIdGroups = [...normalizedCounts.values()].filter((count) => count > 1).length;
  return {
    totalReferees: referees.length,
    totalActiveAccounts: referees.filter((referee) => referee.status === "ACTIVE").length,
    missingStudentId,
    activeMissingStudentId,
    activeNonNormalizedStudentId,
    duplicateStudentIdGroups,
    unsafeLoginMigrationBlockers: activeMissingStudentId + activeNonNormalizedStudentId + duplicateStudentIdGroups,
  };
}
