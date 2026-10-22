import { consumePublicRequestBudget, reserveLoginBudget } from "@/lib/request-budget";
import { NextResponse } from "next/server";
import { createAdminSession, getAdminConfigurationIssue, isSameOrigin } from "@/lib/referee-auth";
import { refereeApiErrorResponse, readRefereeApiJson, RefereeApiInputError } from "@/lib/referee-api";
import { isRecord, readShortText } from "@/lib/referee-validation";
import {
  assertLoginAllowed,
  clearLoginFailures,
  getLoginKey,
  recordLoginFailure,
} from "@/lib/referee-security";
import { resolveUnifiedAdminRoles } from "@/lib/unified-admin-rbac";
import { getAuthorizedUnifiedAdminReturnTo } from "@/lib/unified-admin-routing";

async function readAdminLoginInput(request: Request) {
  const body = await readRefereeApiJson(request, "登录信息格式不正确。");
  if (!isRecord(body)) throw new RefereeApiInputError("登录信息格式不正确。");
  return {
    username: readShortText(body.username, "管理员账号", 64, false),
    password: readShortText(body.password, "管理员密码", 256),
    next: typeof body.next === "string" ? body.next : undefined,
  };
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  const configurationIssue = getAdminConfigurationIssue();
  if (configurationIssue) return NextResponse.json({ error: "裁判管理后台暂未开放。" }, { status: 503 });
  try {
    await consumePublicRequestBudget("admin", request);
    const { username, password, next } = await readAdminLoginInput(request);
    const loginKey = getLoginKey(request, username || "legacy-administrator");
    await assertLoginAllowed("admin", loginKey);
    const release = await reserveLoginBudget("admin", request, username || "legacy-administrator");
    let identity;
    try { identity = await createAdminSession(username, password); } finally { release(); }
    if (!identity) {
      await recordLoginFailure("admin", loginKey);
      return NextResponse.json({ error: "登录信息不正确或后台当前不可用。" }, { status: 401 });
    }
    await clearLoginFailures("admin", loginKey);
    const roles = resolveUnifiedAdminRoles(identity);
    return NextResponse.json({
      ok: true,
      returnTo: identity.mustChangePassword
        ? "/admin"
        : getAuthorizedUnifiedAdminReturnTo(
            next,
            roles,
          ),
    });
  } catch (error) {
    return refereeApiErrorResponse(error, "登录失败，请稍后再试。");
  }
}
