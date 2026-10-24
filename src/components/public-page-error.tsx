"use client";

import Link from "next/link";

export function PublicPageError({ retry }: { retry: () => void }) {
  return <main className="page-shell functional-page" id="main-content">
    <div className="functional-empty" role="alert">
      <h1>资料暂时无法加载</h1>
      <p>请稍后重试；这不表示相关赛事或文章不存在。</p>
      <button type="button" onClick={() => retry()}>重新加载</button>
      <p><Link href="/">返回首页</Link></p>
    </div>
  </main>;
}
