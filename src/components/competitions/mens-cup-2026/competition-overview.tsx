import { ArchiveProfile } from "@/components/competitions/archive/archive-profile";
import { mensIntercollegeCup2026 } from "@/data/mens-intercollege-cup-2026";

import { formatArchiveDate } from "./archive-utils";

export function CompetitionOverview() {
  const { competition } = mensIntercollegeCup2026;
  return (
    <ArchiveProfile
      titleId="cup-overview-title"
      name={competition.shortName}
      context="2025—2026学年第二学期 · 天目湖校区 · 十一人制院系赛事"
      introduction="从小组赛到决赛，记录八支院系球队的绿茵征程。"
      facts={[
        { label: "比赛日期", value: `${formatArchiveDate(competition.startDate)}—${formatArchiveDate(competition.endDate)}` },
        { label: "比赛地点", value: competition.venue },
        { label: "竞赛形式", value: `${competition.formatLabel} · ${competition.teamFormation}` },
        { label: "承办单位", value: competition.organizers.organizer },
      ]}
      format={[competition.structure.groupStage, competition.structure.knockoutStage, `比赛时间：${competition.structure.matchDuration}`]}
      hosts={competition.organizers.hosts}
      statistics={[
        { value: competition.summary.teams, label: "参赛球队" },
        { value: competition.summary.registeredPlayers, label: "注册球员（赛事汇总）" },
        { value: competition.summary.matches, label: "完成比赛" },
        { value: competition.summary.goals, label: "赛事进球" },
      ]}
      source={`资料来源：${competition.source}。169为赛事汇总人数，不代表下方公开名单的逐人列举总数。`}
    >
      <a className="cup-document-link" href={competition.guidebook} download><span>PDF</span><strong>下载赛事秩序册</strong><b aria-hidden="true">↓</b></a>
    </ArchiveProfile>
  );
}
