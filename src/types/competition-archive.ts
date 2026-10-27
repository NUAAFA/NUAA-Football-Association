export type CompetitionArchiveEntry = {
  id: string;
  year: number | null;
  name: string;
  format: string;
  campus: string;
  kind: "完整档案" | "历史记录" | "赛事记录";
  href: string;
  image?: { src: string; alt: string };
  summary: string;
};
