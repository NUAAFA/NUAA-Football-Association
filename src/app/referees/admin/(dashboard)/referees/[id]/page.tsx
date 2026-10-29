import { getUnifiedAdminActor, hasUnifiedAdminPermission } from "@/lib/unified-admin-rbac";
import { BeijingDayRefresh } from "@/components/referees/admin/beijing-day-refresh";
import { AdminGradeControl } from "@/components/referees/admin/admin-grade-control";
import { getEffectiveRefereeGrade } from "@/lib/referee-grade";
import { formatBeijingDateTimeInput } from "@/lib/beijing-datetime";
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
            recordSource: true, recordedAt: true,
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
  const actor = await getUnifiedAdminActor();
  const canWrite = Boolean(actor && hasUnifiedAdminPermission(actor.roles, "referees:write"));
  const record: AdminRefereeRecord = {
    id: referee.id, publicCode: referee.publicCode, name: referee.name, studentId: referee.studentId ?? "", collegeId: referee.collegeId ?? "",
    currentAffiliationUnitId: referee.currentAffiliationUnitId ?? "",
    gradeMode: referee.gradeMode, effectiveGrade: getEffectiveRefereeGrade(new Date(), referee).grade ?? "",
    grade: referee.grade ?? "", phone: referee.phone ?? "", qq: referee.qq ?? "", refereeLevel: referee.refereeLevel ?? "",
    joinedAt: referee.joinedAt ? formatBeijingDateTimeInput(referee.joinedAt).slice(0, 10) : "", status: referee.status,
    elevenASide: referee.elevenASide, futsal: referee.futsal, certificateNote: referee.certificateNote ?? "", trainingStatus: referee.trainingStatus,
    assignmentEligibility: referee.assignmentEligibility,
    qualificationNote: referee.qualificationNote ?? "",
    publicDirectoryEnabled: referee.publicDirectoryEnabled, publicBio: referee.publicBio ?? "", internalNote: referee.internalNote ?? "",
    mustChangePassword: referee.mustChangePassword, lastLoginAt: referee.lastLoginAt ? formatRefereeDateTime(referee.lastLoginAt) : "",
    capabilities: referee.capabilities.map((item) => `${item.format}:${item.positionKey}:${item.status}`),
  };
  const applicationCapabilities = referee.capabilities.filter(item => item.status === "TRAINING" || item.status === "READY");
  return <><BeijingDayRefresh />
    <section className="admin-detail-hero admin-referee-hero"><div><span>裁判员档案 · {referee.publicCode}</span><h1>{referee.name}</h1><p>{referee.college?.name ?? "学院待确认"} · {referee.refereeLevel || "暂无正式裁判资质"}</p><dl className="admin-detail-meta"><div><dt>账号状态</dt><dd>{refereeStatusLabels[referee.status]}</dd></div><div><dt>可报名岗位</dt><dd className="admin-meta-capabilities"><span>十一人制 {applicationCapabilities.filter(item => item.format === "ELEVEN_A_SIDE").length} 项</span><span>五人制 {applicationCapabilities.filter(item => item.format === "FUTSAL").length} 项</span></dd></div><div><dt>培训记录</dt><dd>{trainingStatusLabels[referee.trainingStatus]}</dd></div><div><dt>已完成执裁</dt><dd>{history.length}{history.length === 30 ? "+" : ""} 条岗位记录</dd></div></dl></div><AdminStatusBadge status={referee.assignmentEligibility} label={`报名与选派：${assignmentEligibilityLabels[referee.assignmentEligibility]}`} /></section>

    <AdminPanel title="裁判员档案" description="常用资料集中维护；报名限制、持证记录和账号设置各有明确入口。">{canWrite ? <RefereeEditForm account={record} affiliationUnits={unitOptions} colleges={collegeOptions} /> : <p>当前权限仅可查看档案。</p>}</AdminPanel>
    <details className="admin-profile-disclosure admin-profile-secondary"><summary>年级计算设置 · 自动识别与特殊学籍</summary>
    <AdminPanel title="年级计算设置">{canWrite && actor?.id ? <AdminGradeControl key={referee.updatedAt.toISOString()} id={referee.id} mode={referee.gradeMode} grade={referee.grade ?? ""} expectedUpdatedAt={referee.updatedAt.toISOString()} preview={`${getEffectiveRefereeGrade(new Date(), referee).grade ?? "学籍待核实"} · ${getEffectiveRefereeGrade(new Date(), referee).source} · 可识别入学年：${getEffectiveRefereeGrade(new Date(), referee).enrollmentYear ?? "待核实"}`} /> : <p>{getEffectiveRefereeGrade(new Date(), referee).grade ?? "学籍待核实"} · {getEffectiveRefereeGrade(new Date(), referee).source} · 只读档案</p>}</AdminPanel>
    </details>
    <details className="admin-profile-disclosure admin-profile-secondary"><summary>可执裁时间与执裁历史 · 查看最近记录</summary>
    <div className="admin-two-column">
      <AdminPanel title="可执裁时间" description="最近 30 条，可到可执裁时间页代为维护。">{availability.length ? <div className="admin-compact-list">{availability.map((item) => <article className="admin-compact-row" key={item.id}><div><strong>{item.kind === "AVAILABLE" ? "可执裁" : "不可执裁"}</strong><span>{formatRefereeDateTime(item.startAt)} — {formatRefereeDateTime(item.endAt)}</span></div><p>{item.note || "—"}</p></article>)}</div> : <AdminEmptyState title="暂无可执裁时间" description="裁判员或管理员尚未添加记录。" />}</AdminPanel>
      <AdminPanel title="执裁历史" description="保留原已完成选派；缺失赛果或比赛状态不一致的旧档案标注待核。">{history.length ? <div className="admin-compact-list">{history.map((item) => <article className="admin-compact-row" key={item.id}><div><strong>{item.appointment.match.homeTeam.name} vs {item.appointment.match.awayTeam.name}</strong><span>{item.appointment.match.competition.name} · {formatRefereeDateTime(item.appointment.match.kickoff)}</span>{completedAssignmentReviewReason(item.appointment.match) ? <span>旧完成记录 · 完赛事实待核：{completedAssignmentReviewReason(item.appointment.match)}</span> : null}</div><p>{item.label} · {item.appointment.recordSource === "POST_MATCH_ENTRY" ? "赛后执裁记录" : "正式选派完成"}</p></article>)}</div> : <AdminEmptyState title="暂无已完成执裁" description="选派完成后会进入这里。" />}</AdminPanel>
    </div>
    </details>
  </>;
}
