"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function MatchTentativeForm({ matchId, date, note, canWrite }: { matchId: string; date: string | null; note: string | null; canWrite: boolean }) {
  const router = useRouter(); const [busy,setBusy] = useState(false), [message,setMessage] = useState("");
  return <section><p>暂定日期：{date || "未定"} · 暂定安排：{note || "未定"}。暂定信息不用于正式排期、裁判任务或冲突计算。</p>{canWrite ? <details><summary>修改暂定安排</summary><form className="admin-form" onSubmit={async (e) => { e.preventDefault(); if (busy) return; const form = new FormData(e.currentTarget); setBusy(true); try { const r = await fetch(`/api/admin/matches/${matchId}/tentative`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({tentativeDate:form.get("date"),tentativeSchedule:form.get("note")})}); const d = await r.json(); if (!r.ok) throw new Error(d.error || "保存失败"); setMessage("暂定安排已保存，正式开球时间保持原样。");router.refresh();} catch (error) {setMessage(error instanceof Error ? error.message : "保存失败");} finally {setBusy(false);} }}><label>暂定日期<input name="date" type="date" defaultValue={date || ""} /></label><label>暂定安排说明<input name="note" maxLength={500} defaultValue={note || ""} /></label><button className="admin-button" disabled={busy}>保存暂定安排</button><p role="status">{message}</p></form></details> : null}</section>;
}
