import { RefereeApiInputError } from "@/lib/referee-api-input-error";

/** Bound actual bytes before decoding/parsing, including chunked requests. */
export async function readBoundedJson(request: Request, maximumBytes?: number): Promise<unknown> {
  const pathname = new URL(request.url).pathname;
  const limit = maximumBytes ?? (pathname.includes("/content/posts") ? 256 * 1024
    : /\/(?:login|password)$/.test(pathname) ? 16 * 1024 : 64 * 1024);
  const type = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (!type || !/^application\/(?:json|[a-z0-9.+-]+\+json)$/.test(type)) {
    throw new RefereeApiInputError("请求须使用 JSON 格式。", 415);
  }
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)))) {
    throw new RefereeApiInputError("请求长度无效。");
  }
  if (declared !== null && Number(declared) > limit) throw new RefereeApiInputError("请求内容过大。", 413);
  if (!request.body) throw new RefereeApiInputError("请求内容为空。");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RefereeApiInputError("请求读取超时。", 408)), 5_000);
  });
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new RefereeApiInputError("请求内容过大。", 413);
      if (chunks.length >= 1024) throw new RefereeApiInputError("请求分片过多。", 413);
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    if (error instanceof RefereeApiInputError) throw error;
    throw new RefereeApiInputError("请求内容格式不正确。");
  } finally {
    if (timer) clearTimeout(timer);
    reader.releaseLock();
  }
}
