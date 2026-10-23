import type { Metadata } from "next";
import { RefereeOpenMatchesShell } from "@/components/referees/mvp/referee-open-matches-shell";
import { getRefereeMemberSession } from "@/lib/referee-member-auth";
import { RefereeListBrowser } from "@/components/referees/referee-list-browser";
import { ProgressiveRefereeList } from "@/components/referees/progressive-referee-list";
import { refereeListFilters, type RefereeListSearchParams } from "@/lib/referee-list-filters";
import { getPublicRefereeList } from "@/lib/referee-public-list-view";

export const metadata: Metadata = {
  alternates: { canonical: "/referees/open-matches" },
  title: "公开场次",
  description: "访客可查看开放场次；经审核启用账号的裁判员可提交执裁意向。",
};
export const dynamic = "force-dynamic";

export default async function OpenRefereeMatchesPage({ searchParams }: { searchParams: Promise<RefereeListSearchParams> }) {
  const filters = refereeListFilters(await searchParams);
  const [data, session] = await Promise.all([getPublicRefereeList("open-matches", filters), getRefereeMemberSession()]);
  return <RefereeOpenMatchesShell
    compact
    description="访客可查看开放比赛和岗位信息；经审核启用账号的裁判员可登录提交执裁意向。"
    eyebrow="OPEN APPOINTMENTS"
    member={session?.referee ?? null}
    title={session ? "可报名场次 / 执裁意向" : "公开场次"}
    workspaceDescription="在裁判员工作区中浏览开放比赛、查看岗位要求并提交执裁意向。"
  >
    <RefereeListBrowser base="/referees/open-matches" filters={filters} info={data} openMatches>
      <ProgressiveRefereeList key={JSON.stringify(filters)} kind="open-matches" filters={filters} initial={data} />
    </RefereeListBrowser>
  </RefereeOpenMatchesShell>;
}
