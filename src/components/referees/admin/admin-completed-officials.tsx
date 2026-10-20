"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
export type CompletedOfficialsView = { id: string; resultVersion: number; revision: number; action: "record" | "correct"; eligible: boolean; summary: string; recordedAt: string; publicHistoryVisible: boolean; template: { key: string; slot: number; label: string; refereeId: string | null }[] };
export function AdminCompletedOfficials({ match, referees, canWrite }: { match: CompletedOfficialsView; referees: { id: string; label: string; warning: string }[]; canWrite: boolean }) {
  const router = useRouter(); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false); const [review, setReview] = useState(false); const [payload, setPayload] = useState<Record<string, unknown> | null>(null); const [warnings, setWarnings] = useState<string[]>([]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const positions = match.template.map(p => ({ key: p.key, slot: p.slot, refereeId: String(form.get(`${p.key}:${p.slot}`) ?? "") || null }));
    setPayload({ action: match.action, expectedResultVersion: match.resultVersion, expectedAppointmentRevision: match.revision, positions, reason: form.get("reason"), verificationReason: form.get("verificationReason"), publicHistoryVisible: form.get("publicHistoryVisible") === "on" }); setReview(true); setMessage("");
  }
  async function confirm() {
    setBusy(true);
    try {
      const response = await fetch(`/api/referees/admin/appointments/${match.id}/completed-officials`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }); const result = await response.json();
      setMessage(response.ok ? "赛后实际执裁记录已保存，比赛及比分保持原值。" : result.error ?? "保存失败。"); setWarnings((result.warnings ?? []).map((w: { message: string }) => w.message));
      if (response.ok) { setReview(false); router.refresh(); }
    } catch { setMessage("网络异常，请刷新核对后重试。"); } finally { setBusy(false); }
  }
  return <section className="admin-panel" aria-label="实际执裁历史"><header className="admin-panel-header"><h2>{match.action === "correct" ? "更正实际执裁人员" : "赛后补录实际执裁人员"}</h2></header><div className="admin-panel-body"><p className="admin-postmatch-summary">{match.summary}</p>{match.recordedAt ? <p>赛后补录 · 已记录 · 实际操作时间：{match.recordedAt}</p> : null}<p>根据真实执裁报告记录；未分配岗位显示“实际执裁人员未记录”。历史版本、真实录入时间和操作人保留在下方版本历史。</p>
    {canWrite && match.eligible ? <form className="admin-form" onSubmit={submit} onChange={() => setReview(false)}><div className="admin-form-grid">{match.template.map(p => <label key={`${p.key}:${p.slot}`}><span>{p.label}{p.slot > 1 ? ` ${p.slot}` : ""}</span><select name={`${p.key}:${p.slot}`} defaultValue={p.refereeId ?? ""}><option value="">实际执裁人员未记录</option>{referees.map(r => <option key={r.id} value={r.id}>{r.label}{r.warning ? ` · ${r.warning}` : ""}</option>)}</select></label>)}</div><label><span>补录 / 更正原因（必填，仅后台）</span><textarea name="reason" required maxLength={500} /></label><label><span>实际执裁核实依据（资格变化 / 历史冲突时必填，仅后台）</span><textarea name="verificationReason" maxLength={1000} placeholder="依据执裁报告或其他可核查记录；历史时间重叠须最高管理员核实" /></label><label className="admin-checkbox-label"><input name="publicHistoryVisible" type="checkbox" defaultChecked={match.publicHistoryVisible} />单独确认公开为“赛后执裁记录”（仅姓名与岗位；原因和联系方式不公开）</label><button className="admin-button" disabled={busy}>核对并准备提交</button>{review ? <section className="admin-postmatch-summary" aria-label="提交前核对"><h3>提交前核对</h3><p>{match.summary}</p><ul>{(payload?.positions as { key: string; slot: number; refereeId: string | null }[]).map(p => <li key={`${p.key}:${p.slot}`}>{match.template.find(t => t.key === p.key && t.slot === p.slot)?.label}：{referees.find(r => r.id === p.refereeId)?.label ?? "实际执裁人员未记录"}</li>)}</ul><p>这是赛后事实记录；不会生成赛前公告、任务通知或裁判确认，不会更改比赛结果。</p><button className="admin-button" type="button" disabled={busy} onClick={() => void confirm()}>确认保存实际执裁记录</button> <button className="admin-button admin-button-secondary" type="button" disabled={busy} onClick={() => setReview(false)}>返回修改</button></section> : null}</form> : <p>{match.eligible ? "当前权限仅可查看历史。" : "尚未满足已确认比分、过去真实完赛及岗位模板条件。请先核实赛果；已有正式已发布选派应使用原完成流程。"}</p>}
    <p role="status">{message}</p>{warnings.length ? <ul className="admin-postmatch-warning" role="alert">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul> : null}</div></section>;
}
