import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@libsql/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../src/generated/prisma-v29/client";
import type { UnifiedAdminActor } from "../src/lib/unified-admin-rbac";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function rejects(action: () => unknown | Promise<unknown>, expected: string) {
  try {
    await action();
  } catch (error) {
    assert(error instanceof Error && error.message.includes(expected), `Expected rejection containing ${expected}.`);
    return;
  }
  throw new Error(`Expected rejection containing ${expected}.`);
}

async function applyMigrations(url: string) {
  const client = createClient({ url });
  const entries = (await readdir(path.resolve("prisma/migrations"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    await client.executeMultiple(await readFile(path.resolve("prisma/migrations", entry.name, "migration.sql"), "utf8"));
  }
  client.close();
}

async function main() {
  const databasePath = process.env.UNIFIED_ADMIN_RBAC_DATABASE_PATH;
  if (!databasePath) throw new Error("UNIFIED_ADMIN_RBAC_DATABASE_PATH is required.");
  const url = `file:${databasePath.replaceAll("\\", "/")}`;
  process.env.DATABASE_URL = url;
  process.env.REFEREE_ADMIN_SESSION_SECRET = "unified-admin-rbac-test-secret-2026";
  process.env.NUAAFA_ISOLATED_SECURITY_TEST = "1";
  await applyMigrations(url);

  const verifier = new PrismaClient({ adapter: new PrismaLibSql({ url }) });
  const { hashPassword, verifyPassword } = await import("../src/lib/referee-security");
  const rbac = await import("../src/lib/unified-admin-rbac");
  const routing = await import("../src/lib/unified-admin-routing");
  const legacyRoutes = await import("../src/lib/unified-admin-legacy-routes");
  const accounts = await import("../src/lib/unified-admin-account-service");
  const refereeR1Service = await import("../src/lib/referee-r1-service");
  const capabilities = await import("./security-r4a-test-capabilities");
  const { prisma } = await import("../src/lib/prisma");

  try {
    const passwordHash = await hashPassword("Legacy-Super-Password-2026!");
    const legacySuper = await verifier.adminAccount.create({
      data: { username: "legacy-super", displayName: "现有实名管理员", passwordHash, role: "SUPER_ADMIN" },
    });
    const superActor: UnifiedAdminActor = {
      id: "service-test-super",
      displayName: "服务测试超级管理员",
      isLegacy: false,
      roles: ["SUPER_ADMIN"],
    };
    const systemAuthorization = capabilities.issueTestAdminServiceAuthorization(
      "system:write",
      superActor,
    );

    assert(rbac.resolveUnifiedAdminRoles({ explicitRoles: [], legacyRole: "SUPER_ADMIN" }).join() === "SUPER_ADMIN", "Legacy SUPER_ADMIN fallback failed.");
    assert(rbac.resolveUnifiedAdminRoles({ explicitRoles: ["SUPER_ADMIN", "CONTENT_EDITOR"] }).join() === "SUPER_ADMIN", "SUPER_ADMIN was not normalized.");
    assert(!rbac.hasUnifiedAdminPermission(["CONTENT_EDITOR"], "competitions:read"), "CONTENT_EDITOR retained competition operations.");
    assert(!rbac.hasUnifiedAdminPermission(["CONTENT_EDITOR"], "referees:read"), "CONTENT_EDITOR retained referee operations.");
    assert(!rbac.hasUnifiedAdminPermission(["REFEREE_ADMIN"], "competitions:read"), "REFEREE_ADMIN retained competition management.");
    assert(!rbac.hasUnifiedAdminPermission(["COMPETITION_ADMIN"], "referees:read"), "COMPETITION_ADMIN retained referee management.");
    const combined = rbac.resolveUnifiedAdminRoles({ explicitRoles: ["COMPETITION_ADMIN", "REFEREE_ADMIN"] });
    assert(rbac.hasUnifiedAdminPermission(combined, "competitions:write") && rbac.hasUnifiedAdminPermission(combined, "referees:write"), "Combined roles did not union permissions.");
    assert(!rbac.hasUnifiedAdminPermission(combined, "content:read") && !rbac.hasUnifiedAdminPermission(combined, "system:read"), "Combined roles gained content/system access.");
    assert(
      rbac.isUnifiedAdminPasswordChangeRequired({ adminAccount: { mustChangePassword: true } } as never),
      "Persistent required-change session was not detected.",
    );
    assert(
      !rbac.isUnifiedAdminPasswordChangeRequired({ adminAccount: null } as never),
      "Synthetic legacy administrator was incorrectly marked as password-change-required.",
    );

    assert(routing.getUnifiedAdminDefaultLanding(["SUPER_ADMIN"]) === "/admin", "SUPER_ADMIN landing mismatch.");
    assert(routing.getUnifiedAdminDefaultLanding(["CONTENT_EDITOR"]) === "/admin/content/news", "CONTENT_EDITOR landing mismatch.");
    assert(routing.getUnifiedAdminDefaultLanding(["COMPETITION_ADMIN"]) === "/admin/competitions", "COMPETITION_ADMIN landing mismatch.");
    assert(routing.getUnifiedAdminDefaultLanding(["REFEREE_ADMIN"]) === "/admin/referees", "REFEREE_ADMIN landing mismatch.");
    assert(routing.getUnifiedAdminDefaultLanding(combined) === "/admin", "Multi-role landing mismatch.");
    assert(routing.getAuthorizedUnifiedAdminReturnTo("/admin/media", ["CONTENT_EDITOR"]) === "/admin/media", "Authorized next was rejected.");
    assert(routing.getAuthorizedUnifiedAdminReturnTo("/admin/competitions", ["CONTENT_EDITOR"]) === "/admin/content/news", "Unauthorized next was accepted.");
    assert(routing.getAuthorizedUnifiedAdminReturnTo("//evil.invalid", ["SUPER_ADMIN"]) === "/admin", "Open redirect was accepted.");
    assert(routing.getAuthorizedUnifiedAdminReturnTo("admin/media", ["SUPER_ADMIN"]) === "/admin", "Relative next was accepted.");
    assert(routing.getUnifiedAdminRoutePermission("/admin/referees/new") === "referees:write", "New referee route was not classified as a write page.");
    assert(legacyRoutes.mapLegacyAdminPathToUnified("/referees/admin/matches/match-1/edit?tab=core") === "/admin/matches/match-1/edit?tab=core", "Legacy match deep link mapping failed.");
    assert(legacyRoutes.mapLegacyAdminPathToUnified("/referees/admin/referees/ref-1") === "/admin/referees/ref-1", "Legacy referee deep link mapping failed.");
    assert(routing.resolveAuthorizedLegacyAdminDestination("/referees/admin", ["CONTENT_EDITOR"]) === "/admin/content/news", "Legacy root did not use the CONTENT_EDITOR landing.");
    assert(routing.resolveAuthorizedLegacyAdminDestination("/referees/admin", ["COMPETITION_ADMIN", "REFEREE_ADMIN"]) === "/admin", "Legacy multi-role root did not use the safe unified landing.");
    assert(routing.resolveAuthorizedLegacyAdminDestination("/referees/admin/matches", ["COMPETITION_ADMIN"]) === "/admin/matches", "Legacy matches did not preserve COMPETITION_ADMIN semantics.");
    assert(routing.resolveAuthorizedLegacyAdminDestination("/referees/admin/matches", ["REFEREE_ADMIN"]) === "/admin/appointments", "Legacy matches did not preserve REFEREE_ADMIN semantics.");
    assert(routing.resolveAuthorizedLegacyAdminDestination("/referees/admin/matches/competitions?view=legacy", ["COMPETITION_ADMIN"]) === "/admin/competitions?view=legacy", "Legacy competitions root was shadowed by the match-detail route.");
    assert(routing.resolveAuthorizedLegacyAdminDestination("/referees/admin/matches/match-1?tab=appointments", ["REFEREE_ADMIN"]) === "/admin/appointments/match-1?tab=appointments", "Legacy match detail did not preserve the referee appointment deep link.");
    assert(routing.resolveAuthorizedLegacyAdminDestination("/referees/admin/matches/match-1/edit", ["REFEREE_ADMIN"]) === null, "Legacy competition write deep link did not fail closed for REFEREE_ADMIN.");
    assert(routing.resolveAuthorizedLegacyAdminDestination("/referees/admin/referees/ref-1", ["CONTENT_EDITOR", "REFEREE_ADMIN"]) === "/admin/referees/ref-1", "Legacy referee deep link rejected an authorized multi-role actor.");

    const content = await accounts.createUnifiedAdminAccount({
      username: "content-owner",
      displayName: "宣传负责人",
      password: "Content-Password-2026!",
      roles: ["CONTENT_EDITOR"],
    }, systemAuthorization);
    assert(content.mustChangePassword && content.roles.join() === "CONTENT_EDITOR", "Single-role account creation failed.");
    const requiredPasswordAccount = await accounts.createUnifiedAdminAccount({
      username: "required-password-owner",
      displayName: "首次改密管理员",
      password: "Required-Password-2026!",
      roles: ["CONTENT_EDITOR"],
    }, systemAuthorization);
    const requiredPasswordAuthorization = capabilities.issueTestAdminServiceAuthorization(
      "dashboard:read",
      { ...superActor, id: requiredPasswordAccount.id, roles: ["CONTENT_EDITOR"] },
    );
    const currentRequiredSession = await verifier.adminSession.create({
      data: {
        tokenHash: "required-password-current-session",
        expiresAt: new Date(Date.now() + 60_000),
        adminAccountId: requiredPasswordAccount.id,
      },
    });
    const otherRequiredSession = await verifier.adminSession.create({
      data: {
        tokenHash: "required-password-other-session",
        expiresAt: new Date(Date.now() + 60_000),
        adminAccountId: requiredPasswordAccount.id,
      },
    });
    await rejects(() => refereeR1Service.changeAdminPassword({
      adminAccountId: requiredPasswordAccount.id,
      currentSessionId: currentRequiredSession.id,
      currentPassword: "Wrong-Password-2026!",
      newPassword: "Required-Password-New-2026!",
    }, requiredPasswordAuthorization), "当前管理员密码不正确");
    const afterFailedPasswordChange = await verifier.adminAccount.findUniqueOrThrow({
      where: { id: requiredPasswordAccount.id },
    });
    assert(
      afterFailedPasswordChange.mustChangePassword &&
      await verifier.adminSession.count({ where: { adminAccountId: requiredPasswordAccount.id } }) === 2,
      "Failed password change cleared the required flag or invalidated sessions.",
    );
    await rejects(() => refereeR1Service.changeAdminPassword({
      adminAccountId: requiredPasswordAccount.id,
      currentSessionId: currentRequiredSession.id,
      currentPassword: "Required-Password-2026!",
      newPassword: "Required-Password-2026!",
    }, requiredPasswordAuthorization), "新密码不能与当前密码相同");
    await refereeR1Service.changeAdminPassword({
      adminAccountId: requiredPasswordAccount.id,
      currentSessionId: currentRequiredSession.id,
      currentPassword: "Required-Password-2026!",
      newPassword: "Required-Password-New-2026!",
    }, requiredPasswordAuthorization);
    const afterSuccessfulPasswordChange = await verifier.adminAccount.findUniqueOrThrow({
      where: { id: requiredPasswordAccount.id },
    });
    assert(
      !afterSuccessfulPasswordChange.mustChangePassword &&
      await verifyPassword("Required-Password-New-2026!", afterSuccessfulPasswordChange.passwordHash) &&
      !await verifyPassword("Required-Password-2026!", afterSuccessfulPasswordChange.passwordHash),
      "Successful password change did not replace the hash or clear the required flag.",
    );
    assert(
      await verifier.adminSession.count({ where: { id: currentRequiredSession.id } }) === 1 &&
      await verifier.adminSession.count({ where: { id: otherRequiredSession.id } }) === 0,
      "Successful password change did not preserve only the current session.",
    );
    assert(
      await verifier.auditLog.count({
        where: {
          actorId: requiredPasswordAccount.id,
          action: "ADMIN_PASSWORD_CHANGED",
        },
      }) === 1,
      "Successful password change was not audited exactly once.",
    );
    const multi = await accounts.createUnifiedAdminAccount({
      username: "competition-director",
      displayName: "竞赛部部长",
      password: "Competition-Director-2026!",
      roles: ["COMPETITION_ADMIN", "REFEREE_ADMIN", "COMPETITION_ADMIN"],
    }, systemAuthorization);
    assert(multi.roles.join() === "COMPETITION_ADMIN,REFEREE_ADMIN", "Multi-role account creation/deduplication failed.");
    const explicitSuper = await accounts.createUnifiedAdminAccount({
      username: "explicit-super",
      displayName: "第二超级管理员",
      password: "Explicit-Super-Password-2026!",
      roles: ["SUPER_ADMIN", "CONTENT_EDITOR", "REFEREE_ADMIN"],
    }, systemAuthorization);
    assert(explicitSuper.roles.join() === "SUPER_ADMIN" && explicitSuper.unifiedRoles.length === 1, "SUPER_ADMIN persistence normalization failed.");
    await rejects(() => accounts.updateUnifiedAdminAccount(
      { id: explicitSuper.id, isActive: false },
      capabilities.issueTestAdminServiceAuthorization(
        "system:write",
        { ...superActor, id: explicitSuper.id },
      ),
    ), "不能停用当前登录账号");
    assert((await verifier.adminAccount.findUniqueOrThrow({ where: { id: explicitSuper.id } })).isActive, "Self-disable rejection changed account state.");

    const updated = await accounts.updateUnifiedAdminAccount({
      id: content.id,
      roles: ["COMPETITION_ADMIN", "REFEREE_ADMIN"],
    }, systemAuthorization);
    assert(updated.roles.join() === "COMPETITION_ADMIN,REFEREE_ADMIN", "Existing role assignment update failed.");
    await verifier.adminSession.create({
      data: {
        tokenHash: "ordinary-admin-session-proof",
        expiresAt: new Date(Date.now() + 60_000),
        adminAccountId: multi.id,
      },
    });
    await accounts.updateUnifiedAdminAccount({ id: multi.id, isActive: false }, systemAuthorization);
    assert(!(await verifier.adminAccount.findUniqueOrThrow({ where: { id: multi.id } })).isActive, "Ordinary admin disable failed.");
    assert(await verifier.adminSession.count({ where: { adminAccountId: multi.id } }) === 0, "Account disable did not invalidate sessions atomically.");
    await accounts.updateUnifiedAdminAccount({ id: multi.id, isActive: true }, systemAuthorization);
    assert((await verifier.adminAccount.findUniqueOrThrow({ where: { id: multi.id } })).isActive, "Ordinary admin re-enable failed.");

    await accounts.updateUnifiedAdminAccount({ id: legacySuper.id, roles: ["CONTENT_EDITOR"] }, systemAuthorization);
    const lastSuperBefore = await verifier.adminAccount.findUniqueOrThrow({
      where: { id: explicitSuper.id },
      include: { unifiedRoles: true },
    });
    const lastSuperAuditCount = await verifier.auditLog.count({ where: { entityId: explicitSuper.id } });
    await rejects(() => accounts.updateUnifiedAdminAccount({ id: explicitSuper.id, isActive: false }, systemAuthorization), "至少一个已启用的超级管理员");
    await rejects(() => accounts.updateUnifiedAdminAccount({ id: explicitSuper.id, roles: ["REFEREE_ADMIN"] }, systemAuthorization), "至少一个已启用的超级管理员");
    await rejects(() => accounts.updateUnifiedAdminAccount({ id: explicitSuper.id, roles: ["REFEREE_ADMIN"], isActive: false }, systemAuthorization), "至少一个已启用的超级管理员");
    const lastSuperAfter = await verifier.adminAccount.findUniqueOrThrow({
      where: { id: explicitSuper.id },
      include: { unifiedRoles: true },
    });
    assert(
      lastSuperAfter.isActive === lastSuperBefore.isActive &&
      lastSuperAfter.role === lastSuperBefore.role &&
      lastSuperAfter.unifiedRoles.map(({ role }) => role).join() === lastSuperBefore.unifiedRoles.map(({ role }) => role).join() &&
      await verifier.auditLog.count({ where: { entityId: explicitSuper.id } }) === lastSuperAuditCount,
      "Rejected last-SUPER_ADMIN mutations produced partial writes or audit rows.",
    );
    const owner = await verifier.adminAccount.create({
      data: { username: "nuaafa", displayName: "NUAAFA", passwordHash, role: "SUPER_ADMIN" },
    });
    const ownerActor: UnifiedAdminActor = { ...superActor, id: owner.id };
    const ownerAuthorization = capabilities.issueTestAdminServiceAuthorization("system:write", ownerActor);
    const delegateAuthorization = capabilities.issueTestAdminServiceAuthorization("system:write", { ...superActor, id: explicitSuper.id });
    const ownerBefore = await verifier.adminAccount.findUniqueOrThrow({ where: { id: owner.id } });
    const auditCountBefore = await verifier.auditLog.count();
    for (const grant of [delegateAuthorization, ownerAuthorization, systemAuthorization]) {
      await rejects(() => accounts.updateUnifiedAdminAccount({ id: owner.id, roles: ["CONTENT_EDITOR"] }, grant), "最高管理员账号受保护");
      for (const isActive of [false, true]) {
        await rejects(() => accounts.updateUnifiedAdminAccount({ id: owner.id, isActive }, grant), "最高管理员账号受保护");
        await rejects(() => refereeR1Service.setAdminAccountStatus(owner.id, isActive, grant), "最高管理员账号受保护");
      }
      await rejects(() => accounts.resetUnifiedAdminPassword({ id: owner.id, password: "Forbidden-Reset-2026!" }, grant), "最高管理员账号受保护");
      await rejects(() => accounts.deleteUnifiedAdminAccount({ id: owner.id, confirmUsername: "nuaafa" }, grant), "最高管理员账号受保护");
    }
    assert(JSON.stringify(await verifier.adminAccount.findUniqueOrThrow({ where: { id: owner.id } })) === JSON.stringify(ownerBefore), "Owner protection changed account data.");
    assert(await verifier.auditLog.count() === auditCountBefore, "Rejected owner mutations wrote audit records.");
    assert(rbac.resolveUnifiedAdminRoles({ username: "nuaafa", explicitRoles: ["CONTENT_EDITOR"], legacyRole: "REFEREE_MANAGER" }).join() === "SUPER_ADMIN", "Owner did not retain highest authority.");
    const listed = await accounts.listUnifiedAdminAccounts(ownerActor);
    assert(listed[0].id === owner.id && listed[0].isProtected && !listed[0].canManage && listed[0].isCurrent, "Protected owner UI metadata/ordering missing.");
    await rejects(() => accounts.createUnifiedAdminAccount({ username: " NUAAFA ", displayName: "Forged owner", password: "Forged-Password-2026!", roles: ["SUPER_ADMIN"] }, delegateAuthorization), "系统保留账号");
    await rejects(() => refereeR1Service.createAdminAccount({ username: "NUAAFA", displayName: "Forged owner", password: "Forged-Password-2026!", role: "SUPER_ADMIN" }, delegateAuthorization), "系统保留账号");

    await verifier.adminSession.create({ data: { adminAccountId: content.id, tokenHash: "password-reset-session", expiresAt: new Date(Date.now() + 60_000) } });
    const beforeReset = await verifier.adminAccount.findUniqueOrThrow({ where: { id: content.id }, include: { unifiedRoles: true } });
    await rejects(() => accounts.resetUnifiedAdminPassword({ id: content.id, password: "short" }, ownerAuthorization), "12 至 256");
    assert(await verifier.adminSession.count({ where: { adminAccountId: content.id } }) === 1, "Failed reset removed a session.");
    await accounts.resetUnifiedAdminPassword({ id: content.id, password: "Reset-Password-2026!" }, ownerAuthorization);
    const reset = await verifier.adminAccount.findUniqueOrThrow({ where: { id: content.id } });
    assert(reset.mustChangePassword && await verifyPassword("Reset-Password-2026!", reset.passwordHash) && reset.passwordHash !== beforeReset.passwordHash, "Password reset did not persist hashed password/required change.");
    assert(await verifier.adminSession.count({ where: { adminAccountId: content.id } }) === 0, "Password reset left live sessions.");
    await rejects(() => accounts.deleteUnifiedAdminAccount({ id: explicitSuper.id, confirmUsername: explicitSuper.username }, delegateAuthorization), "不能删除当前登录账号");
    await rejects(() => accounts.resetUnifiedAdminPassword({ id: explicitSuper.id, password: "Self-Reset-Password!" }, delegateAuthorization), "个人菜单");
    await accounts.updateUnifiedAdminAccount({ id: explicitSuper.id, roles: ["REFEREE_ADMIN"], isActive: false }, ownerAuthorization);
    const post = await verifier.contentPost.create({ data: { slug: "retained-after-admin-delete", title: "历史新闻", summary: "保留内容", content: { type: "doc" }, authorAdminId: content.id } });
    await verifier.adminSession.create({ data: { adminAccountId: content.id, tokenHash: "delete-session", expiresAt: new Date(Date.now() + 60_000) } });
    await rejects(() => accounts.deleteUnifiedAdminAccount({ id: content.id, confirmUsername: "wrong" }, ownerAuthorization), "完整账号");
    assert(await verifier.adminSession.count({ where: { adminAccountId: content.id } }) === 1, "Failed delete removed session.");
    await accounts.deleteUnifiedAdminAccount({ id: content.id, confirmUsername: content.username }, ownerAuthorization);
    assert(!await verifier.adminAccount.findUnique({ where: { id: content.id } }), "Deleted account persisted.");
    assert(await verifier.adminRoleAssignment.count({ where: { adminAccountId: content.id } }) === 0, "Delete left role assignments.");
    assert(await verifier.adminSession.count({ where: { tokenHash: "delete-session" } }) === 0, "Delete left a synthetic legacy session.");
    assert((await verifier.contentPost.findUniqueOrThrow({ where: { id: post.id } })).authorAdminId === null, "Delete failed to retain historical content.");
    assert(await verifier.auditLog.count({ where: { entityId: content.id, action: "ADMIN_ACCOUNT_CREATED" } }) === 1, "Delete removed historical audit records.");
    await rejects(() => accounts.deleteUnifiedAdminAccount({ id: content.id, confirmUsername: content.username }, ownerAuthorization), "不存在");
    const resetAudit = await verifier.auditLog.findFirstOrThrow({ where: { entityId: content.id, action: "ADMIN_PASSWORD_RESET" } });
    assert(!JSON.stringify(resetAudit).includes("Reset-Password-2026!") && !JSON.stringify(resetAudit).includes(reset.passwordHash), "Password reset audit leaked credentials.");
    console.log("PASS protected owner, delegated SUPER_ADMIN restrictions, reserved login, owner authority, password reset/session invalidation, confirmed deletion/history retention");

    await rejects(() => accounts.createUnifiedAdminAccount(
      { username: "wrong-role", displayName: "越权账号", password: "Wrong-Role-Password-2026!", roles: ["CONTENT_EDITOR"] },
      capabilities.issueTestAdminServiceAuthorization("system:write", { ...superActor, roles: ["CONTENT_EDITOR"] }),
    ), "没有执行此操作的权限");

    const stored = beforeReset;
    assert(stored.passwordHash !== "Content-Password-2026!" && stored.unifiedRoles.length === 2, "Password hashing or role persistence failed.");
    const auditRows = await verifier.auditLog.findMany({ where: { entityType: "AdminAccount" }, orderBy: { createdAt: "asc" } });
    const auditText = auditRows.map((row) => `${row.summary}\n${row.metadata ?? ""}`).join("\n");
    assert(auditRows.some((row) => row.action === "ADMIN_ACCOUNT_CREATED"), "Account creation was not audited.");
    assert(auditRows.some((row) => row.action === "ADMIN_ROLE_ASSIGNMENTS_UPDATED"), "Role update was not audited.");
    assert(auditRows.some((row) => row.action === "ADMIN_ACCOUNT_STATUS_UPDATED"), "Status update was not audited.");
    assert(!auditText.includes("Content-Password-2026!") && !auditText.includes(stored.passwordHash), "Audit metadata leaked password material.");

    console.log(JSON.stringify({
      legacySuperFallback: true,
      roleIsolation: true,
      multiRoleUnion: true,
      safeRoleBasedLanding: true,
      legacyDeepLinkMapping: true,
      accountCreateEditDisable: true,
      superNormalization: true,
      lastActiveSuperProtection: true,
      passwordHashOnly: true,
      requiredPasswordChange: true,
      requiredPasswordFailureAtomicity: true,
      requiredPasswordSessionInvalidation: true,
      syntheticLegacyPasswordCompatibility: true,
      safeAuditMetadata: true,
      auditLogCount: auditRows.length,
    }, null, 2));
  } finally {
    await verifier.$disconnect();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
