import { NextResponse } from "next/server";

import { getAdminSession, destroyAdminSession, createAdminSession } from "@/lib/referee-auth";
import { refereeApiErrorResponse, readRefereeApiJson, RefereeApiInputError } from "@/lib/referee-api";
import { authorizeLegacyAdminRequest } from "@/lib/legacy-admin-authorization";
import { changeAdminPassword } from "@/lib/referee-r1-service";
import { isRecord, readShortText } from "@/lib/referee-validation";

async function readAdminPasswordInput(request: Request) {
  const body = await readRefereeApiJson(request, "密码内容格式不正确。");
  if (!isRecord(body)) throw new RefereeApiInputError("密码内容格式不正确。");
  return {
    currentPassword: readShortText(body.currentPassword, "当前密码", 256),
    newPassword: readShortText(body.newPassword, "新密码", 256),
  };
}

export async function POST(request: Request) {
  try {
    const authorization = await authorizeLegacyAdminRequest(request, "dashboard:read", {
      allowPasswordChangeRequired: true,
      failureMessage: "密码修改失败，请稍后再试。",
    });
    if (!authorization.ok) return authorization.response;
    const session = await getAdminSession();
    if (!session) return NextResponse.json({ error: "请先登录管理员后台。" }, { status: 401 });
    if (!session.adminAccount) {
      return NextResponse.json(
        { error: "兼容管理员须先切换到持久化实名账号。" },
        { status: 409 },
      );
    }
    const input = await readAdminPasswordInput(request);
    await changeAdminPassword({
      adminAccountId: session.adminAccount.id,
      currentSessionId: session.id,
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
    }, authorization.authorization);
    await destroyAdminSession();
    const refreshed = await createAdminSession(session.adminAccount.username, input.newPassword);
    return NextResponse.json({ ok: true, reauthenticationRequired: !refreshed });
  } catch (error) {
    return refereeApiErrorResponse(error, "密码修改失败，请稍后再试。");
  }
}
