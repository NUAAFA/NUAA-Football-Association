import { readBoundedJson } from "@/lib/bounded-json";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { revalidatePublicContentPaths } from "@/lib/public-content-revalidation";

import type { ContentPostStatus, ContentPostType } from "@/generated/prisma-v29/client";
import { readContentPostInput } from "@/lib/admin-content-input";
import {
  createContentPost,
  getAdminContentPage,
  parseContentPage,
} from "@/lib/admin-content-service";
import { authorizeUnifiedAdminRequest, unifiedAdminErrorResponse } from "@/lib/unified-admin-api";

function readType(value: string | null): ContentPostType | undefined {
  return value === "NEWS" || value === "ANNOUNCEMENT" || value === "DISCIPLINE" ? value : undefined;
}

function readStatus(value: string | null): ContentPostStatus | undefined {
  return value === "DRAFT" || value === "PUBLISHED" || value === "ARCHIVED" ? value : undefined;
}

export async function GET(request: Request) {
  try {
    const actor = await authorizeUnifiedAdminRequest(request, "content:read");
    const url = new URL(request.url);
    const result = await getAdminContentPage({
      actor,
      page: parseContentPage(url.searchParams.get("page") ?? undefined),
      query: url.searchParams.get("query") ?? undefined,
      type: readType(url.searchParams.get("type")),
      status: readStatus(url.searchParams.get("status")),
    });
    return NextResponse.json(result);
  } catch (error) {
    return unifiedAdminErrorResponse(error, "内容列表读取失败。");
  }
}

export async function POST(request: Request) {
  try {
    const actor = await authorizeUnifiedAdminRequest(request, "content:write", { mutation: true });
    const input = readContentPostInput(await readBoundedJson(request));
    const post = await createContentPost(input, actor);
    revalidatePublicContentPaths();
    revalidatePath("/competitions/[slug]", "page");
    revalidatePath("/media");
    return NextResponse.json({ ok: true, post }, { status: 201 });
  } catch (error) {
    return unifiedAdminErrorResponse(error, "内容创建失败。");
  }
}
