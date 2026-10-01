import type { Prisma } from "@/generated/prisma-v29/client";
import { prisma } from "@/lib/prisma";
import { requireAdminServiceAuthorization, type AdminServiceAuthorization } from "@/lib/privileged-service-authorization";
import { RefereeServiceError } from "@/lib/referee-service-error";
type Db = Prisma.TransactionClient | typeof prisma;
function containsId(value: unknown, id: string): boolean {
  if (typeof value === "string") return value === id;
  if (Array.isArray(value)) return value.some((v) => containsId(v, id));
  return Boolean(value && typeof value === "object" && Object.values(value).some((v) => containsId(v, id)));
}
export async function inspectTeamRemoval(competitionId: string, teamIds: string[], db: Db = prisma) {
  if (!teamIds.length || teamIds.length > 500 || new Set(teamIds).size !== teamIds.length) throw new RefereeServiceError("请明确选择 1–500 支不同球队。", 400);
  const [competition, teams, matches, confirmations] = await Promise.all([
    db.competition.findUnique({ where: { id: competitionId }, select: { name: true } }),
    db.team.findMany({ where: { competitionId, id: { in: teamIds } }, include: { memberships: { include: { group: { select: { name: true } }, stage: { select: { name: true } } } } } }),
    db.match.findMany({ where: { OR: [{ homeTeamId: { in: teamIds } }, { awayTeamId: { in: teamIds } }] }, select: { id: true, matchNumber: true, homeTeamId: true, awayTeamId: true, status: true } }),
    db.groupConfirmation.findMany({ where: { group: { stage: { competitionId } } }, select: { teamIds: true, kind: true } }),
  ]);
  if (!competition || teams.length !== teamIds.length) throw new RefereeServiceError("所选球队已不在当前赛事，请刷新名单；不能使用其他赛事的球队。", 409);
  return { competitionName: competition.name, teams: teamIds.map((id) => {
    const team = teams.find((t) => t.id === id)!;
    const related = matches.filter((m) => m.homeTeamId === id || m.awayTeamId === id);
    const confirmed = confirmations.some((c) => containsId(c.teamIds, id));
    return { id, name: team.name, groups: team.memberships.map((m) => `${m.stage.name} · ${m.group.name}`), directoryIsPublic: team.directoryIsPublic, removable: !related.length && !confirmed,
      reason: related.length ? `已被 ${related.length} 场比赛引用（含待排期、取消及历史比赛），不能删除。` : confirmed ? "已有正式排名或出线确认引用，不能作为误加球队移除。" : "尚无正式业务引用",
      matches: related.map((m) => ({ id: m.id, label: m.matchNumber ? `第${m.matchNumber}场` : "查看关联比赛" })) };
  }) };
}
export async function removeCompetitionTeams(competitionId: string, teamIds: string[], reason: string, authorization: AdminServiceAuthorization<"competitions:write">) {
  const actor = requireAdminServiceAuthorization(authorization, "competitions:write");
  if (!reason.trim() || reason.length > 200) throw new RefereeServiceError("请选择简短的移除原因。", 400);
  return prisma.$transaction(async (tx) => {
    const inspection = await inspectTeamRemoval(competitionId, teamIds, tx);
    const blocked = inspection.teams.filter((t) => !t.removable);
    if (blocked.length) throw new RefereeServiceError(blocked.map((t) => `“${t.name}”：${t.reason}`).join("；"), 409);
    const memberships = await tx.teamGroupMembership.deleteMany({ where: { teamId: { in: teamIds }, team: { competitionId } } });
    await tx.team.deleteMany({ where: { competitionId, id: { in: teamIds } } });
    // Preserve the established per-team audit vocabulary for existing consumers.
    for (const team of inspection.teams) await tx.auditLog.create({ data: { actorType: "ADMIN", actorId: actor.id, action: "TEAM_DELETED", entityType: "Team", entityId: team.id, summary: `从本赛事移除 ${team.name}`, metadata: JSON.stringify({ competitionId, teamId: team.id, teamName: team.name, reason }) } });
    await tx.auditLog.create({ data: { actorType: "ADMIN", actorId: actor.id, action: teamIds.length === 1 ? "TEAM_REMOVED_FROM_COMPETITION" : "TEAM_BULK_REMOVED_FROM_COMPETITION", entityType: "Competition", entityId: competitionId, summary: `从本赛事移除 ${teamIds.length} 支未使用球队`, metadata: JSON.stringify({ competitionId, actor: actor.id, time: new Date().toISOString(), reason, teams: inspection.teams.map((t) => ({ teamId: t.id, teamName: t.name, groups: t.groups, directoryIsPublic: t.directoryIsPublic })), removedTeams: teamIds.length, removedMemberships: memberships.count }) } });
    return { competitionId, removedCount: teamIds.length, teams: inspection.teams };
  });
}
