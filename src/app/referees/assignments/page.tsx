import { RefereeListBrowser } from "@/components/referees/referee-list-browser";
import { getPublicRefereeList } from "@/lib/referee-public-list-view";
import { refereeListFilters, type RefereeListSearchParams } from "@/lib/referee-list-filters";
import { RefereePage } from "@/components/referees/referee-public-layout";
import type { Metadata } from "next";
import { ProgressiveRefereeList } from "@/components/referees/progressive-referee-list";

export const metadata: Metadata = {
  alternates: { canonical: "/referees/assignments" }, title: "裁判员选派公告", description: "仅展示已发布且未撤回的裁判组选派。" };
export const dynamic = "force-dynamic";

export default async function RefereeAssignmentsPage({ searchParams }: { searchParams: Promise<RefereeListSearchParams> }) {
  const filters = refereeListFilters(await searchParams);
  const data = await getPublicRefereeList("assignments", filters);
  return <RefereePage compact current="/referees/assignments" eyebrow="ASSIGNMENTS" title="裁判员选派公告" description="按赛事查看当前有效的正式选派，按开赛时间排序；开球后未确认完赛仍保留，调整以最新公告为准。">
    <RefereeListBrowser base="/referees/assignments" filters={filters} info={data}>
      <ProgressiveRefereeList key={JSON.stringify(filters)} kind="assignments" filters={filters} initial={data} />
    </RefereeListBrowser>
  </RefereePage>;
}
