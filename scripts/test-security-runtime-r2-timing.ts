import { scrypt as scryptCallback } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";

import { createClient } from "@libsql/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

import { PrismaClient } from "../src/generated/prisma-v29/client";

const scrypt = promisify(scryptCallback);
const identitiesPerClass = 6;
const attemptsPerIdentity = 2;
const maximumLoginRequests = 52;
const requestTimeoutMs = 5_000;
const separationThresholdMs = 25;
const fixturePassword = "Security-R2-Timing-Fixture-2026!";
const wrongPassword = "Security-R2-Timing-Wrong-2026!";
const mutationOrigin = "https://nuaafa.cn";

type Sample = {
  route: "admin" | "referee";
  category: string;
  identity: string;
  ordinal: number;
  latencyMs: number;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function applyMigrations(url: string) {
  const client = createClient({ url });
  try {
    const entries = (await readdir(path.resolve("prisma/migrations"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      await client.executeMultiple(await readFile(path.resolve("prisma/migrations", entry.name, "migration.sql"), "utf8"));
    }
  } finally {
    client.close();
  }
}

async function fixtureHash() {
  const salt = Buffer.from("NUAAFA-R2-TIMING", "utf8");
  const derived = await scrypt(fixturePassword, salt, 64) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

function sequence(prefix: string) {
  return Array.from({ length: identitiesPerClass }, (_, index) => `${prefix}-${index + 1}`);
}

async function prepareFixture(databasePath: string) {
  const url = `file:${databasePath.replaceAll("\\", "/")}`;
  await applyMigrations(url);
  const prisma = new PrismaClient({ adapter: new PrismaLibSql({ url }) });
  const passwordHash = await fixtureHash();
  const adminActive = sequence("r2-timing-admin-active");
  const refereeActive = sequence("R2-TIMING-REF-ACTIVE");
  try {
    await prisma.adminAccount.createMany({ data: adminActive.map((username) => ({
      username,
      displayName: username,
      passwordHash,
      role: "SUPER_ADMIN" as const,
      isActive: true,
    })) });
    await prisma.referee.createMany({ data: refereeActive.map((studentId) => ({
      publicCode: studentId,
      studentId,
      name: studentId,
      passwordHash,
      status: "ACTIVE" as const,
    })) });
    return { adminActive, refereeActive };
  } finally {
    await prisma.$disconnect();
  }
}

async function findPort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate an isolated timing port."));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function startServer(databasePath: string) {
  const port = await findPort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.resolve("node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: `file:${databasePath.replaceAll("\\", "/")}`,
      REFEREE_ADMIN_SESSION_SECRET: "security-r2-timing-admin-session-secret",
      REFEREE_MEMBER_SESSION_SECRET: "security-r2-timing-member-session-secret",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const append = (chunk: Buffer | string) => { output = `${output}${String(chunk)}`.slice(-16_384); };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Timing server exited ${child.exitCode}.\n${output}`);
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.status === 200) return { child, origin, output: () => output };
    } catch {
      // Server is still starting.
    }
    await delay(100);
  }
  child.kill();
  throw new Error(`Timing server did not become healthy.\n${output}`);
}

async function stopServer(child: ChildProcess) {
  if (child.exitCode !== null) return;
  child.kill();
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 5_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function shuffle<T>(items: T[], random: () => number) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function quantile(values: number[], probability: number) {
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function stats(values: number[]) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length - 1);
  const round = (value: number) => Math.round(value * 1_000) / 1_000;
  return {
    n: values.length,
    medianMs: round(quantile(values, 0.5)),
    meanMs: round(mean),
    p90Ms: round(quantile(values, 0.9)),
    p95Ms: round(quantile(values, 0.95)),
    standardDeviationMs: round(Math.sqrt(variance)),
    minMs: round(Math.min(...values)),
    maxMs: round(Math.max(...values)),
  };
}

function compare(left: number[], right: number[]) {
  let wins = 0;
  let ties = 0;
  for (const leftValue of left) {
    for (const rightValue of right) {
      if (leftValue > rightValue) wins += 1;
      else if (leftValue === rightValue) ties += 1;
    }
  }
  const probabilityLeftSlower = (wins + ties / 2) / (left.length * right.length);
  return {
    medianDifferenceMs: Math.round((quantile(left, 0.5) - quantile(right, 0.5)) * 1_000) / 1_000,
    probabilityLeftSlower: Math.round(probabilityLeftSlower * 10_000) / 10_000,
    cliffsDelta: Math.round((2 * probabilityLeftSlower - 1) * 10_000) / 10_000,
  };
}

async function loginFailure(origin: string, route: "admin" | "referee", identity: string) {
  const started = performance.now();
  const response = await fetch(`${origin}${route === "admin" ? "/api/referees/admin/login" : "/api/referees/login"}`, {
    method: "POST",
    headers: { origin: mutationOrigin, "content-type": "application/json", "x-real-ip": "127.0.0.1" },
    body: JSON.stringify(route === "admin"
      ? { username: identity, password: wrongPassword }
      : { studentId: identity, password: wrongPassword }),
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  const body = await response.text();
  assert(response.status === 401, `${route}/${identity} returned ${response.status}: ${body}`);
  return performance.now() - started;
}

async function main() {
  assert(process.version === "v22.23.4", `Node v22.23.4 is required; received ${process.version}.`);
  await readFile(path.resolve(".next/BUILD_ID"), "utf8");
  const root = await mkdtemp(path.join(os.tmpdir(), "nuaafa-security-r2-timing-"));
  const databasePath = path.join(root, "timing.db");
  let running: Awaited<ReturnType<typeof startServer>> | null = null;
  try {
    const fixture = await prepareFixture(databasePath);
    running = await startServer(databasePath);
    await loginFailure(running.origin, "admin", "r2-timing-admin-warm-missing");
    await loginFailure(running.origin, "admin", fixture.adminActive[0]);
    await loginFailure(running.origin, "referee", "R2-TIMING-REF-WARM-MISSING");
    await loginFailure(running.origin, "referee", fixture.refereeActive[0]);

    const categories = [
      { route: "admin" as const, category: "admin_nonexistent", identities: sequence("r2-timing-admin-missing") },
      { route: "admin" as const, category: "admin_active_wrong", identities: fixture.adminActive },
      { route: "referee" as const, category: "referee_nonexistent", identities: sequence("R2-TIMING-REF-MISSING") },
      { route: "referee" as const, category: "referee_active_wrong", identities: fixture.refereeActive },
    ];
    const samples: Sample[] = [];
    const random = seededRandom(0x5232_4635);
    for (let ordinal = 1; ordinal <= attemptsPerIdentity; ordinal += 1) {
      const round = categories.flatMap((category) => category.identities.map((identity) => ({ ...category, identity })));
      for (const item of shuffle(round, random)) {
        assert(samples.length + 4 < maximumLoginRequests, "F-005 bounded request budget reached.");
        samples.push({
          route: item.route,
          category: item.category,
          identity: item.identity,
          ordinal,
          latencyMs: await loginFailure(running.origin, item.route, item.identity),
        });
      }
    }

    const values = (category: string) => samples.filter((sample) => sample.category === category).map((sample) => sample.latencyMs);
    const identityMedians = (category: string) => {
      const selected = samples.filter((sample) => sample.category === category);
      return [...new Set(selected.map((sample) => sample.identity))]
        .map((identity) => quantile(selected.filter((sample) => sample.identity === identity).map((sample) => sample.latencyMs), 0.5));
    };
    const grouped = Object.fromEntries(categories.map(({ category }) => [category, stats(values(category))]));
    const comparisons = {
      admin: compare(identityMedians("admin_active_wrong"), identityMedians("admin_nonexistent")),
      referee: compare(identityMedians("referee_active_wrong"), identityMedians("referee_nonexistent")),
    };
    for (const [label, comparison] of Object.entries(comparisons)) {
      assert(Math.abs(comparison.medianDifferenceMs) < separationThresholdMs, `${label} median timing gap ${comparison.medianDifferenceMs} ms exceeds the bounded 25 ms gate.`);
      assert(comparison.probabilityLeftSlower > 0 && comparison.probabilityLeftSlower < 1, `${label} retained complete active/nonexistent class separation.`);
    }

    const url = `file:${databasePath.replaceAll("\\", "/")}`;
    const verifier = new PrismaClient({ adapter: new PrismaLibSql({ url }) });
    try {
      const attempts = await verifier.loginAttempt.findMany({ select: { failures: true, blockedUntil: true } });
      assert(Math.max(...attempts.map((attempt) => attempt.failures)) <= 3, "Timing regression exceeded the bounded failure count.");
      assert(attempts.every((attempt) => !attempt.blockedUntil), "Timing regression triggered a login block.");
    } finally {
      await verifier.$disconnect();
    }

    console.log(`SECURITY_R2_F005_TIMING=${JSON.stringify({
      environment: { node: process.version, mode: "production-next-localhost", platform: `${process.platform}-${process.arch}`, cpu: os.cpus()[0]?.model },
      method: { identitiesPerClass, attemptsPerIdentity, samplesPerClass: identitiesPerClass * attemptsPerIdentity, warmups: 4, randomizedWithinOrdinal: true },
      grouped,
      comparisons,
      gate: { maximumAbsoluteMedianDifferenceMs: separationThresholdMs, completeSeparationForbidden: true },
    })}`);
    console.log("F-005 bounded production-mode timing regression passed.");
  } finally {
    if (running) await stopServer(running.child);
    const resolved = path.resolve(root);
    const prefix = path.resolve(os.tmpdir(), "nuaafa-security-r2-timing-");
    assert(resolved.startsWith(prefix), "Refusing to remove a non-R2 timing directory.");
    await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
