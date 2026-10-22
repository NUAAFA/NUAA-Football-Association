import { prisma } from "@/lib/prisma";
import { sortTeamDirectory, teamDirectoryUnitSelect } from "@/lib/team-directory-order";
import { RefereeServiceError } from "@/lib/referee-service-error";
import {
  requireAdminServiceAuthorization,
  type AdminServiceAuthorization,
} from "@/lib/privileged-service-authorization";

type Authorization = AdminServiceAuthorization<"competitions:write">;

function text(value: unknown, label: string, max: number) {
  if (value !== null && value !== undefined && typeof value !== "string") throw new RefereeServiceError(`${label}格式不正确。`);
  const result = typeof value === "string" ? value.trim() : null;
  if (result && result.length > max) throw new RefereeServiceError(`${label}不能超过 ${max} 字。`);
  return result || null;
}

function email(value: unknown) {
  const result = text(value, "公开邮箱", 254);
  if (result && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(result)) {
    throw new RefereeServiceError("公开邮箱格式不正确。");
  }
  return result;
}

function boolean(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new RefereeServiceError(`${label}格式不正确。`);
  return value;
}

export async function getAdminTeamDirectory(competitionId?: string) {
  const [settings, competitions] = await Promise.all([
    prisma.teamDirectorySettings.findUnique({ where: { id: "current" } }),
    prisma.competition.findMany({
      where: { isTestData: false },
      select: { id: true, name: true, year: true, publicPublished: true, _count: { select: { teams: true } } },
      orderBy: [{ year: "desc" }, { name: "asc" }],
    }),
  ]);
  const [units, publicCounts] = await Promise.all([
    prisma.affiliationUnit.findMany({ select: { id: true, name: true, type: true }, orderBy: [{ type: "asc" }, { name: "asc" }] }),
    prisma.team.groupBy({ by: ["competitionId"], where: { directoryIsPublic: true, competitionId: { in: competitions.map((competition) => competition.id) } }, _count: { _all: true } }),
  ]);
  const publicCountByCompetition = new Map(publicCounts.map((item) => [item.competitionId, item._count._all]));
  const selectedId = competitionId || settings?.activeCompetitionId || competitions[0]?.id;
  const selected = competitions.find((competition) => competition.id === selectedId);
  const teams = selected ? await prisma.team.findMany({
    where: { competitionId: selected.id },
    select: {
      id: true, name: true, publicStatus: true, publicContactName: true,
      publicContactRole: true, publicContactQQ: true, publicContactEmail: true,
      publicDirectoryNote: true, directoryIsPublic: true, directoryPublicOrder: true,
      teamType: true, unitAffiliations: { select: { unit: { select: teamDirectoryUnitSelect } } },
    },
  }) : [];
  return { settings, competitions: competitions.map(({ _count, ...competition }) => ({ ...competition, teamCount: _count.teams, publicTeamCount: publicCountByCompetition.get(competition.id) ?? 0 })), units, selectedId: selected?.id ?? null, teams: sortTeamDirectory(teams).map(({ unitAffiliations, ...team }) => ({ ...team, units: unitAffiliations.map(({ unit }) => ({ id: unit.id, name: unit.name })) })) };
}

export async function updateTeamDirectorySettings(input: Record<string, unknown>, authorization: Authorization) {
  const actor = requireAdminServiceAuthorization(authorization, "competitions:write");
  const activeCompetitionId = text(input.activeCompetitionId, "当前赛事", 64);
  const directoryPublished = boolean(input.directoryPublished, "公开状态");
  const contactName = text(input.contactName, "负责人姓名", 80);
  const contactTitle = text(input.contactTitle, "职务", 80);
  const contactQQ = text(input.contactQQ, "咨询 QQ", 40);
  const contactEmail = email(input.contactEmail);
  return prisma.$transaction(async (tx) => {
    if (activeCompetitionId) {
      const competition = await tx.competition.findFirst({
        where: { id: activeCompetitionId, isTestData: false }, select: { id: true },
      });
      if (!competition) throw new RefereeServiceError("所选赛事不存在或属于测试数据。", 404);
    }
    if (directoryPublished && !activeCompetitionId) {
      throw new RefereeServiceError("公开目录前请先选择赛事。");
    }
    const previous = await tx.teamDirectorySettings.findUnique({ where: { id: "current" } });
    await tx.teamDirectorySettings.upsert({
      where: { id: "current" },
      create: { id: "current", activeCompetitionId, directoryPublished, contactName, contactTitle, contactQQ, contactEmail },
      update: { activeCompetitionId, directoryPublished, contactName, contactTitle, contactQQ, contactEmail },
    });
    await tx.auditLog.create({ data: {
      actorType: "ADMIN", actorId: actor.id, action: "TEAM_DIRECTORY_SETTINGS_UPDATED",
      entityType: "TeamDirectorySettings", entityId: "current", summary: "更新公开组队目录页设置",
      metadata: JSON.stringify({
        activeCompetitionId, previousActiveCompetitionId: previous?.activeCompetitionId ?? null,
        activeCompetitionChanged: previous?.activeCompetitionId !== activeCompetitionId,
        directoryPublished, previousDirectoryPublished: previous?.directoryPublished ?? false,
        contactChanged: previous?.contactName !== contactName || previous?.contactTitle !== contactTitle || previous?.contactQQ !== contactQQ || previous?.contactEmail !== contactEmail,
      }),
    } });
    if ((previous?.activeCompetitionId ?? null) !== activeCompetitionId) {
      await tx.auditLog.create({ data: {
        actorType: "ADMIN", actorId: actor.id, action: "TEAM_DIRECTORY_COMPETITION_SWITCHED",
        entityType: "TeamDirectorySettings", entityId: "current", summary: "切换当前公开组队目录赛事",
        metadata: JSON.stringify({ fromCompetitionId: previous?.activeCompetitionId ?? null, toCompetitionId: activeCompetitionId }),
      } });
    }
    return { activeCompetitionId };
  });
}

