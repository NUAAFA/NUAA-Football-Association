"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function MatchSchedulingForm({ matchId }: { matchId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setMessage("");
    try { const response = await fetch(`/api/admin/matches/${matchId}/schedule`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kickoff: `${form.get("date")}T${form.get("time")}`, endAt: form.get("endAt"), venue: form.get("venue") }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "安排失败"); setOpen(false); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "安排失败"); } finally { setBusy(false); }
  }
  return <><button className="admin-button admin-button-secondary" type="button" onClick={() => setOpen(true)}>安排比赛</button>{open ? <div className="ops-modal-backdrop"><section className="admin-panel ops-modal" role="dialog" aria-modal="true" aria-label="安排比赛"><header className="admin-panel-header"><h2>安排比赛</h2><button type="button" onClick={() => setOpen(false)} disabled={busy}>关闭</button></header><div className="admin-panel-body"><p>填写真实比赛时间与场地，均使用北京时间。保存后可通过完整编辑入口开放裁判报名。</p><form className="admin-form" onSubmit={save}><div className="admin-form-grid"><label><span>比赛日期</span><input name="date" type="date" required autoFocus /></label><label><span>开球时间</span><input name="time" type="time" required /></label><label><span>结束时间（可选）</span><input name="endAt" type="datetime-local" /></label><label><span>比赛场地</span><input name="venue" maxLength={120} required /></label></div><p role="alert">{message}</p><button className="admin-button" disabled={busy}>{busy ? "保存中…" : "保存排期"}</button></form></div></section></div> : null}</>;
}
