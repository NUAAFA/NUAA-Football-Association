export type RefereeConflictSnapshot = {
  id: string;
  reportedAt: string;
  resolvedAt: string | null;
  status: string;
  reasonCode: string | null;
  explanation: string | null;
};

export function conflictSnapshot(report: Omit<RefereeConflictSnapshot, "reportedAt" | "resolvedAt"> & { reportedAt: Date; resolvedAt: Date | null }): RefereeConflictSnapshot {
  return { id: report.id, status: report.status, reasonCode: report.reasonCode, explanation: report.explanation, reportedAt: report.reportedAt.toISOString(), resolvedAt: report.resolvedAt?.toISOString() ?? null };
}

export function isConflictSnapshot(value: unknown): value is RefereeConflictSnapshot {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.reportedAt === "string" && Number.isFinite(Date.parse(row.reportedAt))
    && (row.resolvedAt === null || (typeof row.resolvedAt === "string" && Number.isFinite(Date.parse(row.resolvedAt))))
    && typeof row.status === "string" && ["PENDING", "RESOLVED", "DISMISSED"].includes(row.status)
    && (row.reasonCode === null || typeof row.reasonCode === "string") && (row.explanation === null || typeof row.explanation === "string");
}

/** Reconcile one report generation; an older resolved payload cannot erase a new submission. */
export function visibleConflictSnapshot(server: RefereeConflictSnapshot | null, local: { versionId: string; report: RefereeConflictSnapshot } | null, versionId: string | null) {
  if (!local || local.versionId !== versionId) return server;
  if (!server) return local.report;
  const saved = local.report;
  const generation = (report: RefereeConflictSnapshot) => JSON.stringify([report.id, report.reportedAt, report.reasonCode, report.explanation]);
  if (generation(server) !== generation(saved)) {
    return Date.parse(server.reportedAt) > Date.parse(saved.reportedAt) ? server : saved;
  }
  // Resolution advances the same generation. Re-reporting different content changes it.
  const serverResolved = server.status !== "PENDING" && server.resolvedAt !== null;
  const savedResolved = saved.status !== "PENDING" && saved.resolvedAt !== null;
  if (serverResolved && (!savedResolved || Date.parse(server.resolvedAt!) >= Date.parse(saved.resolvedAt!))) return server;
  if (savedResolved) return saved;
  return saved.status === "PENDING" ? saved : server;
}
