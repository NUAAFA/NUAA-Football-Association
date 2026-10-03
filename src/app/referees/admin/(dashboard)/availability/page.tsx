import Link from "next/link";
import { AvailabilityManager } from "@/components/referees/admin/admin-data-managers";
import { AdminPageHeader, AdminPanel } from "@/components/referees/admin/admin-ui";
import { getAdminAvailabilityPage, type AvailabilityKindFilter } from "@/lib/admin-availability-page";
import { prisma } from "@/lib/prisma";

export default async function AdminAvailabilityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const refereeId = typeof query.referee === "string" ? query.referee : "";
  const kind: AvailabilityKindFilter = query.kind === "AVAILABLE" || query.kind === "UNAVAILABLE" ? query.kind : "";
  const date = typeof query.date === "string" ? query.date : "";
  const page = typeof query.page === "string" ? Number(query.page) : 1;
  const [referees, result] = await Promise.all([
    prisma.referee.findMany({ where: { status: { not: "ARCHIVED" } }, select: { id: true, publicCode: true, name: true }, orderBy: { publicCode: "asc" } }),
    getAdminAvailabilityPage({ refereeId, kind, date, page }),
  ]);
  const href = (p: number) => `/admin/referees/availability?${new URLSearchParams({ referee: refereeId, kind, date, page: String(p) })}`;
  return <>
    <AdminPageHeader eyebrow="AVAILABILITY" title="可执裁时间" description={result.date ? "当日可执裁情况 · 按裁判员查看时段" : "按裁判员聚合；查看详情可通过月历查看每天的可执裁情况。"} />
    <form className="admin-filter-bar"><label><span>日期</span><input defaultValue={date} name="date" type="date" /></label><label><span>裁判员</span><select defaultValue={refereeId} name="referee"><option value="">全部裁判员</option>{referees.map((item) => <option key={item.id} value={item.id}>{item.publicCode} · {item.name}</option>)}</select></label><label><span>类型</span><select defaultValue={kind} name="kind"><option value="">全部类型</option><option value="AVAILABLE">可执裁</option><option value="UNAVAILABLE">不可执裁</option></select></label><button className="admin-button admin-button-secondary" type="submit">筛选</button><Link className="admin-filter-reset" href="/admin/referees/availability">清除</Link></form>
    <AdminPanel title={`裁判可执裁情况 · ${result.total} 人`} description={`${result.date ? "当日" : "全部日期"} · 每页 ${result.pageSize} 位裁判员，第 ${result.page} / ${result.totalPages} 页。时间按 Asia/Shanghai 展示。`}>
      <AvailabilityManager items={result.items.map((item) => ({ ...item, updatedAt: item.updatedAt?.toISOString() ?? null, dateRecords: item.dateRecords.map((r) => ({ ...r, startAt: r.startAt.toISOString(), endAt: r.endAt.toISOString() })) }))} referees={referees.map((item) => ({ id: item.id, label: `${item.publicCode} · ${item.name}` }))} date={result.date} kind={kind} />
      <nav aria-label="裁判员分页" className="admin-pagination">{result.page > 1 ? <Link href={href(result.page - 1)}>上一页</Link> : <span>上一页</span>}<span>{result.page} / {result.totalPages}</span>{result.page < result.totalPages ? <Link href={href(result.page + 1)}>下一页</Link> : <span>下一页</span>}</nav>
    </AdminPanel>
  </>;
}
