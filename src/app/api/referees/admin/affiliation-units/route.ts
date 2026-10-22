import { readBoundedJson } from "@/lib/bounded-json";
import { NextResponse } from "next/server";

import { authorizeLegacyAdminRequest } from "@/lib/legacy-admin-authorization";
import { refereeApiErrorResponse, RefereeApiInputError } from "@/lib/referee-api";
import {
  createAffiliationUnit,
  createHouse,
  deleteHouseSafely,
  setHouseChildren,
  updateHouse,
} from "@/lib/referee-r1-service";
import { isRecord, readEnum, readShortText, readShortTextArray } from "@/lib/referee-validation";

export async function POST(request: Request) {
  const authorization = await authorizeLegacyAdminRequest(request, "competitions:write");
  if (!authorization.ok) return authorization.response;
  const actor = authorization.actor;
  try {
    const body: unknown = await readBoundedJson(request);
    if (!isRecord(body)) throw new RefereeApiInputError("组织单位内容格式不正确。");
    const action = readEnum(body.action, ["create", "set-children"] as const, "操作");
    const type = action === "create"
      ? readEnum(body.type, ["COLLEGE", "SHUYUAN"] as const, "组织单位类型")
      : null;
    const result = action === "create"
      ? type === "SHUYUAN"
        ? await createHouse({
            name: readShortText(body.name, "书院名称", 80),
            childUnitIds: readShortTextArray(body.childUnitIds ?? [], "组成学院", 64, 30),
          }, authorization.authorization)
        : await createAffiliationUnit(readShortText(body.name, "学院名称", 80), "COLLEGE", actor)
      : await setHouseChildren(
          readShortText(body.parentUnitId, "书院", 64),
          readShortTextArray(body.childUnitIds, "组成学院", 64, 30),
          authorization.authorization,
        );
    return NextResponse.json({ ok: true, id: result.id }, { status: 201 });
  } catch (error) {
    return refereeApiErrorResponse(error, "组织单位配置失败，请稍后重试。");
  }
}

export async function PATCH(request: Request) {
  const authorization = await authorizeLegacyAdminRequest(request, "competitions:write");
  if (!authorization.ok) return authorization.response;
  try {
    const body: unknown = await readBoundedJson(request);
    if (!isRecord(body)) throw new RefereeApiInputError("书院内容格式不正确。");
    const result = await updateHouse(
      readShortText(body.id, "书院", 64),
      readShortText(body.name, "书院名称", 80),
      authorization.authorization,
    );
    return NextResponse.json({ ok: true, id: result.id });
  } catch (error) {
    return refereeApiErrorResponse(error, "书院更新失败，请稍后重试。");
  }
}

export async function DELETE(request: Request) {
  const authorization = await authorizeLegacyAdminRequest(request, "competitions:write");
  if (!authorization.ok) return authorization.response;
  try {
    const body: unknown = await readBoundedJson(request);
    if (!isRecord(body)) throw new RefereeApiInputError("书院删除内容格式不正确。");
    await deleteHouseSafely(
      readShortText(body.id, "书院", 64),
      readShortText(body.confirmationName, "书院名称确认", 80),
      authorization.authorization,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return refereeApiErrorResponse(error, "书院删除失败，请稍后重试。");
  }
}
