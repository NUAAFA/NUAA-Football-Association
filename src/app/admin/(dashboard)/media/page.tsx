import Image from "next/image";
import { MediaVisibilityButton } from "@/components/admin/media-visibility-button";
import Link from "next/link";

import { MediaUploadForm } from "@/components/admin/media-upload-form";
import { AdminEmptyState, AdminPageHeader, AdminPanel } from "@/components/referees/admin/admin-ui";
import { getAdminMediaPage } from "@/lib/admin-media-service";
import { formatRefereeDateTime } from "@/lib/referee-presenters";
import { guardUnifiedAdminPage } from "@/lib/unified-admin-page";
import { hasUnifiedAdminPermission } from "@/lib/unified-admin-rbac";

function formatBytes(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

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
  const href = (c: string, p = 1) => `/admin/media?${new URLSearchParams({ category: c, query, visibility: visibility ?? "", page: String(p) })}`;
  const result = await getAdminMediaPage({ actor, page: Number.isSafeInteger(page) ? page : 1, visibility, query, category });
  const canUpload = hasUnifiedAdminPermission(actor.roles, "media:write");
  return (
    <>
      <AdminPageHeader eyebrow="MEDIA ASSETS" title="媒体与附件" description="集中管理图片与公开文件，检查文件可用性和内容引用。" />
      {canUpload ? <AdminPanel title="上传文件" description="图片最大 10 MB，PDF 最大 20 MB；上传后仍需确认内容可公开。"><div className="admin-panel-body"><MediaUploadForm /></div></AdminPanel> : null}
      <nav className="admin-filter-bar" aria-label="媒体分类">{[["", "全部", result.counts.all], ["images", "图片", result.counts.images], ["files", "文件", result.counts.files]].map(([c, label, count]) => <Link key={c} href={href(String(c))} className="admin-button admin-button-secondary" aria-current={category === c ? "page" : undefined}>{label} · {count}</Link>)}</nav>
      <form className="admin-filter-bar"><input name="category" type="hidden" value={category} /><label><span>文件名 / 说明</span><input name="query" defaultValue={query} /></label>
        <label><span>可见性</span><select defaultValue={visibility ?? ""} name="visibility"><option value="">全部</option><option value="PUBLIC">公开文件</option><option value="PRIVATE">仅后台</option></select></label>
        <button className="admin-button admin-button-secondary" type="submit">筛选</button>
        <Link className="admin-filter-reset" href="/admin/media">清除</Link>
      </form>
      <AdminPanel title={`媒体列表 · ${result.total}`} description={`数据库分页：每页 ${result.pageSize} 条，第 ${result.page} / ${result.totalPages} 页。`}>
        {result.items.length ? <div className="admin-table-scroll"><table className="admin-data-table"><thead><tr><th>文件名</th><th>权限</th><th>类型</th><th>大小</th><th>说明</th><th>使用情况</th><th>上传者</th><th>时间</th><th>访问</th></tr></thead><tbody>{result.items.map((asset) => <tr key={asset.id}><td>{asset.mimeType.startsWith("image/") && asset.fileStatus === "AVAILABLE" ? <Image src={`/media/${asset.id}`} alt={asset.altText || asset.originalFilename} width={64} height={48} unoptimized /> : <span aria-hidden="true">📄 </span>}<strong>{asset.originalFilename}</strong>{asset.fileStatus === "MISSING" ? <small className="admin-file-missing">文件缺失</small> : null}</td><td><span className="admin-media-visibility" data-visibility={asset.visibility}>{asset.visibility === "PUBLIC" ? "公开文件" : "仅后台"}</span></td><td>{asset.mimeType === "application/pdf" ? "PDF 文件" : asset.mimeType.replace("image/", "").toUpperCase() + " 图片"}</td><td>{formatBytes(asset.size)}</td><td>{asset.altText || "—"}</td><td><strong>{asset.usageCount ? `用于 ${asset.usageCount} 篇内容` : "未使用"}</strong>{asset.usage.map((u) => <small key={u.id}><Link href={`/admin/content/news/${u.id}`}>{u.title}</Link> · {u.ways.join(" / ")}</small>)}</td><td>{asset.uploadedByAdmin?.displayName ?? "兼容管理员"}</td><td>{formatRefereeDateTime(asset.createdAt)}</td><td><div className="admin-table-actions">{asset.fileStatus === "AVAILABLE" ? <><a href={`/media/${asset.id}`} rel="noreferrer" target="_blank">打开</a>{canUpload ? <MediaVisibilityButton id={asset.id} visibility={asset.visibility} /> : null}</> : <span>不可用</span>}</div></td></tr>)}</tbody></table></div> : <AdminEmptyState title="媒体库为空" description="上传图片或 PDF 后会显示在这里。" />}
        <nav aria-label="媒体分页" className="admin-pagination">{result.page > 1 ? <Link href={href(category, result.page - 1)}>上一页</Link> : <span>上一页</span>}<span>{result.page} / {result.totalPages}</span>{result.page < result.totalPages ? <Link href={href(category, result.page + 1)}>下一页</Link> : <span>下一页</span>}</nav>
      </AdminPanel>
    </>
  );
}
