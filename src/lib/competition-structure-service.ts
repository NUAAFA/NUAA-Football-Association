import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma-v29/client";
import { prisma } from "@/lib/prisma";
import { RefereeServiceError } from "@/lib/referee-service-error";
import { assertUnifiedAdminPermission, type UnifiedAdminActor } from "@/lib/unified-admin-rbac";
import { calculateStandings } from "@/lib/competition-standings";

type Db = Prisma.TransactionClient;
export type MatchStructureInput = { competitionId: string; stageId?: string | null; groupId?: string | null; roundId?: string | null; homeTeamId: string; awayTeamId: string };
export async function assertMatchStructure(db: Db, input: MatchStructureInput) {
  if (!input.stageId) {
    if (input.groupId || input.roundId) throw new RefereeServiceError("请先选择阶段。");
    return;
  }
  const stage = await db.competitionStage.findUnique({ where: { id: input.stageId } });
  if (!stage || stage.competitionId !== input.competitionId) throw new RefereeServiceError("阶段不属于当前赛事。");
  if (input.groupId) {
    const group = await db.competitionGroup.findUnique({ where: { id: input.groupId }, include: { members: true } });
    if (!group || group.stageId !== stage.id || stage.type !== "GROUP") throw new RefereeServiceError("小组不属于当前小组阶段。");
    const ids = new Set(group.members.map((m) => m.teamId));
    if (!ids.has(input.homeTeamId) || !ids.has(input.awayTeamId)) throw new RefereeServiceError("双方球队必须是所选小组的成员。");
  }
  if (stage.type === "GROUP" && !input.groupId) throw new RefereeServiceError("小组赛请选择小组；无分组赛事请使用其他阶段。");
  if (input.roundId) {
    const round = await db.competitionRound.findUnique({ where: { id: input.roundId } });
    if (!round || round.stageId !== stage.id || (round.groupId && round.groupId !== input.groupId)) throw new RefereeServiceError("轮次不属于所选阶段或小组。");
  }
}

export async function loadCompetitionStructure(competitionId: string) {
  return prisma.competitionStage.findMany({ where: { competitionId }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], include: { groups: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }], include: { members: { include: { team: { select: { id: true, name: true } } } } } }, rounds: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } } });
}

export type StructureAction =
 | { action: "stage"; name: string; type: "GROUP" | "KNOCKOUT" | "OTHER"; sortOrder: number }
 | { action: "group"; stageId: string; name: string; sortOrder: number }
 | { action: "round"; stageId: string; groupId?: string; name: string; sortOrder: number }
 | { action: "members"; groupId: string; teamIds: string[]; reason: string }
 | { action: "delete"; entity: "stage" | "group" | "round"; id: string };
