import { readBoundedJson } from "@/lib/bounded-json";
import { NextResponse } from "next/server";

import { authorizeLegacyAdminRequest } from "@/lib/legacy-admin-authorization";
import { refereeApiErrorResponse, RefereeApiInputError } from "@/lib/referee-api";
import { createCollege, upsertCollegeCodeMapping } from "@/lib/referee-r1-service";
import { isRecord, readEnum, readShortText } from "@/lib/referee-validation";

export async function POST(request: Request) {
  const authorization = await authorizeLegacyAdminRequest(request, "competitions:write");
  if (!authorization.ok) return authorization.response;
  const actor = authorization.actor;
  try {
    const body: unknown = await readBoundedJson(request);
    if (!isRecord(body)) throw new RefereeApiInputError("学院内容格式不正确。");
    const action = readEnum(body.action, ["create-college", "upsert-mapping"] as const, "操作");
    const result = action === "create-college"
      ? await createCollege(readShortText(body.name, "学院名称", 80), actor)
      : await upsertCollegeCodeMapping(
          readShortText(body.prefix, "学号前缀", 2),
          readShortText(body.collegeId, "学院", 64),
          readShortText(body.note, "说明", 240, false),
          actor,
        );
    return NextResponse.json({ ok: true, id: result.id }, { status: 201 });
  } catch (error) {
    return refereeApiErrorResponse(error, "学院配置失败，请稍后重试。");
  }
}
