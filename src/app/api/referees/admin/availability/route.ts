import { readBoundedJson } from "@/lib/bounded-json";
import { NextResponse } from "next/server";

import { authorizeLegacyAdminRequest } from "@/lib/legacy-admin-authorization";
import { refereeApiErrorResponse, RefereeApiInputError } from "@/lib/referee-api";
import { deleteRefereeAvailability, saveRefereeAvailability } from "@/lib/referee-r1-service";
import { isRecord, readDate, readEnum, readShortText } from "@/lib/referee-validation";

export async function POST(request: Request) {
  const authorization = await authorizeLegacyAdminRequest(request, "referees:write");
  if (!authorization.ok) return authorization.response;
  try {
    const body: unknown = await readBoundedJson(request);
    if (!isRecord(body)) throw new RefereeApiInputError("可执裁时间格式不正确。");
    const actor = authorization.actor;
    const result = await saveRefereeAvailability({
      id: readShortText(body.id, "记录 ID", 64, false) || undefined,
      refereeId: readShortText(body.refereeId, "裁判员", 64),
      startAt: readDate(body.startAt, "开始时间")!,
      endAt: readDate(body.endAt, "结束时间")!,
      kind: readEnum(body.kind, ["AVAILABLE", "UNAVAILABLE"] as const, "时间类型"),
      competitionFormat: readEnum(body.competitionType ?? "BOTH", ["BOTH", "ELEVEN_A_SIDE", "FUTSAL"] as const, "比赛制式") === "BOTH"
        ? null
        : readEnum(body.competitionType, ["ELEVEN_A_SIDE", "FUTSAL"] as const, "比赛制式"),
      note: readShortText(body.note, "说明", 240, false),
      actor: { type: "ADMIN", id: actor.id },
    });
    return NextResponse.json({ ok: true, id: result.id });
  } catch (error) {
    return refereeApiErrorResponse(error, "保存失败，请稍后重试。");
  }
}

export async function DELETE(request: Request) {
  const authorization = await authorizeLegacyAdminRequest(request, "referees:write");
  if (!authorization.ok) return authorization.response;
  try {
    const body: unknown = await readBoundedJson(request);
    if (!isRecord(body)) throw new RefereeApiInputError("删除内容格式不正确。");
    const actor = authorization.actor;
    await deleteRefereeAvailability(
      readShortText(body.id, "记录 ID", 64),
      readShortText(body.refereeId, "裁判员", 64),
      { type: "ADMIN", id: actor.id },
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return refereeApiErrorResponse(error, "删除失败，请稍后重试。");
  }
}
