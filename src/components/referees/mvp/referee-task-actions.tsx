"use client";

import { useRef, useState } from "react";

import { isConflictSnapshot, visibleConflictSnapshot, type RefereeConflictSnapshot } from "@/lib/referee-conflict-snapshot";
import { checkRefereeSubmission, RefereeSubmissionRequestError, refereeSubmissionJson, submitRefereeWithCheck } from "@/lib/referee-submission-client";
import type { RefereeTaskSubmissionState } from "@/lib/referee-submission-state";

const conflictReasons = [
  ["TIME_CONFLICT", "时间冲突"],
  ["UNABLE_TO_ATTEND", "临时无法到场"],
  ["COURSE_EXAM", "课程/考试"],
  ["HEALTH", "身体原因"],
  ["OTHER", "其他"],
] as const;

export function RefereeTaskActions({ appointmentId, versionId, acknowledgedAt, report }: { appointmentId: string; versionId: string | null; acknowledgedAt: string | null; report: RefereeConflictSnapshot | null }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const busy = useRef(false);
  const [savedAcknowledgement, setSavedAcknowledgement] = useState<string | null>(null);
  const [savedReport, setSavedReport] = useState<{ versionId: string; report: RefereeConflictSnapshot } | null>(null);
  const [pendingCheck, setPendingCheck] = useState<{ read: () => Promise<RefereeTaskSubmissionState>; confirmed: (state: RefereeTaskSubmissionState) => boolean; kind: "acknowledge" | "conflict"; versionId: string; reportSnapshot: () => RefereeConflictSnapshot | null } | null>(null);

  const reportPending = visibleConflictSnapshot(report, savedReport, versionId)?.status === "PENDING";

  function markSaved(kind: "acknowledge" | "conflict", version: string, snapshot: RefereeConflictSnapshot | null) {
    if (kind === "acknowledge") setSavedAcknowledgement(version);
    else if (snapshot) { setSavedReport({ versionId: version, report: snapshot }); setOpen(false); }
  }

  async function run(kind: "acknowledge" | "conflict", body?: { reasonCode: string; explanation: string }) {
    if (busy.current || !versionId) return;
    busy.current = true; setSubmitting(true); setMessage(""); setPendingCheck(null);
    const submittedVersion = versionId;
    let savedReportSnapshot: RefereeConflictSnapshot | null = null;
    const read = async () => {
      const state = await refereeSubmissionJson<RefereeTaskSubmissionState>(`/api/referees/appointments/${appointmentId}/status?versionId=${encodeURIComponent(submittedVersion)}`);
      if (state.versionId !== submittedVersion) throw new RefereeSubmissionRequestError("任务版本已变化，请重新打开工作区核对。", true);
      if (!Object.hasOwn(state, "acknowledgement") || !Object.hasOwn(state, "report") || (state.acknowledgement !== null && typeof state.acknowledgement?.id !== "string") || (state.report !== null && !isConflictSnapshot(state.report))) throw new Error("无法核对任务响应。");
      return state;
    };
    const confirmed = (state: RefereeTaskSubmissionState) => {
      const matches = state.versionId === submittedVersion && (kind === "acknowledge"
      ? Boolean(state.acknowledgement)
      : state.report?.reasonCode === body?.reasonCode && state.report?.explanation === body?.explanation.trim());
      if (matches && kind === "conflict" && state.report) savedReportSnapshot = state.report;
      return matches;
    };
    try {
      const result = await submitRefereeWithCheck({
        read, confirmed,
        before: (state) => confirmed(state) ? { kind: "success", message: kind === "acknowledge" ? "此版本已确认知悉。" : "此版本已有相同冲突报告，请查看工作区处理结果。" } : null,
        write: async () => {
          const receipt = await refereeSubmissionJson<{ ok?: boolean; report?: unknown }>(`/api/referees/appointments/${appointmentId}/${kind}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, expectedVersionId: submittedVersion }) });
          if (kind === "conflict" && receipt.ok === true) {
            if (!isConflictSnapshot(receipt.report)) throw new Error("无法确认报告身份，请核对保存结果。");
            savedReportSnapshot = receipt.report;
          }
          return receipt;
        },
      });
      setMessage(result.message);
      if (result.kind === "success") markSaved(kind, submittedVersion, savedReportSnapshot);
      else if (result.kind === "unknown") setPendingCheck({ read, confirmed, kind, versionId: submittedVersion, reportSnapshot: () => savedReportSnapshot });
    } finally { busy.current = false; setSubmitting(false); }
  }

  async function recheck() {
    if (busy.current || !pendingCheck) return;
    busy.current = true; setSubmitting(true);
    try {
      const result = await checkRefereeSubmission(pendingCheck.read, pendingCheck.confirmed);
      setMessage(result.message);
      if (result.kind === "success") { markSaved(pendingCheck.kind, pendingCheck.versionId, pendingCheck.reportSnapshot()); setPendingCheck(null); }
    } finally { busy.current = false; setSubmitting(false); }
  }

  return <div className="referee-task-actions" data-appointment-id={appointmentId}>
    <button disabled={submitting || !versionId || Boolean(acknowledgedAt) || (savedAcknowledgement !== null && savedAcknowledgement === versionId)} onClick={() => void run("acknowledge")} type="button">{acknowledgedAt ? `已确认 ${acknowledgedAt}` : (savedAcknowledgement !== null && savedAcknowledgement === versionId) ? "已确认知悉" : "确认知悉"}</button>
    <button disabled={submitting || !versionId || reportPending} onClick={() => setOpen((current) => !current)} type="button">{reportPending ? "冲突待处理" : "报告冲突"}</button>
    {open ? <form className="referee-conflict-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void run("conflict", { reasonCode: String(form.get("reasonCode")), explanation: String(form.get("explanation")) }); }}>
      <label><span>结构化原因</span><select name="reasonCode" required>{conflictReasons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>补充说明</span><textarea maxLength={500} name="explanation" required rows={3} /></label>
      <div><button disabled={submitting} type="submit">提交冲突报告</button><button onClick={() => setOpen(false)} type="button">取消</button></div>
    </form> : null}
    {pendingCheck ? <button disabled={submitting} onClick={() => void recheck()} type="button">再次核对结果</button> : null}
    {!versionId ? <p>当前任务版本待核对，请重新打开工作区。</p> : null}
    <p aria-live="polite">{message}</p>
  </div>;
}
