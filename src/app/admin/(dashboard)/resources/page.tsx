import Link from "next/link";
import { AdminEmptyState, AdminPageHeader, AdminPanel, AdminStatusBadge } from "@/components/referees/admin/admin-ui";
import { getResourceDestinations, resourceAreas, resourceCategories, resourceStatusLabels } from "@/data/resource-options";
import { getResourceLibrary } from "@/lib/resource-library";
import { guardUnifiedAdminPage } from "@/lib/unified-admin-page";
import { hasUnifiedAdminPermission } from "@/lib/unified-admin-rbac";
import styles from "@/components/admin/resource-library.module.css";

export default async function AdminResourcesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await guardUnifiedAdminPage("content:read", "resources");
  const params = await searchParams;
  const category = resourceCategories.find((option) => option.key === params.category)?.key ?? "";
  const area = resourceAreas.find((option) => option.key === params.area);
  const status = typeof params.status === "string" && Object.hasOwn(resourceStatusLabels, params.status) ? params.status : "";
  const query = typeof params.query === "string" ? params.query.trim().slice(0, 160) : "";
  const categoryOrder = resourceAreas.flatMap((option) => [...option.categories]) as string[];
  const allResources = (await getResourceLibrary(actor)).sort((a, b) => categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category) || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  const sectionResources = allResources.filter((resource) => (!area || (area.categories as readonly string[]).includes(resource.category)) && (!category || resource.category === category) && (!query || `${resource.title} ${resource.source} ${resource.version}`.includes(query)));
  const resources = sectionResources.filter((resource) => !status || resource.status === status);
  const totalPages = Math.max(1, Math.ceil(resources.length / 20));
  const requested = Number(params.page ?? 1);
  const page = Math.min(totalPages, Math.max(1, Number.isSafeInteger(requested) ? requested : 1));
  const href = (next: number) => `/admin/resources?${new URLSearchParams({ area: area?.key ?? "", category, status, query, page: String(next) })}`;
  const areaHref = (key: string) => `/admin/resources?${new URLSearchParams({ area: key, query, status })}`;
  const selectedCategory = category || area?.defaultCategory;
  const newHref = selectedCategory ? `/admin/resources/new?category=${selectedCategory}` : "/admin/resources/new";
  const canWrite = hasUnifiedAdminPermission(actor.roles, "content:write") && hasUnifiedAdminPermission(actor.roles, "media:write");
  return <>
    <AdminPageHeader eyebrow="CONTENT OPERATIONS" title="资料与规则" description="管理赛事文件与裁判学习资料，查看分类、发布状态和前台位置。" actions={<>
      <Link className="admin-button admin-button-secondary" href="/admin/media?category=files">媒体与附件</Link>
      {canWrite ? <Link className="admin-button" href={newHref}>+ 新增资料</Link> : null}
    </>} />
    {typeof params.message === "string" ? <p role="status" className="admin-notice-success">{params.message.slice(0, 160)}</p> : null}
    <section className={styles.libraryControls} aria-label="资料分类与发布位置">
      <nav className={styles.areaTabs} aria-label="按展示位置筛选">
        <Link href={areaHref("")} aria-current={!area ? "page" : undefined}>全部资料 <span>{allResources.length}</span></Link>
        {resourceAreas.map((option) => <Link key={option.key} href={areaHref(option.key)} aria-current={area?.key === option.key ? "page" : undefined}>
          {option.label}<span>{allResources.filter((resource) => (option.categories as readonly string[]).includes(resource.category)).length}</span>
        </Link>)}
      </nav>
      <div className={styles.sectionSummary}>
        <div><strong>{area?.label ?? "全部资料"}</strong><p>{area ? `${area.destination} · ${area.description}` : "赛事文件进入赛事文件中心；培训与工作资料进入裁判中心。竞赛规则在两处同步展示。"}</p></div>
        <div className={styles.statusSummary} aria-label="当前分类资料状态">{Object.entries(resourceStatusLabels).map(([key, label]) => <span key={key}>{label}<b>{sectionResources.filter((resource) => resource.status === key).length}</b></span>)}</div>
      </div>
    </section>
    <form className={`admin-filter-bar ${styles.filters}`}>
      {area ? <input name="area" type="hidden" value={area.key} /> : null}
      <label><span>搜索</span><input defaultValue={query} maxLength={160} name="query" placeholder="资料标题、来源或版本" /></label>
      <label><span>资料分类</span><select defaultValue={category} name="category"><option value="">{area ? "本分区全部分类" : "全部分类"}</option>{resourceCategories.filter((option) => !area || (area.categories as readonly string[]).includes(option.key)).map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
      <label><span>状态</span><select defaultValue={status} name="status"><option value="">全部状态</option>{Object.entries(resourceStatusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <button className="admin-button admin-button-secondary" type="submit">筛选</button><Link className="admin-filter-reset" href="/admin/resources">清除</Link>
    </form>
    <AdminPanel title={`${area?.label ?? "资料列表"} · ${resources.length}`} description={`第 ${page} / ${totalPages} 页 · 每页 20 份。编辑资料信息或替换文件；下架会移除前台展示，保留原文件。`} className={styles.resourcePanel}>
      {resources.length ? <div className="admin-table-scroll"><table className={`admin-data-table ${styles.resourceTable}`}><thead><tr><th>资料文件</th><th>分类 / 版本</th><th>前台位置</th><th>状态</th><th>操作</th></tr></thead><tbody>{resources.slice((page - 1) * 20, page * 20).map((resource) => <tr key={resource.id}>
        <td><div className={styles.fileSummary}><span className={styles.fileType} aria-hidden="true">{resource.fileType}</span><div><strong>{resource.title}</strong><small>{resource.source || "来源未标注"}</small></div></div></td>
        <td><span className={styles.categoryTag}>{resourceCategories.find((option) => option.key === resource.category)?.label}</span><small>{resource.version || "版本未标注"}</small></td>
        <td><div className={styles.destinations}>{getResourceDestinations(resource.category, resource.playingFormat, resource.trainingLevel).map((destination) => <Link key={destination.href} href={destination.href} title={destination.label} aria-label={`${resource.title}的发布位置：${destination.label}`} target="_blank" rel="noreferrer">{destination.shortLabel} ↗</Link>)}{resource.status !== "PUBLISHED" ? <small>当前未公开展示</small> : null}</div></td>
        <td><AdminStatusBadge status={resource.status} label={resourceStatusLabels[resource.status]} /></td>
        <td><div className={`admin-table-actions ${styles.rowActions}`}>{canWrite ? <Link className="admin-row-action-primary" href={`/admin/resources/${encodeURIComponent(resource.id)}`}>编辑</Link> : null}<a href={resource.fileHref} aria-label={`打开原文件：${resource.title}`} target="_blank" rel="noreferrer">原文件 ↗</a></div></td>
      </tr>)}</tbody></table></div> : <AdminEmptyState title="没有符合条件的资料" description="调整筛选条件，或点击右上角新增资料。" />}
      <nav className="admin-pagination" aria-label="资料分页">{page > 1 ? <Link href={href(page - 1)}>上一页</Link> : <span>上一页</span>}<span>{page} / {totalPages}</span>{page < totalPages ? <Link href={href(page + 1)}>下一页</Link> : <span>下一页</span>}</nav>
    </AdminPanel>
  </>;
}
