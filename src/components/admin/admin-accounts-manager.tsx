"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { WorkspaceDialog } from "@/components/admin/workspace-dialog";

type Role = "SUPER_ADMIN" | "CONTENT_EDITOR" | "COMPETITION_ADMIN" | "REFEREE_ADMIN";
type Account = {
  id: string;
  username: string;
  displayName: string;
  roles: Role[];
  isProtected: boolean;
  canManage: boolean;
  isCurrent: boolean;
  isActive: boolean;
  lastLoginAt: string;
};

const roleOptions: Array<{ role: Role; label: string; description: string }> = [
  { role: "SUPER_ADMIN", label: "超级管理员", description: "全部业务模块与普通账号管理，不可操作最高管理员" },
  { role: "CONTENT_EDITOR", label: "内容运营", description: "管理新闻公告、宣传内容与媒体附件" },
  { role: "COMPETITION_ADMIN", label: "赛事管理员", description: "管理赛事、赛程导入、比赛与组织球队" },
  { role: "REFEREE_ADMIN", label: "裁判管理员", description: "管理裁判、准入申请、选派与执裁统计" },
];

async function api(method: "POST" | "PATCH" | "DELETE", body: unknown) {
  const response = await fetch("/api/admin/system/admin-accounts", {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const result = await response.json() as { error?: string };
  if (!response.ok) throw new Error(result.error ?? "管理员账号操作失败。");
}

function RoleSelector({ roles, onChange }: { roles: Role[]; onChange: (roles: Role[]) => void }) {
  const isSuper = roles.includes("SUPER_ADMIN");
  function toggle(role: Role, checked: boolean) {
    if (role === "SUPER_ADMIN") { onChange(checked ? ["SUPER_ADMIN"] : []); return; }
    const withoutSuper = roles.filter((item) => item !== "SUPER_ADMIN");
    onChange(checked ? [...new Set([...withoutSuper, role])] : withoutSuper.filter((item) => item !== role));
  }
  return <fieldset className="admin-role-selector">
    <legend>角色权限 <small>可按职责组合</small></legend>
    {roleOptions.map((option) => <label key={option.role} data-selected={roles.includes(option.role)} data-disabled={option.role !== "SUPER_ADMIN" && isSuper}>
      <input checked={roles.includes(option.role)} disabled={option.role !== "SUPER_ADMIN" && isSuper}
        onChange={(event) => toggle(option.role, event.target.checked)} type="checkbox" />
      <span><strong>{option.label}</strong><small>{option.description}</small></span>
    </label>)}
    <p>{isSuper ? "已包含全部业务权限，无需再选择其他角色。" : "至少选择一个角色，权限将按所选职责合并。"}</p>
  </fieldset>;
}

type Mode = "create" | "edit" | "reset" | "delete" | "status";
export function AdminAccountsManager({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [editing, setEditing] = useState<Account | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmUsername, setConfirmUsername] = useState("");
  const [busy, setBusy] = useState(false);

  function open(next: Mode, account?: Account) {
    setRoles(account?.roles ?? ["CONTENT_EDITOR"]); setEditing(account ?? null);
    setError(""); setConfirmUsername(""); setMode(next);
  }
  function close() { if (!busy) { setMode(null); setEditing(null); setError(""); } }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(""); setMessage("");
    try {
      if (mode === "create") {
        await api("POST", { displayName: form.get("displayName"), username: form.get("username"), password: form.get("password"), roles });
        setMessage("管理员账号已创建，首次登录须修改密码。");
      } else if (editing) {
        if (mode === "edit") {
          await api("PATCH", { id: editing.id, roles }); setMessage("管理员角色已更新。");
        } else if (mode === "reset") {
          if (form.get("password") !== form.get("confirmPassword")) throw new Error("两次输入的密码不一致。");
          await api("PATCH", { id: editing.id, action: "reset-password", password: form.get("password") });
          setMessage("密码已重置，旧会话已失效；下次登录须修改密码。");
        } else if (mode === "delete") {
          await api("DELETE", { id: editing.id, confirmUsername }); setMessage(`账号 ${editing.username} 已删除，业务历史已保留。`);
        } else if (mode === "status") {
          await api("PATCH", { id: editing.id, isActive: !editing.isActive });
          setMessage(editing.isActive ? "账号已停用，旧会话已失效。" : "账号已启用。");
        }
      }
      setMode(null); setEditing(null); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "管理员账号操作失败。"); }
    finally { setBusy(false); }
  }

  const title = mode === "create" ? "新建管理员" : `${mode === "edit" ? "修改角色权限" : mode === "reset" ? "重置管理员密码" : mode === "delete" ? "删除管理员账号" : editing?.isActive ? "停用管理员账号" : "启用管理员账号"}`;
  const submitLabel = mode === "create" ? "创建账号" : mode === "edit" ? "保存权限" : mode === "reset" ? "确认重置" : mode === "delete" ? "确认删除" : editing?.isActive ? "确认停用" : "确认启用";
  return <div className="admin-accounts-workspace">
    <div className="admin-accounts-toolbar"><p><strong>权限分级，职责清晰</strong><span>最高管理员受保护；其他角色按工作需要授予。</span></p><button className="admin-button" disabled={busy} onClick={() => open("create")} type="button">+ 新建管理员</button></div>
    <p aria-live="polite" className="admin-form-message">{message}</p>
    <div className="admin-table-scroll"><table className="admin-data-table admin-accounts-table">
      <thead><tr><th>管理员</th><th>角色权限</th><th>状态</th><th>最近登录</th><th>账号管理</th></tr></thead>
      <tbody>{accounts.map((account) => <tr key={account.id} data-protected={account.isProtected}>
        <td><div className="admin-account-identity"><span className="admin-account-avatar" aria-hidden="true">{account.displayName.slice(0, 1).toUpperCase()}</span><div><strong>{account.displayName}</strong><small>{account.username}{account.isCurrent ? " · 当前账号" : ""}</small></div></div></td>
        <td><div className="admin-account-roles">{account.isProtected ? <span className="admin-owner-badge">最高管理员</span> : account.roles.map((role) => <span key={role}>{roleOptions.find((option) => option.role === role)?.label ?? role}</span>)}</div>{account.isProtected ? <small className="admin-account-protected-copy">全部权限 · 身份受保护</small> : null}</td>
        <td><span className="admin-status-badge" data-status={account.isActive ? "ACTIVE" : "INACTIVE"}>{account.isActive ? "已启用" : "已停用"}</span></td>
        <td className="admin-account-login">{account.lastLoginAt || "从未登录"}</td>
        <td>{account.canManage ? <div className="admin-account-actions">
          <button disabled={busy} onClick={() => open("edit", account)} type="button">角色权限</button>
          {!account.isCurrent ? <>
            <button disabled={busy} onClick={() => open("reset", account)} type="button">重置密码</button>
            <button disabled={busy} onClick={() => open("status", account)} type="button">{account.isActive ? "停用" : "启用"}</button>
            <button className="admin-account-delete" disabled={busy} onClick={() => open("delete", account)} type="button">删除</button>
          </> : <small>密码请在个人菜单修改</small>}
        </div> : <span className="admin-account-lock">{account.isCurrent ? "受保护 · 密码请在个人菜单修改" : "受保护 · 无法操作"}</span>}</td>
      </tr>)}</tbody>
    </table></div>
    {mode ? <WorkspaceDialog title={title} onClose={close} busy={busy} className="admin-account-dialog" footer={<button className={`admin-button${mode === "delete" ? " admin-account-danger-button" : ""}`} form="admin-account-form" disabled={busy || ((mode === "create" || mode === "edit") && !roles.length) || (mode === "delete" && confirmUsername !== editing?.username)} type="submit">{busy ? "处理中…" : submitLabel}</button>}>
      <form id="admin-account-form" className="admin-form admin-account-form" onSubmit={submit}>
        {editing ? <div className="admin-account-dialog-identity"><strong>{editing.displayName}</strong><span>{editing.username}</span></div> : null}
        {mode === "create" ? <>
          <label><span>姓名</span><input maxLength={80} name="displayName" required /></label>
          <label><span>登录账号</span><input autoCapitalize="none" autoComplete="off" maxLength={64} minLength={3} pattern="[a-zA-Z0-9._-]{3,64}" name="username" required /><small>3–64 位字母、数字、点、下划线或连字符</small></label>
          <label><span>初始密码</span><input autoComplete="new-password" minLength={12} maxLength={256} name="password" required type="password" /><small>至少 12 个字符，首次登录须修改。</small></label>
        </> : null}
        {mode === "create" || mode === "edit" ? <RoleSelector onChange={setRoles} roles={roles} /> : null}
        {mode === "reset" ? <>
          <p className="admin-account-notice">重置后，所有已登录会话立即失效。请将新的初始密码告知本人，下次登录必须修改密码。</p>
          <label><span>新的初始密码</span><input autoComplete="new-password" minLength={12} maxLength={256} name="password" required type="password" /></label>
          <label><span>再次输入密码</span><input autoComplete="new-password" minLength={12} maxLength={256} name="confirmPassword" required type="password" /></label>
        </> : null}
        {mode === "delete" ? <>
          <p className="admin-account-notice admin-account-danger-notice">删除后，该账号无法再登录，所有会话与角色授权会被清除。已有新闻、赛事、选派记录和操作日志将保留。此操作无法撤销。</p>
          <label><span>输入账号 {editing?.username} 确认删除</span><input autoComplete="off" value={confirmUsername} onChange={(event) => setConfirmUsername(event.target.value)} required /></label>
        </> : null}
        {mode === "status" ? <p className="admin-account-notice">{editing?.isActive ? "停用后，该账号无法登录，所有已登录会话立即失效。账号及业务历史仍会保留，可随时重新启用。" : "启用后，该管理员可使用原有账号密码登录，角色权限保持不变。"}</p> : null}
        {error ? <p role="alert" className="admin-account-error">{error}</p> : null}
      </form>
    </WorkspaceDialog> : null}
  </div>;
}
