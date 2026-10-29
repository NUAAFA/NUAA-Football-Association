"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { AdminAffiliationOptionGroups } from "@/components/referees/admin/admin-affiliation-options";
import {
  assignmentEligibilityLabels,
  refereeStatusLabels,
  trainingStatusLabels,
} from "@/components/referees/admin/admin-ui";
import {
  applyCapabilityBatch,
  refereeGrades,
  type RefereeCapabilityStatus,
} from "@/lib/referee-profile-options";
import { refereeQualifications } from "@/lib/referee-qualifications";
import { getRefereeRegistrationSummary } from "@/lib/referee-profile-summary";
import { PublicRefereeName } from "@/components/referees/public-referee-name";

export type CollegeOption = { id: string; name: string; label: string };
export type AffiliationUnitOption = {
  id: string;
  name: string;
  label: string;
  type: "COLLEGE" | "SHUYUAN";
  childUnitIds: string[];
};
export type AdminRefereeRecord = {
  id: string;
  publicCode: string;
  name: string;
  studentId: string;
  collegeId: string;
  currentAffiliationUnitId: string;
  grade: string;
  gradeMode?: string;
  effectiveGrade?: string;
  phone: string;
  qq: string;
  refereeLevel: string;
  joinedAt: string;
  status: string;
  elevenASide: boolean;
  futsal: boolean;
  certificateNote: string;
  qualificationNote: string;
  trainingStatus: string;
  assignmentEligibility: string;
  publicDirectoryEnabled: boolean;
  publicBio: string;
  internalNote: string;
  mustChangePassword: boolean;
  lastLoginAt: string;
  capabilities: string[];
};

const capabilities = {
  ELEVEN_A_SIDE: [
    ["REFEREE", "裁判员"],
    ["ASSISTANT_REFEREE_1", "第一助理裁判员"],
    ["ASSISTANT_REFEREE_2", "第二助理裁判员"],
    ["FOURTH_OFFICIAL", "第四官员"],
    ["RESERVE_ASSISTANT_REFEREE", "候补助理裁判员"],
  ],
  FUTSAL: [
    ["REFEREE", "裁判员"],
    ["SECOND_REFEREE", "第二裁判员"],
    ["THIRD_REFEREE", "第三裁判员"],
    ["FOURTH_REFEREE", "第四裁判员"],
    ["TIMEKEEPER", "计时员"],
  ],
} as const;

type CapabilityFormat = keyof typeof capabilities;
type CapabilityStatus = RefereeCapabilityStatus;

function text(form: FormData, key: string) {
  return String(form.get(key) ?? "");
}

function capabilityPayload(form: FormData) {
  return form.getAll("capability").map((value) => {
    const [format, positionKey, status] = String(value).split(":");
    return { format, positionKey, status };
  });
}

function fullPayload(form: FormData) {
  const selectedCapabilities = capabilityPayload(form);
  return {
    publicCode: text(form, "publicCode"), name: text(form, "name"),
    studentId: text(form, "studentId"), collegeId: text(form, "collegeId"), grade: text(form, "grade"),
    gradeChangeReason: text(form, "gradeChangeReason"),
    currentAffiliationUnitId: text(form, "currentAffiliationUnitId"),
    phone: text(form, "phone"), qq: text(form, "qq"), refereeLevel: text(form, "refereeLevel"),
    joinedAt: text(form, "joinedAt"), initialPassword: "", status: text(form, "status"),
    elevenASide: selectedCapabilities.some((item) => item.format === "ELEVEN_A_SIDE" && item.status !== "NOT_ASSIGNED"),
    futsal: selectedCapabilities.some((item) => item.format === "FUTSAL" && item.status !== "NOT_ASSIGNED"),
    certificateNote: text(form, "certificateNote"), qualificationNote: text(form, "qualificationNote"), trainingStatus: text(form, "trainingStatus"),
    assignmentEligibility: text(form, "assignmentEligibility"), eligibilityReason: text(form, "eligibilityReason"),
    publicDirectoryEnabled: form.get("publicDirectoryEnabled") === "on",
    publicBio: text(form, "publicBio"), internalNote: text(form, "internalNote"),
    capabilities: selectedCapabilities,
  };
}

