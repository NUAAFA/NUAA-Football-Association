"use client";

import { useRef, useState } from "react";
import type { AppointmentPositionKey } from "@/generated/prisma-v29/client";
import { checkRefereeSubmission, refereeSubmissionJson, submitRefereeWithCheck } from "@/lib/referee-submission-client";
import type { RefereeApplicationSubmissionState } from "@/lib/referee-submission-state";

type PositionOption = { key: AppointmentPositionKey; label: string };

export function RefereeApplicationForm({
  matchId,
  positions,
  referee,
}: {
  matchId: string;
  positions: PositionOption[];
  referee: { publicCode: string; name: string };
}) {
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const busy = useRef(false);
  const [saved, setSaved] = useState(false);
  const [pendingCheck, setPendingCheck] = useState<{ read: () => Promise<RefereeApplicationSubmissionState>; confirmed: (state: RefereeApplicationSubmissionState) => boolean } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || saved) return;
    const formElement = event.currentTarget;
    busy.current = true; setSubmitting(true); setMessage(""); setPendingCheck(null);
    const form = new FormData(formElement);
    const preferredPositions = [...new Set(form.getAll("preferredPositions").map(String))].sort();
    const note = String(form.get("note") ?? "").trim();
    const read = async () => {
      const state = await refereeSubmissionJson<RefereeApplicationSubmissionState>(`/api/referees/applications/status?matchId=${encodeURIComponent(matchId)}`);
      if (!Object.hasOwn(state, "application") || (state.application !== null && (!Array.isArray(state.application.preferredPositions) || typeof state.application.note !== "string" || typeof state.application.status !== "string"))) throw new Error("无法核对报名响应。");
      return state;
    };
    const confirmed = (state: RefereeApplicationSubmissionState) => Boolean(state.application && state.application.status !== "WITHDRAWN" && state.application.note === note && JSON.stringify([...state.application.preferredPositions].sort()) === JSON.stringify(preferredPositions));
    try {
      const result = await submitRefereeWithCheck({
        read, confirmed,
        before: (state) => state.application ? confirmed(state)
          ? { kind: "success", message: "本场已有相同执裁意向，请查看工作区审核结果。" }
          : { kind: "failure", message: "本场已有执裁意向记录，请先在工作区核对，不能重复提交。" } : null,
        write: () => refereeSubmissionJson("/api/referees/applications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ matchId, preferredPositions, note }) }),
      });
      setMessage(result.kind === "success" && result.message === "操作已保存。" ? "执裁意向已提交，请等待管理员审核。" : result.message);
      if (result.kind === "success") setSaved(true);
      else if (result.kind === "unknown") setPendingCheck({ read, confirmed });
    } finally { busy.current = false; setSubmitting(false); }
  }

  async function recheck() {
    if (busy.current || !pendingCheck) return;
    busy.current = true; setSubmitting(true);
    try {
      const result = await checkRefereeSubmission(pendingCheck.read, pendingCheck.confirmed);
      setMessage(result.message);
      if (result.kind === "success") { setSaved(true); setPendingCheck(null); }
    } finally { busy.current = false; setSubmitting(false); }
  }

  return (
    <form className="referee-form" onSubmit={submit}>
      <div className="referee-form-identity">
        <span>当前登录裁判员</span>
        <strong>{referee.publicCode} · {referee.name}</strong>
      </div>
      <fieldset>
        <legend>意向岗位（至少选择一项）</legend>
        <div className="referee-checkbox-grid">
          {positions.map((position) => (
            <label key={position.key}>
              <input name="preferredPositions" type="checkbox" value={position.key} />
              <span>{position.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label>
        <span>补充说明（选填，不填写联系方式）</span>
        <textarea maxLength={240} name="note" rows={4} />
      </label>
      <p className="referee-form-note">提交仅表达执裁意向，不等于正式获得任务；最终结果以已发布选派公告为准。</p>
      <button disabled={submitting || saved} type="submit">{submitting ? "提交中…" : saved ? "已有执裁意向" : "提交执裁意向"}</button>
      {pendingCheck ? <button disabled={submitting} onClick={() => void recheck()} type="button">再次核对结果</button> : null}
      <p aria-live="polite" className="referee-form-message">{message}</p>
    </form>
  );
}
