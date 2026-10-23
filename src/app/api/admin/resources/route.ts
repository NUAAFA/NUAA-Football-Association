import { NextResponse } from "next/server";
import { readBoundedJson } from "@/lib/bounded-json";
import { saveResourceDocument } from "@/lib/resource-library";
import { authorizeUnifiedAdminRequest, unifiedAdminErrorResponse } from "@/lib/unified-admin-api";

export async function POST(request: Request) {
  try {
    const actor = await authorizeUnifiedAdminRequest(request, "content:write", { mutation: true });
    const resource = await saveResourceDocument(null, await readBoundedJson(request), actor);
    return NextResponse.json({ ok: true, resource }, { status: 201 });
  } catch (error) { return unifiedAdminErrorResponse(error, "资料保存失败。"); }
}
