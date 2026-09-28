import { createHash } from "node:crypto";

import type { Prisma, TeamType } from "@/generated/prisma-v29/client";
import {
  type CompetitionImportAction,
  type CompetitionImportCell,
  type CompetitionImportCommitResult,
  type CompetitionImportInput,
  type CompetitionImportIssue,
  type CompetitionImportPreview,
  type CompetitionImportPreviewRow,
} from "@/lib/competition-import-types";
import { assertMatchStructure } from "@/lib/competition-structure-service";
import { prisma } from "@/lib/prisma";
import {
  requireAdminServiceAuthorization,
  type AdminServiceAuthorization,
} from "@/lib/privileged-service-authorization";

type ImportDb = Prisma.TransactionClient | typeof prisma;

type LoadedTeam = {
  id: string;
  competitionId: string;
  name: string;
  teamType: TeamType;
  source: "MANUAL" | "FOOTBALL_CHINA";
  externalTeamId: string | null;
};

type LoadedMatch = {
  stageId: string | null; groupId: string | null; roundId: string | null;
  id: string;
  slug: string;
  competitionId: string;
  stage: string;
  kickoff: Date;
  endAt: Date | null;
  venue: string;
  round: string | null;
  source: "MANUAL" | "FOOTBALL_CHINA";
  externalMatchId: string | null;
  homeTeam: { id: string; name: string };
  awayTeam: { id: string; name: string };
};

type TeamPlan = {
  preview: CompetitionImportPreviewRow;
  name: string;
  teamType: TeamType;
  externalTeamId: string | null;
  action: CompetitionImportAction;
};

type MatchPlan = {
  stageId: string | null; groupId: string | null; roundId: string | null;
  preview: CompetitionImportPreviewRow;
  homeTeam: string;
  awayTeam: string;
  kickoff: Date;
  endAt: Date | null;
  venue: string;
  stage: string;
  round: string | null;
  externalMatchId: string | null;
  slug: string;
  action: CompetitionImportAction;
};

type ImportAnalysis = {
  preview: CompetitionImportPreview;
  currentTeams: LoadedTeam[];
  teamPlans: TeamPlan[];
  matchPlans: MatchPlan[];
  plannedMatchTeams: string[];
};

export class CompetitionImportServiceError extends Error {
  constructor(message: string, readonly status: 404 | 409) {
    super(message);
    this.name = "CompetitionImportServiceError";
  }
}

export class CompetitionImportCommitConflict extends CompetitionImportServiceError {
  constructor(message: string, readonly preview: CompetitionImportPreview) {
    super(message, 409);
    this.name = "CompetitionImportCommitConflict";
  }
}

function comparisonKey(value: string) {
  return value.trim().toLocaleLowerCase("zh-CN");
}

function displayCell(value: CompetitionImportCell | undefined) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
  return String(value);
}

function rawSummary(values: Record<string, CompetitionImportCell>) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, displayCell(value)]));
}

function issue(field: string, errorCode: string, message: string): CompetitionImportIssue {
  return { field, errorCode, message };
}

function readText(
  values: Record<string, CompetitionImportCell>,
  field: string,
  label: string,
  maxLength: number,
  errors: CompetitionImportIssue[],
  required = true,
) {
  const raw = values[field];
  if (raw instanceof Date || (raw !== null && raw !== undefined && typeof raw === "object")) {
    errors.push(issue(field, "INVALID_TEXT", `${label}必须是文本。`));
    return "";
  }
  const value = raw === null || raw === undefined ? "" : String(raw).trim();
  if (!value) {
    if (required) errors.push(issue(field, "REQUIRED", `${label}不能为空。`));
    return "";
  }
  if (value.length > maxLength) {
    errors.push(issue(field, "TOO_LONG", `${label}不能超过 ${maxLength} 个字符。`));
  }
  return value;
}

function parseTeamType(value: CompetitionImportCell | undefined, errors: CompetitionImportIssue[]) {
  const normalized = displayCell(value).trim().toLocaleUpperCase("en-US");
  if (!normalized) return "FREEFORM" satisfies TeamType;
  if (normalized === "ORGANIZATION" || normalized === "JOINT" || normalized === "FREEFORM") {
    return normalized satisfies TeamType;
  }
  errors.push(issue("teamType", "INVALID_TEAM_TYPE", "球队类型须为 ORGANIZATION、JOINT 或 FREEFORM。"));
  return "FREEFORM" satisfies TeamType;
}

