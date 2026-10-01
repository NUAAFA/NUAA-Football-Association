import type {
  AdminRole,
  AffiliationUnitType,
  AppointmentPositionKey,
  AvailabilityKind,
  CompetitionFormat,
  ConflictReportStatus,
  Prisma,
  TeamType,
} from "@/generated/prisma-v29/client";
import { prisma } from "@/lib/prisma";
import { completedAssignmentReviewReason } from "@/lib/referee-completion-evidence";
import {
  requireAdminServiceAuthorization,
  type AdminServiceAuthorization,
} from "@/lib/privileged-service-authorization";
import type { AdminActor } from "@/lib/referee-service";
import { RefereeServiceError } from "@/lib/referee-service";
import { hashPassword, verifyPassword } from "@/lib/referee-security";
import { ensureOrganizationTeam } from "@/lib/referee-team-service";
import { getStudentIdPrefix } from "@/lib/student-id";

async function audit(input: {
  actorType: "ADMIN" | "REFEREE";
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string;
  summary: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.auditLog.create({
    data: {
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      summary: input.summary,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });
}

export async function inferCollegeSuggestion(studentId: string) {
  const prefix = getStudentIdPrefix(studentId);
  if (prefix.length !== 2) return null;
  return prisma.collegeCodeMapping.findUnique({
    where: { prefix },
    select: { prefix: true, college: { select: { id: true, name: true } } },
  });
}

export async function createCollege(name: string, actor: AdminActor) {
  return createAffiliationUnit(name, "COLLEGE", actor);
}

export async function createAffiliationUnit(
  name: string,
  type: AffiliationUnitType,
  actor: AdminActor,
) {
  const unit = await prisma.$transaction(async (tx) => {
    if (type === "COLLEGE") {
      const college = await tx.college.create({ data: { name } });
      return tx.affiliationUnit.create({
        data: { id: college.id, name, type, legacyCollegeId: college.id },
      });
    }
    return tx.affiliationUnit.create({ data: { name, type } });
  });
  await audit({
    actorType: "ADMIN",
    actorId: actor.id,
    action: "AFFILIATION_UNIT_CREATED",
    entityType: "AffiliationUnit",
    entityId: unit.id,
    summary: `创建${type === "COLLEGE" ? "学院" : "书院"} ${unit.name}`,
    metadata: { type },
  });
  return unit;
}

export async function setAffiliationUnitChildren(
  parentUnitId: string,
  childUnitIds: string[],
  actor: AdminActor,
) {
  const uniqueIds = [...new Set(childUnitIds)].filter((id) => id !== parentUnitId);
  return prisma.$transaction(async (tx) => {
    const parent = await tx.affiliationUnit.findUnique({ where: { id: parentUnitId } });
    if (!parent || parent.type !== "SHUYUAN") throw new RefereeServiceError("组织关系上级必须是有效书院。");
    const children = await tx.affiliationUnit.findMany({ where: { id: { in: uniqueIds }, type: "COLLEGE" } });
    if (children.length !== uniqueIds.length) throw new RefereeServiceError("书院组成关系包含无效学院。");
    await tx.affiliationUnitRelation.deleteMany({ where: { parentUnitId } });
    if (uniqueIds.length) {
      await tx.affiliationUnitRelation.createMany({
        data: uniqueIds.map((childUnitId) => ({ parentUnitId, childUnitId })),
      });
    }
    await tx.auditLog.create({
      data: {
        actorType: "ADMIN", actorId: actor.id, action: "AFFILIATION_RELATIONS_UPDATED",
        entityType: "AffiliationUnit", entityId: parent.id,
        summary: `更新书院 ${parent.name} 的组成单位`,
        metadata: JSON.stringify({ childUnitIds: uniqueIds }),
      },
    });
    return parent;
  });
}

export async function upsertCollegeCodeMapping(
  prefix: string,
  collegeId: string,
  note: string,
  actor: AdminActor,
) {
  const normalizedPrefix = prefix.trim().toUpperCase();
  if (!/^[0-9A-Z]{2}$/.test(normalizedPrefix)) throw new RefereeServiceError("学号前缀必须是两位数字或字母。");
  const mapping = await prisma.collegeCodeMapping.upsert({
    where: { prefix: normalizedPrefix },
    update: { collegeId, note: note || null },
    create: { prefix: normalizedPrefix, collegeId, note: note || null },
  });
  await audit({
    actorType: "ADMIN",
    actorId: actor.id,
    action: "COLLEGE_CODE_MAPPING_UPDATED",
    entityType: "CollegeCodeMapping",
    entityId: mapping.id,
    summary: `更新学号前缀映射 ${normalizedPrefix}`,
    metadata: { collegeId },
  });
  return mapping;
}

export async function setTeamAffiliations(
  teamId: string,
  collegeIds: string[],
  actor: AdminActor,
) {
  const teamType: TeamType = collegeIds.length > 1 ? "JOINT" : collegeIds.length === 1 ? "ORGANIZATION" : "FREEFORM";
  return setTeamUnitAffiliations(teamId, collegeIds, teamType, actor);
}

export async function setTeamUnitAffiliations(
  teamId: string,
  unitIds: string[],
  teamType: TeamType,
  actor: AdminActor,
) {
  const uniqueIds = [...new Set(unitIds)];
  if (teamType === "ORGANIZATION" && uniqueIds.length !== 1) {
    throw new RefereeServiceError("固定组织代表队须关联一个组织单位。");
  }
  if (teamType === "JOINT" && uniqueIds.length < 2) {
    throw new RefereeServiceError("联合队须关联至少两个组织单位。");
  }
  const result = await prisma.$transaction(async (tx) => {
    const team = await tx.team.findUnique({ where: { id: teamId }, select: { id: true, name: true, competitionId: true } });
    if (!team) throw new RefereeServiceError("球队不存在。", 404);
    const units = await tx.affiliationUnit.findMany({ where: { id: { in: uniqueIds } }, select: { id: true, legacyCollegeId: true } });
    if (units.length !== uniqueIds.length) throw new RefereeServiceError("球队组织关联包含无效单位。");
    await tx.teamUnitAffiliation.deleteMany({ where: { teamId } });
    if (uniqueIds.length) {
      await tx.teamUnitAffiliation.createMany({ data: uniqueIds.map((unitId) => ({ teamId, unitId })) });
    }
    // Keep the R1 college bridge synchronized for existing reads and rollback safety.
    await tx.teamAffiliation.deleteMany({ where: { teamId } });
    const legacyCollegeIds = units.flatMap((unit) => unit.legacyCollegeId ? [unit.legacyCollegeId] : []);
    if (legacyCollegeIds.length) {
      await tx.teamAffiliation.createMany({
        data: legacyCollegeIds.map((collegeId) => ({ teamId, collegeId })),
      });
    }
    await tx.team.update({ where: { id: teamId }, data: { teamType } });
    await tx.auditLog.create({
      data: {
        actorType: "ADMIN",
        actorId: actor.id,
        action: "TEAM_AFFILIATIONS_UPDATED",
        entityType: "Team",
        entityId: teamId,
        summary: `更新球队 ${team.name} 的组织关联`,
        metadata: JSON.stringify({ unitIds: uniqueIds, teamType }),
      },
    });
    return team;
  });
  return result;
}

function normalizedTeamNames(names: string[]) {
  const seen = new Set<string>();
  return names.map((name) => name.trim()).filter((name) => {
    if (!name || name.length > 80) return false;
    const key = name.toLocaleLowerCase("zh-CN");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function createTeamsBulk(input: {
  competitionId: string;
  names: string[];
  actor: AdminActor;
}) {
  const names = normalizedTeamNames(input.names);
  if (!names.length) throw new RefereeServiceError("没有可创建的球队。");
  return prisma.$transaction(async (tx) => {
    const competition = await tx.competition.findUnique({ where: { id: input.competitionId }, select: { id: true, name: true } });
    if (!competition) throw new RefereeServiceError("赛事不存在。", 404);
    const existing = await tx.team.findMany({ where: { competitionId: input.competitionId }, select: { name: true } });
    const existingKeys = new Set(existing.map((item) => item.name.toLocaleLowerCase("zh-CN")));
    const createNames = names.filter((name) => !existingKeys.has(name.toLocaleLowerCase("zh-CN")));
    if (createNames.length) {
      await tx.team.createMany({ data: createNames.map((name) => ({ competitionId: input.competitionId, name, teamType: "FREEFORM" })) });
    }
    await tx.auditLog.create({
      data: {
        actorType: "ADMIN", actorId: input.actor.id, action: "TEAMS_BULK_CREATED",
        entityType: "Competition", entityId: input.competitionId,
        summary: `为赛事 ${competition.name} 批量创建 ${createNames.length} 支自由组队球队`,
        metadata: JSON.stringify({ createdNames: createNames, skippedExisting: names.filter((name) => !createNames.includes(name)) }),
      },
    });
    return { createdNames: createNames, skippedExisting: names.filter((name) => !createNames.includes(name)) };
  });
}

export async function createTeamsFromUnits(input: {
  competitionId: string;
  unitIds: string[];
  actor: AdminActor;
}) {
  const unitIds = [...new Set(input.unitIds)];
  if (!unitIds.length) throw new RefereeServiceError("请选择至少一个组织单位。");
  return prisma.$transaction(async (tx) => {
    const competition = await tx.competition.findUnique({ where: { id: input.competitionId } });
    if (!competition) throw new RefereeServiceError("赛事不存在。", 404);
    const units = await tx.affiliationUnit.findMany({ where: { id: { in: unitIds } }, select: { id: true, name: true } });
    if (units.length !== unitIds.length) throw new RefereeServiceError("包含无效组织单位。");
    const createdNames: string[] = [];
    for (const unit of units) {
      const result = await ensureOrganizationTeam(tx, {
        competitionId: input.competitionId,
        unitId: unit.id,
      });
      if (result.created) createdNames.push(unit.name);
    }
    await tx.auditLog.create({
      data: {
        actorType: "ADMIN", actorId: input.actor.id, action: "ORGANIZATION_TEAMS_CREATED",
        entityType: "Competition", entityId: input.competitionId,
        summary: `从组织单位创建 ${createdNames.length} 支代表队`,
        metadata: JSON.stringify({ unitIds, createdNames }),
      },
    });
    return { createdNames };
  });
}

export async function createOrganizationTeam(input: {
  competitionId: string;
  unitId: string;
  name: string;
  actor: AdminActor;
}) {
  const name = input.name.trim();
  if (!name || name.length > 80) throw new RefereeServiceError("球队名称须为 1 至 80 个字符。");
  return prisma.$transaction(async (tx) => {
    const competition = await tx.competition.findUnique({ where: { id: input.competitionId }, select: { id: true } });
    const unit = await tx.affiliationUnit.findUnique({ where: { id: input.unitId }, select: { id: true, legacyCollegeId: true } });
    if (!competition) throw new RefereeServiceError("赛事不存在。", 404);
    if (!unit) throw new RefereeServiceError("组织单位不存在。", 404);
    const duplicate = await tx.team.findUnique({ where: { competitionId_name: { competitionId: input.competitionId, name } }, select: { id: true } });
    if (duplicate) throw new RefereeServiceError(`当前赛事已存在球队“${name}”。`, 409);
    const team = await tx.team.create({ data: {
      competitionId: input.competitionId, name, teamType: "ORGANIZATION",
      unitAffiliations: { create: { unitId: unit.id } },
      affiliations: unit.legacyCollegeId ? { create: { collegeId: unit.legacyCollegeId } } : undefined,
    } });
    await tx.auditLog.create({ data: {
      actorType: "ADMIN", actorId: input.actor.id, action: "ORGANIZATION_TEAM_CREATED",
      entityType: "Team", entityId: team.id, summary: `创建组织代表队 ${team.name}`,
      metadata: JSON.stringify({ competitionId: input.competitionId, unitId: unit.id }),
    } });
    return team;
  });
}

export async function createJointTeam(input: {
  competitionId: string;
  name: string;
  unitIds: string[];
  actor: AdminActor;
}) {
  const unitIds = [...new Set(input.unitIds)];
  if (unitIds.length < 2) throw new RefereeServiceError("联合队须选择至少两个组织单位。");
  const name = input.name.trim();
  if (!name || name.length > 80) throw new RefereeServiceError("联合队名称须为 1 至 80 个字符。");
  return prisma.$transaction(async (tx) => {
    const competition = await tx.competition.findUnique({ where: { id: input.competitionId }, select: { id: true } });
    if (!competition) throw new RefereeServiceError("赛事不存在。", 404);
    const duplicate = await tx.team.findUnique({ where: { competitionId_name: { competitionId: input.competitionId, name } }, select: { id: true } });
    if (duplicate) throw new RefereeServiceError(`当前赛事已存在球队“${name}”。`, 409);
    const units = await tx.affiliationUnit.findMany({ where: { id: { in: unitIds } }, select: { id: true, legacyCollegeId: true } });
    if (units.length !== unitIds.length) throw new RefereeServiceError("包含无效组织单位。");
    const team = await tx.team.create({ data: { competitionId: input.competitionId, name, teamType: "JOINT" } });
    await tx.teamUnitAffiliation.createMany({ data: unitIds.map((unitId) => ({ teamId: team.id, unitId })) });
    const collegeIds = units.flatMap((unit) => unit.legacyCollegeId ? [unit.legacyCollegeId] : []);
    if (collegeIds.length) await tx.teamAffiliation.createMany({ data: collegeIds.map((collegeId) => ({ teamId: team.id, collegeId })) });
    await tx.auditLog.create({ data: { actorType: "ADMIN", actorId: input.actor.id, action: "JOINT_TEAM_CREATED", entityType: "Team", entityId: team.id, summary: `创建联合队 ${team.name}`, metadata: JSON.stringify({ unitIds }) } });
    return team;
  });
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export async function createHouse(
  input: { name: string; childUnitIds: string[] },
  authorization: AdminServiceAuthorization<"competitions:write">,
) {
  const actor = requireAdminServiceAuthorization(authorization, "competitions:write");
  const name = input.name.trim();
  const childUnitIds = [...new Set(input.childUnitIds)];
  try {
    return await prisma.$transaction(async (tx) => {
      const children = await tx.affiliationUnit.findMany({
        where: { id: { in: childUnitIds }, type: "COLLEGE" },
        select: { id: true, name: true },
      });
      if (children.length !== childUnitIds.length) {
        throw new RefereeServiceError("书院组成关系包含无效学院。");
      }
      const house = await tx.affiliationUnit.create({
        data: {
          name,
          type: "SHUYUAN",
          parentRelations: childUnitIds.length
            ? { create: childUnitIds.map((childUnitId) => ({ childUnitId })) }
            : undefined,
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: "ADMIN",
          actorId: actor.id,
          action: "HOUSE_CREATED",
          entityType: "AffiliationUnit",
          entityId: house.id,
          summary: `创建书院 ${house.name}`,
          metadata: JSON.stringify({ childUnitIds, childUnitNames: children.map((child) => child.name) }),
        },
      });
      return house;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new RefereeServiceError(`组织单位“${name}”已存在。`, 409);
    throw error;
  }
}

export async function updateHouse(
  id: string,
  nameValue: string,
  authorization: AdminServiceAuthorization<"competitions:write">,
) {
  const actor = requireAdminServiceAuthorization(authorization, "competitions:write");
  const name = nameValue.trim();
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.affiliationUnit.findUnique({ where: { id } });
      if (!existing || existing.type !== "SHUYUAN") throw new RefereeServiceError("书院不存在。", 404);
      const house = await tx.affiliationUnit.update({ where: { id }, data: { name } });
      await tx.auditLog.create({
        data: {
          actorType: "ADMIN",
          actorId: actor.id,
          action: "HOUSE_UPDATED",
          entityType: "AffiliationUnit",
          entityId: house.id,
          summary: `更新书院 ${house.name}`,
          metadata: JSON.stringify({ nameChange: { from: existing.name, to: house.name } }),
        },
      });
      return house;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new RefereeServiceError(`组织单位“${name}”已存在。`, 409);
    throw error;
  }
}

export async function setHouseChildren(
  parentUnitId: string,
  childUnitIds: string[],
  authorization: AdminServiceAuthorization<"competitions:write">,
) {
  const actor = requireAdminServiceAuthorization(authorization, "competitions:write");
  const uniqueIds = [...new Set(childUnitIds)].filter((id) => id !== parentUnitId);
  return prisma.$transaction(async (tx) => {
    const parent = await tx.affiliationUnit.findUnique({
      where: { id: parentUnitId },
      include: { parentRelations: { select: { childUnitId: true } } },
    });
    if (!parent || parent.type !== "SHUYUAN") throw new RefereeServiceError("书院不存在。", 404);
    const children = await tx.affiliationUnit.findMany({
      where: { id: { in: uniqueIds }, type: "COLLEGE" },
      select: { id: true, name: true },
    });
    if (children.length !== uniqueIds.length) throw new RefereeServiceError("书院组成关系包含无效学院。");
    await tx.affiliationUnitRelation.deleteMany({ where: { parentUnitId } });
    if (uniqueIds.length) {
      await tx.affiliationUnitRelation.createMany({
        data: uniqueIds.map((childUnitId) => ({ parentUnitId, childUnitId })),
      });
    }
    await tx.auditLog.create({
      data: {
        actorType: "ADMIN",
        actorId: actor.id,
        action: "HOUSE_RELATIONSHIP_UPDATED",
        entityType: "AffiliationUnit",
        entityId: parent.id,
        summary: `更新书院 ${parent.name} 的组成学院`,
        metadata: JSON.stringify({
          previousChildUnitIds: parent.parentRelations.map((relation) => relation.childUnitId),
          childUnitIds: uniqueIds,
          childUnitNames: children.map((child) => child.name),
        }),
      },
    });
    return parent;
  });
}

export async function deleteHouseSafely(
  id: string,
  confirmationName: string,
  authorization: AdminServiceAuthorization<"competitions:write">,
) {
  const actor = requireAdminServiceAuthorization(authorization, "competitions:write");
  return prisma.$transaction(async (tx) => {
    const house = await tx.affiliationUnit.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        type: true,
        parentRelations: { select: { childUnit: { select: { id: true, name: true } } } },
        _count: { select: { childRelations: true, refereeLinks: true, currentReferees: true, teamLinks: true } },
      },
    });
    if (!house || house.type !== "SHUYUAN") throw new RefereeServiceError("书院不存在。", 404);
    if (confirmationName.trim() !== house.name) throw new RefereeServiceError("书院名称确认不一致，已取消删除。", 409);
    const reasons = [
      house._count.refereeLinks || house._count.currentReferees ? "裁判员归属" : "",
      house._count.teamLinks ? `${house._count.teamLinks} 条球队组织关系` : "",
      house._count.childRelations ? "其他组织组成关系" : "",
    ].filter(Boolean);
    if (reasons.length) {
      throw new RefereeServiceError(
        `书院“${house.name}”已有受保护引用（${reasons.join("、")}），不能删除。请保留历史并先调整相关归属。`,
        409,
      );
    }
    const members = house.parentRelations.map((relation) => relation.childUnit);
    await tx.affiliationUnit.delete({ where: { id: house.id } });
    await tx.auditLog.create({
      data: {
        actorType: "ADMIN",
        actorId: actor.id,
        action: "HOUSE_DELETED",
        entityType: "AffiliationUnit",
        entityId: house.id,
        summary: `删除书院 ${house.name}`,
        metadata: JSON.stringify({
          deletedAt: new Date().toISOString(),
          houseName: house.name,
          removedComposition: members,
          collegesDeleted: 0,
        }),
      },
    });
    return { id: house.id, name: house.name, removedComposition: members };
  });
}

export async function deleteTeamSafely(
  id: string,
  authorization: AdminServiceAuthorization<"competitions:write">,
) {
  const team = await prisma.team.findUnique({ where: { id }, select: { competitionId: true, name: true } });
  if (!team) throw new RefereeServiceError("球队不存在。", 404);
  const { removeCompetitionTeams } = await import("@/lib/competition-team-removal");
  await removeCompetitionTeams(team.competitionId, [id], "误添加", authorization);
  return { id, name: team.name, competitionId: team.competitionId };
}

export async function saveRefereeAvailability(input: {
  id?: string;
  refereeId: string;
  startAt: Date;
  endAt: Date;
  kind: AvailabilityKind;
  competitionFormat?: CompetitionFormat | null;
  note?: string;
  actor: { type: "ADMIN" | "REFEREE"; id: string | null };
}) {
  if (input.endAt <= input.startAt) throw new RefereeServiceError("结束时间必须晚于开始时间。");
  if (input.id) {
    const existing = await prisma.refereeAvailability.findUnique({ where: { id: input.id } });
    if (!existing || existing.refereeId !== input.refereeId) {
      throw new RefereeServiceError("可执裁时间记录不存在。", 404);
    }
  }
  const availability = input.id
    ? await prisma.refereeAvailability.update({
        where: { id: input.id },
        data: {
          startAt: input.startAt,
          endAt: input.endAt,
          kind: input.kind,
          competitionFormat: input.competitionFormat ?? null,
          note: input.note || null,
        },
      })
    : await prisma.refereeAvailability.create({
        data: {
          refereeId: input.refereeId,
          startAt: input.startAt,
          endAt: input.endAt,
          kind: input.kind,
          competitionFormat: input.competitionFormat ?? null,
          note: input.note || null,
        },
      });
  await audit({
    actorType: input.actor.type,
    actorId: input.actor.id,
    action: "REFEREE_AVAILABILITY_SAVED",
    entityType: "RefereeAvailability",
    entityId: availability.id,
    summary: "保存裁判员可执裁时间",
    metadata: {
      refereeId: input.refereeId,
      kind: input.kind,
      competitionFormat: input.competitionFormat ?? "BOTH",
    },
  });
  return availability;
}

export async function deleteRefereeAvailability(
  id: string,
  refereeId: string,
  actor: { type: "ADMIN" | "REFEREE"; id: string | null },
) {
  const existing = await prisma.refereeAvailability.findUnique({ where: { id } });
  if (!existing || existing.refereeId !== refereeId) {
    throw new RefereeServiceError("可执裁时间记录不存在。", 404);
  }
  await prisma.refereeAvailability.delete({ where: { id } });
  await audit({
    actorType: actor.type,
    actorId: actor.id,
    action: "REFEREE_AVAILABILITY_DELETED",
    entityType: "RefereeAvailability",
    entityId: id,
    summary: "删除裁判员可执裁时间",
    metadata: { refereeId },
  });
}

async function getCurrentPublishedVersion(appointmentId: string, refereeId: string, db: Prisma.TransactionClient) {
  const appointment = await db.refereeAppointment.findFirst({
    where: {
      id: appointmentId,
      status: "PUBLISHED",
      match: { status: "SCHEDULED" },
      positions: { some: { refereeId } },
    },
    select: {
      id: true,
      revision: true,
      versions: {
        where: { status: "PUBLISHED" },
        orderBy: { revision: "desc" },
        take: 1,
        select: { id: true, revision: true },
      },
    },
  });
  const version = appointment?.versions[0];
  if (!appointment || !version || version.revision !== appointment.revision) {
    throw new RefereeServiceError("当前没有可确认的已发布版本。", 409);
  }
  return { appointment, version };
}

export async function acknowledgeAppointment(appointmentId: string, refereeId: string) {
  return prisma.$transaction(async (tx) => {
  const { version } = await getCurrentPublishedVersion(appointmentId, refereeId, tx);
  const existing = await tx.appointmentAcknowledgement.findUnique({ where: { versionId_refereeId: { versionId: version.id, refereeId } } });
  if (existing) return existing;
  const acknowledgement = await tx.appointmentAcknowledgement.create({
    data: { appointmentId, versionId: version.id, refereeId },
  });
  await tx.auditLog.create({ data: {
    actorType: "REFEREE",
    actorId: refereeId,
    action: "APPOINTMENT_ACKNOWLEDGED",
    entityType: "RefereeAppointment",
    entityId: appointmentId,
    summary: "裁判员确认知悉已发布选派",
    metadata: JSON.stringify({ versionId: version.id }),
  } });
  return acknowledgement;
  });
}

export async function reportAppointmentConflict(
  appointmentId: string,
  refereeId: string,
  input: string | {
    reasonCode: "TIME_CONFLICT" | "UNABLE_TO_ATTEND" | "COURSE_EXAM" | "HEALTH" | "OTHER";
    explanation: string;
  },
) {
  const structuredInput = typeof input === "string"
    ? { reasonCode: "OTHER" as const, explanation: input }
    : input;
  if (!structuredInput.explanation.trim()) throw new RefereeServiceError("请填写冲突补充说明。");
  const reasonLabels = {
    TIME_CONFLICT: "时间冲突",
    UNABLE_TO_ATTEND: "临时无法到场",
    COURSE_EXAM: "课程/考试",
    HEALTH: "身体原因",
    OTHER: "其他",
  } as const;
  const explanation = structuredInput.explanation.trim();
  const reason = `${reasonLabels[structuredInput.reasonCode]}：${explanation}`;
  return prisma.$transaction(async (tx) => {
  const { version } = await getCurrentPublishedVersion(appointmentId, refereeId, tx);
  const report = await tx.appointmentConflictReport.upsert({
    where: { versionId_refereeId: { versionId: version.id, refereeId } },
    update: { reason, reasonCode: structuredInput.reasonCode, explanation, reportedAt: new Date(), status: "PENDING", resolutionNote: null, resolvedAt: null, resolvedByAdminId: null },
    create: { appointmentId, versionId: version.id, refereeId, reason, reasonCode: structuredInput.reasonCode, explanation },
  });
  await tx.auditLog.create({ data: {
    actorType: "REFEREE",
    actorId: refereeId,
    action: "APPOINTMENT_CONFLICT_REPORTED",
    entityType: "AppointmentConflictReport",
    entityId: report.id,
    summary: "裁判员报告已发布选派冲突",
    metadata: JSON.stringify({ appointmentId, versionId: version.id, reasonCode: structuredInput.reasonCode }),
  } });
  return report;
  });
}

export async function resolveAppointmentConflictReport(
  id: string,
  status: Exclude<ConflictReportStatus, "PENDING">,
  resolutionNote: string,
  actor: AdminActor,
) {
  if (!resolutionNote.trim()) throw new RefereeServiceError("请填写处理说明。");
  const report = await prisma.appointmentConflictReport.update({
    where: { id },
    data: { status, resolutionNote, resolvedAt: new Date(), resolvedByAdminId: actor.id },
  });
  await audit({
    actorType: "ADMIN",
    actorId: actor.id,
    action: "APPOINTMENT_CONFLICT_REPORT_RESOLVED",
    entityType: "AppointmentConflictReport",
    entityId: id,
    summary: `处理裁判选派冲突报告：${status}`,
    metadata: { appointmentId: report.appointmentId, resolutionNote },
  });
  return report;
}

export async function updateSelfRefereeProfile(
  refereeId: string,
  input: { phone?: string; qq?: string },
) {
  const referee = await prisma.referee.update({
    where: { id: refereeId },
    data: { phone: input.phone || null, qq: input.qq || null },
    select: { id: true, phone: true, qq: true },
  });
  await audit({
    actorType: "REFEREE",
    actorId: refereeId,
    action: "REFEREE_SELF_PROFILE_UPDATED",
    entityType: "Referee",
    entityId: refereeId,
    summary: "裁判员更新基础个人资料",
  });
  return referee;
}

export async function createAdminAccount(input: {
  username: string;
  displayName: string;
  password: string;
  role: AdminRole;
}, authorization: AdminServiceAuthorization<"system:write">) {
  const authorizedActor = requireAdminServiceAuthorization(authorization, "system:write");
  const actor: AdminActor = { id: authorizedActor.id, role: "SUPER_ADMIN" };
  const username = input.username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,64}$/.test(username)) {
    throw new RefereeServiceError("管理员账号须为 3 至 64 位字母、数字、点、下划线或连字符。");
  }
  if (input.password.length < 12) {
    throw new RefereeServiceError("管理员初始密码不能少于 12 个字符。");
  }
  const passwordHash = await hashPassword(input.password);
  const account = await prisma.adminAccount.create({
      data: {
        username,
        displayName: input.displayName,
        passwordHash,
        role: input.role,
        mustChangePassword: true,
      },
      select: { id: true, username: true, displayName: true, role: true, isActive: true },
    }).catch((error: unknown) => {
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      throw new RefereeServiceError("管理员账号已存在。", 409);
    }
    throw error;
  });
  await audit({
    actorType: "ADMIN",
    actorId: actor.id,
    action: "ADMIN_ACCOUNT_CREATED",
    entityType: "AdminAccount",
    entityId: account.id,
    summary: `创建管理员账号 ${account.username}`,
  });
  return account;
}

export async function setAdminAccountStatus(
  id: string,
  isActive: boolean,
  authorization: AdminServiceAuthorization<"system:write">,
) {
  const authorizedActor = requireAdminServiceAuthorization(authorization, "system:write");
  const actor: AdminActor = { id: authorizedActor.id, role: "SUPER_ADMIN" };
  if (actor.id === id && !isActive) throw new RefereeServiceError("不能停用当前登录账号。");
  const account = await prisma.adminAccount.update({
    where: { id },
    data: { isActive, ...(!isActive ? { sessions: { deleteMany: {} } } : {}) },
    select: { id: true, username: true, isActive: true },
  });
  await audit({
    actorType: "ADMIN",
    actorId: actor.id,
    action: "ADMIN_ACCOUNT_STATUS_UPDATED",
    entityType: "AdminAccount",
    entityId: id,
    summary: `${isActive ? "启用" : "停用"}管理员账号 ${account.username}`,
  });
  return account;
}

export async function changeAdminPassword(input: {
  adminAccountId: string;
  currentSessionId: string;
  currentPassword: string;
  newPassword: string;
}, authorization: AdminServiceAuthorization<"dashboard:read">) {
  const actor = requireAdminServiceAuthorization(authorization, "dashboard:read");
  if (!actor.id || actor.id !== input.adminAccountId) {
    throw new RefereeServiceError("可信服务授权上下文与管理员账号不匹配。", 403);
  }
  if (input.newPassword.length < 12) {
    throw new RefereeServiceError("管理员新密码不能少于 12 个字符。");
  }
  const account = await prisma.adminAccount.findUnique({
    where: { id: input.adminAccountId },
    select: { id: true, username: true, passwordHash: true, isActive: true },
  });
  if (
    !account?.isActive ||
    !(await verifyPassword(input.currentPassword, account.passwordHash))
  ) {
    throw new RefereeServiceError("当前管理员密码不正确。", 401);
  }
  if (await verifyPassword(input.newPassword, account.passwordHash)) {
    throw new RefereeServiceError("新密码不能与当前密码相同。");
  }
  const passwordHash = await hashPassword(input.newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.adminAccount.update({
      where: { id: account.id },
      data: { passwordHash, mustChangePassword: false },
    });
    await tx.adminSession.deleteMany({
      where: {
        adminAccountId: account.id,
        id: { not: input.currentSessionId },
      },
    });
    await tx.auditLog.create({
      data: {
        actorType: "ADMIN",
        actorId: account.id,
        action: "ADMIN_PASSWORD_CHANGED",
        entityType: "AdminAccount",
        entityId: account.id,
        summary: `管理员 ${account.username} 修改个人密码`,
      },
    });
  });
}

