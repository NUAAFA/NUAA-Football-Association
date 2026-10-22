import { createClient } from "@libsql/client";

type RoleName =
  | "super"
  | "content"
  | "competition"
  | "referee"
  | "multi"
  | "contentReferee"
  | "contentCompetition";

type RoleCapabilities = {
  content: boolean;
  competition: boolean;
  referee: boolean;
  system: boolean;
};

const baseUrl = requiredEnvironment("UNIFIED_ADMIN_BLOCKER_BASE_URL");
const databasePath = requiredEnvironment("UNIFIED_ADMIN_BLOCKER_DATABASE_PATH");
const password = requiredEnvironment("UNIFIED_ADMIN_BLOCKER_PASSWORD");
const publicMediaId = requiredEnvironment("UNIFIED_ADMIN_BLOCKER_PUBLIC_MEDIA_ID");
const privateMediaId = requiredEnvironment("UNIFIED_ADMIN_BLOCKER_PRIVATE_MEDIA_ID");
const competitionId = requiredEnvironment("UNIFIED_ADMIN_BLOCKER_COMPETITION_ID");
const matchId = requiredEnvironment("UNIFIED_ADMIN_BLOCKER_MATCH_ID");
const refereeId = requiredEnvironment("UNIFIED_ADMIN_BLOCKER_REFEREE_ID");
const mutationOrigin = "https://nuaafa.cn";

const usernames: Record<RoleName, string> = {
  super: "smoke-super",
  content: "smoke-content",
  competition: "smoke-competition",
  referee: "smoke-referee",
  multi: "smoke-multi",
  contentReferee: "smoke-content-referee",
  contentCompetition: "smoke-content-competition",
};

const capabilities: Record<RoleName, RoleCapabilities> = {
  super: { content: true, competition: true, referee: true, system: true },
  content: { content: true, competition: false, referee: false, system: false },
  competition: { content: false, competition: true, referee: false, system: false },
  referee: { content: false, competition: false, referee: true, system: false },
  multi: { content: false, competition: true, referee: true, system: false },
  contentReferee: { content: true, competition: false, referee: true, system: false },
  contentCompetition: { content: true, competition: true, referee: false, system: false },
};

const requiredUsernames = {
  super: "required-super",
  content: "required-content",
  competition: "required-competition",
  referee: "required-referee",
} as const;

const businessSeedMarkers = [
  "R1-2 数据库新闻 01",
  "R1 浏览器隔离测试赛事",
  "R1 Smoke 主队",
  "R1 Smoke 客队",
  "R1 浏览器隔离测试裁判",
  "R1-3A 待审核申请人",
  "冒烟超级管理员",
  "smoke-super",
] as const;

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectStatus(label: string, actual: number, expected: number) {
  assert(actual === expected, `${label}: expected ${expected}, received ${actual}.`);
  console.log(`PASS ${label}: ${actual}`);
}

function assertNoBusinessSeed(label: string, payload: string) {
  for (const marker of businessSeedMarkers) {
    assert(!payload.includes(marker), `${label}: leaked seeded business data marker ${marker}.`);
  }
}

