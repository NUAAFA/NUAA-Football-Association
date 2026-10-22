import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { RefereeServiceError } from "@/lib/referee-service-error";
import { getTrustedClientAddress } from "@/lib/referee-security";

let lastCleanup = 0;
let activeLogins = 0;
const minute = 60_000;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

/** One atomic fixed-window reservation, shared across processes via SQLite. */
export async function consumeRequestQuota(scope: string, key: string, maximum: number, windowMs: number, now = new Date()) {
  const at = now.getTime();
  const rows = await prisma.$queryRaw<Array<{ failures: number }>>`
    INSERT INTO "LoginAttempt" ("id", "scope", "keyHash", "failures", "blockedUntil", "updatedAt")
    VALUES (${randomUUID()}, ${scope}, ${digest(key)}, 1, ${at + windowMs}, ${at})
    ON CONFLICT ("scope", "keyHash") DO UPDATE SET
      "failures" = CASE WHEN "blockedUntil" IS NULL OR
        (CASE WHEN typeof("blockedUntil") = 'integer' THEN "blockedUntil" ELSE unixepoch("blockedUntil") * 1000 END) <= ${at}
        THEN 1 ELSE MIN("failures" + 1, ${maximum + 1}) END,
      "blockedUntil" = CASE WHEN "blockedUntil" IS NULL OR
        (CASE WHEN typeof("blockedUntil") = 'integer' THEN "blockedUntil" ELSE unixepoch("blockedUntil") * 1000 END) <= ${at}
        THEN ${at + windowMs} ELSE "blockedUntil" END,
      "updatedAt" = ${at}
    RETURNING "failures"`;
  if (Number(rows[0]?.failures) > maximum) throw new RefereeServiceError("请求过于频繁，请稍后再试。", 429);
  if (at - lastCleanup > minute) {
    lastCleanup = at;
    await prisma.loginAttempt.deleteMany({ where: { updatedAt: { lt: new Date(at - 24 * 60 * minute) } } });
  }
}

/** Applied before reading public bodies, including malformed/duplicate attempts. */
export async function consumePublicRequestBudget(scope: "admin" | "referee" | "admission", request: Request) {
  await consumeRequestQuota(`public:${scope}:global`, "all", 600, minute);
  await consumeRequestQuota(`public:${scope}:address`, getTrustedClientAddress(request), 60, minute);
}

export async function reserveLoginBudget(scope: "admin" | "referee", request: Request, identifier: string) {
  if (activeLogins >= 4) throw new RefereeServiceError("登录繁忙，请稍后再试。", 429);
  activeLogins++;
  let released = false;
  const release = () => { if (!released) { released = true; activeLogins--; } };
  try {
    const account = identifier.trim().toLowerCase();
    await consumeRequestQuota(`login:${scope}:account`, account, 20, 15 * minute);
    await consumeRequestQuota(`login:${scope}:pair`, `${getTrustedClientAddress(request)}:${account}`, 10, 15 * minute);
    return release;
  } catch (error) { release(); throw error; }
}