function initialCapabilityValues(selected: string[]) {
  return Object.fromEntries(Object.entries(capabilities).flatMap(([format, items]) => items.map(([key]) => {
    const status = selected.find((value) => value.startsWith(`${format}:${key}:`))?.split(":")[2] ?? "NOT_ASSIGNED";
    return [`${format}:${key}`, status as CapabilityStatus];
  })));
}

function CapabilityGroups({
  values,
  onChange,
}: {
  values: Record<string, CapabilityStatus>;
  onChange: (values: Record<string, CapabilityStatus>) => void;
}) {
  const [batch, setBatch] = useState<Record<CapabilityFormat, CapabilityStatus>>({ ELEVEN_A_SIDE: "TRAINING", FUTSAL: "TRAINING" });
  function applyBatch(format: CapabilityFormat) {
    onChange(applyCapabilityBatch(values, format, capabilities[format].map(([key]) => key), batch[format]));
  }
  return <div className="admin-capability-groups">{(Object.entries(capabilities) as Array<[CapabilityFormat, typeof capabilities[CapabilityFormat]]>).map(([format, items]) => <section className="admin-capability-group" key={format}>
    <header className="admin-capability-header"><strong>{format === "ELEVEN_A_SIDE" ? "十一人制" : "五人制"}<small>{items.filter(([key]) => values[`${format}:${key}`] !== "NOT_ASSIGNED").length} 项可报名</small></strong><div><span>批量设置</span><select aria-label={`${format === "ELEVEN_A_SIDE" ? "十一人制" : "五人制"}批量状态`} onChange={(event) => setBatch((current) => ({ ...current, [format]: event.target.value as CapabilityStatus }))} value={batch[format]}><option value="NOT_ASSIGNED">暂不安排</option><option value="TRAINING">培养中 · 可报名</option><option value="READY">可正式选派</option></select><button className="admin-button admin-button-quiet" onClick={() => applyBatch(format)} type="button">应用</button></div></header>
    <div>{items.map(([key, label]) => { const identity = `${format}:${key}`; return <label className="admin-capability-row" key={identity}><span>{label}</span><select name="capability" onChange={(event) => onChange({ ...values, [identity]: event.target.value.split(":")[2] as CapabilityStatus })} value={`${identity}:${values[identity]}`}><option value={`${identity}:NOT_ASSIGNED`}>暂不安排</option><option value={`${identity}:TRAINING`}>培养中 · 可报名</option><option value={`${identity}:READY`}>可正式选派</option></select></label>; })}</div>
  </section>)}</div>;
}

type DirectOnboardingResult = {
  refereeId: string;
  name: string;
  studentId: string;
  publicCode: string;
  temporaryPassword: string;
  college: string;
  capabilitySummary: string[];
};