async function login(username: string, label: string) {
  const response = await fetch(`${baseUrl}/api/referees/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: mutationOrigin },
    body: JSON.stringify({ username, password }),
    redirect: "manual",
  });
  expectStatus(`${label} login`, response.status, 200);
  const cookie = response.headers.get("set-cookie")?.match(/nuaa_referee_admin=[^;]+/)?.[0];
  assert(cookie, `${label}: login did not set the administrator cookie.`);
  return cookie;
}

function apiRequest(input: {
  path: string;
  method: string;
  cookie?: string;
  body?: string;
}) {
  return fetch(`${baseUrl}${input.path}`, {
    method: input.method,
    headers: {
      origin: mutationOrigin,
      ...(input.cookie ? { cookie: input.cookie } : {}),
      ...(input.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: input.body,
    redirect: "manual",
  });
}

async function expectPasswordChangeGate(label: string, response: Response) {
  expectStatus(label, response.status, 403);
  const body = await response.json() as { code?: string; error?: string };
  assert(
    body.code === "ADMIN_PASSWORD_CHANGE_REQUIRED" &&
      body.error === "请先修改管理员初始密码。",
    `${label}: password-change response contract mismatch.`,
  );
}

async function verifyLockedPage(
  label: string,
  path: string,
  cookie: string,
) {
  const direct = await fetch(`${baseUrl}${path}`, {
    headers: { cookie },
    redirect: "manual",
  });
  let htmlResponse = direct;
  if ([303, 307, 308].includes(direct.status)) {
    const location = new URL(direct.headers.get("location") ?? "", baseUrl);
    assert(location.pathname === "/admin", `${label}: expected the safe /admin lock landing, received ${location}.`);
    assertNoBusinessSeed(`${label} redirect response`, await direct.text());
    htmlResponse = await fetch(location, { headers: { cookie }, redirect: "manual" });
  }
  expectStatus(`${label} locked HTML`, htmlResponse.status, 200);
  const html = await htmlResponse.text();
  assert(
    html.includes("完成首次密码修改") &&
      html.includes("修改成功前不能使用后台业务功能"),
    `${label}: locked HTML shell was not rendered.`,
  );
  assertNoBusinessSeed(`${label} locked HTML`, html);

  const rscHeaders = { cookie, RSC: "1", accept: "text/x-component" };
  let rscUrl = new URL(path, baseUrl);
  let rscResponse: Response | null = null;
  for (let redirectCount = 0; redirectCount < 4; redirectCount += 1) {
    const response = await fetch(rscUrl, { headers: rscHeaders, redirect: "manual" });
    if (![303, 307, 308].includes(response.status)) {
      rscResponse = response;
      break;
    }
    const rscLocation = new URL(response.headers.get("location") ?? "", baseUrl);
    assert(
      rscLocation.pathname === path || rscLocation.pathname === "/admin",
      `${label}: unexpected RSC redirect target ${rscLocation}.`,
    );
    assertNoBusinessSeed(`${label} RSC redirect response`, await response.text());
    rscUrl = rscLocation;
  }
  assert(rscResponse, `${label}: RSC transport redirect chain did not terminate.`);
  expectStatus(`${label} locked RSC`, rscResponse.status, 200);
  assert(
    rscResponse.headers.get("content-type")?.includes("text/x-component"),
    `${label}: request did not return an RSC payload.`,
  );
  const rsc = await rscResponse.text();
  assert(
    rsc.includes("完成首次密码修改") || rsc.includes("/admin"),
    `${label}: RSC payload did not contain the lock shell or safe-lock navigation instruction.`,
  );
  assertNoBusinessSeed(`${label} locked RSC`, rsc);
}

async function verifyRequiredPasswordMatrix() {
  const requiredCookies = Object.fromEntries(await Promise.all(
    (Object.keys(requiredUsernames) as Array<keyof typeof requiredUsernames>).map(async (role) => [
      role,
      await login(requiredUsernames[role], `required ${role}`),
    ] as const),
  )) as Record<keyof typeof requiredUsernames, string>;

  await expectPasswordChangeGate(
    "required CONTENT_EDITOR canonical API",
    await apiRequest({ path: "/api/admin/content/posts", method: "GET", cookie: requiredCookies.content }),
  );
  await expectPasswordChangeGate(
    "required COMPETITION_ADMIN legacy API",
    await apiRequest({ path: "/api/referees/admin/competitions", method: "POST", cookie: requiredCookies.competition, body: "{}" }),
  );
  await expectPasswordChangeGate(
    "required REFEREE_ADMIN canonical API",
    await apiRequest({ path: "/api/referees/admin/admission-applications", method: "GET", cookie: requiredCookies.referee }),
  );
  await expectPasswordChangeGate(
    "required SUPER_ADMIN canonical API",
    await apiRequest({ path: "/api/admin/system/admin-accounts", method: "POST", cookie: requiredCookies.super, body: "{}" }),
  );

  for (const page of [
    { label: "CONTENT_EDITOR", path: "/admin/content/news", cookie: requiredCookies.content },
    { label: "COMPETITION_ADMIN", path: "/admin/matches", cookie: requiredCookies.competition },
    { label: "REFEREE_ADMIN", path: "/admin/referees", cookie: requiredCookies.referee },
    { label: "SUPER_ADMIN", path: "/admin/system/admins", cookie: requiredCookies.super },
  ]) {
    await verifyLockedPage(`required ${page.label}`, page.path, page.cookie);
  }

  const root = await fetch(`${baseUrl}/admin`, { headers: { cookie: requiredCookies.super } });
  expectStatus("required /admin safe lock landing", root.status, 200);
  const rootHtml = await root.text();
  assert(rootHtml.includes("完成首次密码修改"), "Required /admin did not render the locked shell.");
  assertNoBusinessSeed("required /admin safe lock landing", rootHtml);

  const legacyLocked = await fetch(`${baseUrl}/referees/admin/matches/${matchId}`, {
    headers: { cookie: requiredCookies.referee },
    redirect: "manual",
  });
  expectStatus("required legacy compatibility gate", legacyLocked.status, 307);
  assert(new URL(legacyLocked.headers.get("location") ?? "", baseUrl).pathname === "/admin", "Required legacy route did not fail closed to /admin.");

  expectStatus("PUBLIC media anonymous", (await fetch(`${baseUrl}/media/${publicMediaId}`)).status, 200);
  expectStatus("PUBLIC media required session", (await fetch(`${baseUrl}/media/${publicMediaId}`, { headers: { cookie: requiredCookies.content } })).status, 200);
  await expectPasswordChangeGate(
    "PRIVATE media required session",
    await fetch(`${baseUrl}/media/${privateMediaId}`, { headers: { cookie: requiredCookies.content } }),
  );

  const newPassword = "Required-Content-Blocker-Fixed-2026!";
  const passwordChange = await apiRequest({
    path: "/api/referees/admin/account/password",
    method: "POST",
    cookie: requiredCookies.content,
    body: JSON.stringify({ currentPassword: password, newPassword }),
  });
  expectStatus("required password change success", passwordChange.status, 200);
  const rotatedCookie = passwordChange.headers.getSetCookie().filter((value) => value.startsWith("nuaa_referee_admin=")).at(-1)?.split(";", 1)[0];
  assert(rotatedCookie && rotatedCookie !== requiredCookies.content, "Password change did not rotate the authenticated Cookie.");
  expectStatus("old password-change Cookie rejected", (await fetch(`${baseUrl}/media/${privateMediaId}`, { headers: { cookie: requiredCookies.content } })).status, 401);
  expectStatus(
    "PRIVATE media restored for rotated session",
    (await fetch(`${baseUrl}/media/${privateMediaId}`, { headers: { cookie: rotatedCookie } })).status,
    200,
  );
  console.log("PASS required-password HTML/RSC/API and PUBLIC/PRIVATE media matrix");
}

function expectedRoot(role: RoleName) {
  if (role === "super" || Object.values(capabilities[role]).filter(Boolean).length > 1) return "/admin";
  if (capabilities[role].content) return "/admin/content/news";
  if (capabilities[role].competition) return "/admin/competitions";
  if (capabilities[role].referee) return "/admin/referees";
  return "/admin?denied=legacy";
}

function withSuffix(pathname: string, suffix = "") {
  return `${pathname}${suffix}`;
}

async function verifyLegacyRedirect(
  label: string,
  source: string,
  expected: string,
  cookie: string,
) {
  const direct = await fetch(`${baseUrl}${source}`, { headers: { cookie }, redirect: "manual" });
  expectStatus(`${label} redirect`, direct.status, 307);
  const location = new URL(direct.headers.get("location") ?? "", baseUrl);
  assert(`${location.pathname}${location.search}` === expected, `${label}: expected ${expected}, received ${location.pathname}${location.search}.`);

  const followed = await fetch(`${baseUrl}${source}`, { headers: { cookie }, redirect: "follow" });
  expectStatus(`${label} final page`, followed.status, 200);
  const finalUrl = new URL(followed.url);
  assert(`${finalUrl.pathname}${finalUrl.search}` === expected, `${label}: redirect chain ended at ${finalUrl.pathname}${finalUrl.search}.`);
  await followed.arrayBuffer();
}

async function verifyRoleApi(
  label: string,
  response: Response,
  allowed: boolean,
) {
  if (allowed) {
    assert(![401, 403].includes(response.status) && response.status < 500, `${label}: authorized API ended at ${response.status}.`);
  } else {
    expectStatus(label, response.status, 403);
  }
}

async function verifyLegacyRoleMatrix(cookies: Record<RoleName, string>) {
  for (const role of Object.keys(cookies) as RoleName[]) {
    const caps = capabilities[role];
    const denied = "/admin?denied=legacy";
    await verifyLegacyRedirect(`${role} legacy root`, "/referees/admin", expectedRoot(role), cookies[role]);
    await verifyLegacyRedirect(
      `${role} legacy matches root`,
      "/referees/admin/matches?view=legacy",
      caps.competition
        ? "/admin/matches?view=legacy"
        : caps.referee
          ? "/admin/appointments?view=legacy"
          : denied,
      cookies[role],
    );
    await verifyLegacyRedirect(
      `${role} legacy competitions root`,
      "/referees/admin/matches/competitions?view=legacy",
      caps.competition ? "/admin/competitions?view=legacy" : denied,
      cookies[role],
    );
    await verifyLegacyRedirect(
      `${role} legacy match detail`,
      `/referees/admin/matches/${matchId}?tab=appointments`,
      caps.competition
        ? withSuffix(`/admin/matches/${matchId}`, "?tab=appointments")
        : caps.referee
          ? withSuffix(`/admin/appointments/${matchId}`, "?tab=appointments")
          : denied,
      cookies[role],
    );
    await verifyLegacyRedirect(
      `${role} legacy match edit`,
      `/referees/admin/matches/${matchId}/edit`,
      caps.competition ? `/admin/matches/${matchId}/edit` : denied,
      cookies[role],
    );
    await verifyLegacyRedirect(
      `${role} legacy referee detail`,
      `/referees/admin/referees/${refereeId}`,
      caps.referee ? `/admin/referees/${refereeId}` : denied,
      cookies[role],
    );
    await verifyLegacyRedirect(
      `${role} legacy competition edit`,
      `/referees/admin/matches/competitions/${competitionId}/edit`,
      caps.competition ? `/admin/competitions/${competitionId}/edit` : denied,
      cookies[role],
    );

    await verifyRoleApi(
      `${role} content API permission`,
      await apiRequest({ path: "/api/admin/content/posts", method: "GET", cookie: cookies[role] }),
      caps.content,
    );
    await verifyRoleApi(
      `${role} referee API permission`,
      await apiRequest({ path: "/api/referees/admin/admission-applications", method: "GET", cookie: cookies[role] }),
      caps.referee,
    );
    await verifyRoleApi(
      `${role} competition API permission`,
      await apiRequest({ path: "/api/referees/admin/competitions", method: "POST", cookie: cookies[role], body: "{}" }),
      caps.competition,
    );
    await verifyRoleApi(
      `${role} system API permission`,
      await apiRequest({ path: "/api/admin/system/admin-accounts", method: "POST", cookie: cookies[role], body: "{}" }),
      caps.system,
    );
  }

  const unauthenticated = await fetch(`${baseUrl}/referees/admin/matches/${matchId}`, { redirect: "manual" });
  expectStatus("unauthenticated legacy route", unauthenticated.status, 307);
  assert(new URL(unauthenticated.headers.get("location") ?? "", baseUrl).pathname === "/admin/login", "Unauthenticated legacy route did not redirect to login.");
  console.log("PASS legacy root/matches/deep-link role and multi-role redirect chains plus final API permissions");
}

async function verifyMediaPermissionSemantics(cookies: Record<RoleName, string>) {
  expectStatus("PRIVATE media unauthenticated", (await fetch(`${baseUrl}/media/${privateMediaId}`)).status, 401);
  expectStatus("PRIVATE media role denied", (await fetch(`${baseUrl}/media/${privateMediaId}`, { headers: { cookie: cookies.competition } })).status, 403);
  const allowed = await fetch(`${baseUrl}/media/${privateMediaId}`, { headers: { cookie: cookies.content } });
  expectStatus("PRIVATE media authorized", allowed.status, 200);
  assert(allowed.headers.get("cache-control") === "private, no-store", "PRIVATE media cache policy changed.");
  console.log("PASS existing PUBLIC/PRIVATE media permission semantics");
}

async function expectFixedRuntimeFailure(
  label: string,
  response: Response,
  expectedMessage: string,
) {
  expectStatus(label, response.status, 500);
  const bodyText = await response.text();
  const body = JSON.parse(bodyText) as { error?: string };
  assert(body.error === expectedMessage, `${label}: fixed 500 message changed.`);
  for (const internal of ["LoginAttempt", "AdminSession", "SQLITE", "no such table", "Prisma"]) {
    assert(!bodyText.includes(internal), `${label}: leaked internal runtime detail ${internal}.`);
  }
}

async function verifyUnknownRuntimeBoundaries(normalContentCookie: string) {
  const malformedLogin = await fetch(`${baseUrl}/api/referees/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: mutationOrigin },
    body: "{",
  });
  expectStatus("known malformed login validation", malformedLogin.status, 400);
  assert((await malformedLogin.json() as { error?: string }).error === "登录信息格式不正确。", "Known login validation message changed.");

  const database = createClient({ url: `file:${databasePath.replaceAll("\\", "/")}` });
  try {
    await database.execute('DROP TABLE "LoginAttempt"');
    await expectFixedRuntimeFailure(
      "unknown login database failure",
      await fetch(`${baseUrl}/api/referees/admin/login`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: mutationOrigin },
        body: JSON.stringify({ username: usernames.content, password }),
      }),
      "登录失败，请稍后再试。",
    );

    await database.execute('DROP TABLE "AdminSession"');
    await expectFixedRuntimeFailure(
      "unknown password session failure",
      await apiRequest({
        path: "/api/referees/admin/account/password",
        method: "POST",
        cookie: normalContentCookie,
        body: JSON.stringify({ currentPassword: password, newPassword: "Runtime-Failure-Proof-2026!" }),
      }),
      "密码修改失败，请稍后再试。",
    );
  } finally {
    database.close();
  }
  console.log("PASS login/password unknown runtime failures are fixed 500 responses without internal leakage");
}

async function main() {
  expectStatus("isolated blocker app health", (await fetch(`${baseUrl}/api/health`)).status, 200);
  // This matrix verifies permissions, not login saturation. Keep real KDF
  // admission limits enabled and authenticate the role fixtures sequentially.
  const cookies = {} as Record<RoleName, string>;
  for (const role of Object.keys(usernames) as RoleName[]) cookies[role] = await login(usernames[role], role);

  await verifyRequiredPasswordMatrix();
  await verifyLegacyRoleMatrix(cookies);
  await verifyMediaPermissionSemantics(cookies);
  await verifyUnknownRuntimeBoundaries(cookies.content);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
