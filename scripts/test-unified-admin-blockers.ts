import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hashPassword } from "../src/lib/referee-security";

type PreparedSmoke = {
  databasePath: string;
  uploadRoot: string;
  password: string;
  competitionId: string;
  matchId: string;
  admissionId: string;
  refereeId: string;
  coverMediaId: string;
  privateMediaId: string;
};

function runCapture(command: string, args: string[], environment: NodeJS.ProcessEnv) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: environment,
      stdio: ["ignore", "pipe", "inherit"],
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${command} exited with ${code ?? "unknown"}.`));
    });
  });
}

function runInherited(command: string, args: string[], environment: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: environment,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? "unknown"}.`));
    });
  });
}

function findPort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to allocate an isolated port."));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForHealth(origin: string, server: ChildProcess) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Next server exited before health was ready (${server.exitCode}).`);
    try {
      const response = await fetch(`${origin}/api/health`, { cache: "no-store" });
      if (response.status === 200) return;
    } catch {
      // The isolated server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the isolated Next server.");
}

async function stopServer(server: ChildProcess) {
  if (server.exitCode !== null) return;
  server.kill();
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 5_000);
    server.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function main() {
  const cmsRegression = process.argv.includes("--cms");
  const root = await mkdtemp(path.join(os.tmpdir(), "nuaafa-unified-admin-blockers-"));
  const databasePath = path.join(root, "blockers.db");
  const uploadRoot = path.join(root, "uploads");
  const port = await findPort();
  const origin = `http://127.0.0.1:${port}`;
  let server: ChildProcess | null = null;

  try {
    const fixtureOutput = await runCapture(
      process.execPath,
      ["--import", "tsx", path.resolve("scripts/prepare-unified-admin-smoke.ts")],
      {
        ...process.env,
        DATABASE_URL: `file:${databasePath.replaceAll("\\", "/")}`,
        UNIFIED_ADMIN_SMOKE_DATABASE_PATH: databasePath,
        NUAAFA_UPLOAD_DIR: uploadRoot,
      },
    );
    const fixture = JSON.parse(fixtureOutput.trim().split(/\r?\n/).at(-1) ?? "") as PreparedSmoke;
    const serverEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: `file:${databasePath.replaceAll("\\", "/")}`,
      NUAAFA_UPLOAD_DIR: uploadRoot,
      NUAAFA_CONTENT_SOURCE: "database",
      REFEREE_ADMIN_SESSION_SECRET: "unified-admin-blocker-session-secret-2026",
      REFEREE_ADMIN_PASSWORD_HASH: cmsRegression ? (await hashPassword(fixture.password)).replaceAll("$", "\\$") : "ops-isolated-legacy-login-disabled",
    };
    const runningServer = spawn(
      process.execPath,
      [path.resolve("node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)],
      { cwd: process.cwd(), env: serverEnvironment, stdio: ["ignore", "pipe", "pipe"] },
    );
    server = runningServer;
    runningServer.stdout?.pipe(process.stdout);
    runningServer.stderr?.pipe(process.stderr);
    await waitForHealth(origin, runningServer);

    await runInherited(
      process.execPath,
      ["--import", "tsx", path.resolve(cmsRegression ? "scripts/test-unified-admin-r1-2-http.ts" : "scripts/test-unified-admin-blockers-http.ts")],
      {
        ...serverEnvironment,
        UNIFIED_ADMIN_BLOCKER_BASE_URL: origin,
        UNIFIED_ADMIN_BLOCKER_DATABASE_PATH: fixture.databasePath,
        UNIFIED_ADMIN_BLOCKER_PASSWORD: fixture.password,
        UNIFIED_ADMIN_BLOCKER_COMPETITION_ID: fixture.competitionId,
        UNIFIED_ADMIN_BLOCKER_MATCH_ID: fixture.matchId,
        UNIFIED_ADMIN_BLOCKER_ADMISSION_ID: fixture.admissionId,
        UNIFIED_ADMIN_BLOCKER_REFEREE_ID: fixture.refereeId,
        UNIFIED_ADMIN_BLOCKER_PUBLIC_MEDIA_ID: fixture.coverMediaId,
        UNIFIED_ADMIN_BLOCKER_PRIVATE_MEDIA_ID: fixture.privateMediaId,
        R1_2_SMOKE_BASE_URL: origin,
        R1_2_SMOKE_ORIGIN: "https://nuaafa.cn",
        R1_2_SMOKE_PASSWORD: fixture.password,
        R1_2_LEGACY_PASSWORD: fixture.password,
        R1_2_PUBLIC_MEDIA_ID: fixture.coverMediaId,
        R1_3A_ADMISSION_ID: fixture.admissionId,
      },
    );
  } finally {
    if (server) await stopServer(server);
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
