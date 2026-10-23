export const resourceCategories = [
  { key: "guidebooks", label: "秩序册与赛事指南" },
  { key: "regulations", label: "竞赛规则" },
  { key: "schedules", label: "赛程文件" },
  { key: "discipline", label: "纪律决定" },
  { key: "notices", label: "赛事通知" },
  { key: "training", label: "裁判培训资料" },
  { key: "work-files", label: "裁判工作资料" },
] as const;
export type ResourceCategory = typeof resourceCategories[number]["key"];
export const resourceAreas = [
  { key: "competition", label: "赛事文件", categories: ["guidebooks", "schedules", "discipline", "notices"], defaultCategory: "guidebooks", destination: "赛事中心 → 赛事文件中心", description: "秩序册、赛程文件、纪律决定与赛事通知" },
  { key: "rules", label: "竞赛规则", categories: ["regulations"], defaultCategory: "regulations", destination: "赛事文件中心 + 裁判中心", description: "发布一次，同时显示在两处规则栏目" },
  { key: "training", label: "培训资料", categories: ["training"], defaultCategory: "training", destination: "裁判中心 → 培训资料", description: "按基础、专项和进阶学习阶段展示" },
  { key: "work-files", label: "工作资料", categories: ["work-files"], defaultCategory: "work-files", destination: "裁判中心 → 工作资料", description: "比赛成绩报告单、裁判报告与工作模板" },
] as const satisfies readonly { key: string; label: string; categories: readonly ResourceCategory[]; defaultCategory: ResourceCategory; destination: string; description: string }[];

export function getResourceDestinations(category: ResourceCategory, playingFormat = "all", trainingLevel = "基础") {
  const label = resourceCategories.find((option) => option.key === category)!.label;
  if (category === "training") return [{ label: `裁判中心 → 培训资料 → ${trainingLevel}学习`, shortLabel: `裁判中心 / ${trainingLevel}培训`, href: `/referees/resources/training#training-level-${trainingLevel}` }];
  if (category === "work-files") return [{ label: "裁判中心 → 工作资料", shortLabel: "裁判中心 / 工作资料", href: "/referees/resources/work-files#work-files" }];
  const destinations = [{ label: `赛事中心 → 赛事文件中心 → ${label}`, shortLabel: category === "regulations" ? "赛事文件中心 / 竞赛规则" : `赛事文件中心 / ${label}`, href: `/competitions/files#${category}` }];
  if (category === "regulations") destinations.push({ label: `裁判中心 → 竞赛规则${playingFormat === "all" ? "（十一人制与五人制）" : playingFormat === "futsal" ? " → 五人制" : " → 十一人制"}`, shortLabel: `裁判中心 / ${playingFormat === "all" ? "竞赛规则" : playingFormat === "futsal" ? "五人制规则" : "十一人制规则"}`, href: `/referees/resources/competition-rules${playingFormat === "all" ? "" : `#${playingFormat}`}` });
  return destinations;
}
export const resourceVersionLabels = { current: "当前适用", latest: "最新版本", changes: "变更说明", historical: "历史参考" } as const;
export const resourceStatusLabels = { DRAFT: "草稿", PUBLISHED: "已发布", ARCHIVED: "已下架" } as const;
export type ResourceFormValue = {
  id?: string;
  category: ResourceCategory;
  title: string;
  description: string;
  source: string;
  scope: string;
  version: string;
  dateLabel: string;
  versionStatus: keyof typeof resourceVersionLabels;
  versionNote: string;
  playingFormat: "all" | "eleven-a-side" | "futsal";
  trainingLevel: "基础" | "专项" | "进阶";
  sortOrder: number;
  status: keyof typeof resourceStatusLabels;
  mediaAssetId: string | null;
  fileLabel: string;
};
