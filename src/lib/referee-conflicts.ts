import type { AppointmentPositionKey, Prisma } from "@/generated/prisma-v29/client";
import { prisma } from "@/lib/prisma";

export type AppointmentWarningCode =
  | "COLLEGE_CONFLICT"
  | "UNAVAILABLE"
  | "MATCH_OVERLAP"
  | "ADJACENT_MATCH"
  | "CAPABILITY_TRAINING"
  | "CAPABILITY_NOT_ASSIGNED";

export type AppointmentWarning = {
  code: AppointmentWarningCode;
  refereeId: string;
  refereeName: string;
  message: string;
  severity: "HARD" | "OVERRIDABLE" | "ADVISORY";
  overridable: boolean;
  details: Record<string, string | number | null>;
};

export type ConflictPositionInput = {
  key: AppointmentPositionKey;
  refereeId: string | null;
};

type ConflictDb = Prisma.TransactionClient | typeof prisma;

function intervalsOverlap(firstStart: Date, firstEnd: Date, secondStart: Date, secondEnd: Date) {
  return firstStart < secondEnd && firstEnd > secondStart;
}

function distinctUnits<T extends { id: string }>(units: T[]) {
  return [...new Map(units.map((unit) => [unit.id, unit])).values()];
}

export async function detectAppointmentWarnings(
  matchId: string,
  positions: ConflictPositionInput[],
  db: ConflictDb = prisma,
): Promise<AppointmentWarning[]> {
  const refereeIds = [...new Set(positions.flatMap((item) => item.refereeId ? [item.refereeId] : []))];
  if (!refereeIds.length) return [];

  const match = await db.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      kickoff: true,
      venue: true,
      endAt: true,
      competition: { select: { format: true } },
      homeTeam: {
        select: {
          name: true,
          unitAffiliations: { select: { unit: { select: { id: true, name: true, type: true } } } },
          affiliations: { select: { college: { select: { id: true, name: true } } } },
        },
      },
      awayTeam: {
        select: {
          name: true,
          unitAffiliations: { select: { unit: { select: { id: true, name: true, type: true } } } },
          affiliations: { select: { college: { select: { id: true, name: true } } } },
        },
      },
    },
  });
  if (!match?.kickoff || !match.venue?.trim()) return [];

  const targetEndForAvailability = match.endAt ?? match.kickoff;
  const [referees, existingAssignments] = await Promise.all([
    db.referee.findMany({
      where: { id: { in: refereeIds } },
      select: {
        id: true,
        name: true,
        collegeId: true,
        college: { select: { id: true, name: true } },
        currentAffiliationUnit: { select: { id: true, name: true, type: true } },
        affiliations: { select: { unit: { select: { id: true, name: true, type: true } } } },
        capabilities: {
          where: { format: match.competition.format },
          select: { positionKey: true, status: true },
        },
        availability: {
          where: {
            kind: "UNAVAILABLE",
            startAt: { lte: targetEndForAvailability },
            endAt: { gte: match.kickoff },
            OR: [{ competitionFormat: null }, { competitionFormat: match.competition.format }],
          },
          select: { id: true, startAt: true, endAt: true, note: true },
        },
      },
    }),
    db.appointmentPosition.findMany({
      where: {
        refereeId: { in: refereeIds },
        appointment: {
          status: { in: ["PUBLISHED", "COMPLETED"] },
          matchId: { not: matchId },
          match: { status: { not: "CANCELLED" } },
        },
      },
      select: {
        refereeId: true,
        appointment: {
          select: {
            id: true,
            match: {
              select: {
                id: true,
                kickoff: true,
              venue: true,
                endAt: true,
                homeTeam: { select: { name: true } },
                awayTeam: { select: { name: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  const teamUnits = [
    ...distinctUnits([
      ...match.homeTeam.unitAffiliations.map((item) => item.unit),
      ...match.homeTeam.affiliations.map((item) => ({ ...item.college, type: "COLLEGE" as const })),
    ]).map((unit) => ({ teamName: match.homeTeam.name, unit })),
    ...distinctUnits([
      ...match.awayTeam.unitAffiliations.map((item) => item.unit),
      ...match.awayTeam.affiliations.map((item) => ({ ...item.college, type: "COLLEGE" as const })),
    ]).map((unit) => ({ teamName: match.awayTeam.name, unit })),
  ];
  const teamUnitIds = [...new Set(teamUnits.map((item) => item.unit.id))];
  const relations = teamUnitIds.length ? await db.affiliationUnitRelation.findMany({
    where: { OR: [{ parentUnitId: { in: teamUnitIds } }, { childUnitId: { in: teamUnitIds } }] },
    select: { parentUnitId: true, childUnitId: true },
  }) : [];

  const positionByReferee = new Map(positions.flatMap((position) => position.refereeId ? [[position.refereeId, position] as const] : []));
  const warnings: AppointmentWarning[] = [];

  for (const referee of referees) {
    const directUnits = distinctUnits([
      ...(referee.currentAffiliationUnit
        ? [referee.currentAffiliationUnit]
        : referee.affiliations.map((item) => item.unit)),
      ...(referee.college ? [{ ...referee.college, type: "COLLEGE" as const }] : []),
    ]);
    const organizationSignatures = new Set<string>();
    for (const team of teamUnits) {
      for (const refereeUnit of directUnits) {
        let message = "";
        if (refereeUnit.id === team.unit.id) {
          message = `⚠ 组织关联回避：${referee.name}所属${refereeUnit.name}与参赛方“${team.teamName}”关联单位一致。`;
        } else if (relations.some((relation) => relation.parentUnitId === team.unit.id && relation.childUnitId === refereeUnit.id)) {
          message = `⚠ 组织关联回避：${refereeUnit.name}为参赛方“${team.teamName}”所属${team.unit.name}的组成单位。`;
        } else if (relations.some((relation) => relation.childUnitId === team.unit.id && relation.parentUnitId === refereeUnit.id)) {
          message = `⚠ 组织关联回避：${referee.name}直接所属${refereeUnit.name}与参赛方“${team.teamName}”所属${team.unit.name}存在组成关系。`;
        }
        if (!message) continue;
        const signature = `${team.teamName}:${refereeUnit.id}:${team.unit.id}`;
        if (organizationSignatures.has(signature)) continue;
        organizationSignatures.add(signature);
        warnings.push({
          // Retain the established code so existing R1 API consumers remain compatible.
          code: "COLLEGE_CONFLICT",
          refereeId: referee.id,
          refereeName: referee.name,
          message,
          severity: "OVERRIDABLE",
          overridable: true,
          details: {
            refereeUnitId: refereeUnit.id,
            refereeUnitName: refereeUnit.name,
            teamUnitId: team.unit.id,
            teamUnitName: team.unit.name,
            teamName: team.teamName,
          },
        });
      }
    }

    const assignedPosition = positionByReferee.get(referee.id);
    if (assignedPosition) {
      const capability = referee.capabilities.find((item) => item.positionKey === assignedPosition.key);
      if (!capability || capability.status === "NOT_ASSIGNED") {
        warnings.push({
          code: "CAPABILITY_NOT_ASSIGNED",
          refereeId: referee.id,
          refereeName: referee.name,
          message: `岗位能力不满足：${referee.name}在本制式该岗位当前为“暂不安排”。`,
          severity: "HARD",
          overridable: false,
          details: { positionKey: assignedPosition.key, capabilityStatus: capability?.status ?? "NOT_ASSIGNED" },
        });
      } else if (capability.status === "TRAINING") {
        warnings.push({
          code: "CAPABILITY_TRAINING",
          refereeId: referee.id,
          refereeName: referee.name,
          message: `培养中，可选派：${referee.name}在本制式该岗位仍需关注培养状态。`,
          severity: "ADVISORY",
          overridable: false,
          details: { positionKey: assignedPosition.key, capabilityStatus: capability.status },
        });
      }
    }

    for (const unavailable of referee.availability) {
      if (match.endAt && !intervalsOverlap(match.kickoff, match.endAt, unavailable.startAt, unavailable.endAt)) continue;
      if (!match.endAt && !(unavailable.startAt <= match.kickoff && unavailable.endAt >= match.kickoff)) continue;
      warnings.push({
        code: "UNAVAILABLE",
        refereeId: referee.id,
        refereeName: referee.name,
        message: `⚠ 不可执裁：${referee.name}在本场时间段标记为不可执裁。`,
        severity: "HARD",
        overridable: false,
        details: {
          availabilityId: unavailable.id,
          startAt: unavailable.startAt.toISOString(),
          endAt: unavailable.endAt.toISOString(),
          note: unavailable.note,
        },
      });
    }

    // Match gaps and overlaps require both planned end times. No duration is inferred.
    if (!match.endAt) continue;
    const otherAssignments = existingAssignments.filter((item) => item.refereeId === referee.id);
    let nearestAdjacent: { gapMinutes: number; matchId: string; matchup: string; direction: "上一场" | "下一场" } | null = null;
    for (const item of otherAssignments) {
      const other = item.appointment.match;
      if (!other.kickoff || !other.venue?.trim() || !other.endAt) continue;
      const matchup = `${other.homeTeam.name} vs ${other.awayTeam.name}`;
      if (intervalsOverlap(match.kickoff, match.endAt, other.kickoff, other.endAt)) {
        const overlapMs = Math.min(match.endAt.getTime(), other.endAt.getTime()) - Math.max(match.kickoff.getTime(), other.kickoff.getTime());
        const overlapMinutes = Math.max(1, Math.round(overlapMs / 60_000));
        warnings.push({
          code: "MATCH_OVERLAP",
          refereeId: referee.id,
          refereeName: referee.name,
          message: `⚠ 时间重叠：${referee.name}与另一场比赛 ${matchup} 计划时间重叠 ${overlapMinutes} 分钟。`,
          severity: "HARD",
          overridable: false,
          details: {
            appointmentId: item.appointment.id,
            matchId: other.id,
            kickoff: other.kickoff.toISOString(),
            endAt: other.endAt.toISOString(),
            overlapMinutes,
          },
        });
        continue;
      }
      const previous = other.endAt <= match.kickoff;
      const gapMs = previous
        ? match.kickoff.getTime() - other.endAt.getTime()
        : other.kickoff.getTime() - match.endAt.getTime();
      if (gapMs < 0 || gapMs >= 10 * 60_000) continue;
      const candidate = {
        gapMinutes: Math.round(gapMs / 60_000),
        matchId: other.id,
        matchup,
        direction: previous ? "上一场" as const : "下一场" as const,
      };
      if (!nearestAdjacent || candidate.gapMinutes < nearestAdjacent.gapMinutes) nearestAdjacent = candidate;
    }
    if (nearestAdjacent) {
      warnings.push({
        code: "ADJACENT_MATCH",
        refereeId: referee.id,
        refereeName: referee.name,
        message: nearestAdjacent.gapMinutes === 0
          ? `⚠ 连续执裁：${referee.name}与${nearestAdjacent.direction}比赛 ${nearestAdjacent.matchup} 之间无休息时间。`
          : `⚠ 连续执裁：${referee.name}与${nearestAdjacent.direction}比赛 ${nearestAdjacent.matchup} 间隔仅 ${nearestAdjacent.gapMinutes} 分钟。`,
        severity: "ADVISORY",
        overridable: false,
        details: nearestAdjacent,
      });
    }
  }

  return warnings;
}

export function warningsRequiringOverride(warnings: AppointmentWarning[]) {
  return warnings.filter((warning) => warning.severity === "OVERRIDABLE");
}

export function hardAppointmentConflicts(warnings: AppointmentWarning[]) {
  return warnings.filter((warning) => warning.severity === "HARD");
}
