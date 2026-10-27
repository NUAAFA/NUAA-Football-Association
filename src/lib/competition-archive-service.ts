import { cache } from "react";

import { coreCompetitionDirectory } from "@/data/competition-directory";
import { historicalCompetitionYears } from "@/data/historical-competitions";
import mensArchive from "@/data/archives/2026-mens-intercollege-cup/competition.json";
import { womensIntercollegeCup2026 } from "@/data/womens-intercollege-cup-2026";
import { isDatabaseContentSource } from "@/lib/content-source";
import { prisma } from "@/lib/prisma";
import { readPublicData } from "@/lib/public-read";
import type { CompetitionArchiveEntry } from "@/types/competition-archive";

export function getStaticCompetitionArchives(): CompetitionArchiveEntry[] {
  return [
    ...coreCompetitionDirectory.filter((entry) => entry.status === "completed").map((entry): CompetitionArchiveEntry => ({
      id: entry.currentEditionId, year: entry.year, name: entry.name, format: entry.formatLabel,
      campus: entry.campus, kind: "完整档案", href: entry.detailHref, summary: entry.summary,
      image: entry.id === "mens-intercollege-cup" ? { src: mensArchive.heroImage, alt: "天目湖校区西操场晚霞与足球" }
        : entry.id === "womens-intercollege-cup" ? { src: womensIntercollegeCup2026.heroImage, alt: "女子院际杯赛事集体合影" } : undefined,
    })),
    ...historicalCompetitionYears.flatMap((year) => year.competitions.map((entry): CompetitionArchiveEntry => ({
      id: entry.id, year: year.year, name: entry.name, format: entry.format ?? "历史赛事",
      campus: entry.venue ?? "", kind: "历史记录", href: `/competitions/history/${entry.id}`,
      summary: [entry.teamCount ? `${entry.teamCount} 支球队` : "", entry.startDate ?? "", "已核实历史资料"].filter(Boolean).join(" · "),
    }))),
  ].sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.id.localeCompare(b.id));
}

export const getCompetitionArchives = cache(async (): Promise<CompetitionArchiveEntry[]> => {
  const entries = getStaticCompetitionArchives();
  if (!isDatabaseContentSource()) return entries;
  const rows = await readPublicData("competition-archives", () => prisma.competition.findMany({
    where: { publicPublished: true, isTestData: false, status: "COMPLETED" },
    select: { id: true, year: true, slug: true, name: true, campus: true, playingFormat: true, format: true, summary: true },
    orderBy: [{ year: "desc" }, { id: "asc" }],
  }));
  const known = new Set(entries.map((entry) => entry.href));
  for (const row of rows) {
    const href = `/competitions/${row.slug}`;
    if (known.has(href)) continue;
    entries.push({ id: row.id, year: row.year, name: row.name, campus: row.campus ?? "",
      format: row.playingFormat || (row.format === "ELEVEN_A_SIDE" ? "十一人制" : row.format === "FUTSAL" ? "五人制" : "自定义制式"),
      kind: "赛事记录", href, summary: row.summary || "查阅本届赛事已公开的赛果、球队与赛事报道。" });
    known.add(href);
  }
  return entries.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.id.localeCompare(b.id));
});
