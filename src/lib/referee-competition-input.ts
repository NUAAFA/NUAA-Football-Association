import type { CompetitionFormat, CompetitionStatus } from "@/generated/prisma-v29/client";
import { parseBeijingDateTime } from "@/lib/beijing-datetime";
import { RefereeApiInputError } from "@/lib/referee-api";
import { normalizeCompetitionLines } from "@/lib/competition-presentation";
import type { CompetitionSystemValue } from "@/lib/competition-system";
import {
  isRecord,
  readBoolean,
  readEnum,
  readInteger,
  readShortText,
} from "@/lib/referee-validation";

export const competitionSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const competitionSemesterLabels = ["上半学期", "下半学期"] as const;

export type CompetitionMutationInput = {
  name: string;
  year: number | null;
  campus: string;
  format: CompetitionFormat;
  playingFormat: string;
  competitionSystem?: CompetitionSystemValue;
  status: CompetitionStatus;
  shortName: string | null;
  semesterLabel: string | null;
  teamFormation: string | null;
  publicPublished: boolean;
  homepageFeatured: boolean;
  publicOrder: number;
  registrationStartAt: Date | null;
  registrationEndAt: Date | null;
  matchStartAt: Date | null;
  matchEndAt: Date | null;
  venue: string | null;
  host: string | null;
  organizer: string | null;
  summary: string | null;
  notice: string | null;
  registrationUrl: string | null;
};

export type CompetitionCreateInput = CompetitionMutationInput & { slug: string };

function readCompetitionSlug(value: unknown) {
  if (typeof value !== "string" || value.length < 1 || value.length > 80) {
    throw new RefereeApiInputError("赛事 Slug 须为 1 至 80 个字符。");
  }
  if (!competitionSlugPattern.test(value)) {
    throw new RefereeApiInputError("赛事 Slug 只能使用小写字母、数字和单个连字符分段。");
  }
  return value;
}

function readOptionalText(value: unknown, label: string, maxLength: number) {
  return readShortText(value, label, maxLength, false) || null;
}

function readCompetitionLines(value: unknown, label: string, maxLength: number, required = false) {
  const text = normalizeCompetitionLines(readShortText(value, label, maxLength, required));
  return readShortText(text, label, maxLength, required);
}

function readRegistrationUrl(value: unknown) {
  const text = readOptionalText(value, "报名入口 URL", 500);
  if (!text) return null;
  if (!isAllowedCompetitionRegistrationUrl(text)) {
    throw new RefereeApiInputError("报名入口 URL 仅支持安全的 https:// 地址或以 / 开头的站内路径。");
  }
  return text;
}

export function isAllowedCompetitionRegistrationUrl(text: string) {
  if (text.startsWith("/")) {
    return !text.startsWith("//") && !text.includes("\\") && !/[\u0000-\u001f\u007f\s]/u.test(text);
  }
  try {
    const parsed = new URL(text);
    return parsed.protocol === "https:" && Boolean(parsed.hostname) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function readYear(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  return readInteger(value, "赛季年份", 1900, 2200);
}

function readMutationInput(value: Record<string, unknown>): CompetitionMutationInput {
  const registrationStartAt = parseBeijingDateTime(value.registrationStartAt, "报名开始时间") ?? null;
  const registrationEndAt = parseBeijingDateTime(value.registrationEndAt, "报名截止时间") ?? null;
  const matchStartAt = parseBeijingDateTime(value.matchStartAt, "比赛开始时间") ?? null;
  const matchEndAt = parseBeijingDateTime(value.matchEndAt, "比赛结束时间") ?? null;
  if (registrationStartAt && registrationEndAt && registrationStartAt > registrationEndAt) {
    throw new RefereeApiInputError("报名开始时间不能晚于报名截止时间。");
  }
  if (matchStartAt && matchEndAt && matchStartAt > matchEndAt) {
    throw new RefereeApiInputError("比赛开始时间不能晚于比赛结束时间。");
  }
  return {
    name: readShortText(value.name, "赛事名称", 120),
    year: readYear(value.year),
    campus: readCompetitionLines(value.campus, "校区", 60, true),
    format: readEnum(value.format, ["ELEVEN_A_SIDE", "FUTSAL", "CUSTOM"] as const, "裁判岗位模板"),
    playingFormat: readShortText(value.playingFormat, "比赛制式", 40),
    competitionSystem: value.competitionSystem === undefined
      ? undefined
      : readEnum(value.competitionSystem, ["GROUP_KNOCKOUT", "LEAGUE"] as const, "比赛形式"),
    status: readEnum(
      value.status,
      ["PREPARING", "REGISTRATION", "ONGOING", "COMPLETED"] as const,
      "赛事状态",
    ),
    shortName: readOptionalText(value.shortName, "赛事简称", 60),
    semesterLabel: value.semesterLabel === undefined || value.semesterLabel === null || value.semesterLabel === ""
      ? null
      : readEnum(value.semesterLabel, competitionSemesterLabels, "学期"),
    teamFormation: readOptionalText(value.teamFormation, "组队方式", 60),
    publicPublished: readBoolean(value.publicPublished ?? false, "公开发布"),
    homepageFeatured: readBoolean(value.homepageFeatured ?? false, "在首页赛事预告中展示"),
    publicOrder: readInteger(value.publicOrder ?? 0, "公开排序", -1000, 1000),
    registrationStartAt,
    registrationEndAt,
    matchStartAt,
    matchEndAt,
    venue: readCompetitionLines(value.venue, "比赛场地", 120) || null,
    host: readCompetitionLines(value.host, "主办单位", 240) || null,
    organizer: readCompetitionLines(value.organizer, "承办单位", 240) || null,
    summary: readOptionalText(value.summary, "赛事简介", 2000),
    notice: readOptionalText(value.notice, "赛事公告/说明", 4000),
    registrationUrl: readRegistrationUrl(value.registrationUrl),
  };
}

export function readCompetitionCreateInput(value: unknown): CompetitionCreateInput {
  if (!isRecord(value)) throw new RefereeApiInputError("赛事内容格式不正确。");
  return { slug: readCompetitionSlug(value.slug), ...readMutationInput(value) };
}

export function readCompetitionUpdateInput(value: unknown): CompetitionMutationInput {
  if (!isRecord(value)) throw new RefereeApiInputError("赛事内容格式不正确。");
  if (Object.prototype.hasOwnProperty.call(value, "slug")) {
    throw new RefereeApiInputError("赛事 Slug 创建后不可通过普通编辑修改。", 409);
  }
  return readMutationInput(value);
}
