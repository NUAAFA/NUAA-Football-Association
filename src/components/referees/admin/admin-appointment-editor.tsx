"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type PositionKey = "REFEREE" | "ASSISTANT_REFEREE_1" | "ASSISTANT_REFEREE_2" | "FOURTH_OFFICIAL" | "RESERVE_ASSISTANT_REFEREE" | "SECOND_REFEREE" | "THIRD_REFEREE" | "TIMEKEEPER" | "FOURTH_REFEREE";
export type AppointmentWarningView = { code: string; refereeId: string; refereeName: string; message: string; severity: "HARD" | "OVERRIDABLE" | "ADVISORY"; overridable: boolean };
export type AppointmentMatchView = {
  canComplete?: boolean;
  id: string; appointmentId: string | null; statusKey: string; format: "ELEVEN_A_SIDE" | "FUTSAL" | "CUSTOM"; publicationNote: string;
  template: Array<{ key: PositionKey; label: string; slot: number }>;
  positions: Array<{ key: PositionKey; slot: number; refereeId: string | null }>;
};
export type AppointmentRefereeOption = {
  id: string; label: string; status: string; assignmentEligibility: string; capabilities: string[]; completedCount: number;
  availability: "AVAILABLE" | "UNAVAILABLE" | "UNSET";
  overlap: boolean;
  interested: boolean;
};
export type ApplicationView = {
  id: string; referee: string; status: string; statusLabel: string; preferred: string; note: string | null; createdAt: string;
};

async function jsonApi(url: string, method: string, body: unknown) {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = (await response.json()) as { error?: string; warnings?: AppointmentWarningView[] };
  return { response, result };
}

function warningLabel(code: string) {
  return ({ COLLEGE_CONFLICT: "组织关联回避", UNAVAILABLE: "已填写不可执裁", MATCH_OVERLAP: "与另一场比赛时间重叠", ADJACENT_MATCH: "连续执裁提醒", CAPABILITY_TRAINING: "岗位培养中", CAPABILITY_NOT_ASSIGNED: "岗位暂不安排" } as Record<string,string>)[code] ?? code;
}

function capabilityStatus(referee: AppointmentRefereeOption, format: string, positionKey: string) {
  return referee.capabilities.find((value) => value.startsWith(`${format}:${positionKey}:`))?.split(":")[2] ?? "NOT_ASSIGNED";
}

function capabilityText(status: string) {
  return ({ READY: "可正式选派", TRAINING: "培养中", NOT_ASSIGNED: "暂不安排" } as Record<string, string>)[status] ?? "暂不安排";
}

function canUseForPosition(referee: AppointmentRefereeOption, format: string, positionKey: string) {
  return referee.status === "ACTIVE" &&
    referee.assignmentEligibility === "ELIGIBLE" &&
    capabilityStatus(referee, format, positionKey) !== "NOT_ASSIGNED";
}

function candidateRank(referee: AppointmentRefereeOption, format: string, positionKey: string) {
  if (!canUseForPosition(referee, format, positionKey)) return 0;
  return (capabilityStatus(referee, format, positionKey) === "READY" ? 100 : 50) +
    (referee.interested ? 20 : 0) + (referee.availability === "AVAILABLE" ? 10 : 0) -
    (referee.availability === "UNAVAILABLE" ? 30 : 0) - (referee.overlap ? 40 : 0);
}

function availabilityText(value: AppointmentRefereeOption["availability"]) {
  return ({ AVAILABLE: "可执裁", UNAVAILABLE: "不可执裁", UNSET: "未设置" } as const)[value];
}

