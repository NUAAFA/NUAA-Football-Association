import { NextResponse } from "next/server";
import { readBoundedJson } from "@/lib/bounded-json";
import { saveResourceDocument } from "@/lib/resource-library";
import { authorizeUnifiedAdminRequest, unifiedAdminErrorResponse } from "@/lib/unified-admin-api";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authorizeUnifiedAdminRequest(request, "content:write", { mutation: true });
    const { id } = await context.params;
    const resource = await saveResourceDocument(id, await readBoundedJson(request), actor);
    return NextResponse.json({ ok: true, resource });
  } catch (error) { return unifiedAdminErrorResponse(error, "资料保存失败。"); }
}
