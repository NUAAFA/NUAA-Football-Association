import type { UnifiedAdminRole } from "@/generated/prisma-v29/client";

import { prisma } from "@/lib/prisma";
import { assertAdminAccountMutable, assertAdminUsernameAvailable, isProtectedAdminAccount } from "@/lib/admin-account-protection";
import { hashPassword } from "@/lib/referee-security";
import { RefereeServiceError } from "@/lib/referee-service-error";
import {
  requireAdminServiceAuthorization,
  type AdminServiceAuthorization,
} from "@/lib/privileged-service-authorization";
import {
  assertUnifiedAdminPermission,
  normalizeUnifiedAdminRoles,
  resolveUnifiedAdminRoles,
  unifiedAdminRoleOrder,
  type UnifiedAdminActor,
} from "@/lib/unified-admin-rbac";

const accountSelect = {
  id: true,
  username: true,
  displayName: true,
  role: true,
  isActive: true,
  mustChangePassword: true,
  lastLoginAt: true,
  unifiedRoles: { select: { role: true }, orderBy: { role: "asc" as const } },
};

function assertRoles(roles: readonly UnifiedAdminRole[]) {
  if (!roles.length) throw new RefereeServiceError("请至少选择一个管理员角色。");
  if (roles.some((role) => !unifiedAdminRoleOrder.includes(role))) {
    throw new RefereeServiceError("管理员角色无效。");
  }
  return normalizeUnifiedAdminRoles(roles);
}

function legacyRoleFor(roles: readonly UnifiedAdminRole[]) {
  return roles.includes("SUPER_ADMIN") ? "SUPER_ADMIN" as const : "REFEREE_MANAGER" as const;
}

function effectiveRoles(account: {
  username: string;
  role: "SUPER_ADMIN" | "REFEREE_MANAGER";
  unifiedRoles: Array<{ role: UnifiedAdminRole }>;
}) {
  return resolveUnifiedAdminRoles({
    username: account.username,
    explicitRoles: account.unifiedRoles.map(({ role }) => role),
    legacyRole: account.role,
  });
}

function safeMetadata(input: {
  accountId: string;
  username: string;
  roles?: readonly UnifiedAdminRole[];
  previousRoles?: readonly UnifiedAdminRole[];
  isActive?: boolean;
  previousIsActive?: boolean;
}) {
  return JSON.stringify(input);
}

export async function listUnifiedAdminAccounts(actor: UnifiedAdminActor) {
  assertUnifiedAdminPermission(actor, "system:read");
  const accounts = await prisma.adminAccount.findMany({
    select: accountSelect,
    orderBy: { username: "asc" },
  });
  return accounts.sort((a, b) => Number(isProtectedAdminAccount(b)) - Number(isProtectedAdminAccount(a))).map((account) => ({
    ...account,
    roles: effectiveRoles(account),
    isProtected: isProtectedAdminAccount(account),
    canManage: !isProtectedAdminAccount(account),
    isCurrent: actor.id === account.id,
  }));
}

