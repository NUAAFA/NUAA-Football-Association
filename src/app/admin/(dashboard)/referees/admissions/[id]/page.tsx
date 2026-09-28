import { hasUnifiedAdminPermission } from "@/lib/unified-admin-rbac";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminAdmissionReviewForm } from "@/components/referees/admin/admin-admission-review-form";
import { AdminPageHeader, AdminPanel, AdminStatusBadge, admissionStatusLabels } from "@/components/referees/admin/admin-ui";
import { getRefereeAdmissionApplication } from "@/lib/referee-admission-service";
import { formatRefereeDateTime } from "@/lib/referee-presenters";
import { RefereeServiceError } from "@/lib/referee-service-error";
import { guardUnifiedAdminPage } from "@/lib/unified-admin-page";
import { prisma } from "@/lib/prisma";

export default async function AdminAdmissionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await guardUnifiedAdminPage("referees:read", "referee-admissions");
  const { id } = await params;
  let application;
  try {
    application = await getRefereeAdmissionApplication(id, actor);
  } catch (error) {
    if (error instanceof RefereeServiceError && error.status === 404) notFound();
    throw error;
  }
  const existingReferees = application.status === "PENDING" ? await prisma.referee.findMany({
    where: { status: { not: "ARCHIVED" } },
    select: { id: true, publicCode: true, name: true, status: true, studentId: true },
    orderBy: { publicCode: "asc" },
    take: 300,
  }) : [];

  return <>
    <AdminPageHeader eyebrow="REFEREE ADMISSION" title={application.name} description="完整准入资料、审核追踪与账号关联。" actions={<Link className="admin-button admin-button-secondary" href="/admin/referees/admissions">返回队列</Link>} />
    <AdminPanel title="申请详情" actions={<AdminStatusBadge status={application.status} label={admissionStatusLabels[application.status]} />}>
      <dl className="admin-detail-meta"><div><dt>姓名</dt><dd>{application.name}</dd></div><div><dt>学号</dt><dd>{application.studentId || "—"}</dd></div><div><dt>手机号</dt><dd>{application.phone || "—"}</dd></div><div><dt>QQ</dt><dd>{application.qq || "—"}</dd></div><div><dt>申请时间</dt><dd>{formatRefereeDateTime(application.createdAt)}</dd></div><div><dt>补充说明</dt><dd>{application.note || "—"}</dd></div></dl>
    </AdminPanel>
    {application.status === "PENDING" && hasUnifiedAdminPermission(actor.roles, "referees:write") ? <AdminPanel title="待批复" description="重复审核会由服务层返回 409 conflict。"><AdminAdmissionReviewForm applicationId={application.id} existingReferees={existingReferees.map((referee) => ({ ...referee, studentId: referee.studentId ?? "" }))} /></AdminPanel> : <AdminPanel title="审核追踪" description="记录审核人、审核时间、审核原因和关联账号。"><dl className="admin-detail-meta"><div><dt>审核人</dt><dd>{application.reviewedByAdmin ? `${application.reviewedByAdmin.displayName} (${application.reviewedByAdmin.username})` : "Legacy / 未记录"}</dd></div><div><dt>审核时间</dt><dd>{application.reviewedAt ? formatRefereeDateTime(application.reviewedAt) : "—"}</dd></div><div><dt>审核意见</dt><dd>{application.reviewNote || "—"}</dd></div><div><dt>关联账号</dt><dd>{application.referee ? <Link href={`/admin/referees/${application.referee.id}`}>{application.referee.publicCode} · {application.referee.name}</Link> : "未创建或关联"}</dd></div></dl></AdminPanel>}
  </>;
}
