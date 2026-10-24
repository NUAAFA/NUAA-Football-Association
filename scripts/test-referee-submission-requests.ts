import assert from "node:assert/strict";
import { checkRefereeSubmission, RefereeSubmissionRequestError, refereeSubmissionJson, submitRefereeWithCheck } from "../src/lib/referee-submission-client";

async function main() {
const originalFetch = globalThis.fetch;
try {
  // A response can connect successfully but never finish its JSON body.
  globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"ok":')); } }), { headers: { "content-type": "application/json" } });
  const started = performance.now();
  await assert.rejects(refereeSubmissionJson("http://isolated.invalid/status", {}, 25));
  assert(performance.now() - started < 1_000);
  console.log("PASS F06: bounded wait includes an unfinished response body");

  let writes = 0;
  const unreadable = await submitRefereeWithCheck({ read: async () => { throw new Error("synthetic offline"); }, before: () => null, confirmed: () => false, write: async () => { writes++; return { ok: true }; } });
  assert.equal(unreadable.kind, "failure"); assert.equal(writes, 0); assert.match(unreadable.message, /尚未发送/);
  console.log("PASS F06: failed preflight is a known unsent operation");

  let saved = false, reads = 0;
  const uncertain = await submitRefereeWithCheck({ read: async () => { reads++; return { saved }; }, before: () => null, confirmed: (state) => state.saved, write: async () => { writes++; saved = true; throw new Error("synthetic lost response"); } });
  assert.equal(uncertain.kind, "success"); assert.equal(writes, 1); assert.equal(reads, 2);
  console.log("PASS F06: committed write plus lost reply is confirmed by a read, without replay");

  const down = await checkRefereeSubmission(async () => { throw new Error("synthetic read failure"); }, () => false);
  assert.equal(down.kind, "unknown"); assert.match(down.message, /再次核对/);
  console.log("PASS F06: unavailable read-back remains unknown");

  const changed = await checkRefereeSubmission(async () => { throw new RefereeSubmissionRequestError("任务版本已变化，请重新打开工作区。", true); }, () => false);
  assert.equal(changed.kind, "unknown"); assert.match(changed.message, /任务版本已变化/); assert.match(changed.message, /输入已保留/); assert(!changed.message.includes("恢复网络"));
  console.log("PASS F06: a known version change remains unknown with its actionable cause");

  globalThis.fetch = async () => new Response(JSON.stringify({ error: "synthetic SQL/private-path detail" }), { status: 500, headers: { "content-type": "application/json" } });
  await assert.rejects(refereeSubmissionJson("http://isolated.invalid/write"), (error: unknown) => error instanceof Error && !error.message.includes("SQL"));
  console.log("PASS F06: server error details are not exposed by the request helper");
} finally { globalThis.fetch = originalFetch; }

}

main().catch((error) => { console.error(error); process.exitCode = 1; });
