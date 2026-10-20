import type { AppointmentPositionKey } from "@/generated/prisma-v29/client";
import { prisma } from "@/lib/prisma";
import { requireAdminServiceAuthorization, type AdminServiceAuthorization } from "@/lib/privileged-service-authorization";
import { RefereeServiceError } from "@/lib/referee-service-error";
import { detectAppointmentWarnings } from "@/lib/referee-conflicts";
import { getPositionTemplate, hasPositionTemplate } from "@/lib/referee-roles";

export type CompletedOfficialsInput = {
  matchId: string;
  action: "record" | "correct";
  expectedAppointmentRevision: number;
  expectedResultVersion: number;
  reason: string;
  verificationReason: string;
  publicHistoryVisible: boolean;
  positions: { key: AppointmentPositionKey; slot: number; refereeId: string | null }[];
};

/** Historical facts have a separate workflow. Pre-match admission checks remain unchanged. */
export async function recordCompletedOfficials(input: CompletedOfficialsInput, authorization: AdminServiceAuthorization<"referees:write">) {
  const actor = requireAdminServiceAuthorization(authorization, "referees:write");
  if (!actor.id) throw new RefereeServiceError("赛后执裁记录须使用具有可审计身份的管理员账号。", 403);
  if (!["record", "correct"].includes(input.action) || ![input.expectedAppointmentRevision, input.expectedResultVersion].every((n) => Number.isSafeInteger(n) && n >= 0)) throw new RefereeServiceError("操作或版本无效。");
  if (!input.reason?.trim() || input.reason.length > 500 || input.verificationReason.length > 1000) throw new RefereeServiceError("请填写补录 / 更正原因（最多 500 字），核实依据最多 1000 字。");
  if (typeof input.publicHistoryVisible !== "boolean" || !Array.isArray(input.positions) || input.positions.length > 25) throw new RefereeServiceError("历史执裁输入格式无效。");
  try {
    return await prisma.$transaction(async (tx) => {
      const now = new Date();
      const match = await tx.match.findUnique({ where: { id: input.matchId }, include: { competition: true, homeTeam: true, awayTeam: true, positionRequirements: true, appointment: { include: { positions: true } } } });
      if (!match) throw new RefereeServiceError("比赛不存在。", 404);
      if (match.status !== "COMPLETED" || !match.kickoff || match.kickoff > now || (match.endAt && match.endAt > now) || match.homeScore === null || match.awayScore === null || !match.resultConfirmedAt || match.resultVersion < 1 || match.resultConfirmedAt > now) throw new RefereeServiceError("须为过去已完赛、双方比分已确认的真实场次。旧记录请先核实赛果。", 409);
      if (match.homeTeam.competitionId !== match.competitionId || match.awayTeam.competitionId !== match.competitionId || !hasPositionTemplate(match.competition.format)) throw new RefereeServiceError("场次归属或岗位模板待核实。", 409);
      const old = match.appointment;
      if (match.resultVersion !== input.expectedResultVersion || (old?.revision ?? 0) !== input.expectedAppointmentRevision) throw new RefereeServiceError("赛果或执裁记录已变化，请刷新后核对。", 409);
      if (old?.status === "PUBLISHED") throw new RefereeServiceError("已有正式已发布选派，请先使用原完成流程，再按需专用更正。", 409);
      if ((input.action === "correct") !== (old?.status === "COMPLETED")) throw new RefereeServiceError("已完成记录须使用更正；首次记录须使用补录。", 409);
      const template = getPositionTemplate(match.competition.format);
      const requirements = new Map((match.positionRequirements.length ? match.positionRequirements : template.map((item) => ({ key: item.key, count: 1 }))).map((item) => [item.key, item.count]));
      const allowed = new Map(template.map((item) => [item.key, item]));
      const identities = input.positions.map((p) => `${p.key}:${p.slot}`);
      if (new Set(identities).size !== identities.length || input.positions.some((p) => !allowed.has(p.key) || !Number.isInteger(p.slot) || p.slot < 1 || p.slot > (requirements.get(p.key) ?? 0))) throw new RefereeServiceError("岗位配置包含重复、超额或不适用于本场赛制的岗位。");
      const ids = input.positions.flatMap((p) => p.refereeId ? [p.refereeId] : []);
      if (!ids.length || new Set(ids).size !== ids.length) throw new RefereeServiceError("至少记录一名真实裁判员，同一人不能兼任本场多个岗位。");
      const referees = await tx.referee.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, assignmentEligibility: true } });
      if (referees.length !== ids.length) throw new RefereeServiceError("存在未登记的裁判员。", 409);
      const warnings = await detectAppointmentWarnings(match.id, input.positions, tx, "POST_MATCH");
      const currentExceptions = referees.filter((r) => r.status !== "ACTIVE" || r.assignmentEligibility !== "ELIGIBLE").map((r) => ({ refereeId: r.id, status: r.status, assignmentEligibility: r.assignmentEligibility }));
      if ((warnings.length || currentExceptions.length) && !input.verificationReason.trim()) throw new RefereeServiceError("存在当前资格 / 可用性 / 历史冲突，请核对并填写实际执裁依据；这些提示不代表赛前审核通过。", 409, warnings);
      if (warnings.some((w) => w.code === "MATCH_OVERLAP") && !actor.roles.includes("SUPER_ADMIN")) throw new RefereeServiceError("历史重叠须由最高管理员核实依据后记录。", 403, warnings);
      const revision = (old?.revision ?? 0) + 1;
      const data = { status: "COMPLETED" as const, revision, recordSource: "POST_MATCH_ENTRY", recordedAt: now, recordedByAdminId: actor.id, publicHistoryVisible: input.publicHistoryVisible, completedAt: old?.completedAt ?? now, lastChangeReason: input.reason.trim() };
      const appointment = old
        ? await tx.refereeAppointment.update({ where: { id: old.id, revision: input.expectedAppointmentRevision }, data })
        : await tx.refereeAppointment.create({ data: { ...data, matchId: match.id } });
      await tx.appointmentPosition.deleteMany({ where: { appointmentId: appointment.id } });
      // Persist empty template slots explicitly; never invent an unrecorded official.
      const fullPositions = [...requirements].flatMap(([key, count]) => Array.from({ length: count }, (_, i) => ({ key, slot: i + 1, refereeId: input.positions.find((p) => p.key === key && p.slot === i + 1)?.refereeId ?? null })));
      await tx.appointmentPosition.createMany({ data: fullPositions.map((p) => ({ ...p, appointmentId: appointment.id, label: allowed.get(p.key)!.label, sortOrder: allowed.get(p.key)!.order })) });
      const snapshot = { source: "POST_MATCH_ENTRY", action: input.action, recordedAt: now.toISOString(), recordedByAdminId: actor.id, recordedByName: actor.displayName, expectedResultVersion: input.expectedResultVersion, publicHistoryVisible: input.publicHistoryVisible, verificationReason: input.verificationReason.trim(), warnings, currentExceptions, before: old, positions: fullPositions };
      const version = await tx.appointmentVersion.create({ data: { appointmentId: appointment.id, revision, status: "COMPLETED", recordSource: "POST_MATCH_ENTRY", reason: input.reason.trim(), overrideReason: input.verificationReason.trim() || null, createdByAdminId: actor.id, snapshot: JSON.stringify(snapshot), createdAt: now } });
      await tx.auditLog.create({ data: { actorType: "ADMIN", actorId: actor.id, action: input.action === "record" ? "APPOINTMENT_POST_MATCH_RECORDED" : "APPOINTMENT_POST_MATCH_CORRECTED", entityType: "RefereeAppointment", entityId: appointment.id, summary: input.action === "record" ? "赛后补录实际执裁人员" : "更正实际执裁人员", metadata: JSON.stringify({ matchId: match.id, versionId: version.id, revision, reason: input.reason.trim(), ...snapshot }), createdAt: now } });
      // No Match, application, acknowledgement or notification mutation in this transaction.
      return { appointment, version, warnings, currentExceptions };
    });
  } catch (error) {
    if (error instanceof RefereeServiceError) throw error;
    if (error instanceof Error && /unique constraint|record.*not found|write conflict|SQLITE_BUSY|database is locked|P2034/iu.test(error.message)) throw new RefereeServiceError("执裁记录发生并发变化，请刷新后核对。", 409);
    throw error;
  }
}