function shanghaiWallClock(parts: [number, number, number, number, number, number]) {
  const [year, month, day, hour, minute, second] = parts;
  const wallClock = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    wallClock.getUTCFullYear() !== year ||
    wallClock.getUTCMonth() !== month - 1 ||
    wallClock.getUTCDate() !== day ||
    wallClock.getUTCHours() !== hour ||
    wallClock.getUTCMinutes() !== minute ||
    wallClock.getUTCSeconds() !== second
  ) return null;
  return new Date(wallClock.getTime() - 8 * 60 * 60 * 1_000);
}

export function parseCompetitionImportDate(
  value: CompetitionImportCell | undefined,
  field: string,
  label: string,
  errors: CompetitionImportIssue[],
  required = true,
) {
  if (value === null || value === undefined || String(value).trim() === "") {
    if (required) errors.push(issue(field, "REQUIRED", `${label}不能为空。`));
    return null;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      errors.push(issue(field, "INVALID_DATE", `${label}不是有效日期。`));
      return null;
    }
    const parsed = shanghaiWallClock([
      value.getUTCFullYear(),
      value.getUTCMonth() + 1,
      value.getUTCDate(),
      value.getUTCHours(),
      value.getUTCMinutes(),
      value.getUTCSeconds(),
    ]);
    if (parsed) return parsed;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    errors.push(issue(field, "INVALID_DATE", `${label}须使用 YYYY-MM-DD HH:mm 或带时区的 ISO 8601。`));
    return null;
  }
  const text = String(value).trim();
  const local = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (local) {
    const parsed = shanghaiWallClock([
      Number(local[1]),
      Number(local[2]),
      Number(local[3]),
      Number(local[4]),
      Number(local[5]),
      Number(local[6] ?? 0),
    ]);
    if (parsed) return parsed;
  }
  const zonedIso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(text);
  if (zonedIso) {
    const timestamp = Date.parse(text);
    if (!Number.isNaN(timestamp)) return new Date(timestamp);
  }
  errors.push(issue(field, "INVALID_OR_AMBIGUOUS_DATE", `${label}须使用 YYYY-MM-DD HH:mm（Asia/Shanghai）或带明确时区的 ISO 8601。`));
  return null;
}

function potentialNameMatch(name: string, candidate: string) {
  const simplify = (value: string) => comparisonKey(value)
    .replace(/\s+/g, "")
    .replace(/(?:足球代表队|足球队|代表队|球队|队)$/u, "");
  const left = simplify(name);
  const right = simplify(candidate);
  return left.length >= 2 && right.length >= 2 && left === right && comparisonKey(name) !== comparisonKey(candidate);
}

function stableMatchSlug(competitionSlug: string, kickoff: Date, homeTeam: string, awayTeam: string) {
  const base = competitionSlug
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36) || "competition";
  const local = new Date(kickoff.getTime() + 8 * 60 * 60 * 1_000);
  const timestamp = [
    local.getUTCFullYear(),
    String(local.getUTCMonth() + 1).padStart(2, "0"),
    String(local.getUTCDate()).padStart(2, "0"),
    String(local.getUTCHours()).padStart(2, "0"),
    String(local.getUTCMinutes()).padStart(2, "0"),
  ].join("");
  const hash = createHash("sha256")
    .update(`${competitionSlug}\0${kickoff.toISOString()}\0${comparisonKey(homeTeam)}\0${comparisonKey(awayTeam)}`)
    .digest("hex")
    .slice(0, 12);
  return `${base}-${timestamp}-${hash}`;
}

function naturalMatchKey(kickoff: Date, homeTeam: string, awayTeam: string) {
  return `${kickoff.toISOString()}\0${comparisonKey(homeTeam)}\0${comparisonKey(awayTeam)}`;
}

function makeSummary(rows: CompetitionImportPreviewRow[], plannedTeamCreates: number) {
  return {
    totalRows: rows.length,
    validRows: rows.filter((row) => row.action !== "ERROR" && row.action !== "CONFLICT").length,
    createRows: rows.filter((row) => row.action === "CREATE").length,
    reuseRows: rows.filter((row) => row.action === "REUSE_EXISTING").length,
    skipRows: rows.filter((row) => row.action === "SKIP_DUPLICATE").length,
    warningRows: rows.filter((row) => row.warnings.length > 0).length,
    conflictRows: rows.filter((row) => row.action === "CONFLICT").length,
    errorRows: rows.filter((row) => row.action === "ERROR").length,
    plannedTeamCreates,
  };
}

