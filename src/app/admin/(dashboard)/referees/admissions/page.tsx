import Link from "next/link";

import {
  AdminEmptyState,
  AdminPageHeader,
  AdminPanel,
  AdminStatusBadge,
  admissionStatusLabels,
} from "@/components/referees/admin/admin-ui";
import { getAdmissionQueuePage } from "@/lib/referee-admission-service";
import { formatRefereeDateTime } from "@/lib/referee-presenters";
import { guardUnifiedAdminPage } from "@/lib/unified-admin-page";

const validStatuses = ["PENDING", "APPROVED", "REJECTED"] as const;

export default async function AdminAdmissionQueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await guardUnifiedAdminPage("referees:read", "referee-admissions");
  const query = await searchParams;
  const rawStatus = typeof query.status === "string" ? query.status : "";
  const status = validStatuses.find((item) => item === rawStatus) ?? "PENDING";
  const result = await getAdmissionQueuePage(status, Number(query.page ?? 1), actor);
  const applications = result.items;

  return <>
    <AdminPageHeader eyebrow="REFEREE ADMISSIONS" title="裁判准入申请" description="审核“希望成为裁判员”的申请；与比赛执裁报名和正式选派保持独立。" />
    <nav className="admin-filter-bar" aria-label="准入状态">{validStatuses.map((value) => <Link className="admin-button admin-button-secondary" aria-current={value === status ? "page" : undefined} key={value} href={`/admin/referees/admissions?status=${value}`}>{admissionStatusLabels[value]} · {result.counts[value]}</Link>)}</nav>
    <AdminPanel title={`准入申请 · ${result.counts[status]}`} description="联系方式仅在受权后台中显示，每页 30 条。">
      {applications.length ? <div className="admin-table-scroll"><table className="admin-data-table"><thead><tr><th>姓名</th><th>学号</th><th>手机</th><th>QQ</th><th>状态</th><th>申请时间</th><th>操作</th></tr></thead><tbody>{applications.map((application) => <tr key={application.id}><td><strong>{application.name}</strong></td><td>{application.studentId || "—"}</td><td>{application.phone || "—"}</td><td>{application.qq || "—"}</td><td><AdminStatusBadge status={application.status} label={admissionStatusLabels[application.status]} /></td><td>{formatRefereeDateTime(application.createdAt)}</td><td><Link href={`/admin/referees/admissions/${application.id}`}>查看详情</Link></td></tr>)}</tbody></table></div> : <AdminEmptyState title={`当前没有${admissionStatusLabels[status]}的准入申请`} description="新人从公开招募页提交后会进入此队列。" />}
      <nav className="admin-pagination" aria-label="准入分页">{result.page > 1 ? <Link href={`?status=${status}&page=${result.page - 1}`}>上一页</Link> : null}<span>{result.page} / {result.totalPages}</span>{result.page < result.totalPages ? <Link href={`?status=${status}&page=${result.page + 1}`}>下一页</Link> : null}</nav>
    </AdminPanel>
  </>;
}
