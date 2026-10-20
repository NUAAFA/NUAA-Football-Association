import { RichArchiveLayout } from "@/components/competitions/archive/rich-archive-layout";
import { ShareActions } from "@/components/share/share-actions";
import { womensIntercollegeCup2026 } from "@/data/womens-intercollege-cup-2026";

import { WomensCompetitionOverview } from "./competition-overview";
import {
  WomensCompetitionOfficials,
  WomensCompetitionSchedule,
  WomensCompetitionStandings,
} from "./competition-results";
import { WomensCompetitionStories } from "./competition-stories";
import { WomensCompetitionTeams } from "./competition-teams";

export function WomensCompetitionArchivePage() {
  const { competition, heroImage } = womensIntercollegeCup2026;

  return (
    <RichArchiveLayout
      className="cup-womens-page"
      titleId="womens-cup-title"
      title={competition.canonicalTitle}
      eyebrow="COMPETITION ARCHIVE · WOMEN'S FOOTBALL · 2026"
      status="已结束 · 已归档"
      description={`2026年天目湖校区女子五人制院系赛事，共${competition.summary.teams}支球队完成${competition.summary.matches}场比赛。`}
      heroImage={heroImage}
      heroAlt="2026天目湖校区女子足球院际杯赛事集体合影"
      actions={[{ href: "#honours", label: "查看名次与奖项" }, { href: "#reports", label: "阅读赛事报道" }]}
      summary={[
        { label: "冠军", value: "人文外国语自动化联队" },
        { label: "赛期", value: "2026.04.14—05.30" },
        { label: "规模", value: `${competition.summary.teams}队 / ${competition.summary.matches}场` },
        { label: "进球", value: `${competition.summary.goals}球` },
      ]}
      returnStatus="档案状态：2026赛季已归档"
    >
      <ShareActions title={competition.canonicalTitle} text="2026女子足球院际杯（天目湖校区）赛事档案" />
      <WomensCompetitionOverview />
      <WomensCompetitionSchedule />
      <WomensCompetitionStandings />
      <WomensCompetitionTeams />
      <WomensCompetitionOfficials />
      <WomensCompetitionStories />
    </RichArchiveLayout>
  );
}
