import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { RefreshOnFocus } from "@/components/refresh-on-focus";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { ApplicationWithdrawButton } from "@/components/referees/mvp/application-withdraw-button";
import { RefereeTaskActions } from "@/components/referees/mvp/referee-task-actions";
import { RefereeWorkspaceHero } from "@/components/referees/mvp/referee-workspace-hero";
import { RefereeWorkspaceNav } from "@/components/referees/mvp/referee-workspace-nav";
import { getRefereeMemberSession } from "@/lib/referee-member-auth";
import { applicationStatusLabels, formatRefereeDateTime } from "@/lib/referee-presenters";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  alternates: { canonical: "/referees/workspace" },
  title: "裁判员工作区",
  description: "查看可报名场次、正式任务、可执裁时间和个人资料。",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function RefereeWorkspacePage() {
  const session = await getRefereeMemberSession();
  if (!session) redirect("/referees/login");
  if (session.referee.mustChangePassword) redirect("/referees/workspace/account");
  const now = new Date();
  const [applications, assignedPositions, availability, openMatchCount] = await Promise.all([
    prisma.refereeApplication.findMany({
      where: { refereeId: session.refereeId },
      include: { match: { include: { competition: true, homeTeam: true, awayTeam: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.appointmentPosition.findMany({
      where: { refereeId: session.refereeId, appointment: { status: { in: ["PUBLISHED", "COMPLETED"] } } },
      include: {
        appointment: {
          include: {
            versions: {
              orderBy: { revision: "desc" },
              take: 1,
              include: {
                acknowledgements: { where: { refereeId: session.refereeId } },
                conflictReports: { where: { refereeId: session.refereeId } },
              },
            },
            match: { include: { competition: true, homeTeam: true, awayTeam: true } },
          },
        },
      },
    }),
    prisma.refereeAvailability.findMany({ where: { refereeId: session.refereeId, endAt: { gte: now } }, orderBy: { startAt: "asc" }, take: 5 }),
    prisma.match.count({ where: { status: "SCHEDULED", applicationWindowStatus: "OPEN", applicationDeadline: { gt: now } } }),
  ]);
  const sortedPositions = [...assignedPositions].sort((left, right) => left.appointment.match.kickoff.getTime() - right.appointment.match.kickoff.getTime());
  const upcomingPositions = sortedPositions.filter((item) => item.appointment.status === "PUBLISHED" && item.appointment.match.status === "SCHEDULED");
  const historicalPositions = sortedPositions.filter((item) => item.appointment.status === "COMPLETED" && item.appointment.match.status === "COMPLETED" && item.appointment.match.kickoff <= now).reverse();
  return <>
    <SiteHeader /><RefreshOnFocus />
    <main className="functional-page" id="main-content">
      <RefereeWorkspaceHero description={`登录账号 ${session.referee.studentId} · 从这里查看报名、正式任务与可执裁时间。`} eyebrow="REFEREE WORKSPACE" name={session.referee.name} publicCode={session.referee.publicCode} title={`${session.referee.name}，欢迎回来`} />
      <RefereeWorkspaceNav />
      <section className="functional-section"><div className="detail-shell referee-dashboard">
        <section className="referee-dashboard-priority">
          <header className="functional-section-heading"><div><p>OPEN MATCHES & INTEREST</p><h2>可报名场次 / 我的执裁意向</h2></div><Link href="/referees/open-matches">查看 {openMatchCount} 场开放比赛 →</Link></header>
          {applications.length ? <div className="referee-personal-list">{applications.slice(0, 5).map((application) => <article key={application.id}><div><span>{application.match.competition.name}</span><h3>{application.match.homeTeam.name} vs {application.match.awayTeam.name}</h3><p>{formatRefereeDateTime(application.match.kickoff)}</p></div><strong data-status={application.status}>{applicationStatusLabels[application.status]}</strong>{application.match.applicationDeadline && application.match.applicationDeadline > now && !["APPOINTED", "WITHDRAWN"].includes(application.status) ? <ApplicationWithdrawButton applicationId={application.id} /> : null}</article>)}</div> : <div className="functional-empty functional-empty-compact"><strong>尚未提交执裁意向</strong><p>开放场次会在这里形成报名与审核记录。</p><Link href="/referees/open-matches">浏览开放场次</Link></div>}
        </section>

        <section id="official-tasks">
          <header className="functional-section-heading"><div><p>UPCOMING OFFICIAL DUTIES</p><h2>正式任务 · 待执裁 / 待完赛确认</h2></div><span>{upcomingPositions.length} 项</span></header>
          {upcomingPositions.length ? <div className="referee-task-list">{upcomingPositions.map((position, index) => { const version = position.appointment.versions[0]; return <article className={index === 0 ? "is-nearest" : ""} key={position.id}><div><span>{index === 0 ? "最近任务 · " : ""}{position.appointment.match.competition.name}</span><h3>{position.appointment.match.homeTeam.name} vs {position.appointment.match.awayTeam.name}</h3><p>{formatRefereeDateTime(position.appointment.match.kickoff)} · {position.appointment.match.venue}</p></div><strong>{position.label}{position.appointment.match.kickoff <= now ? " · 待完赛确认" : ""}</strong><RefereeTaskActions appointmentId={position.appointment.id} acknowledgedAt={version?.acknowledgements[0] ? formatRefereeDateTime(version.acknowledgements[0].acknowledgedAt) : null} reportStatus={version?.conflictReports[0]?.status ?? null} /></article>; })}</div> : <div className="functional-empty functional-empty-compact"><strong>暂无正式任务 · 待执裁 / 待完赛确认</strong><p>只有管理员正式发布且未撤回的选派会显示在这里。</p></div>}
        </section>

        <div className="referee-dashboard-secondary">
          <section><header><p>AVAILABILITY</p><h2>我的可执裁时间</h2></header><p>{availability.length ? `未来已有 ${availability.length} 条时间记录。` : "未来尚未设置可执裁时间。"}</p>{availability[0] ? <small>最近：{formatRefereeDateTime(availability[0].startAt)} · {availability[0].kind === "AVAILABLE" ? "可执裁" : "不可执裁"}</small> : null}<Link href="/referees/workspace/availability">打开月历管理 →</Link></section>
          <section id="profile"><header><p>PROFILE</p><h2>基础个人资料</h2></header><dl><div><dt>姓名 / 学号</dt><dd>{session.referee.name} · {session.referee.studentId}</dd></div><div><dt>学院</dt><dd>{session.referee.college?.name ?? "待管理员确认"}</dd></div><div><dt>裁判资质</dt><dd>{session.referee.refereeLevel || "暂无正式裁判资质"}</dd></div><div><dt>联系方式</dt><dd>{[session.referee.phone, session.referee.qq ? `QQ ${session.referee.qq}` : ""].filter(Boolean).join(" / ") || "未填写"}</dd></div></dl><Link href="/referees/workspace/account">账号与安全 →</Link></section>
        </div>

        <section id="task-history"><header className="functional-section-heading"><div><p>HISTORY</p><h2>历史任务</h2></div><span>{historicalPositions.length} 项</span></header>{historicalPositions.length ? <div className="referee-personal-list">{historicalPositions.map((position) => <article key={position.id}><div><span>{position.appointment.match.competition.name}</span><h3>{position.appointment.match.homeTeam.name} vs {position.appointment.match.awayTeam.name}</h3><p>{formatRefereeDateTime(position.appointment.match.kickoff)}</p></div><strong>{position.label}</strong></article>)}</div> : <div className="functional-empty functional-empty-compact"><strong>暂无历史任务</strong><p>已完成的正式任务会保留在这里。</p></div>}</section>
      </div></section>
    </main>
    <SiteFooter />
  </>;
}
