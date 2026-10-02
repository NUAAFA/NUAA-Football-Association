import { AdminAccountsManager } from "@/components/admin/admin-accounts-manager";
import { AdminPageHeader, AdminPanel } from "@/components/referees/admin/admin-ui";
import { formatRefereeDateTime } from "@/lib/referee-presenters";
import { listUnifiedAdminAccounts } from "@/lib/unified-admin-account-service";
import { guardUnifiedAdminPage } from "@/lib/unified-admin-page";

export default async function UnifiedSystemAdminsPage() {
  const actor = await guardUnifiedAdminPage("system:read", "system");
  const accounts = await listUnifiedAdminAccounts(actor);
  return <>
    <AdminPageHeader eyebrow="SYSTEM · ADMIN ACCOUNTS" title="管理员账号" description="按职责分配权限，管理账号状态与密码。最高管理员 nuaafa 始终受保护。" />
    <AdminPanel title={`管理员列表 · ${accounts.length}`} description="超级管理员可管理其他账号；最高管理员的身份与管理权限不可转让。">
      <AdminAccountsManager accounts={accounts.map((account) => ({
        id: account.id,
        username: account.username,
        displayName: account.displayName,
        roles: account.roles,
        isProtected: account.isProtected,
        canManage: account.canManage,
        isCurrent: account.isCurrent,
        isActive: account.isActive,
        lastLoginAt: account.lastLoginAt ? formatRefereeDateTime(account.lastLoginAt) : "",
      }))} />
    </AdminPanel>
  </>;
}
