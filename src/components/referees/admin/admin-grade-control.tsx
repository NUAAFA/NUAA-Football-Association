"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { refereeGrades } from "@/lib/referee-profile-options";
export function AdminGradeControl({ id, mode, grade, expectedUpdatedAt, preview }: { id: string; mode: string; grade: string; expectedUpdatedAt: string; preview: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/referees/admin/accounts/${id}/grade`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: form.get("mode"), grade: form.get("grade"), reason: form.get("reason"), expectedUpdatedAt }) });
      const result = await response.json(); setMessage(response.ok ? "计算方式已保存；账号、资格和组织归属保持原值。" : result.error); if (response.ok) router.refresh();
    } catch { setMessage("网络异常，请刷新核对后重试。"); } finally { setBusy(false); }
  }
  return <form className="admin-form" onSubmit={save}><p>{preview}</p><p>自动年级于北京时间每年 9 月 1 日更新显示。超过四年为学籍待核实，不自动认定毕业。原年级保留；启用自动模式须单独确认。</p><div className="admin-form-grid"><label><span>计算方式</span><select defaultValue={mode} name="mode"><option value="UNVERIFIED">待确认（保留原年级）</option><option value="AUTO_STUDENT_ID">自动识别标准学号</option><option value="MANUAL">人工指定 / 特殊学籍</option></select></label><label><span>人工年级</span><select defaultValue={grade} name="grade"><option value="">待确认</option>{refereeGrades.map(g => <option key={g}>{g}</option>)}</select></label><label><span>年级调整原因 / 特殊学籍依据</span><input name="reason" required maxLength={500} /></label></div><p role="status">{message}</p><button className="admin-button" disabled={busy}>确认年级计算方式</button></form>;
}
