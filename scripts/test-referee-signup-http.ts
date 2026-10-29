import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, rm, mkdir } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import type { Match } from "../src/generated/prisma-v29/client";

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "nuaafa-signup-http-"));
  const database = path.join(root, "fictional.db"), uploads = path.join(root, "uploads");
  await mkdir(uploads);
  Object.assign(process.env, { DATABASE_URL: "file:" + database, NUAAFA_UPLOAD_DIR: uploads, NUAAFA_ISOLATED_SECURITY_TEST: "1" });
  const raw = createClient({ url: process.env.DATABASE_URL! });
  for (const entry of (await readdir("prisma/migrations", { withFileTypes: true })).filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    await raw.executeMultiple(await readFile(path.join("prisma/migrations", entry.name, "migration.sql"), "utf8"));
  }
  raw.close();
  const { prisma } = await import("../src/lib/prisma");
  const { hashPassword } = await import("../src/lib/referee-security");
  const password = "Synthetic-Signup-Only-2026!";
  const referee = await prisma.referee.create({ data: {
    publicCode: "SIGNUP-SYNTHETIC", studentId: "16268888", name: "虚构培训裁判员", status: "ACTIVE",
    trainingStatus: "IN_TRAINING", assignmentEligibility: "ELIGIBLE", mustChangePassword: false,
    passwordHash: await hashPassword(password),
    capabilities: { create: [
      { format: "ELEVEN_A_SIDE", positionKey: "REFEREE", status: "TRAINING" },
      { format: "ELEVEN_A_SIDE", positionKey: "FOURTH_OFFICIAL", status: "NOT_ASSIGNED" },
      { format: "FUTSAL", positionKey: "SECOND_REFEREE", status: "TRAINING" },
    ] },
  } });
  const matches: Match[] = [];
  for (const format of ["ELEVEN_A_SIDE", "FUTSAL"] as const) {
    const competition = await prisma.competition.create({ data: { slug: "signup-" + format, name: "虚构报名测试", campus: "虚构校区", format, status: "ONGOING", publicPublished: true } });
    const teams = await Promise.all(["A", "B"].map(name => prisma.team.create({ data: { competitionId: competition.id, name: "虚构" + name } })));
    matches.push(await prisma.match.create({ data: { slug: "signup-" + format, competitionId: competition.id,
      stage: "虚构报名测试", homeTeamId: teams[0].id, awayTeamId: teams[1].id, venue: "虚构场地",
      kickoff: new Date(Date.now() + 172800000), applicationDeadline: new Date(Date.now() + 86400000),
      status: "SCHEDULED", applicationWindowStatus: "OPEN",
    } }));
  }
  const socket = net.createServer(); socket.listen(0, "127.0.0.1"); await once(socket, "listening");
  const port = (socket.address() as net.AddressInfo).port; await new Promise<void>(resolve => socket.close(() => resolve()));
  const origin = "http://127.0.0.1:" + port;
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], {
    env: { ...process.env, NODE_ENV: "production", APP_BASE_URL: origin, NEXT_TELEMETRY_DISABLED: "1",
      REFEREE_MEMBER_SESSION_SECRET: "Synthetic-Signup-Member-Secret-2026", REFEREE_ADMIN_SESSION_SECRET: "Synthetic-Signup-Admin-Secret-2026" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = ""; child.stdout.on("data", value => log += value); child.stderr.on("data", value => log += value);
  const checks: string[] = [];
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) break;
      try { if ((await fetch(origin + "/api/health", { signal: AbortSignal.timeout(2000) })).ok) { ready = true; break; } } catch { /* Await isolated process startup. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(ready, log);
    const login = await fetch(origin + "/api/referees/login", { method: "POST", headers: { origin: "https://nuaafa.cn", "content-type": "application/json" }, body: JSON.stringify({ studentId: referee.studentId, password }) });
    assert.equal(login.status, 200, await login.clone().text());
    const cookie = login.headers.getSetCookie().find(value => value.startsWith("nuaa_referee_member="))?.split(";")[0]; assert(cookie);
    const page = async (index = 0) => (await fetch(origin + "/referees/open-matches/" + matches[index].slug, { headers: { cookie } })).text();
    const submit = (index = 0, key = "REFEREE") => fetch(origin + "/api/referees/applications", { method: "POST", headers: { origin: "https://nuaafa.cn", cookie, "content-type": "application/json" }, body: JSON.stringify({ matchId: matches[index].id, preferredPositions: [key] }) });
    const hasOption = (html: string, key: string) => new RegExp('name="preferredPositions"[^>]*value="' + key + '"').test(html);
    for (const [index, key] of [[0, "REFEREE"], [1, "SECOND_REFEREE"]] as const) {
      const html = await page(index);
      assert(hasOption(html, key), "培训中岗位必须显示报名表单：" + key);
      assert(!hasOption(html, "FOURTH_OFFICIAL"), "暂不安排岗位不应出现在表单");
      assert.equal((await submit(index, key)).status, 201);
      checks.push("TRAINING page and real submission: " + key);
    }
    await prisma.refereeApplication.deleteMany({ where: { refereeId: referee.id } });
    for (const eligibility of ["SUSPENDED", "NOT_ELIGIBLE"] as const) {
      await prisma.referee.update({ where: { id: referee.id }, data: { assignmentEligibility: eligibility } });
      assert(!hasOption(await page(), "REFEREE")); assert.equal((await submit()).status, 403);
      checks.push(eligibility + " blocked by page and API");
    }
    await prisma.referee.update({ where: { id: referee.id }, data: { assignmentEligibility: "ELIGIBLE", mustChangePassword: true } });
    assert(!hasOption(await page(), "REFEREE")); assert.equal((await submit()).status, 403); checks.push("initial password blocks page and API");
    await prisma.referee.update({ where: { id: referee.id }, data: { mustChangePassword: false } });
    await prisma.refereePositionCapability.updateMany({ where: { refereeId: referee.id, format: "ELEVEN_A_SIDE" }, data: { status: "NOT_ASSIGNED" } });
    assert(!hasOption(await page(), "REFEREE")); assert.equal((await submit()).status, 409); checks.push("NOT_ASSIGNED and other-format TRAINING cannot apply");
    await prisma.refereePositionCapability.updateMany({ where: { refereeId: referee.id, format: "ELEVEN_A_SIDE", positionKey: "REFEREE" }, data: { status: "READY" } });
    assert(hasOption(await page(), "REFEREE")); assert.equal((await submit()).status, 201); checks.push("READY still works");
    assert.equal((await submit()).status, 409); checks.push("duplicate submission remains blocked");
    await prisma.refereeApplication.deleteMany({ where: { refereeId: referee.id } });
    await prisma.match.update({ where: { id: matches[0].id }, data: { applicationWindowStatus: "CLOSED" } });
    assert(!hasOption(await page(), "REFEREE")); assert.equal((await submit()).status, 409); checks.push("closed window blocks page and API");
    await prisma.referee.update({ where: { id: referee.id }, data: { status: "INACTIVE" } });
    assert(!hasOption(await page(1), "SECOND_REFEREE")); assert.equal((await submit(1, "SECOND_REFEREE")).status, 401); checks.push("inactive account remains blocked");
    console.log(JSON.stringify({ status: "PASS", syntheticDataOnly: true, checks }, null, 2));
  } finally {
    const stopped = once(child, "exit"); child.kill("SIGTERM"); await stopped;
    await prisma.$disconnect(); await rm(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