export function RefereeCreateForm() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [onboarding, setOnboarding] = useState<DirectOnboardingResult | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setMessage("");
    const response = await fetch("/api/referees/admin/accounts", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: text(form, "name"), studentId: text(form, "studentId"),
      }),
    });
    const result = (await response.json()) as { error?: string; onboarding?: DirectOnboardingResult };
    setSubmitting(false);
    if (!response.ok) { setMessage(result.error ?? "创建失败。"); return; }
    if (!result.onboarding) { setMessage("账号已创建，但未收到一次性登录凭据，请立即停止并核查。"); return; }
    setOnboarding(result.onboarding);
    setMessage("账号已创建。请立即复制并通过安全渠道交付一次性临时密码。");
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
    setMessage("登录凭据已复制。首次登录后应立即废弃临时密码。");
  }
  if (onboarding) return <section className="admin-form admin-form-section admin-onboarding-result">
    <header><h2>裁判员账号已创建</h2><p>临时密码仅显示一次，不会写入数据库、日志或 AuditLog。</p></header>
    <dl className="admin-detail-meta">
      <div><dt>姓名</dt><dd>{onboarding.name}</dd></div><div><dt>学号 / 登录账号</dt><dd>{onboarding.studentId}</dd></div>
      <div><dt>裁判员编号</dt><dd>{onboarding.publicCode}</dd></div><div><dt>学院</dt><dd>{onboarding.college}</dd></div>
      <div><dt>默认状态</dt><dd>已启用 · 培训中 · 可选派 · 默认进入公开名录</dd></div><div><dt>临时密码</dt><dd><code>{onboarding.temporaryPassword}</code></dd></div>
    </dl>
    <div><strong>默认岗位培养状态</strong><ul>{onboarding.capabilitySummary.map((item) => <li key={item}>{item}</li>)}</ul></div>
    <p aria-live="polite" className="admin-form-message">{message}</p>
    <footer><button className="admin-button admin-button-secondary" onClick={() => void copyCredentials()} type="button">复制登录凭据</button><button className="admin-button" onClick={() => router.push(`/admin/referees/${onboarding.refereeId}`)} type="button">进入裁判员档案</button></footer>
  </section>;
  return <form className="admin-form admin-form-section" onSubmit={submit}>
    <header><h2>一键创建账号</h2><p>填写姓名和学号后，系统自动识别学院、分配裁判员编号和临时密码，并应用标准培养模板。</p></header>
    <div className="admin-form-grid">
      <label><span>姓名</span><input autoFocus maxLength={48} name="name" required /></label>
      <label><span>学号</span><input maxLength={32} name="studentId" required /></label>
    </div>
    <p className="admin-form-message">未知学号前缀会被明确拒绝，不会猜测学院。登录凭据只在成功结果中显示一次。</p>
    <p aria-live="polite" className="admin-form-message">{message}</p>
    <footer><button className="admin-button admin-button-secondary" onClick={() => router.back()} type="button">取消</button><button className="admin-button" disabled={submitting} type="submit">{submitting ? "创建中…" : "创建裁判员"}</button></footer>
  </form>;
}

const tabs = [
  ["profile", "基本资料"], ["capabilities", "报名与岗位"],
  ["qualification", "资质与培养"], ["settings", "公开与账号"],
] as const;

