import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { createClient } from "@libsql/client";

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "nuaafa-security-http-fixed-"));
  const database = path.join(root, "synthetic.db");
  process.env.DATABASE_URL = `file:${database}`;
  const uploadRoot = path.join(root, "uploads");
  const client = createClient({ url: process.env.DATABASE_URL });
  for (const name of (await readdir("prisma/migrations")).sort()) {
    if (name !== "migration_lock.toml") await client.executeMultiple(await readFile(path.join("prisma/migrations", name, "migration.sql"), "utf8"));
  }
  client.close();
  const { prisma } = await import("../src/lib/prisma");
  const { hashPassword } = await import("../src/lib/referee-security");
  const password = "Synthetic-HTTP-Password-2026!", nextPassword = "Synthetic-HTTP-New-Password-2026!";
  await prisma.adminAccount.create({ data: { username: "security-http", displayName: "Synthetic HTTP administrator", passwordHash: await hashPassword(password), role: "SUPER_ADMIN" } });
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDb8AAAAASUVORK5CYII=", "base64");
  const storedFilename = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png";
  const storageKey = `2026/10/${storedFilename}`;
  await mkdir(path.join(uploadRoot, "2026/10"), { recursive: true });
  await writeFile(path.join(uploadRoot, storageKey), image);
  const asset = await prisma.mediaAsset.create({ data: { storageKey, storedFilename, originalFilename: "synthetic.png", mimeType: "image/png", size: image.length, visibility: "PUBLIC" } });
  const require = createRequire(import.meta.url);
  const { ImageOptimizerCache } = require("next/dist/server/image-optimizer");
  const config = await require("next/dist/server/config").default("phase-production-server", process.cwd());
  const cache = new ImageOptimizerCache({ distDir: path.resolve(".next"), nextConfig: config });
  const key = ImageOptimizerCache.getCacheKey({ href: `/media/${asset.id}`, width: 640, quality: 75, mimeType: "image/webp" });
  await cache.set(key, { kind: "IMAGE", buffer: image, etag: "synthetic-cached-image", upstreamEtag: "synthetic-original", extension: "png" }, { cacheControl: { revalidate: 14400 } });
  assert(await cache.get(key), "Synthetic derivative cache was not populated");
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], {
    env: { ...process.env, NODE_ENV: "production", DATABASE_URL: `file:${database}`, NUAAFA_UPLOAD_DIR: uploadRoot, NUAAFA_CONTENT_SOURCE: "database", REFEREE_ADMIN_SESSION_SECRET: "Synthetic-HTTP-Admin-Secret-Only-2026", REFEREE_MEMBER_SESSION_SECRET: "Synthetic-HTTP-Member-Secret-Only-2026", NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  child.stdout.on("data", (c) => { serverLog += c; }); child.stderr.on("data", (c) => { serverLog += c; });
  const cookie = (response: Response) => response.headers.getSetCookie().filter((c) => c.startsWith("nuaa_referee_admin=")).at(-1)?.split(";", 1)[0];
  const json = (body: unknown, session?: string) => ({ method: "POST", headers: { "content-type": "application/json", origin: "https://nuaafa.cn", ...(session ? { cookie: session } : {}) }, body: JSON.stringify(body) });
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) break;
      try { if ((await fetch(base + "/api/health")).ok) { ready = true; break; } } catch { /* wait for loopback listener */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert(ready, serverLog);
    const login = await fetch(base + "/api/referees/admin/login", json({ username: "security-http", password }));
    assert.equal(login.status, 200);
    const oldCookie = cookie(login)!; assert(oldCookie);
    const page = await fetch(base + "/admin/login");
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("x-frame-options"), "SAMEORIGIN");
    assert(page.headers.get("content-security-policy")?.includes("frame-ancestors 'self'"));
    assert.equal((await fetch(base + "/api/admin/content/posts", { headers: { cookie: oldCookie } })).status, 200);
    const changed = await fetch(base + "/api/referees/admin/account/password", json({ currentPassword: password, newPassword: nextPassword }, oldCookie));
    assert.equal(changed.status, 200);
    const newCookie = cookie(changed)!;
    assert(newCookie && oldCookie !== newCookie, "Password change did not rotate Cookie");
    assert.equal((await fetch(base + "/api/admin/content/posts", { headers: { cookie: oldCookie } })).status, 401);
    assert.equal((await fetch(base + "/api/admin/content/posts", { headers: { cookie: newCookie } })).status, 200);
    console.log("PASS HTTP S03: old Cookie invalid, rotated Cookie valid after password change");
    const publicImage = await fetch(base + `/media/${asset.id}`);
    assert.equal(publicImage.status, 200);
    assert.equal(publicImage.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(Buffer.from(await publicImage.arrayBuffer()), image);
    const visibility = await fetch(base + `/api/admin/media/${asset.id}`, { ...json({ visibility: "PRIVATE", confirm: true }, newCookie), method: "PATCH" });
    assert.equal(visibility.status, 200);
    assert.equal((await fetch(base + `/media/${asset.id}`)).status, 401);
    const optimized = await fetch(base + `/_next/image?url=${encodeURIComponent(`/media/${asset.id}`)}&w=640&q=75`, { headers: { accept: "image/webp" } });
    assert.equal(optimized.status, 400, "Old cached derivative URL was still accessible");
    assert.equal((await fetch(base + `/media/${asset.id}`, { headers: { cookie: newCookie } })).status, 200);
    console.log("PASS HTTP R01: private original requires auth; pre-existing derivative cache URL rejected");
    const a = { name: "Synthetic HTTP claimant A", studentId: "102610009", phone: "13000000001" };
    const b = { name: "Synthetic HTTP claimant B", studentId: "102610009", phone: "13000000002" };
    const receipts = [];
    for (const data of [a, b, a]) {
      const response = await fetch(base + "/api/referees/admission-applications", json(data));
      assert.equal(response.status, 201); receipts.push(await response.json());
    }
    assert.deepEqual(receipts[0], receipts[1]); assert.deepEqual(receipts[1], receipts[2]);
    assert.deepEqual(receipts[0], { ok: true, status: "PENDING" });
    assert.equal(await prisma.refereeAdmissionApplication.count({ where: { studentId: "102610009" } }), 2);
    const excessive = await fetch(base + "/api/referees/admin/login", json({ extra: "x".repeat(16 * 1024) }));
    assert.equal(excessive.status, 413);
    assert.equal((await fetch(base + "/api/referees/login", { method: "POST", headers: { origin: "https://nuaafa.cn", "content-type": "text/plain" }, body: "{}" })).status, 415);
    console.log("PASS HTTP S04/R02/headers: uniform receipts, body/content-type limits, framing protection");
  } finally {
    if (child.exitCode === null) { const stopped = new Promise((resolve) => child.once("exit", resolve)); child.kill("SIGTERM"); await stopped; }
    const evidence = process.env.SECURITY_REMEDIATION_EVIDENCE;
    if (evidence) { await mkdir(evidence, { recursive: true }); await writeFile(path.join(evidence, "http-server.log"), serverLog); }
    await prisma.$disconnect();
    await rm(path.join(".next/cache/images", key), { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
