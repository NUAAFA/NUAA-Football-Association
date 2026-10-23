import { PublicSchedule } from "@/components/competitions/public-schedule";
import { PublicStandings } from "@/components/competitions/public-standings";
import Link from "next/link";
import { CompetitionReports } from "@/components/competitions/competition-reports";
import { CompetitionMedia } from "@/components/competitions/competition-media";

import { CompetitionArchiveLayout } from "@/components/competitions/archive/competition-archive-layout";
import { ShareActions } from "@/components/share/share-actions";
import { CompetitionLines } from "./competition-lines";
import { CompetitionAppointments } from "./competition-appointments";
import styles from "./competition-detail.module.css";
import type { PublicCompetitionView } from "@/types/competition-center";

type CoreCompetitionPreviewPageProps = {
  competition: PublicCompetitionView;
};

export function CoreCompetitionPreviewPage({
  competition,
}: CoreCompetitionPreviewPageProps) {
  const referenceTime = competition.asOf;
  return (
    <CompetitionArchiveLayout
      className={`core-competition-preview-page ${styles.page}`}
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
        { label: "校区", value: <CompetitionLines value={competition.campus} /> },
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
                <dd>{["校区", "比赛场地", "主办单位", "承办单位"].includes(label) ? <CompetitionLines value={value} /> : value}</dd>
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
            <h2 id={`${competition.id}-schedule-title`}>赛程与赛果</h2><p>本页业务时间均为北京时间（UTC+8）。</p>
            </div>
          </div>
          {competition.matches.length ? (
            <PublicSchedule competitions={[competition]} referenceTime={referenceTime} />
          ) : <div className="core-competition-empty"><strong>当前暂无赛程赛果</strong><p>赛程将在正式发布后显示。</p></div>}
        </div>
      </section>

      <section className="cup-archive-section" id="standings" aria-labelledby={`${competition.id}-standings-title`}>
        <div className="page-shell">
          <div className="core-competition-section-intro">
            <div>
            <p>STANDINGS & KNOCKOUT</p>
            <h2 id={`${competition.id}-standings-title`}>积分榜与淘汰赛</h2>
            </div>
          </div>
          <PublicStandings tables={competition.standings ?? []} />
          <Link className="text-link core-competition-section-link" href="/competitions/standings">查看全部赛事积分榜 →</Link>
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
            <p>优先展示即将进行比赛的正式选派；往期与已完成记录可展开查看。</p>
          </div>
          <CompetitionAppointments matches={competition.matches} referenceTime={referenceTime} />
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
          <CompetitionReports competitionId={competition.id} />
          <Link href="/news">进入新闻公告 →</Link>
        </div>
      </section>

      <section className="cup-archive-section cup-archive-section-tint" id="media" aria-labelledby={`${competition.id}-media-title`}>
        <div className="page-shell">
          <div className="core-competition-section-intro">
            <div>
              <p>MEDIA</p>
              <h2 id={`${competition.id}-media-title`}>赛事影像</h2>
            </div>
          </div>
          <CompetitionMedia competitionId={competition.id} />
          <Link className="text-link core-competition-section-link" href="/media">进入影像资料 →</Link>
        </div>
      </section>

    </CompetitionArchiveLayout>
  );
}