function makePreview(
  input: CompetitionImportInput,
  competition: { id: string; name: string; slug: string; publicPublished?: boolean; isTestData?: boolean },
  rows: CompetitionImportPreviewRow[],
  plannedTeamCreates: number,
): CompetitionImportPreview {
  return {
    publicImpact: Boolean(competition.publicPublished && !competition.isTestData),
    planHash: createHash("sha256").update(JSON.stringify({ inputHash: input.inputHash, publicImpact: Boolean(competition.publicPublished && !competition.isTestData), rows })).digest("hex"),
    competition,
    importType: input.importType,
    inputMethod: input.inputMethod,
    inputHash: input.inputHash,
    inputWarnings: input.inputWarnings,
    summary: makeSummary(rows, plannedTeamCreates),
    rows,
  };
}

async function loadCompetition(db: ImportDb, competitionId: string) {
  const competition = await db.competition.findUnique({
    where: { id: competitionId },
    select: { id: true, name: true, slug: true, publicPublished: true, isTestData: true },
  });
  if (!competition) throw new CompetitionImportServiceError("赛事不存在。", 404);
  return competition;
}

async function analyzeTeamImport(
  db: ImportDb,
  input: CompetitionImportInput,
  competition: { id: string; name: string; slug: string; publicPublished?: boolean; isTestData?: boolean },
): Promise<ImportAnalysis> {
  const requestedExternalIds = input.rows
    .map((row) => displayCell(row.values.externalTeamId).trim())
    .filter(Boolean);
  const [currentTeams, externalTeams] = await Promise.all([
    db.team.findMany({
      where: { competitionId: competition.id },
      select: { id: true, competitionId: true, name: true, teamType: true, source: true, externalTeamId: true },
    }),
    requestedExternalIds.length
      ? db.team.findMany({
          where: { source: "MANUAL", externalTeamId: { in: requestedExternalIds } },
          select: { id: true, competitionId: true, name: true, teamType: true, source: true, externalTeamId: true },
        })
      : Promise.resolve([]),
  ]);
  const existingByName = new Map(currentTeams.map((team) => [comparisonKey(team.name), team]));
  const existingByExternalId = new Map(externalTeams.flatMap((team) => team.externalTeamId ? [[team.externalTeamId, team] as const] : []));
  const seenNames = new Map<string, number>();
  const seenExternalIds = new Map<string, number>();
  const teamPlans: TeamPlan[] = [];

  for (const row of input.rows) {
    const errors: CompetitionImportIssue[] = [];
    const warnings: CompetitionImportIssue[] = [];
    const name = readText(row.values, "name", "球队名称", 80, errors);
    const teamType = parseTeamType(row.values.teamType, errors);
    const externalTeamId = readText(row.values, "externalTeamId", "外部球队 ID", 120, errors, false) || null;
    const preview: CompetitionImportPreviewRow = {
      rowNumber: row.rowNumber,
      raw: rawSummary(row.values),
      normalized: { name: name || null, teamType, externalTeamId },
      action: errors.length ? "ERROR" : "CREATE",
      warnings,
      errors,
    };

    if (!errors.length) {
      const key = comparisonKey(name);
      const duplicateRow = seenNames.get(key);
      const duplicateExternalRow = externalTeamId ? seenExternalIds.get(externalTeamId) : undefined;
      if (duplicateRow !== undefined) {
        errors.push(issue("name", "DUPLICATE_INPUT", `与第 ${duplicateRow} 行球队重复。`));
        preview.action = "ERROR";
      } else if (duplicateExternalRow !== undefined) {
        errors.push(issue("externalTeamId", "DUPLICATE_INPUT_EXTERNAL_ID", `外部球队 ID 与第 ${duplicateExternalRow} 行重复。`));
        preview.action = "ERROR";
      } else {
        seenNames.set(key, row.rowNumber);
        if (externalTeamId) seenExternalIds.set(externalTeamId, row.rowNumber);
        const externalMatch = externalTeamId ? existingByExternalId.get(externalTeamId) : undefined;
        const exactMatch = existingByName.get(key);
        if (externalMatch && (externalMatch.competitionId !== competition.id || comparisonKey(externalMatch.name) !== key)) {
          errors.push(issue("externalTeamId", "EXTERNAL_TEAM_ID_CONFLICT", "外部球队 ID 已关联到其他球队或赛事。"));
          preview.action = "CONFLICT";
        } else if (exactMatch && externalTeamId && exactMatch.externalTeamId && exactMatch.externalTeamId !== externalTeamId) {
          errors.push(issue("externalTeamId", "EXISTING_TEAM_ID_CONFLICT", "同名球队已关联到不同的外部球队 ID。"));
          preview.action = "CONFLICT";
        } else if (externalMatch || exactMatch) {
          const existing = externalMatch ?? exactMatch!;
          preview.action = "REUSE_EXISTING";
          if (existing.teamType !== teamType) {
            warnings.push(issue("teamType", "EXISTING_TEAM_TYPE_PRESERVED", `已有球队类型为 ${existing.teamType}，导入不会自动覆盖。`));
          }
          if (externalTeamId && !existing.externalTeamId) {
            warnings.push(issue("externalTeamId", "EXTERNAL_ID_NOT_ATTACHED", "已有同名球队未绑定外部 ID；本次复用不会静默修改已有球队。"));
          }
        } else {
          const potential = currentTeams.find((team) => potentialNameMatch(name, team.name));
          if (potential) {
            warnings.push(issue("name", "POTENTIAL_TEAM_MATCH", `可能与已有球队“${potential.name}”相似；系统不会自动合并。`));
          }
          preview.action = "CREATE";
        }
      }
    }
    teamPlans.push({ preview, name, teamType, externalTeamId, action: preview.action });
  }

  const rows = teamPlans.map((plan) => plan.preview);
  return {
    preview: makePreview(input, competition, rows, 0),
    currentTeams,
    teamPlans,
    matchPlans: [],
    plannedMatchTeams: [],
  };
}

