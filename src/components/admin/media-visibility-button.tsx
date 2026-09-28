"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
export function MediaVisibilityButton({ id, visibility }: { id: string; visibility: string }) {
  const router = useRouter(); const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  return <><button className="admin-button admin-button-secondary" disabled={busy} type="button" onClick={async () => { if (!window.confirm(visibility === "PRIVATE" ? "确认该文件可公开访问？草稿引用不会限制公开文件地址。" : "确认改为仅后台？公开内容引用会阻止此操作。")) return; setBusy(true); try { const r = await fetch(`/api/admin/media/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ visibility: visibility === "PRIVATE" ? "PUBLIC" : "PRIVATE", confirm: true }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error || "修改失败。"); router.refresh(); } catch (e) { setMessage(e instanceof Error ? e.message : "修改失败。"); } finally { setBusy(false); } }}>{visibility === "PRIVATE" ? "确认公开" : "设为仅后台"}</button><small aria-live="polite">{message}</small></>;
}
