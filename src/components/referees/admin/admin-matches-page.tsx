import { MatchSchedulingForm } from "@/components/admin/match-scheduling-form";
import Link from "next/link";

import { AdminMatchNavigation } from "@/components/referees/admin/admin-match-navigation";
import { AdminEmptyState, AdminPageHeader, AdminPanel, AdminStatusBadge, appointmentStatusLabels, matchStatusLabels } from "@/components/referees/admin/admin-ui";
import { prisma } from "@/lib/prisma";
import { formatRefereeDateTime } from "@/lib/referee-presenters";
import { getUnifiedAdminActor, hasUnifiedAdminPermission } from "@/lib/unified-admin-rbac";

export type AdminMatchesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function AdminMatchesPageContent({
  searchParams,
  mode = "matches",
}: AdminMatchesPageProps & { mode?: "matches" | "appointments" }) {
  const query = await searchParams;
  const competitionId = typeof query.competition === "string" ? query.competition : "";
  const rawMatchStatus = typeof query.matchStatus === "string" ? query.matchStatus : "";
  const matchStatus = ["PENDING", "SCHEDULED", "COMPLETED", "CANCELLED"].includes(rawMatchStatus) ? rawMatchStatus : "";
  const rawAppointmentStatus = typeof query.appointmentStatus === "string" ? query.appointmentStatus : "";
  const appointmentStatus = ["NONE", "DRAFT", "PUBLISHED", "WITHDRAWN", "COMPLETED", "CANCELLED"].includes(rawAppointmentStatus) ? rawAppointmentStatus : "";
  const quick = typeof query.quick === "string" && ["pending", "incomplete", "conflict", "published"].includes(query.quick) ? query.quick : "";
  const date = typeof query.date === "string" ? query.date : "";
  const dateStart = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00+08:00`) : null;
  const [actor, competitions, allMatches] = await Promise.all([
    getUnifiedAdminActor(),
    prisma.competition.findMany({ select: { id: true, name: true }, orderBy: [{ year: "desc" }, { name: "asc" }] }),
    prisma.match.findMany({
      where: {
        ...(competitionId ? { competitionId } : {}),
        ...(matchStatus === "PENDING" ? { status: "SCHEDULED" as const, OR: [{ kickoff: null }, { venue: null }, { venue: "" }] } : matchStatus ? { status: matchStatus as "SCHEDULED" | "COMPLETED" | "CANCELLED" } : {}),
        ...(dateStart ? { kickoff: { gte: dateStart, lt: new Date(dateStart.getTime() + 86400000) } } : {}),
        ...(appointmentStatus === "NONE" ? { appointment: null } : appointmentStatus ? { appointment: { status: appointmentStatus as "DRAFT" | "PUBLISHED" | "WITHDRAWN" | "COMPLETED" | "CANCELLED" } } : {}),
      },
      select: {
        id: true, kickoff: true, venue: true, stage: true, status: true,
        competition: { select: { name: true } }, homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } },
        positionRequirements: { select: { count: true } },
        appointment: { select: { status: true, positions: { select: { refereeId: true } }, conflictReports: { where: { status: "PENDING" }, select: { id: true } } } },
      },
      orderBy: { kickoff: "desc" }, take: 250,
    }),
  ]);
  const canWriteCompetitions = Boolean(actor && hasUnifiedAdminPermission(actor.roles, "competitions:write"));
  const isAppointmentView = mode === "appointments";
  const detailRoot = isAppointmentView ? "/admin/appointments" : "/admin/matches";
  const matches = allMatches.filter((match) => {
    if (!quick) return true;
    const required = match.positionRequirements.reduce((sum, item) => sum + item.count, 0);
    const assigned = match.appointment?.positions.filter((position) => position.refereeId).length ?? 0;
    if (quick === "pending") return !match.appointment || ["DRAFT", "WITHDRAWN"].includes(match.appointment.status);
    if (quick === "incomplete") return assigned < required;
    if (quick === "conflict") return Boolean(match.appointment?.conflictReports.length);
    return match.appointment?.status === "PUBLISHED";
  });
  return <>
    <AdminPageHeader
      eyebrow={isAppointmentView ? "REFEREE APPOINTMENTS" : "MATCH MANAGEMENT"}
      title={isAppointmentView ? "选派管理" : "比赛管理"}
      description={isAppointmentView ? "按场次查看人员完整度、发布状态和冲突提醒，并直接进入选派。" : "维护比赛资料；裁判选派在裁判中心独立管理。"}
      actions={!isAppointmentView ? <><Link className="admin-button admin-button-secondary" href="/admin/competitions">赛事管理</Link>{canWriteCompetitions ? <Link className="admin-button" href="/admin/matches/new">+ 新建比赛</Link> : null}</> : undefined}
    />
    {!isAppointmentView ? <AdminMatchNavigation active="matches" /> : null}
    <form className="admin-filter-bar">
      <label><span>赛事</span><select defaultValue={competitionId} name="competition"><option value="">全部赛事</option>{competitions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label><span>日期</span><input defaultValue={date} name="date" type="date" /></label>
      <label><span>比赛状态</span><select defaultValue={matchStatus} name="matchStatus"><option value="">全部状态</option><option value="PENDING">待排期</option>{Object.entries(matchStatusLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>选派状态</span><select defaultValue={appointmentStatus} name="appointmentStatus"><option value="">全部状态</option>{Object.entries(appointmentStatusLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button className="admin-button admin-button-secondary" type="submit">筛选</button>
      <Link className="admin-filter-reset" href={detailRoot}>清除</Link>
    </form>
    {isAppointmentView ? <nav aria-label="选派快速筛选" className="admin-quick-filters"><Link aria-current={quick === "pending" ? "page" : undefined} href="/admin/appointments?quick=pending">待选派</Link><Link aria-current={quick === "incomplete" ? "page" : undefined} href="/admin/appointments?quick=incomplete">未完整选派</Link><Link aria-current={quick === "conflict" ? "page" : undefined} href="/admin/appointments?quick=conflict">有冲突 / 异常</Link><Link aria-current={quick === "published" ? "page" : undefined} href="/admin/appointments?quick=published">已发布</Link></nav> : null}
    <AdminPanel title={`比赛列表 · ${matches.length}`} description="默认按开球时间倒序，最多显示 250 场。">
      {matches.length ? <div className="admin-table-scroll"><table className="admin-data-table"><thead><tr><th>时间</th><th>比赛</th><th>赛事</th><th>场地</th><th>比赛状态</th>{isAppointmentView ? <th>人员完整度</th> : null}<th>选派状态</th>{isAppointmentView ? <th>提醒</th> : null}<th>操作</th></tr></thead><tbody>{matches.map((match) => { const required = match.positionRequirements.reduce((sum, item) => sum + item.count, 0); const assigned = match.appointment?.positions.filter((position) => position.refereeId).length ?? 0; const pendingConflicts = match.appointment?.conflictReports.length ?? 0; return <tr key={match.id}><td>{formatRefereeDateTime(match.kickoff)}</td><td><strong>{match.homeTeam.name} vs {match.awayTeam.name}</strong><small>{match.stage}</small></td><td>{match.competition.name}</td><td>{match.venue || "场地待定"}</td><td><AdminStatusBadge status={match.status} label={match.status === "SCHEDULED" && (!match.kickoff || !match.venue?.trim()) ? "待排期" : matchStatusLabels[match.status]} /></td>{isAppointmentView ? <td><strong className="admin-stat-number">{assigned}/{required}</strong></td> : null}<td><AdminStatusBadge status={match.appointment?.status ?? "NONE"} label={appointmentStatusLabels[match.appointment?.status ?? "NONE"]} /></td>{isAppointmentView ? <td>{pendingConflicts ? <Link className="admin-warning-link" href="/admin/conflicts?status=PENDING">{pendingConflicts} 个待处理冲突</Link> : assigned < required ? "人员未完整" : "—"}</td> : null}<td><div className="admin-table-actions">{!isAppointmentView && canWriteCompetitions && match.status === "SCHEDULED" && (!match.kickoff || !match.venue?.trim()) ? <MatchSchedulingForm matchId={match.id} /> : null}<Link className="admin-row-action-primary" href={`${detailRoot}/${match.id}`}>{isAppointmentView ? (match.appointment?.status === "PUBLISHED" ? "查看选派" : "进入选派") : "查看比赛"}</Link>{!isAppointmentView && canWriteCompetitions ? <Link href={`/admin/matches/${match.id}/edit`}>编辑</Link> : null}</div></td></tr>; })}</tbody></table></div> : <AdminEmptyState title="没有符合条件的比赛" description={canWriteCompetitions ? "调整筛选条件，或创建一场新比赛。" : "请调整筛选条件。"} />}
    </AdminPanel>
  </>;
}