function matchDifferences(existing: LoadedMatch, plan: MatchPlan) {
  const differences: Record<string, { existing: string | null; imported: string | null }> = {};
  const compare = (field: string, existingValue: string | null, importedValue: string | null) => {
    if (existingValue !== importedValue) differences[field] = { existing: existingValue, imported: importedValue };
  };
  compare("competitionId", existing.competitionId, plan.preview.normalized.competitionId ?? null);
  compare("homeTeam", comparisonKey(existing.homeTeam.name), comparisonKey(plan.homeTeam));
  compare("awayTeam", comparisonKey(existing.awayTeam.name), comparisonKey(plan.awayTeam));
  compare("kickoff", existing.kickoff.toISOString(), plan.kickoff.toISOString());
  compare("venue", existing.venue.trim(), plan.venue);
  compare("stage", existing.stage.trim(), plan.stage);
  compare("stageId", existing.stageId, plan.stageId); compare("groupId", existing.groupId, plan.groupId); compare("roundId", existing.roundId, plan.roundId);
  compare("endAt", existing.endAt?.toISOString() ?? null, plan.endAt?.toISOString() ?? null);
  compare("round", existing.round?.trim() || null, plan.round);
  if (existing.externalMatchId && plan.externalMatchId && existing.externalMatchId !== plan.externalMatchId) {
    compare("externalMatchId", existing.externalMatchId, plan.externalMatchId);
  }
  return differences;
}

function inputMatchDifferences(existing: MatchPlan, imported: MatchPlan) {
  const differences: Record<string, { existing: string | null; imported: string | null }> = {};
  const compare = (field: string, first: string | null, second: string | null) => {
    if (first !== second) differences[field] = { existing: first, imported: second };
  };
  compare("venue", existing.venue, imported.venue);
  compare("stage", existing.stage, imported.stage);
  compare("stageId", existing.stageId, imported.stageId); compare("groupId", existing.groupId, imported.groupId); compare("roundId", existing.roundId, imported.roundId);
  compare("endAt", existing.endAt?.toISOString() ?? null, imported.endAt?.toISOString() ?? null);
  compare("round", existing.round, imported.round);
  compare("externalMatchId", existing.externalMatchId, imported.externalMatchId);
  return differences;
}

