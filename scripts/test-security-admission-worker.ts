import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@libsql/client";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function applyMigrations(url: string) {
  const client = createClient({ url });
  const entries = (await readdir(path.resolve("prisma/migrations"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    await client.executeMultiple(await readFile(path.resolve("prisma/migrations", entry.name, "migration.sql"), "utf8"));
  }
  client.close();
}

async function main() {
  const databasePath = process.env.SECURITY_ADMISSION_DATABASE_PATH;
  if (!databasePath) throw new Error("SECURITY_ADMISSION_DATABASE_PATH is required.");
  const url = `file:${databasePath.replaceAll("\\", "/")}`;
  process.env.DATABASE_URL = url;
  await applyMigrations(url);

  const admission = await import("../src/lib/referee-admission-service");
  const security = await import("../src/lib/referee-security");
  const { RefereeServiceError } = await import("../src/lib/referee-service-error");
  const { prisma } = await import("../src/lib/prisma");

  try {
    const realAddress = "203.0.113.25";
    const spoofedA = new Request("https://nuaafa.cn/api/referees/admission-applications", {
      headers: { "x-real-ip": realAddress, "x-forwarded-for": "1.1.1.1" },
    });
    const spoofedB = new Request("https://nuaafa.cn/api/referees/admission-applications", {
      headers: { "x-real-ip": realAddress, "x-forwarded-for": "9.9.9.9, 8.8.8.8" },
    });
    const rateKey = security.getAdmissionRateLimitKey(spoofedA);
    assert(
      rateKey === security.getAdmissionRateLimitKey(spoofedB),
      "Rotating client-supplied X-Forwarded-For changed the trusted rate-limit identity.",
    );

    const first = await admission.submitRefereeAdmissionApplication({
      name: "  测试  申请人  ",
      studentId: "abc001",
      phone: "13800000001",
      qq: "12345678",
    }, { rateLimitKey: rateKey });
    assert(first.status === "PENDING", "First admission was not created as PENDING.");

    const beforeDuplicate = await prisma.refereeAdmissionApplication.count();
    let duplicateStatus = 0;
    try {
      await admission.submitRefereeAdmissionApplication({
        name: "测试 申请人",
        studentId: "ABC001",
        phone: "13800000001",
        qq: "12345678",
      }, { rateLimitKey: rateKey });
    } catch (error) {
      if (error instanceof RefereeServiceError) duplicateStatus = error.status;
    }
    assert(duplicateStatus === 0, "Exact repeat should receive the same success semantics.");
    assert(
      await prisma.refereeAdmissionApplication.count() === beforeDuplicate,
      "Duplicate admission created a database row.",
    );

    for (let index = 2; index <= 4; index += 1) {
      await admission.submitRefereeAdmissionApplication({
        name: `共享出口申请人 ${index}`,
        studentId: `1626100${index}`,
        phone: `1380000000${index}`,
      }, { rateLimitKey: rateKey });
    }
    assert(
      await prisma.refereeAdmissionApplication.count() === beforeDuplicate + 3,
      "Shared-IP policy behaved as one-IP-one-application.",
    );

    const concurrent = await Promise.allSettled([
      admission.submitRefereeAdmissionApplication({
        name: "并发申请人甲",
        studentId: "race001",
        phone: "13800000041",
      }),
      admission.submitRefereeAdmissionApplication({
        name: "并发申请人乙",
        studentId: "RACE001",
        phone: "13800000042",
      }),
    ]);
    assert(concurrent.every((r) => r.status === "fulfilled"), "Different claimants sharing an unverified ID must both be accepted.");
    assert(await prisma.refereeAdmissionApplication.count({ where: { studentId: "RACE001" } }) === 2, "An unverified ID claim blocked another applicant.");

    const blockedKey = "f".repeat(64);
    const blockedAttempt = await prisma.loginAttempt.create({
      data: {
        scope: "referee-admission-address",
        keyHash: createHash("sha256").update(blockedKey).digest("hex"),
        failures: admission.admissionAddressMaximumSubmissions,
        blockedUntil: new Date(Date.now() + admission.admissionAddressWindowMs),
      },
    });
    const beforeRateLimit = await prisma.refereeAdmissionApplication.count();
    let rateStatus = 0;
    try {
      await admission.submitRefereeAdmissionApplication({
        name: "达到限额申请人",
        studentId: "16261999",
        phone: "13800000099",
      }, { rateLimitKey: blockedKey, now: new Date(blockedAttempt.updatedAt.getTime() + 1_000) });
    } catch (error) {
      if (error instanceof RefereeServiceError) rateStatus = error.status;
    }
    assert(rateStatus === 429, `Rate-limited admission returned ${rateStatus || "no error"}, expected 429.`);
    assert(
      await prisma.refereeAdmissionApplication.count() === beforeRateLimit,
      "Rate-limited admission created a database row.",
    );

    const resetKey = "e".repeat(64);
    const expiredAt = new Date("2026-08-31T00:15:00.000Z");
    await prisma.loginAttempt.create({
      data: {
        scope: "referee-admission-address",
        keyHash: createHash("sha256").update(resetKey).digest("hex"),
        failures: admission.admissionAddressMaximumSubmissions,
        blockedUntil: expiredAt,
      },
    });
    const resetNow = new Date(expiredAt.getTime() + 1);
    await admission.submitRefereeAdmissionApplication({
      name: "固定窗口重置申请人",
      studentId: "16262000",
      phone: "13800000100",
    }, { rateLimitKey: resetKey, now: resetNow });
    const resetAttempt = await prisma.loginAttempt.findUniqueOrThrow({
      where: { scope_keyHash: { scope: "referee-admission-address", keyHash: createHash("sha256").update(resetKey).digest("hex") } },
    });
    assert(resetAttempt.failures === 1, "Expired admission quota window did not reset its count.");
    assert(
      resetAttempt.blockedUntil?.getTime() === resetNow.getTime() + admission.admissionAddressWindowMs,
      "Reset admission quota did not preserve an exact fixed-window boundary.",
    );

    console.log(JSON.stringify({
      trustedAddressIgnoresSpoofedXff: true,
      duplicateStatus,
      duplicateCreatedRows: 0,
      sharedNatMultipleApplicants: true,
      unverifiedIdentityDoesNotExcludeOthers: true,
      addressLimit: admission.admissionAddressMaximumSubmissions,
      addressWindowMinutes: admission.admissionAddressWindowMs / 60_000,
      rateStatus,
      rateLimitedCreatedRows: 0,
      expiredFixedWindowReset: true,
      duplicateCooldownDays: admission.admissionDuplicateCooldownMs / 86_400_000,
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
