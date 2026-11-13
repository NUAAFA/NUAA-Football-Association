import { randomBytes } from "node:crypto";

import { Prisma, type AppointmentPositionKey } from "@/generated/prisma-v29/client";
import { RefereeServiceError } from "@/lib/referee-service-error";

export const defaultRefereeCapabilities = [
  ["ELEVEN_A_SIDE", "REFEREE", "READY"],
  ["ELEVEN_A_SIDE", "ASSISTANT_REFEREE_1", "READY"],
  ["ELEVEN_A_SIDE", "ASSISTANT_REFEREE_2", "READY"],
  ["ELEVEN_A_SIDE", "FOURTH_OFFICIAL", "READY"],
  ["ELEVEN_A_SIDE", "RESERVE_ASSISTANT_REFEREE", "READY"],
  ["FUTSAL", "REFEREE", "READY"],
  ["FUTSAL", "SECOND_REFEREE", "READY"],
  ["FUTSAL", "THIRD_REFEREE", "READY"],
  ["FUTSAL", "FOURTH_REFEREE", "READY"],
  ["FUTSAL", "TIMEKEEPER", "READY"],
] as const satisfies ReadonlyArray<readonly ["ELEVEN_A_SIDE" | "FUTSAL", AppointmentPositionKey, "READY"]>;

export function generateTemporaryRefereePassword() {
  return `${randomBytes(18).toString("base64url")}aA1!`;
}

export async function allocateRefereePublicCode(tx: Prisma.TransactionClient) {
  const rows = await tx.$queryRaw<Array<{ prefix: string; width: bigint; allocatedValue: bigint }>>(Prisma.sql`
    UPDATE "RefereePublicCodeSequence"
    SET "nextValue" = "nextValue" + 1,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = 'canonical'
    RETURNING "prefix", "width", "nextValue" - 1 AS "allocatedValue"
  `);
  const sequence = rows[0]
    ? { prefix: rows[0].prefix, width: Number(rows[0].width), nextValue: Number(rows[0].allocatedValue) }
    : null;
  if (!sequence) {
    throw new RefereeServiceError("裁判员编号序列尚未初始化，请先完成 R2 数据库迁移。", 409);
  }
  if (sequence.width !== 3 || sequence.prefix !== "" || sequence.nextValue < 1 || sequence.nextValue > 999) {
    throw new RefereeServiceError("现有裁判员编号规则无法安全续号，请管理员核验。", 409);
  }
  const publicCode = String(sequence.nextValue).padStart(sequence.width, "0");
  return publicCode;
}

export function onboardingCapabilitySummary() {
  return [
    "十一人制：全部五个岗位默认可正式选派；可在档案中手动调整",
    "五人制：全部五个岗位默认可正式选派；可在档案中手动调整",
  ];
}
