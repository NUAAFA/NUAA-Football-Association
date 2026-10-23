import { readBoundedJson } from "@/lib/bounded-json";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { readContentPostInput } from "@/lib/admin-content-input";
import { getAdminContentPost, updateContentPost } from "@/lib/admin-content-service";
import {
  authorizeUnifiedAdminRequest,
  UnifiedAdminInputError,
  unifiedAdminErrorResponse,
} from "@/lib/unified-admin-api";

export async function GET(request: Request, context: RouteContext<"/api/admin/content/posts/[id]">) {
  try {
    const actor = await authorizeUnifiedAdminRequest(request, "content:read");
    const { id } = await context.params;
    const post = await getAdminContentPost(id, actor);
    if (!post) throw new UnifiedAdminInputError("内容不存在。", 404);
    return NextResponse.json({ post });
  } catch (error) {
    return unifiedAdminErrorResponse(error, "内容读取失败。");
  }
}

export async function PATCH(request: Request, context: RouteContext<"/api/admin/content/posts/[id]">) {
  try {
    const actor = await authorizeUnifiedAdminRequest(request, "content:write", { mutation: true });
    const { id } = await context.params;
    const input = readContentPostInput(await readBoundedJson(request));
    const post = await updateContentPost(id, input, actor);
    revalidatePath("/competitions/[slug]", "page");
    revalidatePath("/media");
    return NextResponse.json({ ok: true, post });
  } catch (error) {
    return unifiedAdminErrorResponse(error, "内容更新失败。");
  }
}
