import { notFound } from "next/navigation";

import { RefereeEditForm, type AdminRefereeRecord } from "@/components/referees/admin/admin-referee-forms";
import { AdminEmptyState, AdminPanel, AdminStatusBadge, assignmentEligibilityLabels, refereeStatusLabels, trainingStatusLabels } from "@/components/referees/admin/admin-ui";
import { adminRefereeSelect } from "@/lib/referee-dto";
import { affiliationOptionLabel, sortAffiliationOptions } from "@/lib/referee-affiliation-options";
import { formatRefereeDateTime } from "@/lib/referee-presenters";
import { prisma } from "@/lib/prisma";
import { completedAssignmentReviewReason } from "@/lib/referee-completion-evidence";

export default async function AdminRefereeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [referee, colleges, affiliationUnits, availability, history] = await Promise.all([
    prisma.referee.findUnique({ where: { id }, select: adminRefereeSelect }),
    prisma.college.findMany({ select: { id: true, name: true, codeMappings: { select: { prefix: true } } } }),
    prisma.affiliationUnit.findMany({ select: { id: true, name: true, type: true, legacyCollege: { select: { codeMappings: { select: { prefix: true } } } }, parentRelations: { select: { childUnitId: true } } } }),
    prisma.refereeAvailability.findMany({ where: { refereeId: id }, orderBy: { startAt: "desc" }, take: 30 }),
    prisma.appointmentPosition.findMany({
      where: { refereeId: id, appointment: { status: "COMPLETED" } },
      select: {
        id: true,
        label: true,
        appointment: {
          select: {
            match: {
              select: {
                kickoff: true,
                status: true,
                homeScore: true,
                awayScore: true,
                competition: { select: { name: true } },
                homeTeam: { select: { name: true } },
                awayTeam: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { appointment: { match: { kickoff: "desc" } } },
      take: 30,
    }),
  ]);
  if (!referee) notFound();
  const collegeOptions = sortAffiliationOptions(colleges.map((college) => ({ id: college.id, name: college.name, type: "COLLEGE" as const, prefixes: college.codeMappings.map((mapping) => mapping.prefix) })))
    .map((college) => ({ id: college.id, name: college.name, label: affiliationOptionLabel(college) }));
  const unitOptions = sortAffiliationOptions(affiliationUnits.map((unit) => ({ ...unit, prefixes: unit.legacyCollege?.codeMappings.map((mapping) => mapping.prefix) ?? [] })))
    .map((unit) => ({ id: unit.id, name: unit.name, label: affiliationOptionLabel(unit), type: unit.type, childUnitIds: unit.parentRelations.map((relation) => relation.childUnitId) }));
  const record: AdminRefereeRecord = {
    id: referee.id, publicCode: referee.publicCode, name: referee.name, studentId: referee.studentId ?? "", collegeId: referee.collegeId ?? "",
    currentAffiliationUnitId: referee.currentAffiliationUnitId ?? "",
    grade: referee.grade ?? "", phone: referee.phone ?? "", qq: referee.qq ?? "", refereeLevel: referee.refereeLevel ?? "",
    joinedAt: referee.joinedAt ? referee.joinedAt.toISOString().slice(0, 10) : "", status: referee.status,
    elevenASide: referee.elevenASide, futsal: referee.futsal, certificateNote: referee.certificateNote ?? "", trainingStatus: referee.trainingStatus,
    assignmentEligibility: referee.assignmentEligibility,
    qualificationNote: referee.qualificationNote ?? "",
    publicDirectoryEnabled: referee.publicDirectoryEnabled, publicBio: referee.publicBio ?? "", internalNote: referee.internalNote ?? "",
    mustChangePassword: referee.mustChangePassword, lastLoginAt: referee.lastLoginAt ? formatRefereeDateTime(referee.lastLoginAt) : "",
    capabilities: referee.capabilities.map((item) => `${item.format}:${item.positionKey}:${item.status}`),
  };
  return <>
    <section className="admin-detail-hero"><div><span>{referee.publicCode}</span><h1>{referee.name}</h1><p>{referee.college?.name ?? "学院待确认"} · {referee.refereeLevel || "暂无正式裁判资质"}</p><dl className="admin-detail-meta"><div><dt>账号状态</dt><dd>{refereeStatusLabels[referee.status]}</dd></div><div><dt>培养状态</dt><dd>{trainingStatusLabels[referee.trainingStatus]}</dd></div><div><dt>正式选派资格</dt><dd>{assignmentEligibilityLabels[referee.assignmentEligibility]}</dd></div><div><dt>READY 岗位</dt><dd>{referee.capabilities.filter((item) => item.status === "READY").length} 项</dd></div><div><dt>最近登录</dt><dd>{referee.lastLoginAt ? formatRefereeDateTime(referee.lastLoginAt) : "从未登录"}</dd></div><div><dt>执裁历史</dt><dd>{history.length} 条岗位记录</dd></div></dl></div><AdminStatusBadge status={referee.assignmentEligibility} label={assignmentEligibilityLabels[referee.assignmentEligibility]} /></section>
    <AdminPanel title="裁判员档案" description="正式资质、培训状态与岗位培养状态分别维护。"><RefereeEditForm account={record} affiliationUnits={unitOptions} colleges={collegeOptions} /></AdminPanel>
    <div className="admin-two-column">
      <AdminPanel title="可执裁时间" description="最近 30 条，可到可执裁时间页代为维护。">{availability.length ? <div className="admin-compact-list">{availability.map((item) => <article className="admin-compact-row" key={item.id}><div><strong>{item.kind === "AVAILABLE" ? "可执裁" : "不可执裁"}</strong><span>{formatRefereeDateTime(item.startAt)} — {formatRefereeDateTime(item.endAt)}</span></div><p>{item.note || "—"}</p></article>)}</div> : <AdminEmptyState title="暂无可执裁时间" description="裁判员或管理员尚未添加记录。" />}</AdminPanel>
      <AdminPanel title="执裁历史" description="保留原已完成选派；缺失赛果或比赛状态不一致的旧档案标注待核。">{history.length ? <div className="admin-compact-list">{history.map((item) => <article className="admin-compact-row" key={item.id}><div><strong>{item.appointment.match.homeTeam.name} vs {item.appointment.match.awayTeam.name}</strong><span>{item.appointment.match.competition.name} · {formatRefereeDateTime(item.appointment.match.kickoff)}</span>{completedAssignmentReviewReason(item.appointment.match) ? <span>旧完成记录 · 完赛事实待核：{completedAssignmentReviewReason(item.appointment.match)}</span> : null}</div><p>{item.label}</p></article>)}</div> : <AdminEmptyState title="暂无已完成执裁" description="选派完成后会进入这里。" />}</AdminPanel>
    </div>
  </>;
}