export async function updateTeamDirectoryEntry(teamId: string, competitionId: string, input: Record<string, unknown>, authorization: Authorization) {
  const actor = requireAdminServiceAuthorization(authorization, "competitions:write");
  const publicStatus = text(input.publicStatus, "组队状态", 80);
  const publicContactName = text(input.publicContactName, "负责人姓名", 80);
  const publicContactRole = text(input.publicContactRole, "负责人身份", 80);
  const publicContactQQ = text(input.publicContactQQ, "公开 QQ", 40);
  const publicContactEmail = email(input.publicContactEmail);
  const publicDirectoryNote = text(input.publicDirectoryNote, "公开说明", 1000);
  const directoryIsPublic = boolean(input.directoryIsPublic, "官网公开状态");
  const directoryPublicOrder = input.directoryPublicOrder;
  if (!Number.isSafeInteger(directoryPublicOrder) || (directoryPublicOrder as number) < 0 || (directoryPublicOrder as number) > 100000) {
    throw new RefereeServiceError("公开排序须为 0 至 100000 的整数。");
  }
  return prisma.$transaction(async (tx) => {
    const team = await tx.team.findFirst({
      where: { id: teamId, competitionId, competition: { isTestData: false } },
      select: { id: true, name: true },
    });
    if (!team) throw new RefereeServiceError("球队不属于所选赛事，或赛事为测试数据。", 404);
    await tx.team.update({ where: { id: teamId }, data: {
      publicStatus, publicContactName, publicContactRole, publicContactQQ,
      publicContactEmail, publicDirectoryNote, directoryIsPublic,
      directoryPublicOrder: directoryPublicOrder as number,
    } });
    await tx.auditLog.create({ data: {
      actorType: "ADMIN", actorId: actor.id, action: "TEAM_DIRECTORY_ENTRY_UPDATED",
      entityType: "Team", entityId: teamId, summary: `更新球队公开组队信息：${team.name}`,
      metadata: JSON.stringify({ competitionId, directoryIsPublic, directoryPublicOrder }),
    } });
    return { competitionId };
  });
}

export async function updateTeamDirectoryEntriesBulk(input: Record<string, unknown>, authorization: Authorization) {
  const actor = requireAdminServiceAuthorization(authorization, "competitions:write");
  const competitionId = text(input.competitionId, "赛事", 64);
  const rawIds = input.teamIds;
  if (!competitionId || !Array.isArray(rawIds) || rawIds.length === 0 || rawIds.length > 100 || rawIds.some((id) => typeof id !== "string" || !id || id.length > 64)) {
    throw new RefereeServiceError("请选择当前赛事中 1 至 100 支球队。");
  }
  const teamIds = [...new Set(rawIds as string[])];
  const action = input.action;
  if (action !== "recruiting" && action !== "formed" && action !== "publish" && action !== "hide") {
    throw new RefereeServiceError("批量操作无效。");
  }
  return prisma.$transaction(async (tx) => {
    const teams = await tx.team.findMany({ where: { id: { in: teamIds }, competitionId, competition: { isTestData: false } }, select: { id: true } });
    if (teams.length !== teamIds.length) throw new RefereeServiceError("所选球队不属于当前赛事。", 404);
    const data = action === "recruiting" ? { publicStatus: "招募中" } : action === "formed" ? { publicStatus: "已组队" } : { directoryIsPublic: action === "publish" };
    await tx.team.updateMany({ where: { id: { in: teamIds }, competitionId }, data });
    await tx.auditLog.create({ data: {
      actorType: "ADMIN", actorId: actor.id, action: "TEAM_DIRECTORY_BULK_UPDATED",
      entityType: "Competition", entityId: competitionId, summary: `批量更新 ${teamIds.length} 支球队的公开目录信息`,
      metadata: JSON.stringify({ action, teamIds }),
    } });
    return { count: teamIds.length };
  });
}
