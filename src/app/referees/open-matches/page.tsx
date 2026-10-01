import type { Metadata } from "next";
import Link from "next/link";
import { RefereeOpenMatchesShell } from "@/components/referees/mvp/referee-open-matches-shell";
import { getRefereeMemberSession } from "@/lib/referee-member-auth";
import { formatRefereeDateTime } from "@/lib/referee-presenters";
import { formatLabels } from "@/lib/referee-roles";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  alternates: { canonical: "/referees/open-matches" },
  title: "公开场次",
  description: "访客可查看开放场次；经审核启用账号的裁判员可提交执裁意向。",
};
export const dynamic = "force-dynamic";

export default async function OpenRefereeMatchesPage() {
  const [matches, session] = await Promise.all([
    prisma.match.findMany({
      where: {
        status: "SCHEDULED", kickoff: { not: null }, venue: { not: null },
        applicationWindowStatus: "OPEN",
        applicationDeadline: { gt: new Date() },
        isTestData: false,
        competition: { isTestData: false, format: { not: "CUSTOM" } },
      },
      include: { competition: true, homeTeam: true, awayTeam: true, positionRequirements: true },
      orderBy: { kickoff: "asc" },
    }),
    getRefereeMemberSession(),
  ]);
  return <RefereeOpenMatchesShell
    description="访客可查看开放比赛和岗位信息；经审核启用账号的裁判员可登录提交执裁意向。"
    eyebrow="OPEN APPOINTMENTS"
    member={session?.referee ?? null}
    title={session ? "可报名场次 / 执裁意向" : "公开场次"}
    workspaceDescription="在裁判员工作区中浏览开放比赛、查看岗位要求并提交执裁意向。"
  >
    <section className="functional-section"><div className="detail-shell">{matches.length ? <div className="referee-match-list">{matches.map((match) => <article key={match.id}><header><div><span>{match.competition.name}</span><h2>{match.homeTeam.name} vs {match.awayTeam.name}</h2></div><strong>开放报名</strong></header><dl><div><dt>赛制 / 阶段</dt><dd>{match.competition.playingFormat ?? formatLabels[match.competition.format]} · {match.stage}</dd></div><div><dt>开球时间</dt><dd>{formatRefereeDateTime(match.kickoff)}</dd></div><div><dt>报名截止</dt><dd>{formatRefereeDateTime(match.applicationDeadline!)}</dd></div><div><dt>岗位需求</dt><dd>{match.positionRequirements.reduce((total, item) => total + item.count, 0)} 人</dd></div></dl>{match.publicNote ? <p>{match.publicNote}</p> : null}<Link href={`/referees/open-matches/${match.slug}`}>查看岗位信息 →</Link></article>)}</div> : <div className="functional-empty"><strong>当前暂无开放执裁意向的比赛</strong><p>请关注后续赛事通知与选派安排。</p></div>}</div></section>
  </RefereeOpenMatchesShell>;
}
