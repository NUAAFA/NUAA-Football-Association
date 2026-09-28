import { NextResponse } from "next/server";

import {
  getAdminMediaPage,
  maximumMediaRequestBytes,
  storeMediaAssetUploadStream,
} from "@/lib/admin-media-service";
import {
  authorizeUnifiedAdminRequest,
  UnifiedAdminInputError,
  unifiedAdminErrorResponse,
} from "@/lib/unified-admin-api";

export async function GET(request: Request) {
  try {
    const actor = await authorizeUnifiedAdminRequest(request, "media:read");
    const url = new URL(request.url);
    const visibility = url.searchParams.get("visibility");
    const page = Number(url.searchParams.get("page") ?? "1");
    const result = await getAdminMediaPage({
      actor,
      page: Number.isSafeInteger(page) ? page : 1,
      visibility: visibility === "PUBLIC" || visibility === "PRIVATE" ? visibility : undefined,
      mimeType: url.searchParams.get("mimeType") || undefined,
      category: url.searchParams.get("category") || undefined,
      query: url.searchParams.get("query") || undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return unifiedAdminErrorResponse(error, "媒体列表读取失败。");
  }
}

export async function POST(request: Request) {
  try {
    const actor = await authorizeUnifiedAdminRequest(request, "media:write", { mutation: true });
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > maximumMediaRequestBytes) {
      throw new UnifiedAdminInputError("上传请求超过 21 MB 服务端硬限制。", 413);
    }
    if (!request.body) throw new UnifiedAdminInputError("上传数据流为空。");
    const decodeHeader = (name: string, required = false) => {
      const value = request.headers.get(name);
      if (!value) {
        if (required) throw new UnifiedAdminInputError(`缺少 ${name} 请求头。`);
        return "";
      }
      try { return decodeURIComponent(value); } catch { throw new UnifiedAdminInputError(`${name} 请求头编码无效。`); }
    };
    const asset = await storeMediaAssetUploadStream({
      fileName: decodeHeader("x-nuaafa-filename", true),
      mimeType: request.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "",
      stream: request.body,
      contentLength: contentLength > 0 ? contentLength : undefined,
      altText: decodeHeader("x-nuaafa-alt-text"),
      visibility: request.headers.get("x-nuaafa-visibility") ?? "PRIVATE",
      actor,
    });
    return NextResponse.json({ ok: true, asset }, { status: 201 });
  } catch (error) {
    return unifiedAdminErrorResponse(error, "文件上传失败。");
  }
}