export async function mutateCompetitionStructure(competitionId: string, input: StructureAction, actor: UnifiedAdminActor) {
  assertUnifiedAdminPermission(actor, "competitions:write");
  return prisma.$transaction(async (tx) => {
    if (!await tx.competition.findUnique({ where: { id: competitionId } })) throw new RefereeServiceError("赛事不存在。", 404);
    let result: unknown;
    if (input.action === "stage") {
      if (!input.name.trim() || input.name.length > 80 || !["GROUP", "KNOCKOUT", "OTHER"].includes(input.type)) throw new RefereeServiceError("阶段名称或类型无效。");
      result = await tx.competitionStage.create({ data: { competitionId, name: input.name.trim(), type: input.type, sortOrder: input.sortOrder } });
    } else if (input.action === "group" || input.action === "round") {
      const stage = await tx.competitionStage.findUnique({ where: { id: input.stageId } });
      if (!stage || stage.competitionId !== competitionId) throw new RefereeServiceError("阶段归属不正确。");
      if (!input.name.trim() || input.name.length > 80) throw new RefereeServiceError("名称无效。");
      if (input.action === "group") {
        if (stage.type !== "GROUP") throw new RefereeServiceError("仅小组赛阶段可建立分组。");
        result = await tx.competitionGroup.create({ data: { stageId: stage.id, name: input.name.trim(), sortOrder: input.sortOrder } });
      } else {
        if (input.groupId && !await tx.competitionGroup.findFirst({ where: { id: input.groupId, stageId: stage.id } })) throw new RefereeServiceError("小组归属不正确。");
        if (await tx.competitionRound.findFirst({ where: { stageId: stage.id, groupId: input.groupId || null, name: input.name.trim() } })) throw new RefereeServiceError("该范围内已存在同名轮次。");
        result = await tx.competitionRound.create({ data: { stageId: stage.id, groupId: input.groupId || null, name: input.name.trim(), sortOrder: input.sortOrder } });
      }
    } else if (input.action === "members") {
      const group = await tx.competitionGroup.findUnique({ where: { id: input.groupId }, include: { stage: true, members: true } });
      if (!group || group.stage.competitionId !== competitionId) throw new RefereeServiceError("小组归属不正确。");
      if (new Set(input.teamIds).size !== input.teamIds.length || input.teamIds.length > 500) throw new RefereeServiceError("球队名单重复或过多。");
      const teams = await tx.team.findMany({ where: { id: { in: input.teamIds }, competitionId } });
      if (teams.length !== input.teamIds.length) throw new RefereeServiceError("球队不属于当前赛事。");
      const other = await tx.teamGroupMembership.findFirst({ where: { stageId: group.stageId, teamId: { in: input.teamIds }, groupId: { not: group.id } } });
      if (other) throw new RefereeServiceError("所选球队已属于本阶段其他组，请先人工解除原组关系。");
      const removed = group.members.map((m) => m.teamId).filter((id) => !input.teamIds.includes(id));
      if (removed.length && await tx.match.count({ where: { groupId: group.id, OR: [{ homeTeamId: { in: removed } }, { awayTeamId: { in: removed } }] } })) throw new RefereeServiceError("移出的球队已有本组比赛，请先重新归类比赛；已完赛比赛不允许静默改组。", 409);
      await tx.teamGroupMembership.deleteMany({ where: { groupId: group.id } });
      for (const team of teams) await tx.teamGroupMembership.create({ data: { stageId: group.stageId, groupId: group.id, teamId: team.id } });
      result = { count: teams.length };
    } else {
      try {
        if (input.entity === "stage") result = await tx.competitionStage.delete({ where: { id: input.id, competitionId } });
        else if (input.entity === "group") result = await tx.competitionGroup.delete({ where: { id: input.id, stage: { competitionId } } });
        else result = await tx.competitionRound.delete({ where: { id: input.id, stage: { competitionId } } });
      } catch { throw new RefereeServiceError("结构仍被比赛、成员或历史确认引用，请重新归类后处理，不可删除历史。", 409); }
    }
    await tx.auditLog.create({ data: { actorType: "ADMIN", actorId: actor.id, action: "COMPETITION_STRUCTURE_CHANGED", entityType: "Competition", entityId: competitionId, summary: "人工维护赛程结构", metadata: JSON.stringify(input) } });
    return result;
  });
}

