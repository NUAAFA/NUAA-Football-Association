import { affiliationOptionLabel, sortAffiliationOptions } from "@/lib/referee-affiliation-options";
import { BeijingDayRefresh } from "@/components/referees/admin/beijing-day-refresh";
import Link from "next/link";
import { AdminPagination } from "@/components/referees/admin/admin-pagination";
import { AdminEmptyState, AdminPageHeader, AdminPanel, AdminStatusBadge, assignmentEligibilityLabels, refereeStatusLabels, trainingStatusLabels } from "@/components/referees/admin/admin-ui";
import { prisma } from "@/lib/prisma";
import { getAdminRefereeList, rosterCategories } from "@/lib/admin-referee-query";
import { queryHref, queryText, type AdminQuery } from "@/lib/admin-match-query";
import { refereeGrades } from "@/lib/referee-profile-options";
import { getUnifiedAdminActor, hasUnifiedAdminPermission } from "@/lib/unified-admin-rbac";
export default async function AdminRefereesPage({ searchParams }: { searchParams: Promise<AdminQuery> }) {
  const query = await searchParams;
  const [data, colleges, actor] = await Promise.all([getAdminRefereeList(query), prisma.college.findMany({ select: { id: true, name: true, codeMappings: { select: { prefix: true } } }, orderBy: { name: "asc" } }), getUnifiedAdminActor()]);
  const collegeOptions = sortAffiliationOptions(colleges.map(c => ({ ...c, type: "COLLEGE" as const, prefixes: c.codeMappings.map(m => m.prefix) })));
  const canWrite = Boolean(actor && hasUnifiedAdminPermission(actor.roles, "referees:write"));
  function options(name: string, label: string, values: Record<string, string>) { return <label><span>{label}</span><select name={name} defaultValue={queryText(query, name)}><option value="">全部</option>{Object.entries(values).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>; }
  return <><BeijingDayRefresh />
    <AdminPageHeader eyebrow="REFEREES" title="裁判员管理" description="先查看报名与选派资格，再进入个人档案维护岗位、持证信息和培养记录。" actions={canWrite ? <Link className="admin-button" href="/admin/referees/new">+ 新建裁判员</Link> : undefined} />
    <nav className="admin-quick-filters" aria-label="裁判员分类">{Object.entries(rosterCategories).map(([key, label]) => <Link key={key} aria-current={key === data.category ? "page" : undefined} href={queryHref("/admin/referees", query, { category: key, page: undefined })}>{label} {data.counts[key]}</Link>)}</nav><details className="admin-profile-disclosure admin-roster-help"><summary>分类与状态怎么看</summary><p className="admin-filter-help">分类可交叉计数。可选派＝账号已启用、整体资格允许，且至少有一个培养中或可正式选派岗位；实际报名还需完成首次改密。培养中分类包含整体培训记录或具体培养岗位。</p></details>
    <form className="admin-filter-bar admin-referee-filters" key={JSON.stringify(query)}><input type="hidden" name="category" value={data.category} /><label className="admin-filter-search"><span>搜索</span><input name="q" defaultValue={queryText(query, "q")} maxLength={100} placeholder="姓名 / 编号 / 学号" /></label>{options("grade", "当前年级", { ...Object.fromEntries(refereeGrades.map(g => [g, g])), unknown: "学籍待核实 / 未填" })}{options("college", "学院", Object.fromEntries(collegeOptions.map(c => [c.id, affiliationOptionLabel(c)])))}{options("format", "岗位制式", { ELEVEN_A_SIDE: "十一人制", FUTSAL: "五人制" })}
      <button className="admin-button admin-button-secondary">筛选</button><Link href="/admin/referees">重置筛选</Link>
      <details className="admin-advanced-filters" open={["gradeMode", "enrollment", "status", "eligibility", "training"].some(k => queryText(query, k))}><summary>高级筛选</summary><div className="admin-filter-bar">{options("gradeMode", "年级来源", { AUTO_STUDENT_ID: "自动识别", MANUAL: "人工指定", UNVERIFIED: "待确认", review: "人工异常待核实" })}<label><span>入学年份</span><input name="enrollment" type="number" min="2000" max="2099" defaultValue={queryText(query, "enrollment")} /></label>{options("status", "账号状态", refereeStatusLabels)}{options("eligibility", "选派资格", assignmentEligibilityLabels)}{options("training", "培养状态", trainingStatusLabels)}</div></details>
    </form>
    <AdminPanel title={`裁判员名录 · ${data.total}`} description="当前年级按北京时间计算；查询不改写档案，自动升年级不改变组织、账号或选派资格。">
      <p className="admin-table-scroll-hint">窄屏可在表格内横向滚动查看所有列与操作。</p>
      {data.referees.length ? <div className="admin-table-scroll" tabIndex={0} role="region" aria-label="裁判员名录，可横向滚动"><table className="admin-data-table"><thead><tr><th>编号 / 姓名</th><th>学院 / 组织</th><th>当前年级</th><th>报名与选派 / 培训记录</th><th>操作</th></tr></thead><tbody>{data.referees.map(r => <tr key={r.id}><td><strong>{r.publicCode} · {r.name}</strong><small>{[...new Set(r.capabilities.map(c => c.format === "FUTSAL" ? "五人制" : "十一人制"))].join(" · ") || "岗位待评估"}</small></td><td>{r.currentAffiliationUnit?.name ?? r.college?.name ?? "待确认"}</td><td>{r.effectiveGrade.needsReview && r.gradeMode === "AUTO_STUDENT_ID" ? "学籍待核实" : r.effectiveGrade.grade ?? "待确认"}<small>{r.effectiveGrade.source}{r.effectiveGrade.enrollmentYear ? ` · ${r.effectiveGrade.enrollmentYear}级` : ""}</small></td><td><AdminStatusBadge status={r.assignmentEligibility} label={assignmentEligibilityLabels[r.assignmentEligibility]} /><small>培训记录：{trainingStatusLabels[r.trainingStatus]} · {refereeStatusLabels[r.status]}</small></td><td><Link href={`/admin/referees/${r.id}`}>查看{canWrite ? " / 编辑" : ""}</Link></td></tr>)}</tbody></table></div> : <AdminEmptyState title="没有符合条件的裁判员" description="请调整分类或筛选条件。" />}
      <AdminPagination root="/admin/referees" query={query} page={data.page} pages={data.pages} total={data.total} />
    </AdminPanel>
  </>;
}