// Preserve incomplete legacy archives separately from verified match counts.
export async function getUnverifiedCompletedAssignments(options: {
  from?: Date;
  to?: Date;
  competitionId?: string;
  positionKey?: AppointmentPositionKey;
} = {}) {
  const now = new Date();
  const positions = { refereeId: { not: null }, ...(options.positionKey ? { key: options.positionKey } : {}) };
  const records = await prisma.refereeAppointment.findMany({
    where: {
      status: "COMPLETED",
      positions: { some: positions },
      match: {
        ...(options.competitionId ? { competitionId: options.competitionId } : {}),
        ...((options.from || options.to) ? { kickoff: { ...(options.from ? { gte: options.from } : {}), ...(options.to ? { lt: options.to } : {}) } } : {}),
        NOT: { status: "COMPLETED", kickoff: { lte: now }, homeScore: { not: null }, awayScore: { not: null } },
      },
    },
    select: {
      id: true,
      match: { select: { id: true, status: true, kickoff: true, homeScore: true, awayScore: true, competition: { select: { id: true, name: true } }, homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } } } },
      positions: { where: positions, select: { key: true, label: true, referee: { select: { id: true, name: true, publicCode: true } } } },
    },
    orderBy: { match: { kickoff: "desc" } },
  });
  return records.map((record) => ({ ...record, reviewReason: completedAssignmentReviewReason(record.match, now) }));
}

