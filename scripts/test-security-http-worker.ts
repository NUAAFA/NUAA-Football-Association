import { createHash } from "node:crypto";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const baseUrl = required("SECURITY_HTTP_BASE_URL");
const password = required("SECURITY_HTTP_PASSWORD");
const matchId = required("SECURITY_HTTP_MATCH_ID");
const refereeId = required("SECURITY_HTTP_REFEREE_ID");
const mutationOrigin = "https://nuaafa.cn";

async function expectStatus(label: string, response: Response, expected: number) {
  if (response.status !== expected) {
    throw new Error(`${label}: expected ${expected}, received ${response.status}: ${await response.text()}`);
  }
  console.log(`PASS ${label}: ${expected}`);
  return response;
}

async function loginMember() {
  const response = await expectStatus("required member login", await fetch(`${baseUrl}/api/referees/login`, {
    method: "POST",
    headers: { origin: mutationOrigin, "content-type": "application/json", "x-real-ip": "203.0.113.10" },
    body: JSON.stringify({ studentId: "16268888", password }),
  }), 200);
  const body = await response.json() as { mustChangePassword?: boolean };
  assert(body.mustChangePassword === true, "Required member login did not report mustChangePassword.");
  const cookie = response.headers.get("set-cookie")?.match(/nuaa_referee_member=[^;]+/u)?.[0];
  assert(cookie, "Required member login did not set a cookie.");
  return cookie;
}

async function memberMutation(pathname: string, method: string, cookie: string, body: unknown) {
  return fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { origin: mutationOrigin, cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
    redirect: "manual",
  });
}

async function expectMemberGate(label: string, response: Response) {
  await expectStatus(label, response, 403);
  const body = await response.json() as { code?: string };
  assert(body.code === "MEMBER_PASSWORD_CHANGE_REQUIRED", `${label}: canonical code mismatch.`);
}

