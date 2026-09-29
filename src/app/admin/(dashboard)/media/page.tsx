import { MediaLibraryTable } from "@/components/admin/media-library-table";
import Link from "next/link";

import { MediaUploadForm } from "@/components/admin/media-upload-form";
import { AdminEmptyState, AdminPageHeader, AdminPanel } from "@/components/referees/admin/admin-ui";
import { getAdminMediaPage } from "@/lib/admin-media-service";
import { guardUnifiedAdminPage } from "@/lib/unified-admin-page";
import { hasUnifiedAdminPermission } from "@/lib/unified-admin-rbac";

export default async function AdminMediaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await guardUnifiedAdminPage("media:read", "media");
  const params = await searchParams;
  const page = typeof params.page === "string" ? Number(params.page) : 1;
  const visibility = params.visibility === "PUBLIC" || params.visibility === "PRIVATE" ? params.visibility : undefined;
  const query = typeof params.query === "string" ? params.query : "";
  const category = params.category === "images" || params.category === "files" ? params.category : "";
  const usage = params.usage === "used" || params.usage === "unused" ? params.usage : "";
  const href = (c: string, p = 1) => `/admin/media?${new URLSearchParams({ category: c, usage, query, visibility: visibility ?? "", page: String(p) })}`;
  const result = await getAdminMediaPage({ actor, page: Number.isSafeInteger(page) ? page : 1, visibility, query, category, usage: usage || undefined });
  const canUpload = hasUnifiedAdminPermission(actor.roles, "media:write");
  return (
    <>
      <AdminPageHeader eyebrow="MEDIA ASSETS" title="媒体与附件" description="集中管理图片与公开文件，检查文件可用性和内容引用。" />
      {canUpload ? <AdminPanel title="上传文件" description="图片最大 10 MB，PDF 最大 20 MB；上传后仍需确认内容可公开。"><div className="admin-panel-body"><MediaUploadForm /></div></AdminPanel> : null}
      <nav className="admin-filter-bar" aria-label="媒体分类">{[["", "全部", result.counts.all], ["images", "图片", result.counts.images], ["files", "文件", result.counts.files]].map(([c, label, count]) => <Link key={c} href={href(String(c))} className="admin-button admin-button-secondary" aria-current={category === c ? "page" : undefined}>{label} · {count}</Link>)}</nav>
      <form className="admin-filter-bar"><input name="category" type="hidden" value={category} /><label><span>文件名 / 说明</span><input name="query" defaultValue={query} /></label>
        <label><span>可见性</span><select defaultValue={visibility ?? ""} name="visibility"><option value="">全部</option><option value="PUBLIC">公开文件</option><option value="PRIVATE">仅后台</option></select></label>
        <label><span>使用状态</span><select defaultValue={usage} name="usage"><option value="">全部</option><option value="used">已使用</option><option value="unused">未使用</option></select></label>
        <button className="admin-button admin-button-secondary" type="submit">筛选</button>
        <Link className="admin-filter-reset" href="/admin/media">清除</Link>
      </form>
      <AdminPanel title={`媒体列表 · ${result.total}`} description={`数据库分页：每页 ${result.pageSize} 条，第 ${result.page} / ${result.totalPages} 页。`}>
        {result.items.length ? <MediaLibraryTable items={result.items.map((asset) => ({ ...asset, createdAt: asset.createdAt.toISOString() }))} canWrite={canUpload} /> : <AdminEmptyState title="没有符合条件的媒体" description="调整分类、权限或使用状态后重试。" />}
        <nav aria-label="媒体分页" className="admin-pagination">{result.page > 1 ? <Link href={href(category, result.page - 1)}>上一页</Link> : <span>上一页</span>}<span>{result.page} / {result.totalPages}</span>{result.page < result.totalPages ? <Link href={href(category, result.page + 1)}>下一页</Link> : <span>下一页</span>}</nav>
      </AdminPanel>
    </>
  );
}
