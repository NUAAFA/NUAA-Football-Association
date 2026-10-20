import { prisma } from "@/lib/prisma";
import { requireAdminServiceAuthorization, type AdminServiceAuthorization } from "@/lib/privileged-service-authorization";
import { RefereeServiceError } from "@/lib/referee-service-error";
import { gradeModes, inferEnrollmentYear, type GradeMode } from "@/lib/referee-grade";
import { isRefereeGrade } from "@/lib/referee-profile-options";
export async function setRefereeGrade(id: string, input: { mode: GradeMode; grade: string; reason: string; expectedUpdatedAt: string }, authorization: AdminServiceAuthorization<"referees:write">) {
  const actor = requireAdminServiceAuthorization(authorization, "referees:write");
  if (!actor.id) throw new RefereeServiceError("年级计算方式须使用具有可审计身份的管理员账号。", 403);
  if (!gradeModes.includes(input.mode) || !input.reason.trim() || input.reason.length > 500) throw new RefereeServiceError("请选择计算方式并填写调整原因（最多 500 字）。");
  if (input.mode === "MANUAL" && !isRefereeGrade(input.grade)) throw new RefereeServiceError("人工年级无效。");
  return prisma.$transaction(async (tx) => {
    const old = await tx.referee.findUnique({ where: { id } });
    if (!old) throw new RefereeServiceError("裁判员不存在。", 404);
    if (old.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new RefereeServiceError("档案已变化，请刷新后核对。", 409);
    const enrollmentYear = inferEnrollmentYear(old.studentId);
    if (input.mode === "AUTO_STUDENT_ID" && !enrollmentYear) throw new RefereeServiceError("此学号格式或年份未验证适用，不能启用自动识别。", 409);
    const data = { gradeMode: input.mode, enrollmentYear: input.mode === "AUTO_STUDENT_ID" ? enrollmentYear : null, grade: input.mode === "MANUAL" ? input.grade : old.grade, gradeReason: input.reason.trim() };
    const updated = await tx.referee.update({ where: { id, updatedAt: old.updatedAt }, data });
    await tx.auditLog.create({ data: { actorType: "ADMIN", actorId: actor.id, action: "REFEREE_GRADE_MODE_CHANGED", entityType: "Referee", entityId: id, summary: "调整年级计算方式", metadata: JSON.stringify({ actor: { displayName: actor.displayName, isLegacy: actor.isLegacy }, before: { mode: old.gradeMode, grade: old.grade, enrollmentYear: old.enrollmentYear }, after: data, reason: input.reason.trim() }) } });
    return updated;
  });
}