export function RefereeEditForm({ account, colleges, affiliationUnits }: { account: AdminRefereeRecord; colleges: CollegeOption[]; affiliationUnits: AffiliationUnitOption[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const startingCapabilities = useMemo(() => initialCapabilityValues(account.capabilities), [account.capabilities]);
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number][0]>("profile");
  const [message, setMessage] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(account.name);
  const [grade, setGrade] = useState(account.grade);
  const [collegeId, setCollegeId] = useState(account.collegeId);
  const [currentUnitId, setCurrentUnitId] = useState(account.currentAffiliationUnitId);
  const [capabilityValues, setCapabilityValues] = useState<Record<string, CapabilityStatus>>(startingCapabilities);
  const [assignmentEligibility, setAssignmentEligibility] = useState(account.assignmentEligibility);
  const [accountStatus, setAccountStatus] = useState(account.status);
  const [refereeLevel, setRefereeLevel] = useState(account.refereeLevel || refereeQualifications[0]);
  const registration = getRefereeRegistrationSummary({
    status: accountStatus, assignmentEligibility, mustChangePassword: account.mustChangePassword,
    capabilities: Object.entries(capabilityValues).map(([key, status]) => ({ format: key.split(":")[0], status })),
  });
  const [publicEnabled, setPublicEnabled] = useState(account.publicDirectoryEnabled);
  const [publicBio, setPublicBio] = useState(account.publicBio);

  const recommendationGrade = account.gradeMode === "AUTO_STUDENT_ID" ? account.effectiveGrade ?? "" : grade;
  const recommendedUnit = useMemo(() => {
    if (!collegeId) return null;
    if (["大一", "大二"].includes(recommendationGrade)) {
      return affiliationUnits.find((unit) => unit.type === "SHUYUAN" && unit.childUnitIds.includes(collegeId)) ?? null;
    }
    if (["大三", "大四", "已毕业"].includes(recommendationGrade)) {
      return affiliationUnits.find((unit) => unit.id === collegeId) ?? null;
    }
    return null;
  }, [affiliationUnits, collegeId, recommendationGrade]);

  function markDirty() {
    setDirty(true);
    setMessage("");
  }
  function changeTab(value: (typeof tabs)[number][0]) {
    setActiveTab(value);
    if (value !== "settings") setPasswordMessage("");
  }
  function cancelChanges() {
    formRef.current?.reset();
    setName(account.name);
    setGrade(account.grade);
    setCollegeId(account.collegeId);
    setCurrentUnitId(account.currentAffiliationUnitId);
    setCapabilityValues(startingCapabilities);
    setAssignmentEligibility(account.assignmentEligibility);
    setAccountStatus(account.status);
    setRefereeLevel(account.refereeLevel || refereeQualifications[0]);
    setPublicEnabled(account.publicDirectoryEnabled);
    setPublicBio(account.publicBio);
    setDirty(false);
    setMessage("已取消未保存修改。");
  }
  async function update(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const payload = fullPayload(new FormData(event.currentTarget));
    setSaving(true); setMessage("");
    try {
      const response = await fetch(`/api/referees/admin/accounts/${account.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { error?: string };
      setMessage(response.ok ? "裁判员档案已保存。" : result.error ?? "保存失败，请核对后重试。");
      if (response.ok) { setDirty(false); router.refresh(); }
    } catch { setMessage("网络异常，修改尚未确认保存，请核对后重试。"); }
    finally { setSaving(false); }
  }
  async function resetPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/referees/admin/accounts/${account.id}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ initialPassword: form.get("initialPassword") }),
    });
    const result = (await response.json()) as { error?: string };
    setPasswordMessage(response.ok ? "密码已重置，原有会话已失效。" : result.error ?? "重置失败。");
    if (response.ok) { event.currentTarget.reset(); setResetOpen(false); router.refresh(); }
  }

  return <>
    <form className="admin-form" onChange={markDirty} onSubmit={update} ref={formRef}>
      <nav aria-label="裁判员详情分区" className="admin-tabs admin-referee-tabs" role="tablist">{tabs.map(([value, label]) => <button id={`referee-tab-${value}`} aria-controls={`referee-panel-${value}`} aria-selected={activeTab === value} tabIndex={activeTab === value ? 0 : -1} onKeyDown={event => { const index = tabs.findIndex(([key]) => key === value); const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1; if (next < 0) return; event.preventDefault(); changeTab(tabs[next][0]); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button[role="tab"]')[next]?.focus(); }} key={value} onClick={() => changeTab(value)} role="tab" type="button">{label}</button>)}</nav>

      <section id="referee-panel-profile" aria-labelledby="referee-tab-profile" role="tabpanel" className="admin-form-section admin-profile-section" hidden={activeTab !== "profile"}>
        <header><h2>基本资料</h2><p>维护身份、组织和联系方式；报名与选派条件在“报名与岗位”中设置。</p></header>
        <div className="admin-form-grid admin-form-grid-3 admin-profile-grid">
          <label><span>姓名</span><input value={name} onChange={event => { setName(event.target.value); markDirty(); }} name="name" required /></label>
          <label><span>裁判员编号</span><input defaultValue={account.publicCode} name="publicCode" required /></label>
          <label><span>学号</span><input defaultValue={account.studentId} aria-label="学号" name="studentId" /><small>裁判员使用学号登录。</small></label>
          <label><span>年级</span><select aria-label="年级" name="grade" onChange={(event) => { setGrade(event.target.value); markDirty(); }} value={grade}><option value="">待确认</option>{refereeGrades.map((item) => <option key={item} value={item}>{item}</option>)}</select><small>{account.gradeMode === "AUTO_STUDENT_ID" ? `当前自动年级：${account.effectiveGrade || "待核实"}；此处保留原年级记录。` : "特殊学籍与自动计算可在下方“年级计算设置”中维护。"}</small></label>
          <label><span>学院背景</span><select aria-label="学院背景" name="collegeId" onChange={(event) => { setCollegeId(event.target.value); markDirty(); }} value={collegeId}><option value="">待确认</option>{colleges.map((college) => <option key={college.id} value={college.id}>{college.label}</option>)}</select><small>记录专业所属学院。</small></label>
          <label><span>当前组织归属</span><select aria-label="当前组织归属" name="currentAffiliationUnitId" onChange={(event) => { setCurrentUnitId(event.target.value); markDirty(); }} value={currentUnitId}><option value="">待管理员确认</option><AdminAffiliationOptionGroups options={affiliationUnits} /></select>{recommendedUnit && recommendedUnit.id !== currentUnitId ? <small className="admin-field-suggestion">建议：{recommendedUnit.name} <button onClick={() => { setCurrentUnitId(recommendedUnit.id); markDirty(); }} type="button">采用建议</button></small> : <small>用于组织关系与回避判断，需管理员确认。</small>}</label>
          <label><span>手机号</span><input defaultValue={account.phone} name="phone" /></label>
          <label><span>QQ</span><input defaultValue={account.qq} name="qq" /></label>
          <label><span>加入日期</span><input defaultValue={account.joinedAt} name="joinedAt" type="date" /></label>
        </div>
        <details className="admin-profile-disclosure"><summary>修改学号或原年级的核实说明</summary><label><span>学号 / 原年级修改核实原因</span><input name="gradeChangeReason" maxLength={500} placeholder="修改学号或原年级时必填" /></label></details>
      </section>

      <section id="referee-panel-capabilities" aria-labelledby="referee-tab-capabilities" role="tabpanel" className="admin-form-section" hidden={activeTab !== "capabilities"}>
        <header><h2>报名与岗位</h2><p>先设置整体资格，再按赛制评估具体岗位；这里的设置会影响报名和选派。</p></header>
        <div className="admin-registration-summary" data-ready={registration.canApply} role="status" aria-live="polite"><strong>{registration.title}</strong><p>{registration.detail}</p><span>可报名岗位：十一人制 {registration.eleven} 项 · 五人制 {registration.futsal} 项</span></div>
        <div className="admin-form-grid admin-eligibility-fields">
          <label><span>报名与选派资格</span><select aria-label="报名与选派资格" aria-describedby="referee-eligibility-help" name="assignmentEligibility" onChange={(event) => { setAssignmentEligibility(event.target.value); markDirty(); }} value={assignmentEligibility}>{Object.entries(assignmentEligibilityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><small id="referee-eligibility-help">“不可选派”与“暂停选派”都会关闭报名，并阻止管理员正式选派。</small></label>
          <label><span>选派资格调整原因</span><input maxLength={500} name="eligibilityReason" placeholder="暂停或恢复选派时必填" /><small>暂停或恢复资格需说明原因，保存后留下操作记录。</small></label>
        </div>
        <div className="admin-capability-legend"><p><strong>培养中</strong> 可报名，由管理员评估安排。</p><p><strong>可正式选派</strong> 可报名，已评估可承担该岗位。</p><p><strong>暂不安排</strong> 该岗位不能报名或选派。</p></div>
        <CapabilityGroups onChange={(values) => { setCapabilityValues(values); markDirty(); }} values={capabilityValues} />
        <p className="admin-profile-help">批量设置仅作用于当前赛制；修改后点击“保存修改”生效。</p>
      </section>

      <section id="referee-panel-qualification" aria-labelledby="referee-tab-qualification" role="tabpanel" className="admin-form-section" hidden={activeTab !== "qualification"}>
        <header><h2>资质与培养</h2><p>记录正式持证等级和协会培养进度；两者分别维护，不自动改变岗位或报名资格。</p></header>
        <div className="admin-form-grid">
          <label><span>持证裁判等级</span><select aria-label="持证裁判等级" aria-describedby="referee-level-help" name="refereeLevel" onChange={event => { setRefereeLevel(event.target.value); markDirty(); }} value={refereeLevel}>{refereeQualifications.map((qualification) => <option key={qualification} value={qualification}>{qualification}</option>)}</select><small id="referee-level-help">按已核验的证书登记；官网公开选派会在姓名后显示此等级。</small></label>
          <label><span>协会培训状态（仅作记录）</span><select defaultValue={account.trainingStatus} aria-label="协会培训状态（仅作记录）" aria-describedby="referee-training-help" name="trainingStatus">{Object.entries(trainingStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><small id="referee-training-help">用于培养进度、档案和筛选；“考察通过”不会自动升级岗位或授予裁判等级。</small></label>
        </div>
        <div className="admin-qualification-preview"><span>官网选派显示示例</span><p>裁判员 <PublicRefereeName name={name} level={refereeLevel} /></p><small>未登记正式等级时只显示姓名。证书编号和资质备注仅作内部资料。</small></div>
        <details className="admin-profile-disclosure"><summary>证书编号与资质备注 · 内部留档</summary><div className="admin-form-grid"><label><span>证书 / 登记编号</span><input defaultValue={account.certificateNote} name="certificateNote" /></label><label><span>资质备注</span><textarea defaultValue={account.qualificationNote} maxLength={500} aria-label="资质备注" name="qualificationNote" /></label></div></details>
      </section>

      <section id="referee-panel-settings" aria-labelledby="referee-tab-settings" role="tabpanel" className="admin-form-section" hidden={activeTab !== "settings"}>
        <header><h2>公开与账号</h2><p>公开名录决定是否展示个人简介；账号状态决定能否登录、报名和参与正式选派。</p></header>
        <div className="admin-profile-settings">
          <section><h3>公开名录</h3><label className="admin-switch-row"><span><strong>进入公开裁判名录</strong><small>控制名录中的个人介绍；已公开选派按正式任务展示姓名与持证等级。</small></span><input checked={publicEnabled} name="publicDirectoryEnabled" onChange={(event) => { setPublicEnabled(event.target.checked); markDirty(); }} role="switch" type="checkbox" /><b>{publicEnabled ? "已公开" : "未公开"}</b></label><label><span>公开简介</span><textarea maxLength={300} aria-label="公开简介" name="publicBio" onChange={(event) => { setPublicBio(event.target.value); markDirty(); }} rows={3} value={publicBio} /></label><small className="admin-profile-help">不公开学号、联系方式、证书编号或内部备注。</small></section>
          <section><h3>登录与账号</h3><label><span>账号状态</span><select aria-label="账号状态" aria-describedby="referee-status-help" name="status" onChange={event => { setAccountStatus(event.target.value); markDirty(); }} value={accountStatus}>{Object.entries(refereeStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><small id="referee-status-help">待启用、停用或归档的账号不能登录、报名或被正式选派。</small></label><dl className="admin-account-facts"><div><dt>最近登录</dt><dd>{account.lastLoginAt || "从未登录"}</dd></div><div><dt>首次改密</dt><dd>{account.mustChangePassword ? "待裁判员完成，暂不能报名" : "已完成"}</dd></div></dl><div className="admin-security-action"><div><strong>重置登录密码</strong><p>原会话失效，下次登录须改密。</p></div><button className="admin-button admin-button-secondary" onClick={() => { setPasswordMessage(""); setResetOpen(true); }} type="button">重置密码</button></div><p aria-live="polite" className="admin-form-message">{passwordMessage}</p></section>
        </div>
        <details className="admin-profile-disclosure"><summary>内部管理备注 · 仅管理员可见</summary><label><span>内部备注</span><textarea defaultValue={account.internalNote} maxLength={500} aria-label="内部备注" name="internalNote" /></label></details>
      </section>

      <div className="admin-form-savebar"><span role="status">{message || (dirty ? "存在未保存修改" : "当前档案已同步")}</span><div><button className="admin-button admin-button-secondary" disabled={!dirty || saving} onClick={cancelChanges} type="button">取消修改</button><button className="admin-button" disabled={saving} type="submit">{saving ? "保存中…" : "保存修改"}</button></div></div>
    </form>
    {resetOpen ? <div aria-modal="true" className="admin-modal-backdrop" role="dialog"><div className="admin-modal admin-modal-compact"><header><div><span>ACCOUNT SECURITY</span><h2>重置裁判员密码</h2></div><button aria-label="关闭" onClick={() => setResetOpen(false)} type="button">×</button></header><form className="admin-form" onSubmit={resetPassword}><p>重置后，该裁判员已有会话将全部失效，下一次登录须修改密码。</p><label><span>新的初始密码</span><input minLength={12} name="initialPassword" required type="password" /></label><footer><button className="admin-button admin-button-secondary" onClick={() => setResetOpen(false)} type="button">取消</button><button className="admin-button" type="submit">确认重置</button></footer></form></div></div> : null}
  </>;
}
