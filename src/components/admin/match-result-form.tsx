"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function MatchResultForm({ match }: { match: { id: string; homeScore: number | null; awayScore: number | null; homePenaltyScore: number | null; awayPenaltyScore: number | null; resultVersion: number; status: string; canConfirm: boolean; knockout: boolean } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const form = new FormData(event.currentTarget), score = (key: string) => String(form.get(key) ?? "").trim() === "" ? null : Number(form.get(key));
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/admin/matches/${match.id}/result`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ homeScore: score("homeScore"), awayScore: score("awayScore"), homePenaltyScore: score("homePenaltyScore"), awayPenaltyScore: score("awayPenaltyScore"), expectedVersion: match.resultVersion, actualEnded: form.get("actualEnded") === "on", reason: String(form.get("reason") ?? "") }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "确认失败。");
      setMessage("赛果已确认，积分和已发布执裁任务同步更新。"); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "确认失败。"); } finally { setBusy(false); }
  }
  return <form className="admin-form admin-panel-body" onSubmit={submit}><p>场上最终比分（不含点球大战）。0:0 合法；只有真实完赛并确认的比赛进入小组积分。</p><div className="admin-form-grid"><label><span>主队比分</span><input defaultValue={match.homeScore ?? ""} min={0} max={999} step={1} name="homeScore" required type="number" /></label><label><span>客队比分</span><input defaultValue={match.awayScore ?? ""} min={0} max={999} step={1} name="awayScore" required type="number" /></label>{match.knockout ? <><label><span>主队点球大战比分（可空）</span><input defaultValue={match.homePenaltyScore ?? ""} min={0} max={999} step={1} name="homePenaltyScore" type="number" /></label><label><span>客队点球大战比分（可空）</span><input defaultValue={match.awayPenaltyScore ?? ""} min={0} max={999} step={1} name="awayPenaltyScore" type="number" /></label></> : null}<label><span>{match.status === "COMPLETED" ? "更正原因（必填）" : "确认说明"}</span><textarea maxLength={500} name="reason" required={match.status === "COMPLETED"} /></label></div><label className="admin-inline-checks"><input name="actualEnded" required type="checkbox" /><span>我已核对本场比赛实际结束，双方及比分无误</span></label>{!match.canConfirm ? <p>未来、预计尚未结束或已取消的比赛不能确认赛果。</p> : null}<p aria-live="polite">{message}</p><button className="admin-button" disabled={busy || !match.canConfirm} type="submit">{busy ? "保存中…" : match.status === "COMPLETED" ? "更正赛果" : "确认赛果"}</button></form>;
}
