import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { promisify } from "node:util";

import { prisma } from "@/lib/prisma";
import { RefereeServiceError } from "@/lib/referee-service-error";

const scrypt = promisify(scryptCallback);
const passwordKeyLength = 64;
const maximumFailures = 5;
const lockDurationMs = 15 * 60 * 1000;

export const DUMMY_PASSWORD_HASH = "scrypt$9KelznfjpvG36WDVkfxMhw$FvGxTPUJhb3Ov3FpDLb5Ir--FncIexTi3uMcy0SYTpc_bBuMWsQwj1V1APsRxRNtam79arK9FbcwUcG6zIAQ-g";

export class LoginRateLimitError extends RefereeServiceError {
  constructor() {
    super("登录尝试过于频繁，请稍后再试。", 429);
    this.name = "LoginRateLimitError";
  }
}

export async function hashPassword(password: string) {
  if (password.length < 12 || password.length > 256) {
    throw new Error("密码须为 12 至 256 个字符。");
  }
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, passwordKeyLength)) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export function isUsablePasswordHash(storedHash: string | null | undefined) {
  if (!storedHash) return false;
  const [algorithm, saltText, hashText, extra] = storedHash.split("$");
  if (
    algorithm !== "scrypt"
    || !saltText
    || !hashText
    || extra !== undefined
    || !/^[A-Za-z0-9_-]+$/u.test(saltText)
    || !/^[A-Za-z0-9_-]+$/u.test(hashText)
  ) return false;
  return Buffer.from(saltText, "base64url").byteLength === 16
    && Buffer.from(hashText, "base64url").byteLength === passwordKeyLength;
}

export async function verifyPassword(password: string, storedHash: string) {
  const [algorithm, saltText, hashText] = storedHash.split("$");
  if (algorithm !== "scrypt" || !saltText || !hashText) return false;
  try {
    const expected = Buffer.from(hashText, "base64url");
    const actual = (await scrypt(
      password,
      Buffer.from(saltText, "base64url"),
      expected.length,
    )) as Buffer;
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function isSessionFresh(expiresAt: Date, now = new Date()) {
  return expiresAt > now;
}

export function getLoginKey(request: Request, identifier = "anonymous") {
  const address = getTrustedClientAddress(request);
  return createHash("sha256")
    .update(`${address}:${identifier.trim().toLowerCase()}`)
    .digest("hex");
}

export function getTrustedClientAddress(request: Request) {
  const realAddress = request.headers.get("x-real-ip")?.trim();
  return realAddress && isIP(realAddress) ? realAddress.toLowerCase() : "local";
}

export function getAdmissionRateLimitKey(request: Request) {
  return createHash("sha256")
    .update(`referee-admission:${getTrustedClientAddress(request)}`)
    .digest("hex");
}

export async function assertLoginAllowed(scope: "admin" | "referee", keyHash: string) {
  const attempt = await prisma.loginAttempt.findUnique({
    where: { scope_keyHash: { scope, keyHash } },
  });
  if (attempt?.blockedUntil && attempt.blockedUntil <= new Date()) {
    await prisma.loginAttempt.deleteMany({ where: { id: attempt.id, blockedUntil: { lte: new Date() } } });
  }
  if (attempt?.blockedUntil && attempt.blockedUntil > new Date()) {
    throw new LoginRateLimitError();
  }
}

export async function recordLoginFailure(scope: "admin" | "referee", keyHash: string) {
  const current = await prisma.loginAttempt.upsert({
    where: { scope_keyHash: { scope, keyHash } },
    create: { scope, keyHash, failures: 1 },
    update: { failures: { increment: 1 } },
  });
  if (current.failures >= maximumFailures) {
    await prisma.loginAttempt.update({
      where: { id: current.id },
      data: { blockedUntil: new Date(Date.now() + lockDurationMs) },
    });
  }
  await new Promise((resolve) => setTimeout(resolve, Math.min(250 * current.failures, 1_250)));
}

export async function clearLoginFailures(scope: "admin" | "referee", keyHash: string) {
  await prisma.loginAttempt.deleteMany({ where: { scope, keyHash } });
}
