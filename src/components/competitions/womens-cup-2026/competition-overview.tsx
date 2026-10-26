import { ArchiveProfile } from "@/components/competitions/archive/archive-profile";
import styles from "@/components/competitions/archive/archive-sections.module.css";
import { MEN_AND_WOMEN_CUP_HOST, MEN_AND_WOMEN_CUP_ORGANIZER } from "@/data/competition-directory";
import { womensIntercollegeCup2026 } from "@/data/womens-intercollege-cup-2026";

export function WomensCompetitionOverview() {
  const { competition, matches } = womensIntercollegeCup2026;
  const { registration, rules, summary } = competition;
  const dates = matches.map((match) => match.kickoff.split(" ")[0]).sort();
  return (
    <ArchiveProfile
      titleId="womens-overview-title"
      name={competition.shortName}
      context="2025—2026学年第二学期 · 天目湖校区 · 五人制院系赛事"
      introduction="绿茵逐梦，铿锵绽放。记录校园女足在比赛、协作与拼搏中留下的青春篇章。"
      facts={[
        { label: "比赛日期", value: `${dates[0].replaceAll("-", "/")}—${dates.at(-1)!.replaceAll("-", "/")}` },
        { label: "比赛地点", value: competition.venue },
        { label: "竞赛形式", value: `${competition.format} · 院系组队` },
        { label: "承办单位", value: MEN_AND_WOMEN_CUP_ORGANIZER },
      ]}
      format={[
        `${summary.teams}支球队参加联赛阶段，随后进行淘汰赛与决赛。`,
        `比赛时间：上下半场各${rules.firstHalfMinutes}分钟，不设置加时赛。`,
        `联赛积分：胜${rules.points.win}分、平${rules.points.draw}分、负${rules.points.loss}分；点球胜${rules.points.penaltyWin}分、负${rules.points.penaltyLoss}分。`,
      ]}
      hosts={MEN_AND_WOMEN_CUP_HOST.split("、")}
      statistics={[
        { value: summary.teams, label: "参赛球队" },
        { value: summary.players, label: "注册球员（赛事汇总）" },
        { value: summary.matches, label: "完成比赛" },
        { value: summary.goals, label: "赛事进球" },
      ]}
      source="资料来源：足球中国赛事资料、球队报名截图及赛事记录。3支球队共24名注册球员，名单已补齐核对。"
    >
      <details className={styles.supplement}>
        <summary>报名与竞赛规则归档</summary>
        <dl>
          <div><dt>报名时间</dt><dd>{registration.start.replaceAll("-", ".")} — {registration.end.replaceAll("-", ".")}</dd></div>
          <div><dt>报名费用</dt><dd>报名费{registration.feePerTeam}元 / 保证金{registration.depositPerTeam}元</dd></div>
          <div><dt>名单发布</dt><dd>首发名单赛前{rules.publishStartingLineupMinutesBefore}分钟、裁判名单赛前{rules.publishRefereeListMinutesBefore}分钟发布。</dd></div>
          <div><dt>停赛基准</dt><dd>球员及工作人员累计2黄或1红，停赛1场。</dd></div>
        </dl>
      </details>
    </ArchiveProfile>
  );
}
