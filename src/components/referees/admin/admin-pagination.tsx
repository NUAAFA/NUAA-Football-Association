import Link from "next/link";
import { queryHref, type AdminQuery } from "@/lib/admin-match-query";
export function AdminPagination({ root, query, page, pages, total }: { root: string; query: AdminQuery; page: number; pages: number; total: number }) {
  return <nav className="admin-pagination" aria-label="列表分页">{page > 1 ? <Link className="admin-button admin-button-secondary" href={queryHref(root, query, { page: String(page - 1) })}>上一页</Link> : <span>上一页</span>}<span aria-live="polite">{page} / {pages} · 共 {total} 条 · 每页 20 条</span>{page < pages ? <Link className="admin-button admin-button-secondary" href={queryHref(root, query, { page: String(page + 1) })}>下一页</Link> : <span>下一页</span>}</nav>;
}
