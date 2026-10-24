import type { ApplicationStatus, Prisma } from "@/generated/prisma-v29/client";

export const applicationReviewStatuses = ["PENDING", "REVIEWING", "APPROVED", "REJECTED"] as const;
type Db = Prisma.TransactionClient;
type SavedApplication = { id: string; refereeId: string; status: ApplicationStatus; reviewedAt: string | null; reviewNote: string | null };

export function effectiveApplicationStatus(status: ApplicationStatus, hasOfficialTask: boolean, canContinue: boolean): ApplicationStatus {
  if (hasOfficialTask) return "APPOINTED";
  return status === "APPOINTED" ? canContinue ? "REVIEWING" : "NOT_SELECTED" : status;
}

export async function hasOfficialApplicationTask(db: Db, matchId: string, refereeId: string) {
  return Boolean(await db.refereeAppointment.count({ where: {
    matchId, status: { in: ["PUBLISHED", "COMPLETED"] }, match: { status: { not: "CANCELLED" } },
    positions: { some: { refereeId } },
  } }));
}

export async function applicationPublicationSnapshot(db: Db, matchId: string): Promise<SavedApplication[]> {
  const rows = await db.refereeApplication.findMany({ where: { matchId } });
  return rows.map((row) => ({ id: row.id, refereeId: row.refereeId, status: row.status, reviewedAt: row.reviewedAt?.toISOString() ?? null, reviewNote: row.reviewNote }));
}

// Restore only the states changed by this exact publication. A later human review wins.
export async function releasePublishedApplications(db: Db, appointmentId: string, matchId: string, actorId: string | null) {
  const [event, match, rows] = await Promise.all([
    db.auditLog.findFirst({ where: { entityType: "RefereeAppointment", entityId: appointmentId, action: { in: ["APPOINTMENT_PUBLISHED", "APPOINTMENT_REPUBLISHED"] } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { metadata: true } }),
    db.match.findUniqueOrThrow({ where: { id: matchId } }),
    db.refereeApplication.findMany({ where: { matchId, status: { in: ["APPOINTED", "NOT_SELECTED"] } } }),
  ]);
  let snapshot: SavedApplication[] = [];
  let reconciledAt: string | null = null;
  try {
    const value = JSON.parse(event?.metadata ?? "null");
    if (value && Array.isArray(value.applicationStates)) snapshot = value.applicationStates;
    if (typeof value?.reconciledAt === "string") reconciledAt = value.reconciledAt;
  } catch { /* Legacy publications have no reversible state proof. Keep them identifiable. */ }
  const changes = [];
  for (const row of rows) {
    if (row.status !== "APPOINTED" && (!reconciledAt || row.reviewedAt?.toISOString() !== reconciledAt)) continue;
    if (reconciledAt && row.reviewedAt?.toISOString() !== reconciledAt) continue;
    const saved = snapshot.find((item) => item.id === row.id && item.refereeId === row.refereeId);
    const proven = saved && !["APPOINTED", "NOT_SELECTED"].includes(saved.status);
    const canContinue = match.status === "SCHEDULED" && match.applicationWindowStatus === "OPEN" && Boolean(match.applicationDeadline && match.applicationDeadline > new Date());
    const base = proven ? saved.status : canContinue ? "REVIEWING" : "NOT_SELECTED";
    const status = ["PENDING", "REVIEWING"].includes(base) && !canContinue ? "NOT_SELECTED" : base;
    await db.refereeApplication.update({ where: { id: row.id }, data: {
      status, reviewedAt: proven ? saved.reviewedAt ? new Date(saved.reviewedAt) : null : row.reviewedAt,
      reviewNote: proven ? saved.reviewNote : [row.reviewNote, "原选派已撤销；原审核结论缺少可验证快照，待人工核查。"].filter(Boolean).join("\n"),
    } });
    changes.push({ id: row.id, before: row.status, after: status, proof: proven ? "PUBLICATION_SNAPSHOT" : "LEGACY_REVIEW_REQUIRED" });
  }
  if (changes.length) await db.auditLog.create({ data: { actorType: "ADMIN", actorId, action: "APPLICATION_TASK_STATES_RELEASED", entityType: "RefereeAppointment", entityId: appointmentId, summary: "正式任务撤回或取消后恢复报名审核状态", metadata: JSON.stringify({ matchId, changes }) } });
}
