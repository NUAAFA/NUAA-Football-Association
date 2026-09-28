import Link from "next/link";

import { AdminEmptyState, AdminPageHeader, AdminPanel } from "@/components/referees/admin/admin-ui";
import { formatRefereeDateTime } from "@/lib/referee-presenters";
import { positionTemplates } from "@/lib/referee-roles";
import { getCompletedRefereeStatistics, getUnverifiedCompletedAssignments } from "@/lib/referee-r1-service";

const positionLabels = Object.fromEntries(Object.values(positionTemplates).flat().map((item) => [item.key, item.label]));

export default async function AdminStatisticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const q = typeof query.referee === "string" ? query.referee.trim() : "";
  const competition = typeof query.competition === "string" ? query.competition : "";
  const position = typeof query.position === "string" ? query.position : "";
  const range = typeof query.range === "string" && ["year", "all", "custom"].includes(query.range) ? query.range : "year";
  const sort = typeof query.sort === "string" && ["total", "recent", "longest"].includes(query.sort) ? query.sort : "total";
  const customFrom = typeof query.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(query.from) ? new Date(`${query.from}T00:00:00+08:00`) : undefined;
  const customToBase = typeof query.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(query.to) ? new Date(`${query.to}T00:00:00+08:00`) : undefined;
  const customTo = customToBase ? new Date(customToBase.getTime() + 86_400_000) : undefined;
  const currentYear = new Date().getFullYear();
  const from = range === "year" ? new Date(`${currentYear}-01-01T00:00:00+08:00`) : range === "custom" ? customFrom : undefined;
  const to = range === "year" ? new Date(`${currentYear + 1}-01-01T00:00:00+08:00`) : range === "custom" ? customTo : undefined;
  const [all, legacy] = await Promise.all([getCompletedRefereeStatistics({ from, to }), getUnverifiedCompletedAssignments({ from, to })]);
  const legacyRows = legacy.filter((item) => (!competition || item.match.competition.name === competition) && item.positions.some((entry) => (!position || entry.key === position) && (!q || `${entry.referee?.publicCode ?? ""} ${entry.referee?.name ?? ""}`.toLowerCase().includes(q.toLowerCase()))));
  const competitionNames = [...new Set([...all.flatMap((item) => item.competitions.map((entry) => entry.name)), ...legacy.map((item) => item.match.competition.name)])].sort();
  const rows = all.filter((item) => (!q || `${item.publicCode} ${item.name}`.toLowerCase().includes(q.toLowerCase())) && (!competition || item.competitions.some((entry) => entry.name === competition)) && (!position || (item.positions[position] ?? 0) > 0)).sort((left, right) => {
    if (sort === "total") return right.totalMatches - left.totalMatches || left.name.localeCompare(right.name, "zh-CN");
    const leftTime = left.mostRecentAssignment?.getTime() ?? 0;
    const rightTime = right.mostRecentAssignment?.getTime() ?? 0;
    return sort === "recent" ? rightTime - leftTime : leftTime - rightTime;
  });
  const total = rows.reduce((sum, item) => sum + item.totalMatches, 0);
  return <>
    <AdminPageHeader eyebrow="STATISTICS" title="执裁统计" description="已核实场次按已完成比赛、已到比赛时间与成对比分汇总；旧完成档案另列待核。" />
    <form className="admin-filter-bar"><label className="admin-filter-search"><span>裁判员</span><input defaultValue={q} name="referee" placeholder="姓名 / 编号" /></label><label><span>赛事</span><select defaultValue={competition} name="competition"><option value="">全部赛事</option>{competitionNames.map((name) => <option key={name}>{name}</option>)}</select></label><label><span>岗位</span><select defaultValue={position} name="position"><option value="">全部岗位</option>{Object.entries(positionLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label><label><span>时间范围</span><select defaultValue={range} name="range"><option value="year">本年度</option><option value="all">全部时间</option><option value="custom">自定义</option></select></label>{range === "custom" ? <><label><span>开始日期</span><input defaultValue={typeof query.from === "string" ? query.from : ""} name="from" type="date" /></label><label><span>结束日期</span><input defaultValue={typeof query.to === "string" ? query.to : ""} name="to" type="date" /></label></> : null}<label><span>排序</span><select defaultValue={sort} name="sort"><option value="total">总场次</option><option value="recent">最近执裁</option><option value="longest">距离最近执裁最久</option></select></label><button className="admin-button admin-button-secondary" type="submit">筛选</button><Link className="admin-filter-reset" href="/admin/statistics">清除</Link></form>
    <section className="admin-kpi-grid admin-kpi-grid-compact"><article className="admin-kpi-card"><span>裁判员</span><strong>{rows.length}</strong><small>有已核实执裁记录</small></article><article className="admin-kpi-card"><span>总执裁场次</span><strong>{total}</strong><small>当前筛选合计</small></article><article className="admin-kpi-card"><span>赛事</span><strong>{competitionNames.length}</strong><small>包含旧完成档案</small></article></section>
    <AdminPanel title="裁判员统计" description="仅汇总筛选时间范围内已核实的完成选派，不自动生成公平性结论。">{rows.length ? <div className="admin-table-scroll"><table className="admin-data-table"><thead><tr><th>裁判员</th><th>总场次</th><th>十一人制 / 五人制</th><th>裁判员 / 助理 / 其他</th><th>赛事分布</th><th>最近执裁</th></tr></thead><tbody>{rows.map((item) => <tr key={item.refereeId}><td><strong>{item.name}</strong><small>{item.publicCode}</small></td><td><b className="admin-stat-number">{item.totalMatches}</b></td><td>{item.elevenASideCount} / {item.futsalCount}</td><td>{item.refereeRoleCount} / {item.assistantRoleCount} / {item.otherRoleCount}</td><td>{item.competitions.map((entry) => `${entry.name} ${entry.count}`).join(" · ") || "—"}</td><td>{item.mostRecentAssignment ? formatRefereeDateTime(item.mostRecentAssignment) : "—"}</td></tr>)}</tbody></table></div> : <AdminEmptyState title="没有符合条件的统计" description="调整筛选条件，或在选派完成后查看。" />}</AdminPanel>
    <AdminPanel title="旧完成档案 · 完赛事实待核" description={`当前筛选 ${legacyRows.length} 条原已完成选派。保留历史状态，不计入上述已核实执裁场次，不补写比分或确认赛果。`}>{legacyRows.length ? <div className="admin-table-scroll"><table className="admin-data-table"><thead><tr><th>比赛 / 赛事</th><th>原岗位记录</th><th>待核原因</th></tr></thead><tbody>{legacyRows.map((item) => <tr key={item.id}><td><Link href={`/admin/appointments/${item.match.id}`}>{item.match.homeTeam.name} vs {item.match.awayTeam.name}</Link><small>{item.match.competition.name} · {formatRefereeDateTime(item.match.kickoff)}</small></td><td>{item.positions.map((entry, index) => <div key={index}>{entry.referee ? <Link href={`/admin/referees/${entry.referee.id}`}>{entry.referee.name} · {entry.referee.publicCode}</Link> : "—"} · {entry.label}</div>)}</td><td>{item.reviewReason}</td></tr>)}</tbody></table></div> : <AdminEmptyState title="没有符合条件的旧完成档案" description="旧档案会保留原记录，并按相同时间、赛事、岗位和裁判条件筛选。" />}</AdminPanel>
  </>;
}
