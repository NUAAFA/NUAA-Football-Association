import { readBoundedJson } from "@/lib/bounded-json";
import { NextResponse } from "next/server";

import {
  getRefereeAdmissionApplication,
  reviewRefereeAdmissionApplication,
} from "@/lib/referee-admission-service";
import {
  authorizeUnifiedAdminRequest,
  UnifiedAdminInputError,
  unifiedAdminErrorResponse,
} from "@/lib/unified-admin-api";
import { isRecord, readEnum, readShortText } from "@/lib/referee-validation";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await authorizeUnifiedAdminRequest(request, "referees:read");
    const { id } = await context.params;
    const application = await getRefereeAdmissionApplication(id, actor);
    return NextResponse.json({ application });
  } catch (error) {
    return unifiedAdminErrorResponse(error, "裁判准入申请读取失败。");
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await authorizeUnifiedAdminRequest(
      request,
      "referees:write",
      { mutation: true },
    );
    const body = await readBoundedJson(request);
    if (!isRecord(body)) throw new UnifiedAdminInputError("审核内容格式不正确。");
    const action = readEnum(body.action, ["APPROVE", "REJECT"] as const, "审核结果");
    const reviewNote = readShortText(body.reviewNote, "审核意见", 500);
    const { id } = await context.params;
    let application;
    if (action === "REJECT") {
      application = await reviewRefereeAdmissionApplication(id, { action, reviewNote }, actor);
    } else {
      const mode = readEnum(
        body.mode,
        ["CREATE_NEW", "LINK_EXISTING"] as const,
        "账号处理方式",
      );
      const approveInput:
        | { mode: "CREATE_NEW" }
        | { mode: "LINK_EXISTING"; existingRefereeId: string } = mode === "CREATE_NEW"
        ? {
            mode,
          }
        : {
            mode,
            existingRefereeId: readShortText(body.existingRefereeId, "现有裁判员", 64),
          };
      application = await reviewRefereeAdmissionApplication(
        id,
        { action, reviewNote, ...approveInput },
        actor,
      );
    }
    return NextResponse.json({ ok: true, application });
  } catch (error) {
    return unifiedAdminErrorResponse(error, "裁判准入申请审核失败。");
  }
}
