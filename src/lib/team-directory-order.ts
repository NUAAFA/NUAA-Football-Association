import { compareAffiliationOptions, type SortableAffiliationOption } from "@/lib/referee-affiliation-options";

/** Shared server-side selection; sorting metadata must not enter the public DTO. */
export const teamDirectoryUnitSelect = {
  id: true,
  name: true,
  type: true,
  legacyCollege: { select: { codeMappings: { select: { prefix: true } } } },
} as const;

type DirectoryUnit = {
  name: string;
  type: "COLLEGE" | "SHUYUAN";
  legacyCollege: { codeMappings: readonly { prefix: string }[] } | null;
};

type DirectoryTeam = {
  id: string;
  name: string;
  unitAffiliations: readonly { unit: DirectoryUnit }[];
};

const nameCollator = new Intl.Collator("zh-CN", { numeric: true });
const chineseTeamNumbers = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

function teamNameKey(name: string) {
  return name.replace(/([一二三四五六七八九十]+)队$/u, (suffix, number: string) => {
    const index = chineseTeamNumbers.indexOf(number);
    return index === -1 ? suffix : `${index + 1}队`;
  });
}

function organizationKey(team: DirectoryTeam): { category: number; unit?: SortableAffiliationOption } {
  const units = team.unitAffiliations.map(({ unit }) => ({
    name: unit.name.trim(),
    type: unit.type,
    prefixes: unit.legacyCollege?.codeMappings.map(({ prefix }) => prefix) ?? [],
  }));
  // A house team stays in the house section even when it also links to colleges.
  const houses = units.filter((unit) => unit.type === "SHUYUAN")
    .map((unit) => ({ ...unit, name: unit.name.replace(/书院.+$/u, "书院") }))
    .sort(compareAffiliationOptions);
  if (houses.length) return { category: 2, unit: houses[0] };

  const isSqa = (unit: SortableAffiliationOption) => /^(?:SQA|SQA项目)$/iu.test(unit.name);
  // For joint college teams, the lowest configured college prefix wins.
  const colleges = units.filter((unit) => unit.type === "COLLEGE" && !isSqa(unit))
    .sort(compareAffiliationOptions);
  if (colleges.length) return { category: 0, unit: colleges[0] };
  if (units.some(isSqa)) return { category: 1 };
  // Unaffiliated/freeform teams are never assigned an organization by name.
  return { category: 3 };
}

/** Colleges by configured prefix, then SQA, houses, and unaffiliated teams. */
export function sortTeamDirectory<T extends DirectoryTeam>(teams: readonly T[]): T[] {
  return teams.map((team) => ({ team, key: organizationKey(team) }))
    .sort((left, right) => left.key.category - right.key.category
      || (left.key.unit && right.key.unit ? compareAffiliationOptions(left.key.unit, right.key.unit) : 0)
      || nameCollator.compare(teamNameKey(left.team.name), teamNameKey(right.team.name))
      || left.team.id.localeCompare(right.team.id))
    .map(({ team }) => team);
}
