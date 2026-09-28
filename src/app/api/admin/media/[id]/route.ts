import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { changeMediaVisibility } from "@/lib/admin-media-service";
import { authorizeUnifiedAdminRequest, UnifiedAdminInputError, unifiedAdminErrorResponse } from "@/lib/unified-admin-api";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authorizeUnifiedAdminRequest(request, "media:write", { mutation: true });
    const input = await request.json();
    if (input.visibility !== "PUBLIC" && input.visibility !== "PRIVATE") throw new UnifiedAdminInputError("可见性无效。");
    if (input.confirm !== true) throw new UnifiedAdminInputError("请明确确认文件访问范围。");
    const asset = await changeMediaVisibility((await context.params).id, input.visibility, actor);
    revalidatePath("/news"); revalidatePath("/", "layout");
    return NextResponse.json({ ok: true, asset });
  } catch (error) { return unifiedAdminErrorResponse(error, "权限修改失败。"); }
}
