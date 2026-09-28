"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { activeAdminHref } from "@/lib/admin-navigation";

type UnifiedAdminModule = "content" | "competitions" | "referees" | "system";

const navigationGroups: Array<{
  label: string;
  module?: UnifiedAdminModule;
  items: Array<{ href: string; label: string; english: string; exact?: boolean }>;
}> = [
  { label: "工作台", items: [{ href: "/admin", label: "概览", english: "Overview", exact: true }] },
  {
    label: "内容运营",
    module: "content",
    items: [
      { href: "/admin/content/news", label: "新闻公告", english: "News & Notices" },
      { href: "/admin/media", label: "媒体与附件", english: "Media Assets" },
    ],
  },
  {
    label: "赛事中心",
    module: "competitions",
    items: [
      { href: "/admin/competitions", label: "赛事管理", english: "Competitions" },
      { href: "/admin/competitions/import", label: "批量导入", english: "Import" },
      { href: "/admin/matches", label: "比赛管理", english: "Matches" },
      { href: "/admin/organizations", label: "组织与球队", english: "Organizations" },
      { href: "/admin/team-directory", label: "公开组队目录", english: "Team Directory" },
    ],
  },
  {
    label: "裁判中心",
    module: "referees",
    items: [
      { href: "/admin/referees", label: "裁判员", english: "Referees" },
      { href: "/admin/referees/admissions", label: "准入申请", english: "Admissions" },
      { href: "/admin/referees/availability", label: "可执裁时间", english: "Availability" },
      { href: "/admin/appointments", label: "选派管理", english: "Appointments" },
      { href: "/admin/conflicts", label: "冲突报告", english: "Conflicts" },
      { href: "/admin/statistics", label: "执裁统计", english: "Statistics" },
    ],
  },
  {
    label: "系统管理",
    module: "system",
    items: [
      { href: "/admin/system/admins", label: "管理员账号", english: "Administrators" },
      { href: "/admin/system/audit", label: "操作日志", english: "Audit Log" },
    ],
  },
];



async function api(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(result.error ?? "操作失败。");
}

