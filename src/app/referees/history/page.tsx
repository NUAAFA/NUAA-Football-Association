import { RefereeListBrowser } from "@/components/referees/referee-list-browser";
import { getPublicRefereeList } from "@/lib/referee-public-list-view";
import { refereeListFilters, type RefereeListSearchParams } from "@/lib/referee-list-filters";
import { RefereePage } from "@/components/referees/referee-public-layout";
import type { Metadata } from "next";
import { ProgressiveRefereeList } from "@/components/referees/progressive-referee-list";

export const metadata: Metadata = {
  alternates: { canonical: "/referees/history" }, title: "历史选派记录", description: "查看已结束比赛中公开发布的裁判组选派记录。" };
export const dynamic = "force-dynamic";

export default async function RefereeHistoryPage({ searchParams }: { searchParams: Promise<RefereeListSearchParams> }) {
  const filters = refereeListFilters(await searchParams);
  const data = await getPublicRefereeList("history", filters);
  return <RefereePage compact current="/referees/history" eyebrow="ASSIGNMENT ARCHIVE" title="历史选派记录" description="查阅已结束比赛的正式选派档案及经独立确认公开的赛后执裁记录。">
    <RefereeListBrowser base="/referees/history" filters={filters} info={data} history>
      <ProgressiveRefereeList key={JSON.stringify(filters)} kind="history" filters={filters} initial={data} />
    </RefereeListBrowser>
  </RefereePage>;
}
