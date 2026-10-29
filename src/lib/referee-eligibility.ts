import type {
  AppointmentPositionKey,
  CompetitionFormat,
  Prisma,
} from "@/generated/prisma-v29/client";
import { prisma } from "@/lib/prisma";
import { getApplicationPositionKeys } from "@/lib/referee-roles";
import { RefereeServiceError } from "@/lib/referee-service-error";

type EligibilityDb = Prisma.TransactionClient | typeof prisma;

type EligibilityReferee = {
  id: string;
  status: "PENDING_ACTIVATION" | "ACTIVE" | "INACTIVE" | "ARCHIVED";
  mustChangePassword: boolean;
  assignmentEligibility: "NOT_ELIGIBLE" | "ELIGIBLE" | "SUSPENDED";
  capabilities: Array<{
    format: CompetitionFormat;
    positionKey: AppointmentPositionKey;
    status: "NOT_ASSIGNED" | "TRAINING" | "READY";
  }>;
};

function assertActiveAndEligible(
  referee: EligibilityReferee,
  options: { requirePasswordChangeCleared: boolean; errorStatus: number },
) {
  if (referee.status !== "ACTIVE") {
    throw new RefereeServiceError("裁判员账号当前未启用，不能参加正式比赛报名或选派。", options.errorStatus);
  }
  if (options.requirePasswordChangeCleared && referee.mustChangePassword) {
    throw new RefereeServiceError("请先完成首次密码修改，再提交正式比赛报名。", options.errorStatus);
  }
  if (referee.assignmentEligibility === "SUSPENDED") {
    throw new RefereeServiceError("该裁判员的正式选派资格已暂停。", options.errorStatus);
  }
  if (referee.assignmentEligibility !== "ELIGIBLE") {
    throw new RefereeServiceError("该裁判员当前尚未获得正式选派资格。", options.errorStatus);
  }
}

async function getEligibilityReferee(
  refereeId: string,
  format: CompetitionFormat,
  db: EligibilityDb,
) {
  return db.referee.findUnique({
    where: { id: refereeId },
    select: {
      id: true,
      status: true,
      mustChangePassword: true,
      assignmentEligibility: true,
      capabilities: {
        where: { format },
        select: { format: true, positionKey: true, status: true },
      },
    },
  });
}

export async function assertRefereeCanApply(input: {
  refereeId: string;
  format: CompetitionFormat;
  preferredPositions: readonly AppointmentPositionKey[];
  requirePasswordChangeCleared?: boolean;
  db?: EligibilityDb;
}) {
  const db = input.db ?? prisma;
  const referee = await getEligibilityReferee(input.refereeId, input.format, db);
  if (!referee) throw new RefereeServiceError("裁判员账号不存在。", 404);
  assertActiveAndEligible(referee, {
    requirePasswordChangeCleared: input.requirePasswordChangeCleared ?? true,
    errorStatus: 403,
  });

  const selectablePositions = getApplicationPositionKeys(referee.capabilities, input.format);
  if (!selectablePositions.size) {
    throw new RefereeServiceError("该裁判员尚无本场赛制可选派的岗位能力。", 409);
  }
  if (!input.preferredPositions.some((positionKey) => selectablePositions.has(positionKey))) {
    throw new RefereeServiceError("所选意向岗位均为“暂不安排”，不能提交报名。", 409);
  }
  return referee;
}

export async function assertAppointmentPositionsEligible(input: {
  format: CompetitionFormat;
  positions: ReadonlyArray<{ refereeId: string | null; key: AppointmentPositionKey }>;
  db?: EligibilityDb;
}) {
  const db = input.db ?? prisma;
  const assigned = input.positions.filter(
    (position): position is { refereeId: string; key: AppointmentPositionKey } => Boolean(position.refereeId),
  );
  const refereeIds = [...new Set(assigned.map((position) => position.refereeId))];
  if (!refereeIds.length) return;

  const referees = await db.referee.findMany({
    where: { id: { in: refereeIds } },
    select: {
      id: true,
      status: true,
      mustChangePassword: true,
      assignmentEligibility: true,
      capabilities: {
        where: { format: input.format },
        select: { format: true, positionKey: true, status: true },
      },
    },
  });
  const byId = new Map(referees.map((referee) => [referee.id, referee]));

  for (const position of assigned) {
    const referee = byId.get(position.refereeId);
    if (!referee) throw new RefereeServiceError("岗位中包含不存在的裁判员。", 409);
    assertActiveAndEligible(referee, {
      requirePasswordChangeCleared: false,
      errorStatus: 409,
    });
    const capability = referee.capabilities.find(
      (item) => item.positionKey === position.key,
    );
    if (!capability || capability.status === "NOT_ASSIGNED") {
      throw new RefereeServiceError("岗位中包含赛制不匹配或该具体岗位为“暂不安排”的裁判员。", 409);
    }
  }
}
