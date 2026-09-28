import Link from "next/link";

import { AdminEmptyState, AdminPageHeader, AdminPanel, AdminStatusBadge } from "@/components/referees/admin/admin-ui";
import {
  contentPostStatusLabels,
  contentPostTypeLabels,
  getAdminContentPage,
  parseContentPage,
} from "@/lib/admin-content-service";
import { formatRefereeDateTime } from "@/lib/referee-presenters";
import { hasUnifiedAdminPermission } from "@/lib/unified-admin-rbac";
import { guardUnifiedAdminPage } from "@/lib/unified-admin-page";

function pageHref(page: number, query: Record<string, string>) {
  const params = new URLSearchParams({ ...query, page: String(page) });
  for (const [key, value] of [...params.entries()]) if (!value) params.delete(key);
  return `/admin/content/news?${params.toString()}`;
}

export default async function AdminNewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await guardUnifiedAdminPage("content:read", "content");
  const params = await searchParams;
  const query = typeof params.query === "string" ? params.query : "";
  const status = typeof params.status === "string" && ["DRAFT", "PUBLISHED", "ARCHIVED"].includes(params.status)
    ? params.status as "DRAFT" | "PUBLISHED" | "ARCHIVED"
    : undefined;
  const type = typeof params.type === "string" && ["NEWS", "ANNOUNCEMENT", "DISCIPLINE"].includes(params.type)
    ? params.type as "NEWS" | "ANNOUNCEMENT" | "DISCIPLINE"
    : undefined;
  const result = await getAdminContentPage({ actor, page: parseContentPage(params.page), query, status, type });
  const linkQuery = { query, status: status ?? "", type: type ?? "" };

  return (
    <>
      <AdminPageHeader eyebrow="CONTENT OPERATIONS" title="新闻公告" description="数据库驱动的草稿、发布、归档、筛选和分页。" actions={hasUnifiedAdminPermission(actor.roles, "content:write") ? <Link className="admin-button" href={`/admin/content/news/new?type=${type ?? "NEWS"}`}>+ 新建内容</Link> : null} />
      {typeof params.message === "string" ? <p className="admin-notice-success" role="status">{params.message}</p> : null}
      <nav className="admin-filter-bar" aria-label="内容分类">{["", "NEWS", "ANNOUNCEMENT", "DISCIPLINE"].map((value) => <Link key={value} className="admin-button admin-button-secondary" aria-current={(type ?? "") === value ? "page" : undefined} href={pageHref(1, { query, status: status ?? "", type: value })}>{value ? contentPostTypeLabels[value as keyof typeof contentPostTypeLabels] : "全部"} · {value ? result.counts[value] ?? 0 : Object.values(result.counts).reduce((n, c) => n + c, 0)}</Link>)}</nav>
      <form className="admin-filter-bar">
        <label className="admin-filter-search"><span>搜索</span><input defaultValue={query} name="query" placeholder="标题或固定网址标识" /></label>
        <input name="type" type="hidden" value={type ?? ""} />
        <label><span>状态</span><select defaultValue={status ?? ""} name="status"><option value="">全部状态</option><option value="DRAFT">草稿</option><option value="PUBLISHED">已发布</option><option value="ARCHIVED">已归档</option></select></label>
        <button className="admin-button admin-button-secondary" type="submit">筛选</button>
        <Link className="admin-filter-reset" href="/admin/content/news">清除</Link>
      </form>
      <AdminPanel title={`内容列表 · ${result.total}`} description={`数据库分页：每页 ${result.pageSize} 条，第 ${result.page} / ${result.totalPages} 页。`}>
        {result.items.length ? <div className="admin-table-scroll"><table className="admin-data-table"><thead><tr><th>标题</th><th>类型</th><th>状态</th><th>附件</th><th>发布时间</th><th>更新</th><th>操作</th></tr></thead><tbody>{result.items.map((post) => <tr key={post.id}><td><strong>{post.title}</strong><small>/{post.slug}</small></td><td>{contentPostTypeLabels[post.type]}</td><td><AdminStatusBadge label={contentPostStatusLabels[post.status]} status={post.status} /></td><td>{post.attachmentCount}</td><td>{post.publishedAt ? formatRefereeDateTime(post.publishedAt) : "—"}</td><td>{formatRefereeDateTime(post.updatedAt)}</td><td><div className="admin-table-actions"><Link className="admin-row-action-primary" href={`/admin/content/news/${post.id}`}>编辑</Link></div></td></tr>)}</tbody></table></div> : <AdminEmptyState title="没有符合条件的内容" description="调整筛选条件，或新建第一篇内容。" />}
        <nav aria-label="内容分页" className="admin-pagination">
          {result.page > 1 ? <Link href={pageHref(result.page - 1, linkQuery)}>上一页</Link> : <span>上一页</span>}
          {Array.from({ length: result.totalPages }, (_, index) => index + 1).slice(Math.max(0, result.page - 3), result.page + 2).map((page) => <Link aria-current={page === result.page ? "page" : undefined} href={pageHref(page, linkQuery)} key={page}>{page}</Link>)}
          {result.page < result.totalPages ? <Link href={pageHref(result.page + 1, linkQuery)}>下一页</Link> : <span>下一页</span>}
        </nav>
      </AdminPanel>
    </>
  );
}
