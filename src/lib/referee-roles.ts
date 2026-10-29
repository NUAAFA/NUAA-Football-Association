import type { AppointmentPositionKey, CompetitionFormat, PositionCapabilityStatus } from "@/generated/prisma-v29/client";

export type PositionDefinition = { key: AppointmentPositionKey; label: string; order: number };

export const positionTemplates: Record<CompetitionFormat, readonly PositionDefinition[]> = {
  ELEVEN_A_SIDE: [
    { key: "REFEREE", label: "裁判员", order: 1 },
    { key: "ASSISTANT_REFEREE_1", label: "第一助理裁判员", order: 2 },
    { key: "ASSISTANT_REFEREE_2", label: "第二助理裁判员", order: 3 },
    { key: "FOURTH_OFFICIAL", label: "第四官员", order: 4 },
    { key: "RESERVE_ASSISTANT_REFEREE", label: "候补助理裁判员", order: 5 },
  ],
  FUTSAL: [
    { key: "REFEREE", label: "裁判员", order: 1 },
    { key: "SECOND_REFEREE", label: "第二裁判员", order: 2 },
    { key: "THIRD_REFEREE", label: "第三裁判员", order: 3 },
    { key: "FOURTH_REFEREE", label: "第四裁判员", order: 4 },
    { key: "TIMEKEEPER", label: "计时员", order: 5 },
  ],
  CUSTOM: [],
};

export const formatLabels: Record<CompetitionFormat, string> = {
  ELEVEN_A_SIDE: "十一人制",
  FUTSAL: "五人制",
  CUSTOM: "无预设模板 / 自定义赛事",
};

export function getPositionTemplate(format: CompetitionFormat) {
  return positionTemplates[format];
}

export function hasPositionTemplate(format: CompetitionFormat) {
  return getPositionTemplate(format).length > 0;
}

export const capabilityStatusLabels: Record<PositionCapabilityStatus, string> = {
  NOT_ASSIGNED: "暂不安排",
  TRAINING: "培养中",
  READY: "可正式选派",
};

// Application intents accept trainees; NOT_ASSIGNED remains unavailable.
export function getApplicationPositionKeys(
  capabilities: ReadonlyArray<{ format: CompetitionFormat; positionKey: AppointmentPositionKey; status: PositionCapabilityStatus }>,
  format: CompetitionFormat,
) {
  return new Set(capabilities
    .filter((capability) => capability.format === format &&
      (capability.status === "TRAINING" || capability.status === "READY"))
    .map((capability) => capability.positionKey));
}