export async function createUnifiedAdminAccount(input: {
  username: string;
  displayName: string;
  password: string;
  roles: readonly UnifiedAdminRole[];
}, authorization: AdminServiceAuthorization<"system:write">) {
  const actor = requireAdminServiceAuthorization(authorization, "system:write");
  const username = input.username.trim().toLowerCase();
  assertAdminUsernameAvailable(username);
  const displayName = input.displayName.trim();
  const roles = assertRoles(input.roles);
  if (!/^[a-z0-9._-]{3,64}$/.test(username)) {
    throw new RefereeServiceError("管理员账号须为 3 至 64 位字母、数字、点、下划线或连字符。");
  }
  if (!displayName || displayName.length > 80) throw new RefereeServiceError("管理员姓名格式不正确。");
  if (input.password.length < 12) throw new RefereeServiceError("管理员初始密码不能少于 12 个字符。");
  const passwordHash = await hashPassword(input.password);

  try {
    return await prisma.$transaction(async (tx) => {
      const account = await tx.adminAccount.create({
        data: {
          username,
          displayName,
          passwordHash,
          role: legacyRoleFor(roles),
          mustChangePassword: true,
          unifiedRoles: { create: roles.map((role) => ({ role })) },
        },
        select: accountSelect,
      });
      await tx.auditLog.create({
        data: {
          actorType: "ADMIN",
          actorId: actor.id,
          action: "ADMIN_ACCOUNT_CREATED",
          entityType: "AdminAccount",
          entityId: account.id,
          summary: `创建管理员账号 ${account.username}`,
          metadata: safeMetadata({ accountId: account.id, username: account.username, roles, isActive: true }),
        },
      });
      return { ...account, roles };
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      throw new RefereeServiceError("管理员账号已存在。", 409);
    }
    throw error;
  }
}

export async function updateUnifiedAdminAccount(input: {
  id: string;
  roles?: readonly UnifiedAdminRole[];
  isActive?: boolean;
}, authorization: AdminServiceAuthorization<"system:write">) {
  const actor = requireAdminServiceAuthorization(authorization, "system:write");
  if (input.roles === undefined && input.isActive === undefined) {
    throw new RefereeServiceError("没有需要更新的管理员账号内容。");
  }
  const normalizedRoles = input.roles === undefined ? undefined : assertRoles(input.roles);

  return prisma.$transaction(async (tx) => {
    const accounts = await tx.adminAccount.findMany({
      select: accountSelect,
      orderBy: { username: "asc" },
    });
    const current = accounts.find((account) => account.id === input.id);
    if (!current) throw new RefereeServiceError("管理员账号不存在。", 404);
    assertAdminAccountMutable(current);
    if (actor.id === current.id && input.isActive === false) {
      throw new RefereeServiceError("不能停用当前登录账号。");
    }

    const previousRoles = effectiveRoles(current);
    const nextRoles = normalizedRoles ?? previousRoles;
    const nextIsActive = input.isActive ?? current.isActive;
    const activeSuperAdmins = accounts.filter((account) => {
      const isTarget = account.id === current.id;
      const isActive = isTarget ? nextIsActive : account.isActive;
      const roles = isTarget ? nextRoles : effectiveRoles(account);
      return isActive && roles.includes("SUPER_ADMIN");
    });
    if (!activeSuperAdmins.length) {
      throw new RefereeServiceError("系统必须保留至少一个已启用的超级管理员。", 409);
    }

    if (normalizedRoles) {
      await tx.adminRoleAssignment.deleteMany({ where: { adminAccountId: current.id } });
      await tx.adminRoleAssignment.createMany({
        data: normalizedRoles.map((role) => ({ adminAccountId: current.id, role })),
      });
    }
    const account = await tx.adminAccount.update({
      where: { id: current.id },
      data: {
        ...(normalizedRoles ? { role: legacyRoleFor(normalizedRoles) } : {}),
        ...(input.isActive === undefined ? {} : {
          isActive: input.isActive,
          ...(!input.isActive ? { sessions: { deleteMany: {} } } : {}),
        }),
      },
      select: accountSelect,
    });

    if (normalizedRoles) {
      await tx.auditLog.create({
        data: {
          actorType: "ADMIN",
          actorId: actor.id,
          action: "ADMIN_ROLE_ASSIGNMENTS_UPDATED",
          entityType: "AdminAccount",
          entityId: account.id,
          summary: `更新管理员账号 ${account.username} 的角色`,
          metadata: safeMetadata({
            accountId: account.id,
            username: account.username,
            previousRoles,
            roles: normalizedRoles,
            isActive: nextIsActive,
          }),
        },
      });
    }
    if (input.isActive !== undefined && input.isActive !== current.isActive) {
      await tx.auditLog.create({
        data: {
          actorType: "ADMIN",
          actorId: actor.id,
          action: "ADMIN_ACCOUNT_STATUS_UPDATED",
          entityType: "AdminAccount",
          entityId: account.id,
          summary: `${input.isActive ? "启用" : "停用"}管理员账号 ${account.username}`,
          metadata: safeMetadata({
            accountId: account.id,
            username: account.username,
            roles: nextRoles,
            previousIsActive: current.isActive,
            isActive: input.isActive,
          }),
        },
      });
    }
    return { ...account, roles: nextRoles };
  });
}

export async function resetUnifiedAdminPassword(input: {
  id: string;
  password: string;
}, authorization: AdminServiceAuthorization<"system:write">) {
  const actor = requireAdminServiceAuthorization(authorization, "system:write");
  if (input.password.length < 12 || input.password.length > 256) {
    throw new RefereeServiceError("管理员初始密码须为 12 至 256 个字符。");
  }
  const passwordHash = await hashPassword(input.password);
  await prisma.$transaction(async (tx) => {
    const account = await tx.adminAccount.findUnique({ where: { id: input.id }, select: accountSelect });
    if (!account) throw new RefereeServiceError("管理员账号不存在。", 404);
    assertAdminAccountMutable(account);
    if (actor.id === account.id) throw new RefereeServiceError("请通过个人菜单修改自己的密码。");
    await tx.adminSession.deleteMany({ where: { adminAccountId: account.id } });
    await tx.adminAccount.update({ where: { id: account.id }, data: { passwordHash, mustChangePassword: true } });
    await tx.auditLog.create({ data: {
      actorType: "ADMIN", actorId: actor.id, action: "ADMIN_PASSWORD_RESET",
      entityType: "AdminAccount", entityId: account.id,
      summary: `重置管理员账号 ${account.username} 的密码`,
      metadata: safeMetadata({ accountId: account.id, username: account.username }),
    } });
  });
}

export async function deleteUnifiedAdminAccount(input: {
  id: string;
  confirmUsername: string;
}, authorization: AdminServiceAuthorization<"system:write">) {
  const actor = requireAdminServiceAuthorization(authorization, "system:write");
  await prisma.$transaction(async (tx) => {
    const accounts = await tx.adminAccount.findMany({ select: accountSelect });
    const account = accounts.find(({ id }) => id === input.id);
    if (!account) throw new RefereeServiceError("管理员账号不存在。", 404);
    assertAdminAccountMutable(account);
    if (actor.id === account.id) throw new RefereeServiceError("不能删除当前登录账号。");
    if (input.confirmUsername !== account.username) throw new RefereeServiceError("请输入要删除的完整账号以确认。");
    if (!accounts.some((other) => other.id !== account.id && other.isActive && effectiveRoles(other).includes("SUPER_ADMIN"))) {
      throw new RefereeServiceError("系统必须保留至少一个已启用的超级管理员。", 409);
    }
    // Delete sessions first: the legacy nullable FK must never turn a deleted
    // named account's session into a privileged synthetic legacy session.
    await tx.adminSession.deleteMany({ where: { adminAccountId: account.id } });
    await tx.adminAccount.delete({ where: { id: account.id } });
    await tx.auditLog.create({ data: {
      actorType: "ADMIN", actorId: actor.id, action: "ADMIN_ACCOUNT_DELETED",
      entityType: "AdminAccount", entityId: account.id,
      summary: `删除管理员账号 ${account.username}（${account.displayName}），保留业务历史`,
      metadata: safeMetadata({ accountId: account.id, username: account.username, roles: effectiveRoles(account), isActive: account.isActive }),
    } });
  });
}
