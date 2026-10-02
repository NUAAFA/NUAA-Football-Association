import type { UnifiedAdminRole } from "@/generated/prisma-v29/client";
import { NextResponse } from "next/server";

import {
  createUnifiedAdminAccount,
  updateUnifiedAdminAccount,
  resetUnifiedAdminPassword,
  deleteUnifiedAdminAccount,
} from "@/lib/unified-admin-account-service";
import {
  authorizeUnifiedAdminServiceRequest,
  UnifiedAdminInputError,
  unifiedAdminErrorResponse,
} from "@/lib/unified-admin-api";
import { isRecord, readBoolean, readShortText } from "@/lib/referee-validation";
import { unifiedAdminRoleOrder } from "@/lib/unified-admin-rbac";

function readRoles(value: unknown) {
  if (!Array.isArray(value) || !value.length) {
    throw new UnifiedAdminInputError("请至少选择一个管理员角色。");
  }
  if (value.some((role) => typeof role !== "string" || !unifiedAdminRoleOrder.includes(role as UnifiedAdminRole))) {
    throw new UnifiedAdminInputError("管理员角色无效。");
  }
  return value as UnifiedAdminRole[];
}

async function readBody(request: Request) {
  try {
    const body: unknown = await request.json();
    if (!isRecord(body)) throw new UnifiedAdminInputError("管理员账号格式不正确。");
    return body;
  } catch (error) {
    if (error instanceof UnifiedAdminInputError) throw error;
    throw new UnifiedAdminInputError("管理员账号格式不正确。");
  }
}

function readInput<T>(reader: () => T) {
  try {
    return reader();
  } catch (error) {
    if (error instanceof UnifiedAdminInputError) throw error;
    if (error instanceof Error) throw new UnifiedAdminInputError(error.message);
    throw new UnifiedAdminInputError("管理员账号格式不正确。");
  }
}

export async function POST(request: Request) {
  try {
    const { authorization } = await authorizeUnifiedAdminServiceRequest(request, "system:write", { mutation: true });
    const body = await readBody(request);
    const input = readInput(() => ({
      username: readShortText(body.username, "账号", 64),
      displayName: readShortText(body.displayName, "姓名", 80),
      password: readShortText(body.password, "初始密码", 256),
      roles: readRoles(body.roles),
    }));
    const account = await createUnifiedAdminAccount(input, authorization);
    return NextResponse.json({ ok: true, account }, { status: 201 });
  } catch (error) {
    return unifiedAdminErrorResponse(error, "管理员账号创建失败。");
  }
}

export async function PATCH(request: Request) {
  try {
    const { authorization } = await authorizeUnifiedAdminServiceRequest(request, "system:write", { mutation: true });
    const body = await readBody(request);
    if (body.action === "reset-password") {
      const input = readInput(() => ({
        id: readShortText(body.id, "管理员账号", 64),
        password: readShortText(body.password, "初始密码", 256),
      }));
      await resetUnifiedAdminPassword(input, authorization);
      return NextResponse.json({ ok: true });
    }
    if (body.action !== undefined) throw new UnifiedAdminInputError("管理员操作无效。");
    const hasRoles = Object.hasOwn(body, "roles");
    const hasStatus = Object.hasOwn(body, "isActive");
    if (!hasRoles && !hasStatus) throw new UnifiedAdminInputError("没有需要更新的管理员账号内容。");
    const input = readInput(() => ({
      id: readShortText(body.id, "管理员账号", 64),
      ...(hasRoles ? { roles: readRoles(body.roles) } : {}),
      ...(hasStatus ? { isActive: readBoolean(body.isActive, "启用状态") } : {}),
    }));
    const account = await updateUnifiedAdminAccount(input, authorization);
    return NextResponse.json({ ok: true, account });
  } catch (error) {
    return unifiedAdminErrorResponse(error, "管理员账号更新失败。");
  }
}

export async function DELETE(request: Request) {
  try {
    const { authorization } = await authorizeUnifiedAdminServiceRequest(request, "system:write", { mutation: true });
    const body = await readBody(request);
    const input = readInput(() => ({
      id: readShortText(body.id, "管理员账号", 64),
      confirmUsername: readShortText(body.confirmUsername, "确认账号", 64),
    }));
    await deleteUnifiedAdminAccount(input, authorization);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return unifiedAdminErrorResponse(error, "管理员账号删除失败。");
  }
}
