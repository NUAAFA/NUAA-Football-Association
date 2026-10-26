export const competitionSystemLabels = {
  GROUP_KNOCKOUT: "小组赛＋淘汰赛",
  LEAGUE: "联赛制",
} as const;

export type CompetitionSystemValue = keyof typeof competitionSystemLabels;
