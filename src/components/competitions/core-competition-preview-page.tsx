import { PublicSchedule } from "@/components/competitions/public-schedule";
import { PublicStandings } from "@/components/competitions/public-standings";
import Link from "next/link";

import { CompetitionArchiveLayout } from "@/components/competitions/archive/competition-archive-layout";
import { ShareActions } from "@/components/share/share-actions";
import type { PublicCompetitionView } from "@/types/competition-center";

type CoreCompetitionPreviewPageProps = {
  competition: PublicCompetitionView;
};

function getSchedulePresentation(competition: PublicCompetitionView) {
  const forecast = competition.nextMatch;
  if (forecast.state === "scheduled") {
    return {
      summary: `下一场：${forecast.homeTeam} vs ${forecast.awayTeam} · ${forecast.dateLabel} ${forecast.timeLabel} · ${forecast.venue}`,
      href: forecast.detailHref,
      actionLabel: "查看比赛详情",
    };
  }
  return {
    summary: forecast.summary,
    href: "/competitions/schedule",
    actionLabel: "进入赛程与赛果中心",
  };
}

export function CoreCompetitionPreviewPage({
  competition,
}: CoreCompetitionPreviewPageProps) {
  const schedule = getSchedulePresentation(competition);
  const appointmentMatches = competition.matches.filter((match) => match.appointment?.positions.length);
  return (
    <CompetitionArchiveLayout
      className="core-competition-preview-page"
      titleId={`${competition.id}-title`}
      title={competition.name}
      eyebrow={`CURRENT EDITION · ${competition.currentEdition}`}
      status={`${competition.statusLabel} / ${competition.badge}`}
      description={competition.summary}
      heroImage="/images/hero-football.jpg"
      heroAlt="足球鞋与足球组成的校园足球赛事视觉"
      actions={[
        { href: competition.links.schedule, label: "查看赛程赛果" },
        { href: competition.links.files, label: "查看赛事文件" },
      ]}
      summary={[
        { label: "当前届次", value: competition.currentEdition },
        { label: "校区", value: competition.campus },
        { label: "赛制", value: competition.formatLabel },
        { label: "比赛日期", value: competition.matchWindow },
      ]}
      returnStatus={`赛事状态：${competition.statusLabel} / ${competition.badge}`}
    >
      <div className="page-shell"><ShareActions title={competition.name} text={competition.summary} /></div>
      <section
        className="cup-archive-section core-competition-overview"
        id="overview"
        aria-labelledby={`${competition.id}-overview-title`}
      >
        <div className="page-shell">
          <div className="cup-section-heading">
            <div>
              <p>COMPETITION PROFILE</p>
              <h2 id={`${competition.id}-overview-title`}>赛事概览</h2>
            </div>
            <span>查看赛事状态、赛制与已发布的基本信息。</span>
          </div>
          <div className="core-competition-facts">
            {[
              ["赛事名称", competition.name],
              ["年份 / 状态", `${competition.currentEdition} · ${competition.statusLabel}`],
              ["校区", competition.campus],
              ["赛制 / 组队", `${competition.formatLabel} · ${competition.teamFormation}`],
              ["报名日期", competition.registrationWindow],
              ["比赛日期", competition.matchWindow],
              ["比赛场地", competition.venue],
              ["主办单位", competition.host],
              ["承办单位", competition.organizer],
            ].map(([label, value]) => (
              <dl key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </dl>
            ))}
          </div>
          <p className="core-competition-summary">{competition.summary}</p>
          <p className="core-competition-summary"><strong>赛事公告：</strong>{competition.notice}</p>
          {competition.status === "registration"
          && competition.registrationUrl ? (
            <Link
              className="text-link"
              href={competition.registrationUrl}
              {...(competition.registrationUrl.startsWith("https://")
                ? { rel: "noopener noreferrer", target: "_blank" }
                : {})}
            >
              立即报名 →
            </Link>
          ) : null}
        </div>
      </section>

      <section className="cup-archive-section cup-archive-section-tint" id="schedule" aria-labelledby={`${competition.id}-schedule-title`}>
        <div className="page-shell">
          <div className="core-competition-section-intro">
            <div>
            <p>SCHEDULE & RESULTS</p>
            <h2 id={`${competition.id}-schedule-title`}>赛程与赛果</h2>
            </div>
            <p>{schedule.summary}</p>
          </div>
          {competition.matches.length ? (
            <PublicSchedule competitions={[competition]} />
          ) : <div className="core-competition-empty"><strong>当前暂无赛程赛果</strong><p>赛程将在正式发布后显示。</p></div>}
        </div>
      </section>

      <section className="cup-archive-section" id="standings" aria-labelledby={`${competition.id}-standings-title`}>
        <div className="page-shell core-competition-pending">
          <div>
            <p>STANDINGS & KNOCKOUT</p>
            <h2 id={`${competition.id}-standings-title`}>积分榜与淘汰赛</h2>
          </div>
          <PublicStandings tables={competition.standings ?? []} />
          <Link href="/competitions/standings">查看赛事类别与当前届次 →</Link>
        </div>
      </section>

      <section className="cup-archive-section cup-archive-section-tint" id="teams" aria-labelledby={`${competition.id}-teams-title`}>
        <div className="page-shell">
          <div className="core-competition-section-intro">
            <div>
            <p>TEAMS</p>
            <h2 id={`${competition.id}-teams-title`}>参赛球队</h2>
            </div>
            <p>仅展示与本赛事直接关联的参赛球队。</p>
          </div>
          {competition.teams.length ? (
            <div className="core-competition-team-list">
              {competition.teams.map((team, index) => <article key={team.id}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{team.name}</strong><small>{team.teamTypeLabel}</small></div></article>)}
            </div>
          ) : <div className="core-competition-empty"><strong>暂无参赛球队</strong><p>球队将在赛事报名与确认后显示。</p></div>}
        </div>
      </section>

      <section className="cup-archive-section" id="officials" aria-labelledby={`${competition.id}-officials-title`}>
        <div className="page-shell">
          <div className="core-competition-section-intro">
            <div>
            <p>REFEREE APPOINTMENTS</p>
            <h2 id={`${competition.id}-officials-title`}>裁判选派</h2>
            </div>
            <p>仅展示本赛事已正式发布或已完成的公开选派。</p>
          </div>
          {appointmentMatches.length ? (
            <div className="core-competition-record-list">
              {appointmentMatches.map((match) => <article key={match.id}><header><span>{match.homeTeam.name} vs {match.awayTeam.name}</span><strong>{match.dateLabel}</strong></header><ul>{match.appointment!.positions.map((position) => <li key={position.key}><span>{position.label}</span><b>{position.refereeName}</b></li>)}</ul></article>)}
            </div>
          ) : <div className="core-competition-empty"><strong>当前暂无已发布选派</strong><p>正式安排以裁判中心公开记录为准。</p></div>}
          <Link className="text-link core-competition-section-link" href="/referees/assignments">查看全部裁判员选派公示 →</Link>
        </div>
      </section>

      <section className="cup-archive-section cup-archive-section-tint" id="honours" aria-labelledby={`${competition.id}-honours-title`}>
        <div className="page-shell core-competition-pending">
          <div>
            <p>HONOURS</p>
            <h2 id={`${competition.id}-honours-title`}>名次与奖项</h2>
          </div>
          <p>名次与奖项将在赛事结束并正式发布后更新。</p>
        </div>
      </section>

      <section className="cup-archive-section" id="reports" aria-labelledby={`${competition.id}-reports-title`}>
        <div className="page-shell core-competition-pending">
          <div>
            <p>REPORTS</p>
            <h2 id={`${competition.id}-reports-title`}>赛事报道</h2>
          </div>
          <p>暂无赛事报道</p>
          <Link href="/news">进入新闻公告 →</Link>
        </div>
      </section>

      <section className="cup-archive-section cup-archive-section-tint" id="media" aria-labelledby={`${competition.id}-media-title`}>
        <div className="page-shell core-competition-pending">
          <div>
            <p>MEDIA</p>
            <h2 id={`${competition.id}-media-title`}>赛事影像</h2>
          </div>
          <p>赛事照片和视频将在影像资料页面陆续发布。</p>
          <Link href="/media">进入影像资料 →</Link>
        </div>
      </section>

    </CompetitionArchiveLayout>
  );
}
