import Link from "next/link";

import { catalogueHref } from "@/lib/catalogue-navigation";
import styles from "./catalogue.module.css";

export function CataloguePagination({ path, filters, page, pages, total, unit }: {
  path: string; filters: Record<string, string | number | undefined>; page: number; pages: number; total: number; unit: string;
}) {
  return <div className={styles.pagination}>
    <p>共 {total} {unit} · 每页最多 6 {unit}</p>
    {pages > 1 ? <nav aria-label="目录分页">
      {page > 1 ? <Link href={catalogueHref(path, { ...filters, page: page - 1 })}>上一页</Link> : <span aria-disabled="true">上一页</span>}
      <span aria-current="page">第 {page} / {pages} 页</span>
      {page < pages ? <Link href={catalogueHref(path, { ...filters, page: page + 1 })}>下一页</Link> : <span aria-disabled="true">下一页</span>}
    </nav> : null}
  </div>;
}