async function analyzeMatchImport(
  db: ImportDb,
  input: CompetitionImportInput,
  competition: { id: string; name: string; slug: string; publicPublished?: boolean; isTestData?: boolean },
): Promise<ImportAnalysis> {
  const currentTeams = await db.team.findMany({
    where: { competitionId: competition.id },
    select: { id: true, competitionId: true, name: true, teamType: true, source: true, externalTeamId: true },
  });
  const existingByTeamName = new Map(currentTeams.map((team) => [comparisonKey(team.name), team]));
  const structures = await db.competitionStage.findMany({ where: { competitionId: competition.id }, include: { groups: { include: { members: true } }, rounds: true } });
  const preliminary: MatchPlan[] = [];

  for (const row of input.rows) {
    const errors: CompetitionImportIssue[] = [];
    const warnings: CompetitionImportIssue[] = [];
    const homeTeam = readText(row.values, "homeTeam", "主队", 80, errors);
    const awayTeam = readText(row.values, "awayTeam", "客队", 80, errors);
    const kickoff = parseCompetitionImportDate(row.values.kickoff, "kickoff", "开球时间", errors);
    const endAt = parseCompetitionImportDate(row.values.endAt, "endAt", "结束时间", errors, false);
    const venue = readText(row.values, "venue", "场地", 120, errors);
    const stage = readText(row.values, "stage", "阶段", 80, errors);
    const round = readText(row.values, "round", "轮次", 80, errors, false) || null;
    const groupName = readText(row.values, "group", "分组", 80, errors, false);
    const findStage = structures.filter((s) => row.values.stageId ? s.id === displayCell(row.values.stageId) : s.name === stage);
    const selectedStage = findStage.length === 1 ? findStage[0] : undefined;
    const groups = selectedStage?.groups.filter((g) => row.values.groupId ? g.id === displayCell(row.values.groupId) : g.name === groupName) ?? [];
    const selectedGroup = groups.length === 1 ? groups[0] : undefined;
    const rounds = selectedStage?.rounds.filter((r) => (!r.groupId || r.groupId === selectedGroup?.id) && (row.values.roundId ? r.id === displayCell(row.values.roundId) : r.name === round)) ?? [];
    const selectedRound = rounds.length === 1 ? rounds[0] : undefined;
    if ((structures.length || row.values.stageId || groupName || row.values.groupId || row.values.roundId) && !selectedStage) errors.push(issue("stage", "STRUCTURE_UNMATCHED", "阶段未匹配；请先建立结构并核对准确名称或 ID。"));
    if (selectedStage?.type === "GROUP" && !selectedGroup) errors.push(issue("group", "GROUP_UNMATCHED", "小组未匹配；请先建立并选择当前阶段的小组。"));
    if ((groupName || row.values.groupId) && (!selectedGroup || selectedStage?.type !== "GROUP")) errors.push(issue("group", "GROUP_INVALID", "分组不属于所选小组阶段。"));
    if (selectedStage && (round || row.values.roundId) && !selectedRound) errors.push(issue("round", "ROUND_UNMATCHED", "轮次未匹配，请先人工建立轮次或选择准确 ID。"));
    if (selectedGroup) {
      const members = new Set(selectedGroup.members.map((m) => m.teamId));
      if (![homeTeam, awayTeam].every((n) => { const t = existingByTeamName.get(comparisonKey(n)); return t && members.has(t.id); })) errors.push(issue("group", "GROUP_TEAM_MISMATCH", "主客队必须是已确定的本组成员，不能自动建队或归组。"));
    }
    const stageId = selectedStage?.id ?? null, groupId = selectedGroup?.id ?? null, roundId = selectedRound?.id ?? null;
    const externalMatchId = readText(row.values, "externalMatchId", "外部比赛 ID", 120, errors, false) || null;
    if (homeTeam && awayTeam && comparisonKey(homeTeam) === comparisonKey(awayTeam)) {
      errors.push(issue("awayTeam", "SAME_TEAM", "比赛双方不能相同。"));
    }
    if (kickoff && endAt && endAt <= kickoff) {
      errors.push(issue("endAt", "END_NOT_AFTER_KICKOFF", "比赛结束时间必须晚于开球时间。"));
    }
    const slug = kickoff && homeTeam && awayTeam
      ? stableMatchSlug(competition.slug, kickoff, homeTeam, awayTeam)
      : "";
    const preview: CompetitionImportPreviewRow = {
      rowNumber: row.rowNumber,
      raw: rawSummary(row.values),
      normalized: {
        competitionId: competition.id,
        homeTeam: homeTeam || null,
        awayTeam: awayTeam || null,
        kickoff: kickoff?.toISOString() ?? null,
        endAt: endAt?.toISOString() ?? null,
        venue: venue || null,
        stageId, groupId, roundId, group: groupName || null,
        structureFingerprint: selectedStage ? createHash("sha256").update(JSON.stringify(selectedStage)).digest("hex") : null,
        stage: stage || null,
        round,
        externalMatchId,
        status: "SCHEDULED",
        applicationWindowStatus: "CLOSED",
        applicationDeadline: null,
      },
      action: errors.length ? "ERROR" : "CREATE",
      warnings,
      errors,
      slug: slug || undefined,
    };
    preliminary.push({
      preview,
      homeTeam,
      awayTeam,
      kickoff: kickoff ?? new Date(0),
      endAt,
      venue,
      stage, stageId, groupId, roundId,
      round,
      externalMatchId,
      slug,
      action: preview.action,
    });
  }

  const validPlans = preliminary.filter((plan) => plan.preview.errors.length === 0);
  const requestedExternalIds = validPlans.flatMap((plan) => plan.externalMatchId ? [plan.externalMatchId] : []);
  const requestedSlugs = validPlans.map((plan) => plan.slug);
  const [competitionMatches, externalMatches, slugMatches] = await Promise.all([
    db.match.findMany({
      where: { competitionId: competition.id },
      select: {
        id: true, slug: true, competitionId: true, stageId: true, groupId: true, roundId: true, stage: true, kickoff: true, endAt: true,
        venue: true, round: true, source: true, externalMatchId: true,
        homeTeam: { select: { id: true, name: true } },
        awayTeam: { select: { id: true, name: true } },
      },
    }),
    requestedExternalIds.length
      ? db.match.findMany({
          where: { source: "MANUAL", externalMatchId: { in: requestedExternalIds } },
          select: {
            id: true, slug: true, competitionId: true, stageId: true, groupId: true, roundId: true, stage: true, kickoff: true, endAt: true,
            venue: true, round: true, source: true, externalMatchId: true,
            homeTeam: { select: { id: true, name: true } },
            awayTeam: { select: { id: true, name: true } },
          },
        })
      : Promise.resolve([]),
    requestedSlugs.length
      ? db.match.findMany({
          where: { slug: { in: requestedSlugs } },
          select: {
            id: true, slug: true, competitionId: true, stageId: true, groupId: true, roundId: true, stage: true, kickoff: true, endAt: true,
            venue: true, round: true, source: true, externalMatchId: true,
            homeTeam: { select: { id: true, name: true } },
            awayTeam: { select: { id: true, name: true } },
          },
        })
      : Promise.resolve([]),
  ]);
  const existingByNaturalKey = new Map(competitionMatches.map((match) => [naturalMatchKey(match.kickoff, match.homeTeam.name, match.awayTeam.name), match]));
  const existingByExternalId = new Map(externalMatches.flatMap((match) => match.externalMatchId ? [[match.externalMatchId, match] as const] : []));
  const existingBySlug = new Map(slugMatches.map((match) => [match.slug, match]));
  const seenNatural = new Map<string, MatchPlan>();
  const seenExternal = new Map<string, MatchPlan>();
  const plannedTeamRows = new Map<string, { name: string; rowNumber: number }>();

  for (const plan of preliminary) {
    if (plan.preview.errors.length) continue;
    const naturalKey = naturalMatchKey(plan.kickoff, plan.homeTeam, plan.awayTeam);
    const duplicateNatural = seenNatural.get(naturalKey);
    const duplicateExternal = plan.externalMatchId ? seenExternal.get(plan.externalMatchId) : undefined;
    if (duplicateExternal) {
      plan.preview.errors.push(issue("externalMatchId", "DUPLICATE_INPUT_EXTERNAL_ID", `外部比赛 ID 与第 ${duplicateExternal.preview.rowNumber} 行重复。`));
      plan.preview.action = "CONFLICT";
      continue;
    }
    if (duplicateNatural) {
      const differences = inputMatchDifferences(duplicateNatural, plan);
      plan.preview.differences = differences;
      if (Object.keys(differences).length) {
        plan.preview.errors.push(issue("row", "DUPLICATE_INPUT_CONFLICT", `与第 ${duplicateNatural.preview.rowNumber} 行自然键相同但关键字段冲突。`));
        plan.preview.action = "CONFLICT";
      } else {
        plan.preview.errors.push(issue("row", "DUPLICATE_INPUT", `与第 ${duplicateNatural.preview.rowNumber} 行比赛重复。`));
        plan.preview.action = "ERROR";
      }
      continue;
    }
    seenNatural.set(naturalKey, plan);
    if (plan.externalMatchId) seenExternal.set(plan.externalMatchId, plan);

    const teamActions = [plan.homeTeam, plan.awayTeam].map((name) => {
      const key = comparisonKey(name);
      const existing = existingByTeamName.get(key);
      if (existing) return { name, action: "REUSE_EXISTING" as const };
      const planned = plannedTeamRows.get(key);
      if (planned) return { name, action: "REUSE_PLANNED" as const };
      plannedTeamRows.set(key, { name, rowNumber: plan.preview.rowNumber });
      const potential = currentTeams.find((team) => potentialNameMatch(name, team.name));
      if (potential) {
        plan.preview.warnings.push(issue("team", "POTENTIAL_TEAM_MATCH", `“${name}”可能与已有球队“${potential.name}”相似；系统不会自动合并。`));
      }
      return { name, action: "CREATE_TEAM" as const };
    });
    plan.preview.teamActions = teamActions;

    const existing = (plan.externalMatchId ? existingByExternalId.get(plan.externalMatchId) : undefined)
      ?? existingBySlug.get(plan.slug)
      ?? existingByNaturalKey.get(naturalKey);
    if (existing) {
      const differences = matchDifferences(existing, plan);
      if (Object.keys(differences).length) {
        plan.preview.action = "CONFLICT";
        plan.preview.differences = differences;
        plan.preview.errors.push(issue("row", "EXISTING_MATCH_CONFLICT", "已有比赛与导入行的关键字段冲突，导入不会覆盖。"));
      } else {
        plan.preview.action = "SKIP_DUPLICATE";
        if (plan.externalMatchId && !existing.externalMatchId) {
          plan.preview.warnings.push(issue("externalMatchId", "EXTERNAL_ID_NOT_ATTACHED", "已有相同比赛未绑定外部 ID；本次跳过不会静默修改已有比赛。"));
        }
      }
    } else {
      plan.preview.action = "CREATE";
    }
    plan.action = plan.preview.action;
  }

  const plannedMatchTeams = [...plannedTeamRows.values()].map((item) => item.name);
  const rows = preliminary.map((plan) => plan.preview);
  return {
    preview: makePreview(input, competition, rows, plannedMatchTeams.length),
    currentTeams,
    teamPlans: [],
    matchPlans: preliminary,
    plannedMatchTeams,
  };
}