export async function getGroupStandings(groupId: string, db: Db = prisma) {
  const group = await db.competitionGroup.findUnique({ where: { id: groupId }, include: { stage: { include: { competition: { select: { isTestData: true } } } }, members: { include: { team: { select: { id: true, name: true } } }, orderBy: { teamId: "asc" } }, matches: { orderBy: { id: "asc" }, select: { id: true, homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true, status: true, isTestData: true, resultVersion: true, stageId: true, competitionId: true, updatedAt: true } }, confirmations: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] } } });
  if (!group) throw new RefereeServiceError("小组不存在。", 404);
  const memberIds = new Set(group.members.map((m) => m.teamId));
  const matches = group.matches.filter((m) => !m.isTestData && m.stageId === group.stageId && m.competitionId === group.stage.competitionId && m.homeTeamId !== m.awayTeamId && memberIds.has(m.homeTeamId) && memberIds.has(m.awayTeamId));
  const fingerprint = createHash("sha256").update(JSON.stringify({ members: group.members.map((m) => m.teamId), matches: matches.map((m) => [m.id, m.homeTeamId, m.awayTeamId, m.homeScore, m.awayScore, m.status, m.resultVersion, m.updatedAt]) })).digest("hex");
  const rows = calculateStandings(group.members.map((m) => m.team), group.stage.type === "GROUP" && !group.stage.competition.isTestData ? matches : []);
  const hasResults = rows.some((r) => r.played > 0);
  const tied = hasResults && rows.some((r, i) => rows.some((other, j) => i !== j && other.points === r.points));
  const latestRanking = group.confirmations.find((c) => c.kind === "RANKING" || c.kind === "AUTO");
  const ranking = latestRanking?.kind === "RANKING" && latestRanking.fingerprint === fingerprint ? latestRanking : null;
  const latestQualification = group.confirmations.find((c) => c.kind === "QUALIFICATION");
  const qualificationFingerprint = createHash("sha256").update(fingerprint + (latestRanking?.id ?? "")).digest("hex");
  const qualification = latestQualification?.fingerprint === qualificationFingerprint ? latestQualification : null;
  const order = ranking?.teamIds as string[] | undefined;
  const staleTeamIds = latestQualification && !qualification ? latestQualification.teamIds as string[] : [];
  const affectedMatches = staleTeamIds.length ? await db.match.findMany({ where: { competitionId: group.stage.competitionId, structureStage: { type: "KNOCKOUT" }, OR: [{ homeTeamId: { in: staleTeamIds } }, { awayTeamId: { in: staleTeamIds } }] }, select: { id: true, status: true, homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } } }, orderBy: { kickoff: "asc" } }) : [];
  return { group: { id: group.id, name: group.name, stageName: group.stage.name, competitionId: group.stage.competitionId }, rows: order ? [...rows].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)) : rows, fingerprint, qualificationFingerprint, hasResults, tied, rankingConfirmed: Boolean(ranking), rankingStale: latestRanking?.kind === "RANKING" && !ranking, qualificationStale: Boolean(latestQualification && !qualification), qualifiedTeamIds: (qualification?.teamIds ?? []) as string[], affectedMatches, allCompleted: matches.length > 0 && matches.every((m) => (m.status === "COMPLETED" && m.homeScore !== null && m.awayScore !== null) || m.status === "CANCELLED") };
}

export async function confirmGroup(competitionId: string, groupId: string, input: { kind: "RANKING" | "AUTO" | "QUALIFICATION"; teamIds: string[]; fingerprint: string; reason: string }, actor: UnifiedAdminActor) {
  assertUnifiedAdminPermission(actor, "competitions:write");
  return prisma.$transaction(async (tx) => {
    const table = await getGroupStandings(groupId, tx);
    if (table.group.competitionId !== competitionId) throw new RefereeServiceError("小组不属于当前赛事。");
    if (input.fingerprint !== (input.kind === "QUALIFICATION" ? table.qualificationFingerprint : table.fingerprint)) throw new RefereeServiceError("赛果或组成员已变化，请重新检查。", 409);
    if (!input.reason.trim() || input.reason.length > 500) throw new RefereeServiceError("请填写确认原因或适用规程。");
    const ids = table.rows.map((r) => r.id);
    if (new Set(input.teamIds).size !== input.teamIds.length || input.teamIds.some((id) => !ids.includes(id))) throw new RefereeServiceError("名单包含重复或跨组球队。");
    if (input.kind === "RANKING") {
      if (input.teamIds.length !== ids.length) throw new RefereeServiceError("排名必须包含本组全部球队。");
      const points = new Map(table.rows.map((r) => [r.id, r.points]));
      if (input.teamIds.some((id, i) => i > 0 && points.get(input.teamIds[i - 1])! < points.get(id)!)) throw new RefereeServiceError("人工次序仅能调整同积分球队。");
    }
    if (input.kind === "QUALIFICATION" && !input.teamIds.length) throw new RefereeServiceError("请选择出线球队。");
    if (input.kind === "QUALIFICATION" && (!table.allCompleted || (table.tied && !table.rankingConfirmed)) && !input.reason.startsWith("提前确认：")) throw new RefereeServiceError("小组未结束或同分次序未确认；例外请明确填写“提前确认：”及原因。", 409);
    const result = await tx.groupConfirmation.create({ data: { groupId, ...input, teamIds: input.teamIds, actorId: actor.id } });
    await tx.auditLog.create({ data: { actorType: "ADMIN", actorId: actor.id, action: "GROUP_CONFIRMATION", entityType: "CompetitionGroup", entityId: groupId, summary: "人工确认排名或出线，不生成下一轮比赛", metadata: JSON.stringify(input) } });
    return result;
  });
}