export async function getCompletedRefereeStatistics(options: {
  from?: Date;
  to?: Date;
  competitionId?: string;
  positionKey?: AppointmentPositionKey;
} = {}) {
  const positions = await prisma.appointmentPosition.findMany({
    where: {
      refereeId: { not: null },
      ...(options.positionKey ? { key: options.positionKey } : {}),
      appointment: {
        status: "COMPLETED",
        match: {
          status: "COMPLETED", kickoff: { lte: new Date() }, homeScore: { not: null }, awayScore: { not: null },
          ...(options.competitionId ? { competitionId: options.competitionId } : {}),
          ...((options.from || options.to) ? {
            kickoff: {
              ...(options.from ? { gte: options.from } : {}),
              lt: options.to && options.to < new Date() ? options.to : new Date(),
            },
          } : {}),
        },
      },
    },
    select: {
      refereeId: true,
      key: true,
      label: true,
      appointmentId: true,
      referee: { select: { publicCode: true, name: true } },
      appointment: {
        select: {
          completedAt: true,
          match: {
            select: {
              kickoff: true,
              competition: { select: { id: true, name: true, format: true } },
              homeTeam: { select: { name: true } },
              awayTeam: { select: { name: true } },
            },
          },
        },
      },
    },
    orderBy: { appointment: { match: { kickoff: "desc" } } },
  });
  const byReferee = new Map<string, {
    refereeId: string;
    publicCode: string;
    name: string;
    appointmentIds: Set<string>;
    positions: Record<string, number>;
    competitions: Record<string, { name: string; count: number }>;
    elevenASideAppointmentIds: Set<string>;
    futsalAppointmentIds: Set<string>;
    refereeRoleAppointmentIds: Set<string>;
    assistantRoleAppointmentIds: Set<string>;
    otherRoleAppointmentIds: Set<string>;
    mostRecentAssignment: Date | null;
    recent: Array<{ appointmentId: string; matchup: string; kickoff: Date; position: string }>;
  }>();
  for (const position of positions) {
    if (!position.refereeId || !position.referee || !position.appointment.match.kickoff) continue;
    const row = byReferee.get(position.refereeId) ?? {
      refereeId: position.refereeId,
      publicCode: position.referee.publicCode,
      name: position.referee.name,
      appointmentIds: new Set<string>(),
      positions: {},
      competitions: {},
      elevenASideAppointmentIds: new Set<string>(),
      futsalAppointmentIds: new Set<string>(),
      refereeRoleAppointmentIds: new Set<string>(),
      assistantRoleAppointmentIds: new Set<string>(),
      otherRoleAppointmentIds: new Set<string>(),
      mostRecentAssignment: null,
      recent: [],
    };
    row.appointmentIds.add(position.appointmentId);
    row.positions[position.key] = (row.positions[position.key] ?? 0) + 1;
    const competition = position.appointment.match.competition;
    if (competition.format === "ELEVEN_A_SIDE") row.elevenASideAppointmentIds.add(position.appointmentId);
    else if (competition.format === "FUTSAL") row.futsalAppointmentIds.add(position.appointmentId);
    if (position.key === "REFEREE") row.refereeRoleAppointmentIds.add(position.appointmentId);
    else if (["ASSISTANT_REFEREE_1", "ASSISTANT_REFEREE_2", "RESERVE_ASSISTANT_REFEREE", "SECOND_REFEREE"].includes(position.key)) row.assistantRoleAppointmentIds.add(position.appointmentId);
    else row.otherRoleAppointmentIds.add(position.appointmentId);
    if (!row.mostRecentAssignment || position.appointment.match.kickoff > row.mostRecentAssignment) {
      row.mostRecentAssignment = position.appointment.match.kickoff;
    }
    row.competitions[competition.id] = {
      name: competition.name,
      count: (row.competitions[competition.id]?.count ?? 0) + 1,
    };
    if (row.recent.length < 5) {
      row.recent.push({
        appointmentId: position.appointmentId,
        matchup: `${position.appointment.match.homeTeam.name} vs ${position.appointment.match.awayTeam.name}`,
        kickoff: position.appointment.match.kickoff,
        position: position.label,
      });
    }
    byReferee.set(position.refereeId, row);
  }
  return [...byReferee.values()].map((row) => ({
    refereeId: row.refereeId,
    publicCode: row.publicCode,
    name: row.name,
    totalMatches: row.appointmentIds.size,
    elevenASideCount: row.elevenASideAppointmentIds.size,
    futsalCount: row.futsalAppointmentIds.size,
    refereeRoleCount: row.refereeRoleAppointmentIds.size,
    assistantRoleCount: row.assistantRoleAppointmentIds.size,
    otherRoleCount: row.otherRoleAppointmentIds.size,
    mostRecentAssignment: row.mostRecentAssignment,
    positions: row.positions,
    competitions: Object.values(row.competitions),
    recent: row.recent,
  }));
}

export function capabilityInput(
  values: Array<{
    format: CompetitionFormat;
    positionKey: AppointmentPositionKey;
    status: "NOT_ASSIGNED" | "TRAINING" | "READY";
  }>,
) {
  return values;
}