export function UnifiedAdminShell({
  children,
  actorName,
  roleLabels,
  allowedModules,
  isLegacy,
  mustChangePassword,
}: {
  children: React.ReactNode;
  actorName: string;
  roleLabels: string[];
  allowedModules: UnifiedAdminModule[];
  isLegacy: boolean;
  mustChangePassword: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const activeHref = activeAdminHref(pathname, navigationGroups.filter((group) => !group.module || allowedModules.includes(group.module)).flatMap((group) => group.items));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(mustChangePassword);
  const [message, setMessage] = useState("");

  async function logout() {
    await api("/api/referees/admin/logout", "POST");
    router.replace("/admin/login");
    router.refresh();
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const newPassword = String(form.get("newPassword") ?? "");
    if (newPassword !== String(form.get("confirmation") ?? "")) {
      setMessage("两次输入的新密码不一致。");
      return;
    }
    setMessage("");
    try {
      await api("/api/referees/admin/account/password", "POST", {
        currentPassword: form.get("currentPassword"),
        newPassword,
      });
      setMessage("密码已更新，其他管理员会话已退出。");
      formElement.reset();
      setPasswordOpen(false);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "密码修改失败。");
    }
  }

  return (
    <div className="admin-shell">
      <aside className={`admin-sidebar${mobileOpen ? " is-open" : ""}`}>
        <div className="admin-brand">
          <span>NUAAFA</span>
          <strong>统一管理后台</strong>
          <small>V2.9 · Operations</small>
        </div>
        <nav aria-label="统一管理后台导航" className="admin-navigation">
          {mustChangePassword ? (
            <div className="admin-nav-group">
              <span className="admin-nav-label">账号安全</span>
            </div>
          ) : navigationGroups.map((group) => {
            if (group.module && !allowedModules.includes(group.module)) return null;
            return (
              <div className="admin-nav-group" key={group.label}>
                <span className="admin-nav-label">{group.label}</span>
                {group.items.map((item) => (
                  <Link
                    aria-current={activeHref === item.href ? "page" : undefined}
                    href={item.href}
                    key={item.href}
                    onClick={() => setMobileOpen(false)}
                  >
                    <i aria-hidden="true" />
                    <span><strong>{item.label}</strong><small>{item.english}</small></span>
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>
        <Link className="admin-back-link" href="/">← 返回 NUAAFA 官网</Link>
      </aside>
      {mobileOpen ? <button aria-label="关闭后台导航" className="admin-sidebar-scrim" onClick={() => setMobileOpen(false)} type="button" /> : null}
      <div className="admin-main">
        <header className="admin-topbar">
          <button aria-label="打开后台导航" className="admin-menu-button" onClick={() => setMobileOpen(true)} type="button">☰</button>
          <div className="admin-topbar-title"><strong>NUAAFA 管理后台</strong><span>统一运营工作台</span></div>
          <div className="admin-account-area">
            <button className="admin-account-trigger" onClick={() => setAccountOpen((current) => !current)} type="button">
              <span>{actorName.slice(0, 1)}</span>
              <div><strong>{actorName}</strong><small>{roleLabels.join(" / ") || "未授权"}</small></div>
              <b aria-hidden="true">⌄</b>
            </button>
            {accountOpen ? <div className="admin-account-menu">
              <strong>{actorName}</strong><span>{roleLabels.join(" / ")}{isLegacy ? " · 兼容登录" : ""}</span>
              {!isLegacy ? <button onClick={() => { setPasswordOpen(true); setAccountOpen(false); }} type="button">修改个人密码</button> : null}
              {!mustChangePassword && allowedModules.includes("system") ? <Link href="/admin/system/admins" onClick={() => setAccountOpen(false)}>管理员账号</Link> : null}
              <button onClick={logout} type="button">退出后台</button>
            </div> : null}
          </div>
        </header>
        {mustChangePassword ? <button className="admin-password-alert" onClick={() => setPasswordOpen(true)} type="button">当前账号须完成首次密码修改 →</button> : null}
        <main className="admin-content" id="main-content">
          {mustChangePassword ? (
            <section className="admin-panel" role="status">
              <header className="admin-panel-header">
                <div><h2>首次登录需要修改密码</h2><p>完成账号安全验证后，系统才会开放已授权的后台功能。</p></div>
              </header>
              <div className="admin-empty-state"><strong>{actorName}</strong><p>{roleLabels.join(" / ")}</p></div>
            </section>
          ) : children}
        </main>
      </div>
      {passwordOpen && !isLegacy ? <div aria-modal="true" className="admin-modal-backdrop" role="dialog">
        <div className="admin-modal admin-modal-compact">
          <header><div><span>ACCOUNT SECURITY</span><h2>{mustChangePassword ? "完成首次密码修改" : "修改个人密码"}</h2></div>{!mustChangePassword ? <button aria-label="关闭" onClick={() => setPasswordOpen(false)} type="button">×</button> : null}</header>
          <form className="admin-form" onSubmit={changePassword}>
            {mustChangePassword ? <p className="admin-form-message">修改成功前不能使用后台业务功能。你也可以安全退出登录。</p> : null}
            <label><span>当前密码</span><input autoComplete="current-password" name="currentPassword" required type="password" /></label>
            <label><span>新密码</span><input autoComplete="new-password" minLength={12} name="newPassword" required type="password" /></label>
            <label><span>再次输入新密码</span><input autoComplete="new-password" minLength={12} name="confirmation" required type="password" /></label>
            <p aria-live="polite" className="admin-form-message">{message}</p>
            <footer>{mustChangePassword ? <button className="admin-button admin-button-secondary" onClick={logout} type="button">退出登录</button> : <button className="admin-button admin-button-secondary" onClick={() => setPasswordOpen(false)} type="button">取消</button>}<button className="admin-button" type="submit">保存新密码</button></footer>
          </form>
        </div>
      </div> : null}
    </div>
  );
}
