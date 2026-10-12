// Run only in a synthetic, disposable copy of a prebuilt runtime. No install/build/generate.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, realpath, readlink, lstat } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const runtimeArg = process.argv.find((a) => a.startsWith("--runtime="))?.slice(10);
assert(runtimeArg && path.isAbsolute(runtimeArg), "An absolute isolated runtime is required");
const runtime = await realpath(runtimeArg);
const startupArg = process.argv.find((a) => a.startsWith("--startup-fixture="))?.slice(18);
const wrapperArg = process.argv.find((a) => a.startsWith("--wrapper="))?.slice(10);
assert(Boolean(startupArg) === Boolean(wrapperArg), "Wrapper and isolated startup fixture must be supplied together");
const startup = startupArg ? await realpath(startupArg) : null;
if (startup) {
  assert(path.isAbsolute(wrapperArg) && !startup.startsWith("/srv/") && !startup.startsWith("/etc/"));
  assert.equal(await readlink(path.join(runtime, ".env.production")), path.join(startup, ".env.production"));
  assert.equal(await readlink(path.join(runtime, "prisma/dev.db")), path.join(startup, "prisma/dev.db"));
}
assert(!runtime.startsWith("/srv/") && !runtime.startsWith("/etc/"), "Production paths are forbidden");
assert(!(await readdir(runtime)).some((name) => name.startsWith(".env") && !(startup && name === ".env.production")), "Runtime test refuses unexpected environment files or links");
assert(!(await readdir(path.join(runtime, "prisma"))).some((name) => /\.(?:db|sqlite|sqlite3)(?:-|$)/.test(name) && !(startup && name === "dev.db")), "Runtime test refuses unexpected database files");
assert.equal(process.versions.node, "22.23.2");
const requireRuntime = createRequire(path.join(runtime, "package.json"));
assert.equal(requireRuntime("next/package.json").version, "16.3.8");
assert.equal(requireRuntime("prisma/package.json").version, "7.9.1");
const root = startup ? await realpath(path.join(startup, "work")) : await realpath(await mkdtemp(path.join(os.tmpdir(), "nuaafa-prebuilt-runtime-")));
const ownsRoot = !startup;
const rootMetadata = await lstat(root);
assert.equal(rootMetadata.uid, process.getuid(), "Runtime work must belong to the application identity");
// tsx opens a Unix socket below TMPDIR. Long evidence paths can exceed the
// platform socket-path limit, so keep this separately owned scratch path short.
const scratch = await realpath(await mkdtemp("/tmp/nuaafa-runtime-ipc-"));
const uploads = path.join(root, "uploads");
const env = {
  PATH: process.env.PATH, HOME: root, TMPDIR: scratch, TZ: "UTC", NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1", CHECKPOINT_DISABLE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1",
  // Prisma's TypeScript config loader must not add relocated cache executables
  // beneath the verified dependency tree, even in a writable macOS fixture.
  JITI_FS_CACHE: "false",
  DATABASE_URL: `file:${startup ? path.join(startup, "prisma/dev.db") : path.join(root, "synthetic.db")}`, NUAAFA_UPLOAD_DIR: uploads,
  REFEREE_ADMIN_SESSION_SECRET: `Synthetic-Prebuilt-Admin-${randomUUID()}`,
  REFEREE_MEMBER_SESSION_SECRET: `Synthetic-Prebuilt-Member-${randomUUID()}`,
};
const events = [];
function recordEvent(event) {
  events.push(event);
  console.error(`Runtime stage: ${event}`);
}
let server;
let result;
async function run(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: runtime, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d) => { output = (output + d).slice(-200000); });
    child.stderr.on("data", (d) => { output = (output + d).slice(-200000); });
    const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`Runtime command failed (${code}): ${output.slice(-5000)}`)); });
  });
}
async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return port;
}
async function stopServer() {
  if (!server || !server.pid || server.exitCode !== null || server.signalCode !== null) return;
  const stopped = new Promise((resolve) => server.once("exit", resolve));
  server.kill("SIGTERM");
  const timer = setTimeout(() => server.kill("SIGKILL"), 5000);
  await stopped;
  clearTimeout(timer);
}
try {
  await mkdir(uploads);
  // Native image and SQLite drivers must load from the relocated runtime.
  const sharp = requireRuntime("sharp");
  assert((await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer()).length > 0);
  recordEvent("sharp native image operation PASS");
  await run([path.join(runtime, "node_modules/prisma/build/index.js"), "migrate", "deploy"]);
  recordEvent("all 17 synthetic migrations via packaged Prisma CLI PASS");
  const probe = path.join(root, "probe.cjs");
  await writeFile(probe, `const { PrismaClient } = require(${JSON.stringify(path.join(runtime, "src/generated/prisma-v29"))});
const { PrismaLibSql } = require(${JSON.stringify(path.join(runtime, "node_modules/@prisma/adapter-libsql"))});
const p = new PrismaClient({adapter: new PrismaLibSql({url: process.env.DATABASE_URL})});
(async () => { if (await p.referee.count() !== 0) throw Error('synthetic database not empty'); await p.$disconnect(); })().catch(e=>{console.error(e);process.exitCode=1});`);
  await run([probe]);
  recordEvent("relocated generated Prisma client and native libSQL query PASS");
  const aliasRoot = path.join(runtime, ".next/node_modules/@libsql");
  const aliases = await readdir(aliasRoot);
  assert(aliases.length > 0 && aliases.every((name) => /^client-[0-9a-f]{16}$/.test(name)), "Unexpected Next libSQL alias inventory");
  const nextRequire = createRequire(path.join(runtime, ".next/server/chunks/runtime-probe.cjs"));
  for (const alias of aliases) {
    const directory = path.join(aliasRoot, alias);
    const metadata = await lstat(directory);
    assert(metadata.isDirectory() && !metadata.isSymbolicLink(), "Next dependency must be materialized");
    const resolved = nextRequire.resolve(`@libsql/${alias}`);
    assert(resolved.startsWith(directory + path.sep), "Next alias resolved outside materialized package");
    const client = nextRequire(`@libsql/${alias}`).createClient({ url: env.DATABASE_URL });
    try { assert.equal((await client.execute("SELECT 1 AS value")).rows[0].value, 1); }
    finally { client.close(); }
  }
  recordEvent("materialized Next libSQL aliases, actual Node resolution and SQLite query PASS");
  const port = startup ? 3001 : await freePort();
  let log = "";
  server = startup
    ? spawn("/usr/bin/python3", ["-I", wrapperArg], { cwd: "/", env: { PATH: "/usr/bin:/bin", NODE_ENV: "development", NODE_OPTIONS: "--require=/must-not-load", DATABASE_URL: "file:/must-not-open" }, stdio: ["ignore", "pipe", "pipe"] })
    : spawn(process.execPath, [path.join(runtime, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "-p", String(port)], { cwd: runtime, env, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (d) => { log += d; });
  server.stderr.on("data", (d) => { log += d; });
  server.on("error", (e) => { log += e.message; });
  const origin = `http://127.0.0.1:${port}`;
  let healthy = false;
  for (let i = 0; i < 80; i++) {
    if (server.exitCode !== null) throw new Error(`Cold start failed: ${log}`);
    try {
      const r = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok && (await r.json()).status === "ok") { healthy = true; break; }
    } catch { /* Poll a bounded localhost startup. */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert(healthy, `Synthetic cold start timeout: ${log}`);
  if (startup) {
    if (process.platform === "linux") {
      assert.equal(await realpath(`/proc/${server.pid}/cwd`), runtime);
      const status = await readFile(`/proc/${server.pid}/status`, "utf8");
      assert.equal(Number(status.match(/^Uid:\s+(\d+)/m)?.[1]), process.getuid());
    }
    recordEvent("actual start-prebuilt entry, clean inherited environment, shared configuration and application identity PASS (fixed paths adapted; systemd NOT RUN)");
  }
  for (const route of ["/", "/referees"]) {
    const r = await fetch(origin + route, { signal: AbortSignal.timeout(10000) });
    assert.equal(r.status, 200, route);
  }
  const home = await (await fetch(origin, { signal: AbortSignal.timeout(10000) })).text();
  const asset = home.match(/(?:src|href)="(\/_next\/static\/[^"?]+)/)?.[1];
  assert(asset, "Built static asset reference missing");
  assert.equal((await fetch(origin + asset, { signal: AbortSignal.timeout(10000) })).status, 200);
  const publicPath = "/documents/templates/eleven-a-side-match-report.pdf";
  const served = Buffer.from(await (await fetch(origin + publicPath, { signal: AbortSignal.timeout(10000) })).arrayBuffer());
  assert.equal(createHash("sha256").update(served).digest("hex"), createHash("sha256").update(await readFile(path.join(runtime, "public", publicPath))).digest("hex"));
  recordEvent("cold start, Prisma-backed health, two HTTP pages, static and public assets PASS");
  await stopServer();
  // Existing backup/verify/restore scripts use packaged tsx and Git metadata.
  const backup = path.join(root, "backup");
  await run([path.join(runtime, "node_modules/tsx/dist/cli.mjs"), "scripts/backup-unified-data.ts", `--output=${backup}`]);
  await run([path.join(runtime, "node_modules/tsx/dist/cli.mjs"), "scripts/verify-unified-backup.ts", `--backup=${backup}`]);
  const restored = path.join(root, "restored");
  await mkdir(restored);
  env.NUAAFA_RESTORE_ISOLATED = "1";
  env.NUAAFA_RESTORE_TARGET_ROOT = restored;
  await run([path.join(runtime, "node_modules/tsx/dist/cli.mjs"), "scripts/restore-unified-data.ts", `--backup=${backup}`, `--database=${path.join(restored, "restored.db")}`, `--uploads=${path.join(restored, "uploads")}`]);
  assert.equal(createHash("sha256").update(await readFile(path.join(restored, "restored.db"))).digest("hex"), createHash("sha256").update(await readFile(path.join(backup, "database.sqlite"))).digest("hex"));
  recordEvent("packaged backup, verification and isolated restore tools PASS");
  // Exercise the actual deployer backup function from an unrelated cwd. The
  // identity adapter simply retains this already nonprivileged test identity;
  // neither the backup function nor backup/verification tools are mocked.
  await mkdir(path.join(root, "prisma"));
  await writeFile(path.join(root, "prisma/dev.db"), await readFile(env.DATABASE_URL.slice(5)));
  await mkdir(path.join(root, "backups/unified"), { recursive: true });
  const deployer = fileURLToPath(new URL("../ops/deploy/nuaafa-deploy", import.meta.url));
  await new Promise((resolve, reject) => {
    const child = spawn("bash", ["-c", 'source "$1"; shared="$2"; student_id_preflight_node="$3"; prebuilt_python="/usr/bin/python3"; run_as_deploy_user() { "$@"; }; run_prebuilt_backup "$4"', "runtime-test", deployer, root, process.execPath, runtime], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d) => { output += d; });
    child.stderr.on("data", (d) => { output += d; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", (code) => { clearTimeout(timer); if (code === 0 && output.includes("independently verified")) resolve(); else reject(new Error(`Deployer backup failed (${code}): ${output}`)); });
  });
  recordEvent("actual deployer backup function from unrelated cwd PASS");
  result = { platform: `${process.platform}/${process.arch}`, uid: process.getuid(), node: process.versions.node, events, productionAccess: false, releaseAllowed: false };
} catch (error) {
  // Preserve the original failure even if a later cleanup operation also fails.
  console.error(`Runtime failure before cleanup: ${String(error?.stack ?? error).slice(-8000)}`);
  throw error;
} finally {
  await stopServer();
  await rm(scratch, { recursive: true, force: true });
  await assert.rejects(lstat(scratch), { code: "ENOENT" });
  if (ownsRoot) {
    await rm(root, { recursive: true, force: true });
    await assert.rejects(lstat(root), { code: "ENOENT" });
  } else {
    // The caller created this directory under its trusted shared parent. Only
    // that caller may remove the directory entry; errors remain test failures.
    const retained = await lstat(root);
    assert.equal(retained.uid, rootMetadata.uid);
    assert.equal(retained.mode, rootMetadata.mode);
  }
}
result.cleanup = { owner: ownsRoot ? "runtime" : "caller", path: root, removed: ownsRoot, scratchRemoved: true };
console.log(JSON.stringify(result, null, 2));
