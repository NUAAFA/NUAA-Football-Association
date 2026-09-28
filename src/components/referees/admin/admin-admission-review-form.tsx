"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type ExistingReferee = {
  id: string;
  publicCode: string;
  name: string;
  status: string;
  studentId: string;
};

type OnboardingResult = {
  refereeId: string;
  name: string;
  studentId: string;
  publicCode: string;
  temporaryPassword: string;
  college: string;
  capabilitySummary: string[];
};

export function AdminAdmissionReviewForm({
  applicationId,
  existingReferees,
}: {
  applicationId: string;
  existingReferees: ExistingReferee[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"CREATE_NEW" | "LINK_EXISTING">("CREATE_NEW");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [onboarding, setOnboarding] = useState<OnboardingResult | null>(null);

  async function review(action: "APPROVE" | "REJECT", form: HTMLFormElement) {
    if (submitting) return;
    const data = new FormData(form);
    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch(`/api/referees/admin/admission-applications/${applicationId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "REJECT" ? {
          action,
          reviewNote: data.get("reviewNote"),
        } : {
          action,
          reviewNote: data.get("reviewNote"),
          mode,
          publicCode: data.get("publicCode"),
          existingRefereeId: data.get("existingRefereeId"),
          initialPassword: data.get("initialPassword"),
        }),
      });
      const result = (await response.json()) as { error?: string; application?: { onboarding?: OnboardingResult | null } };
      if (!response.ok) {
        setMessage(result.error ?? "审核操作失败。");
        return;
      }
      if (action === "APPROVE" && result.application?.onboarding) {
        setOnboarding(result.application.onboarding);
        setMessage("准入申请已通过。临时密码仅在本页显示一次，请立即安全交付。");
      } else {
        setMessage("准入申请已拒绝。未创建或启用账号。");
        router.refresh();
      }
    } catch {
      setMessage("网络连接异常，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyCredentials() {
    if (!onboarding) return;
    await navigator.clipboard.writeText([
      `姓名：${onboarding.name}`,
      `登录学号：${onboarding.studentId}`,
      `裁判员编号：${onboarding.publicCode}`,
      `临时密码：${onboarding.temporaryPassword}`,
      "首次登录必须修改密码。",
    ].join("\n"));
    setMessage("登录凭据已复制。请通过安全渠道一次性交付。首次登录后临时密码即应废弃。");
  }

  if (onboarding) {
    return <section className="admin-form admin-form-section admin-onboarding-result">
      <header><h2>账号创建完成</h2><p>以下临时密码只在本次成功结果中显示，不会写入数据库、日志或 AuditLog。</p></header>
      <dl className="admin-detail-meta">
        <div><dt>姓名</dt><dd>{onboarding.name}</dd></div>
        <div><dt>学号 / 登录账号</dt><dd>{onboarding.studentId}</dd></div>
        <div><dt>裁判员编号</dt><dd>{onboarding.publicCode}</dd></div>
        <div><dt>学院</dt><dd>{onboarding.college}</dd></div>
        <div><dt>账号状态</dt><dd>已启用 · 培训中 · 可选派</dd></div>
        <div><dt>临时密码</dt><dd><code>{onboarding.temporaryPassword}</code></dd></div>
      </dl>
      <div><strong>默认岗位培养状态</strong><ul>{onboarding.capabilitySummary.map((item) => <li key={item}>{item}</li>)}</ul></div>
      <p aria-live="polite" className="admin-form-message">{message}</p>
      <footer>
        <button className="admin-button admin-button-secondary" onClick={() => void copyCredentials()} type="button">复制登录凭据</button>
        <Link className="admin-button admin-button-secondary" href="/admin/referees/admissions?status=PENDING">返回待批复队列</Link>
        <Link className="admin-button" href={`/admin/referees/${onboarding.refereeId}`}>进入裁判员档案</Link>
      </footer>
    </section>;
  }

  return (
    <form className="admin-form admin-form-section" onSubmit={(event) => {
      event.preventDefault();
      void review("APPROVE", event.currentTarget);
    }}>
      <header><h2>审核决定</h2><p>通过时自动完成学院识别、编号分配、临时密码和默认岗位初始化；关联现有账号必须明确选择，不会按姓名或联系方式猜测。</p></header>
      <label><span>审核意见</span><textarea maxLength={500} name="reviewNote" required rows={4} /></label>
      <fieldset className="admin-form-section">
        <legend>通过后的账号处理</legend>
        <div className="admin-form-grid">
          <label><span>处理方式</span><select onChange={(event) => setMode(event.target.value as typeof mode)} value={mode}><option value="CREATE_NEW">创建新裁判员账号</option><option value="LINK_EXISTING">明确关联现有账号</option></select></label>
          {mode === "CREATE_NEW" ? <div className="admin-form-readonly"><span>自动初始化</span><strong>编号、学院、临时密码与培养模板由系统生成</strong></div> : <label><span>现有裁判员（明确选择）</span><select name="existingRefereeId" required><option value="">请选择</option>{existingReferees.map((referee) => <option key={referee.id} value={referee.id}>{referee.publicCode} · {referee.name} · {referee.studentId || "无学号"} · {referee.status}</option>)}</select></label>}
        </div>
        <p className="admin-form-message">临时密码由服务端安全生成，只在成功结果中显示一次，不写入数据库、日志或 AuditLog。</p>
      </fieldset>
      <p aria-live="polite" className="admin-form-message">{message}</p>
      <footer>
        <button className="admin-button admin-button-secondary" disabled={submitting} onClick={(event) => {
          event.preventDefault();
          void review("REJECT", event.currentTarget.form!);
        }} type="button">拒绝申请</button>
        <button className="admin-button" disabled={submitting} type="submit">{submitting ? "处理中…" : "通过并完成账号闭环"}</button>
      </footer>
    </form>
  );
}
