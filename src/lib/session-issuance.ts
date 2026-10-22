import { prisma } from "@/lib/prisma";

/** Compare the verified credential snapshot while taking the write lock.
 * Password updates/reset and session deletion use the same transaction boundary.
 */
export async function issueVerifiedAdminSession(input: {
  account: { id: string; passwordHash: string } | null;
  tokenHash: string;
  expiresAt: Date;
}) {
  return prisma.$transaction(async (tx) => {
    if (input.account) {
      const result = await tx.adminAccount.updateMany({
        where: { id: input.account.id, passwordHash: input.account.passwordHash, isActive: true },
        data: { lastLoginAt: new Date() },
      });
      if (result.count !== 1) return false;
    }
    await tx.adminSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await tx.adminSession.create({ data: {
      tokenHash: input.tokenHash, expiresAt: input.expiresAt, adminAccountId: input.account?.id ?? null,
    } });
    return true;
  });
}

export async function issueVerifiedRefereeSession(input: {
  account: { id: string; passwordHash: string | null };
  tokenHash: string;
  expiresAt: Date;
}) {
  return prisma.$transaction(async (tx) => {
    const result = await tx.referee.updateMany({
      where: { id: input.account.id, passwordHash: input.account.passwordHash, status: "ACTIVE" },
      data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
    });
    if (result.count !== 1) return false;
    await tx.refereeSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await tx.refereeSession.create({ data: {
      refereeId: input.account.id, tokenHash: input.tokenHash, expiresAt: input.expiresAt,
    } });
    return true;
  });
}
