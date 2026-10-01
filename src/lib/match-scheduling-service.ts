import { prisma } from "@/lib/prisma";
import { assertMatchScheduled, validateMatchSchedule } from "@/lib/match-scheduling";
import { RefereeServiceError } from "@/lib/referee-service-error";
import { requireAdminServiceAuthorization, type AdminServiceAuthorization } from "@/lib/privileged-service-authorization";
export async function scheduleMatch(matchId: string, input: { kickoff: Date; endAt?: Date; venue: string }, authorization: AdminServiceAuthorization<"competitions:write">) {
  const actor = requireAdminServiceAuthorization(authorization, "competitions:write");
  assertMatchScheduled(input);
  return prisma.$transaction(async (tx) => {
    const match = await tx.match.findUnique({ where: { id: matchId } });
    if (!match) throw new RefereeServiceError("比赛不存在。", 404);
    if (match.status !== "SCHEDULED") throw new RefereeServiceError("只有待赛比赛可以安排。", 409);
    if (match.kickoff && match.venue?.trim()) throw new RefereeServiceError("比赛已安排，请刷新或使用完整编辑入口。", 409);
    validateMatchSchedule({ ...match, ...input });
    const updated = await tx.match.update({ where: { id: matchId, updatedAt: match.updatedAt }, data: { kickoff: input.kickoff, endAt: input.endAt ?? null, venue: input.venue.trim() } });
    await tx.auditLog.create({ data: { actorType: "ADMIN", actorId: actor.id, action: "MATCH_SCHEDULED", entityType: "Match", entityId: matchId, summary: "补充真实比赛排期", metadata: JSON.stringify({ before: { kickoff: match.kickoff, endAt: match.endAt, venue: match.venue }, after: input }) } });
    return updated;
  });
}
