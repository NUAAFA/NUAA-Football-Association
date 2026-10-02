import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { UnifiedAdminShell } from "@/components/admin/unified-admin-shell";
import { isProtectedAdminAccount } from "@/lib/admin-account-protection";
import { getAdminSession } from "@/lib/referee-auth";
import {
  getUnifiedAdminActor,
  hasUnifiedAdminPermission,
  isUnifiedAdminPasswordChangeRequired,
  unifiedAdminRoleLabels,
} from "@/lib/unified-admin-rbac";
import "@/styles/referee-admin.css";

export const metadata: Metadata = {
  title: { default: "NUAAFA 管理后台", template: "%s | NUAAFA 管理后台" },
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function UnifiedAdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();
  const actor = await getUnifiedAdminActor(session);
  if (!session || !actor) redirect("/admin/login?next=/admin");
  const passwordChangeRequired = isUnifiedAdminPasswordChangeRequired(session);
  const allowedModules = passwordChangeRequired
    ? []
    : [
        hasUnifiedAdminPermission(actor.roles, "content:read") || hasUnifiedAdminPermission(actor.roles, "media:read") ? "content" : null,
        hasUnifiedAdminPermission(actor.roles, "competitions:read") ? "competitions" : null,
        hasUnifiedAdminPermission(actor.roles, "referees:read") ? "referees" : null,
        hasUnifiedAdminPermission(actor.roles, "system:read") ? "system" : null,
      ].filter((item): item is UnifiedAdminModule => Boolean(item));

  return (
    <UnifiedAdminShell
      actorName={actor.displayName}
      allowedModules={allowedModules}
      isLegacy={actor.isLegacy}
      mustChangePassword={passwordChangeRequired}
      roleLabels={session.adminAccount && isProtectedAdminAccount(session.adminAccount) ? ["最高管理员"] : actor.roles.map((role) => unifiedAdminRoleLabels[role])}
    >
      {passwordChangeRequired ? null : children}
    </UnifiedAdminShell>
  );
}

type UnifiedAdminModule = "content" | "competitions" | "referees" | "system";
