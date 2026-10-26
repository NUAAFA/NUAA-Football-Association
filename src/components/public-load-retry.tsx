"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function PublicLoadRetry({ label = "资料" }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <div className="functional-empty" role="status">
    <strong>{label}暂时无法加载</strong>
    <p>请稍后重试，其他栏目仍可正常浏览。</p>
    <button type="button" disabled={pending} onClick={() => startTransition(() => router.refresh())}>{pending ? "正在重新加载…" : "重新加载"}</button>
  </div>;
}
