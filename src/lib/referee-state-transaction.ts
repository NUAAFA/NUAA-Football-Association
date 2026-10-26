import type { Prisma } from "@/generated/prisma-v29/client";
import { prisma } from "@/lib/prisma";
import { RefereeServiceError } from "@/lib/referee-service-error";

// SQLite rejects a deferred reader's write if another connection committed first.
// Keep that protection and expose a retryable business response, never a stale write.
export async function refereeStateTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(async (tx) => {
      // Acquire SQLite's writer reservation before taking a read snapshot. This
      // no-row statement changes no record or timestamp, and avoids two deferred
      // readers deadlocking while both try to upgrade to writers.
      await tx.$executeRawUnsafe('UPDATE "RefereeAppointment" SET "revision" = "revision" WHERE 0');
      return work(tx);
    });
  } catch (error) {
    const seen = new Set<unknown>();
    const concurrencyFailure = (value: unknown): boolean => {
      if (!value || typeof value !== "object" || seen.has(value)) return false;
      seen.add(value);
      const item = value as { code?: string; message?: string; cause?: unknown; meta?: unknown };
      return ["P2034", "P1008"].includes(item.code ?? "") || /SQLITE_BUSY|SQLITE_LOCKED|database is locked|write conflict|Operation has timed out/i.test(item.message ?? "")
        || concurrencyFailure(item.cause) || concurrencyFailure(item.meta);
    };
    if (concurrencyFailure(error)) throw new RefereeServiceError("其他管理员正在更新相关任务，请刷新核对后重试。", 409);
    throw error;
  }
}
