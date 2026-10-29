import type { Metadata } from "next";
import { RefereeOpenMatchesShell } from "@/components/referees/mvp/referee-open-matches-shell";
import { getRefereeMemberSession } from "@/lib/referee-member-auth";
import { RefereeListBrowser } from "@/components/referees/referee-list-browser";
import { ProgressiveRefereeList } from "@/components/referees/progressive-referee-list";
import { refereeListFilters, type RefereeListSearchParams } from "@/lib/referee-list-filters";
import { getPublicRefereeList } from "@/lib/referee-public-list-view";
import { getRefereeCurrentMatches } from "@/lib/referee-current-matches";
import { RefereeCurrentMatchList } from "@/components/referees/mvp/referee-current-match-list";
import { RefreshOnFocus } from "@/components/refresh-on-focus";

export const metadata: Metadata = {
  alternates: { canonical: "/referees/open-matches" },
  title: "公开场次",
  description: "访客可查看开放场次；经审核启用账号的裁判员可提交执裁意向。",
};
export const dynamic = "force-dynamic";

export default async function OpenRefereeMatchesPage({ searchParams }: { searchParams: Promise<RefereeListSearchParams> }) {
  const filters = refereeListFilters(await searchParams);
  const session = await getRefereeMemberSession();
  const result = session
    ? { member: true as const, data: await getRefereeCurrentMatches(session.refereeId, { filters }) }
    : { member: false as const, data: await getPublicRefereeList("open-matches", filters) };
  return <RefereeOpenMatchesShell
    compact
    description="访客可查看开放比赛和岗位信息；经审核启用账号的裁判员可登录提交执裁意向。"
    eyebrow="OPEN APPOINTMENTS"
    member={session?.referee ?? null}
    title={session ? "可报名场次 / 执裁意向" : "公开场次"}
    workspaceDescription="查看全部开放比赛与本人待进行的执裁意向，点击比赛查看岗位并报名。"
  >
    {session ? <RefreshOnFocus /> : null}
    <RefereeListBrowser base="/referees/open-matches" filters={filters} info={result.data} openMatches>
      {result.member ? <>
        <RefereeCurrentMatchList items={result.data.items} />
        {result.data.items.length ? <p className="referee-current-summary">已显示当前筛选下的全部比赛 · 开放报名优先，按开赛时间排列</p> : null}
      </> : <ProgressiveRefereeList key={JSON.stringify(filters)} kind="open-matches" filters={filters} initial={result.data} />}
    </RefereeListBrowser>
  </RefereeOpenMatchesShell>;
}
