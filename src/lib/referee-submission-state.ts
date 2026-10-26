import { conflictSnapshot, type RefereeConflictSnapshot } from "@/lib/referee-conflict-snapshot";
import { prisma } from "@/lib/prisma";
import { RefereeServiceError } from "@/lib/referee-service-error";

export type RefereeTaskSubmissionState = {
  versionId: string;
  acknowledgement: { id: string } | null;
  report: RefereeConflictSnapshot | null;
};

export type RefereeApplicationSubmissionState = {
  application: { id: string; status: string; preferredPositions: string[]; note: string } | null;
};

export async function getRefereeTaskSubmissionState(appointmentId: string, refereeId: string, expectedVersionId: string): Promise<RefereeTaskSubmissionState> {
  const row = await prisma.refereeAppointment.findFirst({
    where: { id: appointmentId, status: "PUBLISHED", match: { status: "SCHEDULED" }, positions: { some: { refereeId } } },
    select: {
      revision: true,
      versions: {
        where: { status: "PUBLISHED" }, orderBy: { revision: "desc" }, take: 1,
        select: {
          id: true, revision: true,
          acknowledgements: { where: { refereeId }, select: { id: true } },
          conflictReports: { where: { refereeId }, select: { id: true, reasonCode: true, explanation: true, status: true, reportedAt: true, resolvedAt: true } },
        },
      },
    },
  });
  const version = row?.versions[0];
  if (!row || !version || row.revision !== version.revision || version.id !== expectedVersionId) {
    throw new RefereeServiceError("任务版本或岗位已变化，请重新打开工作区核对后操作。", 409);
  }
  return { versionId: version.id, acknowledgement: version.acknowledgements[0] ?? null, report: version.conflictReports[0] ? conflictSnapshot(version.conflictReports[0]) : null };
}

export async function getRefereeApplicationSubmissionState(matchId: string, refereeId: string): Promise<RefereeApplicationSubmissionState> {
  const row = await prisma.refereeApplication.findUnique({
    where: { matchId_refereeId: { matchId, refereeId } },
    select: { id: true, status: true, preferredPositions: true, note: true },
  });
  if (!row) return { application: null };
  let preferredPositions: string[] = [];
  try { const value: unknown = JSON.parse(row.preferredPositions); if (Array.isArray(value)) preferredPositions = value.filter((key): key is string => typeof key === "string"); } catch { /* A legacy malformed row cannot confirm this submission. */ }
  return { application: { id: row.id, status: row.status, preferredPositions, note: row.note ?? "" } };
}