export function AdminAppointmentEditor({
  match,
  referees,
  applications,
  initialWarnings,
}: {
  match: AppointmentMatchView;
  referees: AppointmentRefereeOption[];
  applications: ApplicationView[];
  initialWarnings: AppointmentWarningView[];
}) {
  const router = useRouter();
  const identity = (item: { key: string; slot: number }) => `${item.key}:${item.slot}`;
  const initial = new Map(match.positions.map((item) => [identity(item), item.refereeId]));
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => Object.fromEntries(match.template.map((item) => [identity(item), initial.has(identity(item))])));
  const [assigned, setAssigned] = useState<Record<string, string>>(() => Object.fromEntries(match.template.map((item) => [identity(item), initial.get(identity(item)) ?? ""])));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [warnings, setWarnings] = useState(initialWarnings);
  const [moreOpen, setMoreOpen] = useState(
    match.statusKey === "PUBLISHED" || initialWarnings.some((warning) => warning.overridable),
  );
  const [manualOpen, setManualOpen] = useState(false);
  const [manualMessage, setManualMessage] = useState("");
  const currentStatus = match.statusKey;
  const canEditDraft = ["NONE", "DRAFT", "WITHDRAWN"].includes(currentStatus);
  const needsOverride = warnings.some((warning) => warning.overridable);

  function updateAssignment(key: string, value: string) {
    setAssigned((current) => ({ ...current, [key]: value }));
    setWarnings([]);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
    const form = new FormData(event.currentTarget);
    const positions = match.template.filter((item) => enabled[identity(item)]).map((item) => ({ key: item.key, slot: item.slot, refereeId: assigned[identity(item)] || null }));
    const { response, result } = await jsonApi(`/api/referees/admin/appointments/${match.id}`, "PUT", { positions, publicationNote: form.get("publicationNote"), changeReason: reason, overrideReason });
    setWarnings(result.warnings ?? []);
    if (result.warnings?.some((warning) => warning.overridable)) setMoreOpen(true);
    setMessage(response.ok ? "选派草稿已保存。" : result.error ?? "保存失败。");
    if (response.ok) router.refresh();
    } catch { setMessage("网络异常，请核对当前状态后重试。"); } finally { setBusy(false); }
  }

  async function action(actionName: "publish" | "withdraw" | "complete" | "cancel") {
    if (busy) return; setBusy(true);
    try {
    const { response, result } = await jsonApi(`/api/referees/admin/appointments/${match.id}`, "POST", { action: actionName, reason, overrideReason });
    setWarnings(result.warnings ?? []);
    if (result.warnings?.some((warning) => warning.overridable)) setMoreOpen(true);
    const labels = { publish: "选派已发布。", withdraw: "选派已撤回，可进入修改。", complete: "选派已标记完成。", cancel: "选派已取消。" };
    setMessage(response.ok ? labels[actionName] : result.error ?? "操作失败。");
    if (response.ok) router.refresh();
    } catch { setMessage("网络异常，请核对当前状态后重试。"); } finally { setBusy(false); }
  }

  async function review(applicationId: string, status: string, reviewNote: string) {
    const { response, result } = await jsonApi(`/api/referees/admin/applications/${applicationId}`, "PATCH", { status, reviewNote });
    setManualMessage(response.ok ? "报名审核结果已保存。" : result.error ?? "审核失败。");
    if (response.ok) router.refresh();
  }

  async function manualApplication(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const { response, result } = await jsonApi("/api/referees/admin/applications", "POST", {
      matchId: match.id, refereeId: form.get("refereeId"), preferredPositions: form.getAll("preferredPositions"),
      note: form.get("note"), exceptionReason: form.get("exceptionReason"),
    });
    setManualMessage(response.ok ? "人工例外报名已补录。" : result.error ?? "补录失败。");
    if (response.ok) { setManualOpen(false); router.refresh(); }
  }

  const assignedCount = match.template.filter((item) => enabled[identity(item)] && assigned[identity(item)]).length;

  return <>
    <section className="admin-panel admin-assignment-panel">
      <header className="admin-panel-header admin-workbench-header"><div><h2>裁判选派工作台</h2><p>{match.format === "ELEVEN_A_SIDE" ? "十一人制" : match.format === "FUTSAL" ? "五人制" : "无预设"}岗位模板 · 可正式选派优先，培养中可选；暂不安排不可选</p></div><div className="admin-assignment-summary"><span><strong>{assignedCount}</strong> / {Object.values(enabled).filter(Boolean).length} 已启用岗位已分配</span><span data-warning={warnings.length > 0}><strong>{warnings.length}</strong> 个提醒</span></div></header>
      <form className="admin-form admin-assignment-form" onSubmit={save}>
        <div aria-label="裁判岗位分配" className="admin-workbench-table" role="table">
          <div className="admin-workbench-table-head" role="row"><span role="columnheader">岗位</span><span role="columnheader">裁判员</span><span role="columnheader">岗位能力</span><span role="columnheader">状态检查</span></div>
          <div className="admin-position-assignment-list">{match.template.map((position) => {
          const key = identity(position);
          const refereeId = assigned[key];
          const positionWarnings = warnings.filter((warning) => warning.refereeId === refereeId);
          const nonCapabilityWarnings = positionWarnings.filter((warning) => !warning.code.startsWith("CAPABILITY_"));
          const selectedReferee = referees.find((referee) => referee.id === refereeId);
          const selectedCapability = selectedReferee ? capabilityStatus(selectedReferee, match.format, position.key) : "NOT_ASSIGNED";
          return <div className={`admin-position-assignment${enabled[key] ? "" : " is-disabled"}`} key={key} role="row">
            <div className="admin-workbench-role" data-label="岗位" role="cell"><label className="admin-position-toggle"><input aria-label={`启用${position.label}`} checked={enabled[key]} disabled={!canEditDraft} onChange={(event) => setEnabled((current) => ({ ...current, [key]: event.target.checked }))} type="checkbox" /><span><strong>{position.label}</strong>{position.slot > 1 ? <small>岗位序号 {position.slot}</small> : null}</span></label></div>
            <div className="admin-position-select" data-label="裁判员" role="cell"><select aria-label={`${position.label}裁判员`} disabled={!enabled[key] || !canEditDraft} onChange={(event) => updateAssignment(key, event.target.value)} value={refereeId}><option value="">待分配</option>{[...referees].sort((left, right) => candidateRank(right, match.format, position.key) - candidateRank(left, match.format, position.key)).map((referee) => { const capability = capabilityStatus(referee, match.format, position.key); const eligible = canUseForPosition(referee, match.format, position.key); const signals = `${capabilityText(capability)} · ${availabilityText(referee.availability)}${referee.overlap ? " · 时间重叠" : ""}${referee.interested ? " · 已报名" : ""}`; return <option disabled={!eligible && referee.id !== refereeId} key={referee.id} value={referee.id}>{eligible ? signals : `${referee.status}/${referee.assignmentEligibility}/${capabilityText(capability)}`} · {referee.label} · 已完成 {referee.completedCount} 场</option>; })}</select></div>
            <div className="admin-workbench-capability" data-label="岗位能力" role="cell">{refereeId ? <span data-state={selectedCapability}>{selectedCapability === "READY" ? "✓" : "⚠"} {capabilityText(selectedCapability)}</span> : <span>—</span>}</div>
            <div className={`admin-workbench-checks${nonCapabilityWarnings.length ? " has-warning" : ""}`} data-label="状态检查" role="cell">{refereeId ? nonCapabilityWarnings.length ? nonCapabilityWarnings.map((warning) => <span key={`${warning.code}-${warning.refereeId}`}>⚠ {warning.message}</span>) : <span>✓ 无冲突</span> : <span>—</span>}</div>
          </div>;
        })}</div></div>
        {warnings.length ? <div className="admin-warning-panel"><strong>冲突与相邻任务提醒</strong><ul>{warnings.map((warning, index) => <li key={`${warning.code}-${warning.refereeId}-${index}`}><b>{warning.severity === "HARD" ? "不可覆盖" : warning.severity === "OVERRIDABLE" ? "可覆盖" : "提醒"} · {warningLabel(warning.code)}</b>：{warning.message}</li>)}</ul></div> : null}
        <details className="admin-more-options" onToggle={(event) => setMoreOpen(event.currentTarget.open)} open={moreOpen}><summary><span>更多选项</span><small>公示备注、修改原因与冲突留痕</small></summary><div className="admin-more-options-content"><div className="admin-form-grid">
          <label><span>公示备注</span><input defaultValue={match.publicationNote} maxLength={240} name="publicationNote" readOnly={!canEditDraft} /></label>
          {currentStatus !== "NONE" ? <label><span>{currentStatus === "PUBLISHED" ? "操作原因" : "修改 / 重新发布原因"}</span><input maxLength={240} onChange={(event) => setReason(event.target.value)} placeholder="撤回、修改或重新发布时填写" value={reason} /></label> : null}
        </div>{needsOverride ? <label className="admin-override-field"><span>冲突覆盖原因</span><textarea maxLength={500} onChange={(event) => setOverrideReason(event.target.value)} placeholder="存在可覆盖冲突时必须填写，内容将进入版本与操作日志" value={overrideReason} /></label> : null}</div></details>
        <p aria-live="polite" className="admin-form-message">{message}</p>
        <footer className="admin-assignment-actions">
          <div className="admin-assignment-secondary-actions">{match.appointmentId ? <Link className="admin-button admin-button-quiet" href={`/referees/assignments/${match.appointmentId}/print`}>打印选派单</Link> : null}</div>
          <div className="admin-assignment-primary-actions">{canEditDraft ? <><button className="admin-button admin-button-secondary" disabled={busy} type="submit">保存草稿</button><button className="admin-button admin-primary-cta" disabled={busy} onClick={() => action("publish")} type="button">{currentStatus === "WITHDRAWN" ? "重新发布" : "发布选派"}</button></> : null}
          {currentStatus === "PUBLISHED" ? <><button className="admin-button admin-button-secondary" disabled={busy} onClick={() => action("withdraw")} type="button">撤回并修改</button><button className="admin-button" disabled={busy || !match.canComplete} onClick={() => { if (window.confirm("确认比赛真实结束且已核对赛果？请填写人工完成原因。")) void action("complete"); }} type="button">标记执裁完成</button><button className="admin-button admin-button-danger" disabled={busy} onClick={() => action("cancel")} type="button">取消</button></> : null}</div>
        </footer>
      </form>
    </section>
    <section className="admin-panel admin-applications-panel">
      <header className="admin-panel-header"><div><h2>报名意向（{applications.length}）</h2><p>本场比赛的裁判员报名与人工例外补录。</p></div>{applications.length ? <div className="admin-page-actions"><Link className="admin-button admin-button-quiet" href={`/api/referees/admin/exports/applications?matchId=${match.id}`}>导出 CSV</Link><button className="admin-button admin-button-secondary" onClick={() => setManualOpen(true)} type="button">+ 人工补录</button></div> : null}</header>
      {applications.length ? <div className="admin-table-scroll"><table className="admin-data-table"><thead><tr><th>裁判员</th><th>意向岗位</th><th>说明</th><th>提交时间</th><th>状态</th><th>审核</th></tr></thead><tbody>{applications.map((application) => <ApplicationRow application={application} key={application.id} onReview={review} />)}</tbody></table></div> : <div className="admin-compact-empty"><span>暂无裁判员报名本场比赛。</span><button className="admin-button admin-button-quiet" onClick={() => setManualOpen(true)} type="button">人工补录</button></div>}
      <p aria-live="polite" className="admin-form-message admin-inline-message">{manualMessage}</p>
    </section>
    {manualOpen ? <div aria-modal="true" className="admin-modal-backdrop" role="dialog"><div className="admin-modal"><header><div><span>MANUAL APPLICATION</span><h2>人工例外补录</h2></div><button aria-label="关闭" onClick={() => setManualOpen(false)} type="button">×</button></header><form className="admin-form" onSubmit={manualApplication}><div className="admin-form-grid"><label><span>裁判员</span><select name="refereeId" required><option value="">请选择</option>{referees.map((referee) => { const eligible = referee.status === "ACTIVE" && referee.assignmentEligibility === "ELIGIBLE" && referee.capabilities.some((value) => value.startsWith(`${match.format}:`) && !value.endsWith(":NOT_ASSIGNED")); return <option disabled={!eligible} key={referee.id} value={referee.id}>{eligible ? `可报名 · ${availabilityText(referee.availability)}` : `${referee.status}/${referee.assignmentEligibility}`} · {referee.label}</option>; })}</select></label><label><span>人工例外原因</span><input maxLength={240} name="exceptionReason" required /></label></div><div><span className="admin-field-label">意向岗位</span><div className="admin-checkbox-list admin-manual-position-list">{match.template.filter((item) => item.slot === 1).map((position) => <label key={position.key}><input name="preferredPositions" type="checkbox" value={position.key} />{position.label}</label>)}</div></div><label><span>补充说明</span><textarea maxLength={240} name="note" /></label><footer><button className="admin-button admin-button-secondary" onClick={() => setManualOpen(false)} type="button">取消</button><button className="admin-button" type="submit">确认补录</button></footer></form></div></div> : null}
  </>;
}

function ApplicationRow({ application, onReview }: { application: ApplicationView; onReview: (id: string, status: string, note: string) => Promise<void> }) {
  const [status, setStatus] = useState(application.status);
  const [note, setNote] = useState("");
  return <tr><td><strong>{application.referee}</strong></td><td>{application.preferred}</td><td>{application.note || "—"}</td><td>{application.createdAt}</td><td><span className="admin-status-badge" data-status={application.status}>{application.statusLabel}</span></td><td><div className="admin-inline-review"><select onChange={(event) => setStatus(event.target.value)} value={status}><option value="PENDING">已提交</option><option value="REVIEWING">审核中</option><option value="APPROVED">已通过</option><option value="REJECTED">未通过</option><option value="NOT_SELECTED">未入选</option><option value="APPOINTED">已选派</option></select><input onChange={(event) => setNote(event.target.value)} placeholder="审核备注" value={note} /><button onClick={() => onReview(application.id, status, note)} type="button">保存</button></div></td></tr>;
}