async function analyzeCompetitionImport(db: ImportDb, input: CompetitionImportInput) {
  const competition = await loadCompetition(db, input.competitionId);
  return input.importType === "TEAM"
    ? analyzeTeamImport(db, input, competition)
    : analyzeMatchImport(db, input, competition);
}

export async function buildCompetitionImportPreview(input: CompetitionImportInput) {
  return (await analyzeCompetitionImport(prisma, input)).preview;
}

export async function commitCompetitionImport(
  input: CompetitionImportInput,
  authorization: AdminServiceAuthorization<"competitions:write">,
): Promise<CompetitionImportCommitResult> {
  const actor = requireAdminServiceAuthorization(authorization, "competitions:write");
  try {
    return await prisma.$transaction(async (tx) => {
      const analysis = await analyzeCompetitionImport(tx, input);
      const { preview } = analysis;
      if (input.expectedPlanHash && input.expectedPlanHash !== preview.planHash) throw new CompetitionImportCommitConflict("检查后输入、分组或公开状态已变化，请重新检查并确认。", preview);
      if (preview.summary.errorRows || preview.summary.conflictRows) {
        throw new CompetitionImportCommitConflict("导入内容仍包含错误或冲突，请修正后重新预览。", preview);
      }

      let createdTeams = 0;
      let reusedTeams = 0;
      let createdMatches = 0;
      let skippedMatches = 0;
      const teamsByName = new Map(analysis.currentTeams.map((team) => [comparisonKey(team.name), team]));

      if (input.importType === "TEAM") {
        for (const plan of analysis.teamPlans) {
          if (plan.preview.action === "CREATE") {
            const created = await tx.team.create({
              data: {
                competitionId: input.competitionId,
                name: plan.name,
                teamType: plan.teamType,
                source: "MANUAL",
                externalTeamId: plan.externalTeamId,
              },
            });
            teamsByName.set(comparisonKey(created.name), created);
            createdTeams += 1;
          } else if (plan.preview.action === "REUSE_EXISTING") {
            reusedTeams += 1;
          }
        }
      } else {
        for (const name of analysis.plannedMatchTeams) {
          const created = await tx.team.create({
            data: {
              competitionId: input.competitionId,
              name,
              teamType: "FREEFORM",
              source: "MANUAL",
            },
          });
          teamsByName.set(comparisonKey(name), created);
          createdTeams += 1;
        }
        const reusedTeamIds = new Set<string>();
        for (const plan of analysis.matchPlans) {
          if (plan.preview.action === "SKIP_DUPLICATE") {
            skippedMatches += 1;
            continue;
          }
          if (plan.preview.action !== "CREATE") continue;
          const homeTeam = teamsByName.get(comparisonKey(plan.homeTeam));
          const awayTeam = teamsByName.get(comparisonKey(plan.awayTeam));
          if (!homeTeam || !awayTeam) {
            throw new CompetitionImportCommitConflict("球队 reconciliation 已发生变化，请重新预览。", preview);
          }
          if (analysis.currentTeams.some((team) => team.id === homeTeam.id)) reusedTeamIds.add(homeTeam.id);
          if (analysis.currentTeams.some((team) => team.id === awayTeam.id)) reusedTeamIds.add(awayTeam.id);
          await assertMatchStructure(tx, { competitionId: input.competitionId, stageId: plan.stageId, groupId: plan.groupId, roundId: plan.roundId, homeTeamId: homeTeam.id, awayTeamId: awayTeam.id });
          await tx.match.create({
            data: {
              slug: plan.slug,
              competitionId: input.competitionId,
              stage: plan.stage, stageId: plan.stageId, groupId: plan.groupId, roundId: plan.roundId,
              kickoff: plan.kickoff,
              endAt: plan.endAt,
              venue: plan.venue,
              round: plan.round,
              source: "MANUAL",
              externalMatchId: plan.externalMatchId,
              homeTeamId: homeTeam.id,
              awayTeamId: awayTeam.id,
              status: "SCHEDULED",
              applicationWindowStatus: "CLOSED",
              applicationDeadline: null,
            },
          });
          createdMatches += 1;
        }
        reusedTeams = reusedTeamIds.size;
      }

      const audit = await tx.auditLog.create({
        data: {
          actorType: "ADMIN",
          actorId: actor.id,
          action: "COMPETITION_IMPORT_COMMITTED",
          entityType: "Competition",
          entityId: input.competitionId,
          summary: `完成${input.importType === "TEAM" ? "球队" : "赛程"}批量导入`,
          metadata: JSON.stringify({
            competitionId: input.competitionId,
            importType: input.importType,
            inputMethod: input.inputMethod,
            inputHash: input.inputHash,
            totalRows: preview.summary.totalRows,
            createdTeams,
            reusedTeams,
            createdMatches,
            skippedMatches,
            warnings: preview.summary.warningRows,
            actor: { id: actor.id, displayName: actor.displayName, roles: actor.roles },
          }),
        },
      });

      return {
        ok: true,
        auditId: audit.id,
        inputHash: input.inputHash,
        createdTeams,
        reusedTeams,
        createdMatches,
        skippedMatches,
        warnings: preview.summary.warningRows,
        preview,
      };
    });
  } catch (error) {
    if (error instanceof CompetitionImportCommitConflict) throw error;
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      const preview = await buildCompetitionImportPreview(input);
      throw new CompetitionImportCommitConflict("Preview 后数据已发生变化，整个导入已回滚，请重新预览。", preview);
    }
    throw error;
  }
}
