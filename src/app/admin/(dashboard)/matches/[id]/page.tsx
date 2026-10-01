import { MatchTentativeForm } from "@/components/admin/match-tentative-form";
import { MatchSchedulingForm } from "@/components/admin/match-scheduling-form";
import Link from "next/link";
import { notFound } from "next/navigation";

import { MatchResultForm } from "@/components/admin/match-result-form";
import { AdminMatchDangerActions } from "@/components/referees/admin/admin-match-danger-actions";
import { AdminPanel, appointmentStatusLabels, matchStatusLabels } from "@/components/referees/admin/admin-ui";
import { prisma } from "@/lib/prisma";
import { formatRefereeDateTime } from "@/lib/referee-presenters";
import { hasUnifiedAdminPermission } from "@/lib/unified-admin-rbac";
import { guardUnifiedAdminPage } from "@/lib/unified-admin-page";

export default async function UnifiedMatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await guardUnifiedAdminPage("competitions:read", "matches");
  const { id } = await params;
  const match = await prisma.match.findUnique({
    where: { id },
    select: {
      id: true,
      stage: true, homeScore: true, awayScore: true, homePenaltyScore: true, awayPenaltyScore: true, resultVersion: true, structureStage: { select: { type: true } },
      round: true,
      kickoff: true,
      endAt: true,
      venue: true,
      status: true,
      applicationWindowStatus: true,
      applicationDeadline: true,
      publicNote: true,
      internalNote: true, tentativeDate: true, tentativeSchedule: true,
      competition: { select: { name: true } },
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
      appointment: {
        select: {
          status: true,
          revision: true,
          publishedAt: true,
          withdrawnAt: true,
          completedAt: true,
          cancelledAt: true,
          _count: { select: { versions: true, acknowledgements: true, conflictReports: true } },
        },
      },
      applications: { select: { status: true } },
    },
  });
  if (!match) notFound();
  const canWrite = hasUnifiedAdminPermission(actor.roles, "competitions:write");
  const deletionProtected = match.status !== "SCHEDULED" || match.applications.length > 0 || Boolean(match.appointment);
  const matchLabel = `${match.homeTeam.name} vs ${match.awayTeam.name}`;

  return <>
    <section className="admin-detail-hero">
      <div><span>{match.competition.name}</span><h1>{matchLabel}</h1><p>{match.round ? `${match.round} · ` : ""}{match.stage}</p>
        <dl className="admin-detail-meta">
          <div><dt>开球时间</dt><dd>{formatRefereeDateTime(match.kickoff)}</dd></div>
          <div><dt>比赛场地</dt><dd>{match.venue || "场地待定"}</dd></div>
          <div><dt>比赛状态</dt><dd>{match.status === "SCHEDULED" && (!match.kickoff || !match.venue?.trim()) ? "待排期" : matchStatusLabels[match.status]}</dd></div>
          <div><dt>选派状态</dt><dd>{appointmentStatusLabels[match.appointment?.status ?? "NONE"]}</dd></div>
        </dl>
      </div>
      {canWrite ? <div className="admin-detail-actions">
        {match.status === "SCHEDULED" && (!match.kickoff || !match.venue?.trim()) ? <MatchSchedulingForm matchId={match.id} /> : null}
        <Link className="admin-button admin-button-secondary" href={`/admin/matches/${match.id}/edit`}>编辑比赛</Link>
        <AdminMatchDangerActions matchId={match.id} matchLabel={matchLabel} protectedReason={deletionProtected ? "该比赛已有报名意向、选派或正式历史记录，不能直接删除。请使用“取消比赛”保留业务历史。" : undefined} />
      </div> : null}
    </section>
    <AdminPanel title="比赛结果">{canWrite ? <MatchResultForm match={{ id: match.id, homeScore: match.homeScore, awayScore: match.awayScore, homePenaltyScore: match.homePenaltyScore, awayPenaltyScore: match.awayPenaltyScore, resultVersion: match.resultVersion, status: match.status, knockout: match.structureStage?.type === "KNOCKOUT", canConfirm: match.status !== "CANCELLED" && Boolean(match.venue?.trim()) && match.kickoff !== null && match.kickoff <= new Date() && (!match.endAt || match.endAt <= new Date()) }} /> : <p>{match.homeScore !== null && match.awayScore !== null ? `${match.homeScore}:${match.awayScore}` : "赛果待确认"}</p>}</AdminPanel>
    <AdminPanel title="暂定安排"><MatchTentativeForm matchId={id} date={match.tentativeDate} note={match.tentativeSchedule} canWrite={canWrite && match.status === "SCHEDULED"} /></AdminPanel>
    <AdminPanel title="比赛资料" description="赛事管理员仅维护比赛运营资料；裁判选派位于裁判中心。">
      <dl className="admin-detail-meta">
        <div><dt>报名窗口</dt><dd>{match.applicationWindowStatus}</dd></div>
        <div><dt>报名截止</dt><dd>{match.applicationDeadline ? formatRefereeDateTime(match.applicationDeadline) : "—"}</dd></div>
        <div><dt>结束时间</dt><dd>{match.endAt ? formatRefereeDateTime(match.endAt) : "—"}</dd></div>
        <div><dt>公开说明</dt><dd>{match.publicNote || "—"}</dd></div>
        <div><dt>内部备注</dt><dd>{match.internalNote || "—"}</dd></div>
      </dl>
    </AdminPanel>
  </>;
}
