/** Bounded requests for member actions; uncertain writes are read back, never replayed. */
export const refereeSubmissionTimeoutMs = 12_000;

export class RefereeSubmissionRequestError extends Error {
  constructor(message: string, readonly definite: boolean) { super(message); }
}

export type RefereeSubmissionOutcome =
  | { kind: "success"; message: string }
  | { kind: "failure"; message: string }
  | { kind: "unknown"; message: string };

export async function refereeSubmissionJson<T>(url: string, init: RequestInit = {}, timeoutMs = refereeSubmissionTimeoutMs): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
        const type = response.headers.get("content-type") ?? "";
        if (!type.includes("application/json")) throw new RefereeSubmissionRequestError("未收到可确认的响应。", false);
        const value: unknown = await response.json();
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new RefereeSubmissionRequestError("未收到可确认的响应。", false);
        if (!response.ok) {
          const error = "error" in value && typeof value.error === "string" ? value.error : "操作未能完成，请稍后重试。";
          // A gateway/server failure can arrive after a committed write.
          const definite = response.status < 500 && response.status !== 408;
          throw new RefereeSubmissionRequestError(definite ? error : "暂时无法确认保存结果。", definite);
        }
        return value as T;
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new RefereeSubmissionRequestError("等待超时，正在核对保存结果。", false)); }, timeoutMs);
      }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function checkRefereeSubmission<State>(read: () => Promise<State>, confirmed: (state: State) => boolean): Promise<RefereeSubmissionOutcome> {
  try {
    return confirmed(await read())
      ? { kind: "success", message: "已核对，操作已保存。" }
      : { kind: "unknown", message: "尚未查到与此次内容一致的保存结果。输入已保留，请再次核对；确认未保存后可手动重试。" };
  } catch (error) {
    if (error instanceof RefereeSubmissionRequestError && error.definite) {
      return { kind: "unknown", message: `${error.message}此次保存结果仍需在工作区核对，输入已保留。` };
    }
    return { kind: "unknown", message: "暂时无法核对保存结果。输入已保留，请恢复网络后再次核对，不必连续提交。" };
  }
}

export async function submitRefereeWithCheck<State>(options: {
  read: () => Promise<State>;
  before: (state: State) => RefereeSubmissionOutcome | null;
  confirmed: (state: State) => boolean;
  write: () => Promise<{ ok?: boolean }>;
}): Promise<RefereeSubmissionOutcome> {
  let state: State;
  try { state = await options.read(); }
  catch (error) {
    return { kind: "failure", message: error instanceof RefereeSubmissionRequestError && error.definite ? error.message : "未能核对当前状态，此次尚未发送。输入已保留，请恢复网络后重试。" };
  }
  const existing = options.before(state);
  if (existing) return existing;
  try {
    const result = await options.write();
    if (result.ok !== true) throw new RefereeSubmissionRequestError("未收到保存确认。", false);
    return { kind: "success", message: "操作已保存。" };
  } catch (error) {
    if (error instanceof RefereeSubmissionRequestError && error.definite) return { kind: "failure", message: error.message };
    return checkRefereeSubmission(options.read, options.confirmed);
  }
}
