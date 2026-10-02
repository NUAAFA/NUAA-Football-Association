import type { UnifiedAdminRole } from "@/generated/prisma-v29/client";
import { prisma } from "@/lib/prisma";
import { protectedAdminUsername } from "@/lib/admin-account-protection";
import { getAdminActor, getAdminSession } from "@/lib/referee-auth";

export type UnifiedAdminPermission =
  | "dashboard:read"
  | "content:read"
  | "content:write"
  | "media:read"
  | "media:write"
  | "competitions:read"
  | "competitions:write"
  | "referees:read"
  | "referees:write"
  | "system:read"
  | "system:write";

export type UnifiedAdminActor = {
  id: string | null;
  displayName: string;
  isLegacy: boolean;
  roles: UnifiedAdminRole[];
};

export const unifiedAdminPasswordChangeRequiredCode = "ADMIN_PASSWORD_CHANGE_REQUIRED" as const;

export const allUnifiedAdminPermissions = [
  "dashboard:read",
  "content:read",
  "content:write",
  "media:read",
  "media:write",
  "competitions:read",
  "competitions:write",
  "referees:read",
  "referees:write",
  "system:read",
  "system:write",
] as const satisfies readonly UnifiedAdminPermission[];

export const unifiedAdminPermissionsByRole: Record<
  UnifiedAdminRole,
  readonly UnifiedAdminPermission[]
> = {
  SUPER_ADMIN: allUnifiedAdminPermissions,
  CONTENT_EDITOR: [
    "dashboard:read",
    "content:read",
    "content:write",
    "media:read",
    "media:write",
  ],
  COMPETITION_ADMIN: ["dashboard:read", "competitions:read", "competitions:write"],
  REFEREE_ADMIN: ["dashboard:read", "referees:read", "referees:write"],
};

export const unifiedAdminRoleLabels: Record<UnifiedAdminRole, string> = {
  SUPER_ADMIN: "超级管理员",
  CONTENT_EDITOR: "内容运营",
  COMPETITION_ADMIN: "赛事管理员",
  REFEREE_ADMIN: "裁判管理员",
};

export class UnifiedAdminAccessError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
    readonly code?: typeof unifiedAdminPasswordChangeRequiredCode,
  ) {
    super(message);
    this.name = "UnifiedAdminAccessError";
  }
}

export function isUnifiedAdminPasswordChangeRequired(
  session: Awaited<ReturnType<typeof getAdminSession>>,
) {
  return session?.adminAccount?.mustChangePassword === true;
}

export function assertUnifiedAdminPasswordChangeCompleted(
  session: Awaited<ReturnType<typeof getAdminSession>>,
) {
  if (isUnifiedAdminPasswordChangeRequired(session)) {
    throw new UnifiedAdminAccessError(
      "请先修改管理员初始密码。",
      403,
      unifiedAdminPasswordChangeRequiredCode,
    );
  }
}

export function resolveUnifiedAdminRoles(input: {
  explicitRoles: readonly UnifiedAdminRole[];
  legacyRole?: "SUPER_ADMIN" | "REFEREE_MANAGER";
  isLegacy?: boolean;
  username?: string;
}) {
  if (input.username === protectedAdminUsername) return ["SUPER_ADMIN"] satisfies UnifiedAdminRole[];
  if (input.isLegacy) return ["SUPER_ADMIN"] satisfies UnifiedAdminRole[];
  if (input.explicitRoles.includes("SUPER_ADMIN")) {
    return ["SUPER_ADMIN"] satisfies UnifiedAdminRole[];
  }
  if (input.explicitRoles.length) {
    return unifiedAdminRoleOrder.filter((role) => input.explicitRoles.includes(role));
  }
  if (input.legacyRole === "SUPER_ADMIN") return ["SUPER_ADMIN"] satisfies UnifiedAdminRole[];
  if (input.legacyRole === "REFEREE_MANAGER") {
    return ["REFEREE_ADMIN"] satisfies UnifiedAdminRole[];
  }
  return [] satisfies UnifiedAdminRole[];
}

export const unifiedAdminRoleOrder = [
  "SUPER_ADMIN",
  "CONTENT_EDITOR",
  "COMPETITION_ADMIN",
  "REFEREE_ADMIN",
] as const satisfies readonly UnifiedAdminRole[];

export function normalizeUnifiedAdminRoles(roles: readonly UnifiedAdminRole[]) {
  return resolveUnifiedAdminRoles({ explicitRoles: roles });
}

export function hasUnifiedAdminPermission(
  roles: readonly UnifiedAdminRole[],
  permission: UnifiedAdminPermission,
) {
  return roles.some((role) => unifiedAdminPermissionsByRole[role].includes(permission));
}

export function assertUnifiedAdminPermission(
  actor: UnifiedAdminActor,
  permission: UnifiedAdminPermission,
) {
  if (!hasUnifiedAdminPermission(actor.roles, permission)) {
    throw new UnifiedAdminAccessError("当前管理员没有执行此操作的权限。", 403);
  }
}

export async function getUnifiedAdminActor(
  session?: Awaited<ReturnType<typeof getAdminSession>>,
): Promise<UnifiedAdminActor | null> {
  const currentSession = session === undefined ? await getAdminSession() : session;
  const legacyActor = getAdminActor(currentSession);
  if (!currentSession || !legacyActor) return null;

  const assignments = currentSession.adminAccountId
    ? await prisma.adminRoleAssignment.findMany({
        where: { adminAccountId: currentSession.adminAccountId },
        select: { role: true },
        orderBy: { role: "asc" },
      })
    : [];

  return {
    id: legacyActor.id,
    displayName: legacyActor.displayName,
    isLegacy: legacyActor.isLegacy,
    roles: resolveUnifiedAdminRoles({
      explicitRoles: assignments.map(({ role }) => role),
      legacyRole: legacyActor.role,
      isLegacy: legacyActor.isLegacy,
      username: currentSession.adminAccount?.username,
    }),
  };
}

export async function requireUnifiedAdminActor(permission?: UnifiedAdminPermission) {
  const session = await getAdminSession();
  if (!session) throw new UnifiedAdminAccessError("请先登录管理员后台。", 401);
  assertUnifiedAdminPasswordChangeCompleted(session);
  const actor = await getUnifiedAdminActor(session);
  if (!actor) throw new UnifiedAdminAccessError("请先登录管理员后台。", 401);
  if (permission) assertUnifiedAdminPermission(actor, permission);
  return actor;
}
