import type { PublicCompetitionMatch } from "@/types/competition-center";

/** Keep legacy separators readable without splitting notes inside parentheses. */
export function splitCompetitionLines(value: string): string[] {
  const lines: string[] = [];
  let line = "", depth = 0;
  for (const char of value.replaceAll("\r\n", "\n")) {
    if (char === "（" || char === "(") depth += 1;
    if (char === "）" || char === ")") depth = Math.max(0, depth - 1);
    if (char === "\n" || (depth === 0 && "、；;".includes(char))) {
      if (line.trim()) lines.push(line.trim());
      line = "";
    } else line += char;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

export function normalizeCompetitionLines(value: string) {
  return splitCompetitionLines(value).join("\n");
}

function kickoffTime(match: PublicCompetitionMatch) {
  return match.kickoff ? new Date(match.kickoff).getTime() : null;
}

export function publicMatchProgress(match: PublicCompetitionMatch, referenceTime: number) {
  if (match.status === "completed") return "已完成";
  if (match.status === "cancelled") return "已取消";
  const time = kickoffTime(match);
  if (time === null) return "待排期";
  return time >= referenceTime ? "即将进行" : "赛果待确认";
}

function matchPriority(match: PublicCompetitionMatch, referenceTime: number) {
  if (match.status === "cancelled") return 4;
  const time = kickoffTime(match);
  if (time === null) return 3;
  if (match.status === "completed") return 2;
  return time >= referenceTime ? 0 : 1;
}

/** Upcoming fixtures first, then earlier dated records, then unscheduled/cancelled. */
export function comparePublicMatches(a: PublicCompetitionMatch, b: PublicCompetitionMatch, referenceTime: number) {
  return matchPriority(a, referenceTime) - matchPriority(b, referenceTime)
    || (kickoffTime(a) ?? Infinity) - (kickoffTime(b) ?? Infinity)
    || (a.stageOrder ?? -1) - (b.stageOrder ?? -1)
    || (a.groupOrder ?? -1) - (b.groupOrder ?? -1)
    || (a.roundOrder ?? -1) - (b.roundOrder ?? -1)
    || (a.matchNumber ?? Infinity) - (b.matchNumber ?? Infinity)
    || a.id.localeCompare(b.id);
}