async function verifyAvailabilityDetailAuthorization(adminCookie: string) {
  const { prisma } = await import("../src/lib/prisma");
  const records = await Promise.all(["AVAILABLE", "UNAVAILABLE"].map((kind, index) =>
    prisma.refereeAvailability.create({ data: {
      refereeId,
      kind: kind as "AVAILABLE" | "UNAVAILABLE",
      startAt: new Date(`2030-02-0${index + 1}T02:00:00Z`),
      endAt: new Date(`2030-02-0${index + 1}T04:00:00Z`),
      note: `Isolated availability authorization ${kind}`,
    } }),
  ));
  const detailPath = `/api/referees/admin/availability/${refereeId}`;
  const getWithoutOrigin = (pathname: string, cookie?: string) => fetch(`${baseUrl}${pathname}`, {
    headers: cookie ? { cookie } : {},
    redirect: "manual",
  });
  const detail = await expectStatus("availability detail read permission without Origin", await getWithoutOrigin(detailPath, adminCookie), 200);
  const data = await detail.json() as { referee?: { id?: string }; records?: Array<{ id: string; kind: string }>; total?: number };
  assert(data.referee?.id === refereeId && data.total === 2, "Authorized availability detail did not return the isolated referee and records.");
  assert(records.every((record) => data.records?.some((item) => item.id === record.id)), "Authorized detail omitted availability records.");
  const filtered = await expectStatus("availability detail filtered read without Origin", await getWithoutOrigin(`${detailPath}?kind=AVAILABLE`, adminCookie), 200);
  const filteredData = await filtered.json() as { total?: number; records?: Array<{ kind: string }> };
  assert(filteredData.total === 1 && filteredData.records?.[0]?.kind === "AVAILABLE", "Detail kind filter changed.");
  await expectStatus("availability detail no session without Origin", await getWithoutOrigin(detailPath), 401);
  await expectStatus("availability detail missing referee", await getWithoutOrigin("/api/referees/admin/availability/missing-referee", adminCookie), 404);

  async function adminLoginCookie(username: string) {
    const response = await expectStatus(`${username} availability fixture login`, await fetch(`${baseUrl}/api/referees/admin/login`, {
      method: "POST",
      headers: { origin: mutationOrigin, "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    }), 200);
    const cookie = response.headers.get("set-cookie")?.match(/nuaa_referee_admin=[^;]+/u)?.[0];
    assert(cookie, "Availability fixture login did not set a cookie.");
    return cookie;
  }
  const contentCookie = await adminLoginCookie("smoke-content");
  await expectStatus("availability detail role denied without Origin", await getWithoutOrigin(detailPath, contentCookie), 403);
  const requiredCookie = await adminLoginCookie("required-referee");
  const requiredResponse = await expectStatus("availability detail password-change gate", await getWithoutOrigin(detailPath, requiredCookie), 403);
  assert((await requiredResponse.json() as { code?: string }).code === "ADMIN_PASSWORD_CHANGE_REQUIRED", "Detail bypassed the required-password gate.");
  await expectStatus("other admin content GET still role denied", await getWithoutOrigin("/api/admin/content/posts", adminCookie), 403);

  const before = JSON.stringify({
    availability: await prisma.refereeAvailability.findMany({ orderBy: { id: "asc" } }),
    accounts: await prisma.adminAccount.findMany({ orderBy: { id: "asc" } }),
    teams: await prisma.team.findMany({ orderBy: { id: "asc" } }),
  });
  const mutations = [
    { path: "/api/referees/admin/availability", method: "POST", body: { refereeId, startAt: "2030-03-01T10:00", endAt: "2030-03-01T12:00", kind: "AVAILABLE" } },
    { path: "/api/referees/admin/availability", method: "DELETE", body: { refereeId, id: records[0].id } },
    { path: "/api/referees/admin/accounts/missing-account", method: "PATCH", body: { name: "blocked" } },
    { path: "/api/referees/admin/teams", method: "POST", body: { name: "blocked" } },
  ];
  for (const mutation of mutations) {
    for (const origin of [null, "https://attacker.invalid"]) {
      const response = await expectStatus(`${mutation.method} ${mutation.path} ${origin ? "foreign" : "missing"} Origin blocked`, await fetch(`${baseUrl}${mutation.path}`, {
        method: mutation.method,
        headers: { cookie: adminCookie, "content-type": "application/json", ...(origin ? { origin } : {}) },
        body: JSON.stringify(mutation.body),
      }), 403);
      assert((await response.json() as { error?: string }).error === "请求来源无效。", "A mutation failed outside its Origin guard.");
    }
  }
  const after = JSON.stringify({
    availability: await prisma.refereeAvailability.findMany({ orderBy: { id: "asc" } }),
    accounts: await prisma.adminAccount.findMany({ orderBy: { id: "asc" } }),
    teams: await prisma.team.findMany({ orderBy: { id: "asc" } }),
  });
  assert(after === before, "Rejected mutations changed isolated business data.");
  console.log("PASS availability detail GET: production-mode no-Origin read, session/RBAC/password gates, unchanged POST/PATCH/DELETE Origin guards and zero rejected writes.");
}

async function main() {
  process.env.DATABASE_URL = `file:${required("SECURITY_HTTP_DATABASE_PATH").replaceAll("\\", "/")}`;
  const { prisma } = await import("../src/lib/prisma");
  try {
    const memberCookie = await loginMember();
    const snapshot = async () => JSON.stringify({
      referee: await prisma.referee.findUniqueOrThrow({ where: { id: refereeId }, select: { phone: true, qq: true, mustChangePassword: true, updatedAt: true } }),
      availability: await prisma.refereeAvailability.count({ where: { refereeId } }),
      applications: await prisma.refereeApplication.count({ where: { refereeId } }),
      acknowledgements: await prisma.appointmentAcknowledgement.count({ where: { refereeId } }),
      conflicts: await prisma.appointmentConflictReport.count({ where: { refereeId } }),
    });
    const beforeBlocked = await snapshot();
    await expectMemberGate("member profile blocked", await memberMutation("/api/referees/account/profile", "PATCH", memberCookie, { phone: "13900000000", qq: "99887766" }));
    await expectMemberGate("member availability create blocked", await memberMutation("/api/referees/availability", "POST", memberCookie, { startAt: "2030-01-01T10:00", endAt: "2030-01-01T12:00", kind: "AVAILABLE", note: "blocked" }));
    await expectMemberGate("member availability delete blocked", await memberMutation("/api/referees/availability", "DELETE", memberCookie, { id: "missing" }));
    await expectMemberGate("member application create blocked", await memberMutation("/api/referees/applications", "POST", memberCookie, { matchId, preferredPositions: ["REFEREE"], note: "blocked" }));
    await expectMemberGate("member application withdraw blocked", await memberMutation("/api/referees/applications/missing", "DELETE", memberCookie, {}));
    await expectMemberGate("member appointment acknowledge blocked", await memberMutation("/api/referees/appointments/missing/acknowledge", "POST", memberCookie, {}));
    await expectMemberGate("member appointment conflict blocked", await memberMutation("/api/referees/appointments/missing/conflict", "POST", memberCookie, { reason: "blocked" }));
    assert(await snapshot() === beforeBlocked, "Blocked member business APIs changed business state.");

    const passwordAllowed = await memberMutation("/api/referees/account/password", "POST", memberCookie, { currentPassword: "wrong-password", newPassword: "Security-R1-New-Password-2026" });
    assert(passwordAllowed.status === 401, `Password-change allow-path returned ${passwordAllowed.status}, expected typed 401 rather than required-password 403.`);
    await prisma.referee.update({ where: { id: refereeId }, data: { mustChangePassword: false } });
    await expectStatus("member malformed JSON typed error", await fetch(`${baseUrl}/api/referees/account/profile`, {
      method: "PATCH",
      headers: { origin: mutationOrigin, cookie: memberCookie, "content-type": "application/json" },
      body: "{",
    }), 400);
    await expectStatus("member normal business path after password gate", await memberMutation("/api/referees/account/profile", "PATCH", memberCookie, { phone: "13900000000", qq: "99887766" }), 200);

    const adminLogin = await expectStatus("referee admin login", await fetch(`${baseUrl}/api/referees/admin/login`, {
      method: "POST",
      headers: { origin: mutationOrigin, "content-type": "application/json", "x-real-ip": "203.0.113.11" },
      body: JSON.stringify({ username: "smoke-referee", password }),
    }), 200);
    const adminCookie = adminLogin.headers.get("set-cookie")?.match(/nuaa_referee_admin=[^;]+/u)?.[0];
    assert(adminCookie, "Referee admin login did not set a cookie.");

    await verifyAvailabilityDetailAuthorization(adminCookie);

    const appointment = await prisma.refereeAppointment.create({
      data: {
        matchId,
        status: "COMPLETED",
        revision: 1,
        completedAt: new Date("2030-01-01T00:00:00Z"),
        positions: { create: { key: "REFEREE", label: "裁判员", sortOrder: 10, slot: 1, refereeId } },
      },
    });
    const terminalSnapshot = async () => JSON.stringify(await prisma.refereeAppointment.findUniqueOrThrow({
      where: { id: appointment.id },
      include: { positions: true, versions: true },
    }));
    const beforeTerminal = await terminalSnapshot();
    await expectStatus("completed direct draft API blocked", await fetch(`${baseUrl}/api/referees/admin/appointments/${matchId}`, {
      method: "PUT",
      headers: { origin: mutationOrigin, cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ positions: [{ key: "REFEREE", slot: 1, refereeId }], publicationNote: "blocked", changeReason: "blocked" }),
    }), 409);
    await expectStatus("completed direct publish API blocked", await fetch(`${baseUrl}/api/referees/admin/appointments/${matchId}`, {
      method: "POST",
      headers: { origin: mutationOrigin, cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ action: "publish", reason: "blocked" }),
    }), 409);
    assert(await terminalSnapshot() === beforeTerminal, "Direct terminal appointment API changed row/version/timestamps.");

    const admissionHeaders = { origin: mutationOrigin, "content-type": "application/json", "x-real-ip": "203.0.113.77" };
    const admissionBody = { name: "HTTP Security Applicant", studentId: "sec-http-1", phone: "13911112222", qq: "76543210" };
    await expectStatus("public admission create", await fetch(`${baseUrl}/api/referees/admission-applications`, { method: "POST", headers: admissionHeaders, body: JSON.stringify(admissionBody) }), 201);
    const beforeDuplicate = await prisma.refereeAdmissionApplication.count();
    await expectStatus("public admission duplicate", await fetch(`${baseUrl}/api/referees/admission-applications`, { method: "POST", headers: admissionHeaders, body: JSON.stringify(admissionBody) }), 409);
    assert(await prisma.refereeAdmissionApplication.count() === beforeDuplicate, "HTTP duplicate created a business row.");
    const blockedAddress = "203.0.113.78";
    const blockedKey = createHash("sha256").update(`referee-admission:${blockedAddress}`).digest("hex");
    await prisma.loginAttempt.create({ data: { scope: "referee-admission-address", keyHash: blockedKey, failures: 30, blockedUntil: new Date(Date.now() + 900_000) } });
    const beforeRate = await prisma.refereeAdmissionApplication.count();
    await expectStatus("public admission rate limit", await fetch(`${baseUrl}/api/referees/admission-applications`, {
      method: "POST",
      headers: { ...admissionHeaders, "x-real-ip": blockedAddress },
      body: JSON.stringify({ name: "HTTP Rate Applicant", studentId: "16267777", phone: "13911113333" }),
    }), 429);
    assert(await prisma.refereeAdmissionApplication.count() === beforeRate, "HTTP rate limit created a business row.");

    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const response = await fetch(`${baseUrl}/api/referees/login`, {
        method: "POST",
        headers: {
          origin: mutationOrigin,
          "content-type": "application/json",
          "x-real-ip": "203.0.113.90",
          "x-forwarded-for": `${attempt}.${attempt}.${attempt}.${attempt}`,
        },
        body: JSON.stringify({ studentId: "16268888", password: "wrong-password" }),
      });
      assert(response.status === (attempt === 6 ? 429 : 401), `Spoof attempt ${attempt} returned ${response.status}.`);
    }
    console.log("PASS rotating XFF cannot evade login rate-limit identity: 429");
    await expectStatus("member logout allow-path", await memberMutation("/api/referees/logout", "POST", memberCookie, {}), 200);
    console.log("F-001/F-003/F-007/F-011 direct HTTP security regressions passed.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
