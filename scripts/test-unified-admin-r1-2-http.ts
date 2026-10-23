type RoleName = "super" | "content" | "competition" | "referee" | "multi";
type Permission = "dashboard" | "content" | "media" | "competition" | "referee" | "system";

const baseUrl = process.env.R1_2_SMOKE_BASE_URL ?? "http://localhost:3102";
const mutationOrigin = process.env.R1_2_SMOKE_ORIGIN ?? baseUrl;
const password = process.env.R1_2_SMOKE_PASSWORD ?? "Smoke-Password-2026!";
const legacyPassword = process.env.R1_2_LEGACY_PASSWORD;
const requiredPasswordOnly = process.env.R1_2_REQUIRED_PASSWORD_ONLY === "1";
const usernames: Record<RoleName, string> = {
  super: "smoke-super",
  content: "smoke-content",
  competition: "smoke-competition",
  referee: "smoke-referee",
  multi: "smoke-multi",
};
const requiredUsernames = {
  super: "required-super",
  content: "required-content",
  competition: "required-competition",
  referee: "required-referee",
} as const;

const allowedRoles: Record<Permission, readonly RoleName[]> = {
  dashboard: ["super", "content", "competition", "referee", "multi"],
  content: ["super", "content"],
  media: ["super", "content"],
  competition: ["super", "competition", "multi"],
  referee: ["super", "referee", "multi"],
  system: ["super"],
};

function expectStatus(label: string, actual: number, expected: number) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, received ${actual}`);
  console.log(`PASS ${label}: ${actual}`);
}

function expectAllowedStatus(label: string, status: number) {
  if (status === 401 || status === 403 || status >= 500) throw new Error(`${label}: expected authorized application response, received ${status}`);
  console.log(`PASS ${label}: authorized (${status})`);
}

async function loginCredentials(
  username: string,
  loginPassword: string,
  label: string,
  next?: string,
  expectedReturnTo?: string,
) {
  const response = await fetch(`${baseUrl}/api/referees/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: mutationOrigin },
    body: JSON.stringify({ username, password: loginPassword, next }),
    redirect: "manual",
  });
  expectStatus(`${label} login`, response.status, 200);
  const body = await response.json() as { returnTo?: string };
  if (expectedReturnTo && body.returnTo !== expectedReturnTo) {
    throw new Error(`${label} login landing: expected ${expectedReturnTo}, received ${body.returnTo}`);
  }
  const cookie = response.headers.get("set-cookie")?.match(/nuaa_referee_admin=[^;]+/)?.[0];
  if (!cookie) throw new Error(`${label}: login response did not set the administrator cookie`);
  return cookie;
}

async function login(role: RoleName, next?: string, expectedReturnTo?: string) {
  return loginCredentials(usernames[role], password, `${role} AdminAccount reuse`, next, expectedReturnTo);
}

async function apiRequest(input: { path: string; method: string; cookie?: string; origin?: string | null; body?: BodyInit }) {
  const body = input.body ?? (input.method === "GET" ? undefined : "{}");
  return fetch(`${baseUrl}${input.path}`, {
    method: input.method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(input.cookie ? { cookie: input.cookie } : {}),
      ...(input.origin === null ? {} : { origin: input.origin ?? mutationOrigin }),
    },
    body,
    redirect: "manual",
  });
}

async function expectPasswordChangeGate(label: string, response: Response) {
  expectStatus(label, response.status, 403);
  const body = await response.json() as { error?: string; code?: string };
  if (body.code !== "ADMIN_PASSWORD_CHANGE_REQUIRED" || !body.error?.includes("修改管理员初始密码")) {
    throw new Error(`${label}: required-password response contract mismatch.`);
  }
}

async function verifyLegacyApiMatrix(cookies: Record<RoleName, string>) {
  const admissionId = process.env.R1_3A_ADMISSION_ID ?? "missing-admission";
  const routes: Array<{ method: string; path: string; permission: Permission }> = [
    { method: "POST", path: "/api/referees/admin/account/password", permission: "dashboard" },
    { method: "POST", path: "/api/referees/admin/accounts", permission: "referee" },
    { method: "GET", path: "/api/referees/admin/admission-applications", permission: "referee" },
    { method: "GET", path: `/api/referees/admin/admission-applications/${admissionId}`, permission: "referee" },
    { method: "PATCH", path: `/api/referees/admin/admission-applications/${admissionId}`, permission: "referee" },
    { method: "PATCH", path: "/api/referees/admin/accounts/missing-account", permission: "referee" },
    { method: "POST", path: "/api/referees/admin/accounts/missing-account", permission: "referee" },
    { method: "POST", path: "/api/referees/admin/admin-accounts", permission: "system" },
    { method: "PATCH", path: "/api/referees/admin/admin-accounts", permission: "system" },
    { method: "POST", path: "/api/admin/system/admin-accounts", permission: "system" },
    { method: "PATCH", path: "/api/admin/system/admin-accounts", permission: "system" },
    { method: "POST", path: "/api/referees/admin/affiliation-units", permission: "competition" },
    { method: "POST", path: "/api/referees/admin/applications", permission: "referee" },
    { method: "PATCH", path: "/api/referees/admin/applications/missing-application", permission: "referee" },
    { method: "PUT", path: "/api/referees/admin/appointments/missing-match", permission: "referee" },
    { method: "POST", path: "/api/referees/admin/appointments/missing-match", permission: "referee" },
    { method: "POST", path: "/api/referees/admin/availability", permission: "referee" },
    { method: "DELETE", path: "/api/referees/admin/availability", permission: "referee" },
    { method: "POST", path: "/api/referees/admin/colleges", permission: "competition" },
    { method: "POST", path: "/api/referees/admin/competitions", permission: "competition" },
    { method: "PATCH", path: "/api/referees/admin/competitions/missing-competition", permission: "competition" },
    { method: "PATCH", path: "/api/referees/admin/conflict-reports/missing-report", permission: "referee" },
    { method: "GET", path: "/api/referees/admin/exports/invalid-kind", permission: "referee" },
    { method: "POST", path: "/api/referees/admin/matches", permission: "competition" },
    { method: "PATCH", path: "/api/referees/admin/matches/missing-match", permission: "competition" },
    { method: "POST", path: "/api/referees/admin/matches/missing-match", permission: "competition" },
    { method: "DELETE", path: "/api/referees/admin/matches/missing-match", permission: "competition" },
    { method: "PUT", path: "/api/referees/admin/team-affiliations", permission: "competition" },
    { method: "POST", path: "/api/referees/admin/teams", permission: "competition" },
  ];
  for (const route of routes) {
    const label = `${route.method} ${route.path}`;
    expectStatus(`${label} unauthenticated`, (await apiRequest({ ...route })).status, 401);
    if (route.method !== "GET") {
      expectStatus(`${label} Origin/CSRF`, (await apiRequest({ ...route, cookie: cookies.super, origin: "https://attacker.invalid" })).status, 403);
    }
    for (const role of Object.keys(cookies) as RoleName[]) {
      const response = await apiRequest({ ...route, cookie: cookies[role] });
      if (allowedRoles[route.permission].includes(role)) expectAllowedStatus(`${label} ${role}`, response.status);
      else expectStatus(`${label} ${role}`, response.status, 403);
    }
  }
}

async function verifyAdminPageMatrix(cookies: Record<RoleName, string>) {
  const pages: Array<{ path: string; permission: Permission }> = [
    { path: "/admin", permission: "dashboard" },
    { path: "/admin/content/news", permission: "content" },
    { path: "/admin/media", permission: "media" },
    { path: "/admin/competitions", permission: "competition" },
    { path: "/admin/matches", permission: "competition" },
    { path: "/admin/organizations", permission: "competition" },
    { path: "/admin/referees", permission: "referee" },
    { path: "/admin/referees/admissions", permission: "referee" },
    { path: `/admin/referees/admissions/${process.env.R1_3A_ADMISSION_ID ?? "missing-admission"}`, permission: "referee" },
    { path: "/admin/referees/availability", permission: "referee" },
    { path: "/admin/appointments", permission: "referee" },
    { path: "/admin/conflicts", permission: "referee" },
    { path: "/admin/statistics", permission: "referee" },
    { path: "/admin/system/admins", permission: "system" },
    { path: "/admin/system/audit", permission: "system" },
  ];
  for (const page of pages) {
    const unauthenticated = await fetch(`${baseUrl}${page.path}`, { redirect: "manual" });
    if (![303, 307, 308].includes(unauthenticated.status) || !unauthenticated.headers.get("location")?.includes("/admin/login")) {
      throw new Error(`${page.path} unauthenticated direct URL did not redirect to login`);
    }
    for (const role of Object.keys(cookies) as RoleName[]) {
      const response = await fetch(`${baseUrl}${page.path}`, { headers: { cookie: cookies[role] }, redirect: "manual" });
      if (allowedRoles[page.permission].includes(role)) expectStatus(`${page.path} ${role} page`, response.status, 200);
      else if (![303, 307, 308].includes(response.status) || !response.headers.get("location")?.includes("/admin?denied=")) {
        throw new Error(`${page.path} ${role}: denied direct URL did not fail closed (${response.status})`);
      } else console.log(`PASS ${page.path} ${role} denied direct URL`);
    }
  }
}

async function verifyLegacyRedirectMatrix(cookie: string) {
  const routes = [
    ["/referees/admin", "/admin"],
    ["/referees/admin/referees", "/admin/referees"],
    ["/referees/admin/referees/new", "/admin/referees/new"],
    ["/referees/admin/referees/ref-1", "/admin/referees/ref-1"],
    ["/referees/admin/availability", "/admin/referees/availability"],
    ["/referees/admin/affiliations", "/admin/organizations"],
    ["/referees/admin/conflicts", "/admin/conflicts"],
    ["/referees/admin/statistics", "/admin/statistics"],
    ["/referees/admin/admins", "/admin/system/admins"],
    ["/referees/admin/audit-log", "/admin/system/audit"],
    ["/referees/admin/matches", "/admin/matches"],
    ["/referees/admin/matches/new", "/admin/matches/new"],
    ["/referees/admin/matches/match-1", "/admin/matches/match-1"],
    ["/referees/admin/matches/match-1/edit", "/admin/matches/match-1/edit"],
    ["/referees/admin/matches/competitions", "/admin/competitions"],
    ["/referees/admin/matches/competitions/new", "/admin/competitions/new"],
    ["/referees/admin/matches/competitions/competition-1/edit", "/admin/competitions/competition-1/edit"],
  ] as const;
  for (const [source, destination] of routes) {
    const preserveQuery = source !== "/referees/admin";
    const response = await fetch(`${baseUrl}${source}${preserveQuery ? "?legacy=1" : ""}`, {
      headers: { cookie },
      redirect: "manual",
    });
    const location = response.headers.get("location");
    if (![307, 308].includes(response.status) || !location) throw new Error(`${source} did not redirect (${response.status}).`);
    const parsed = new URL(location, baseUrl);
    if (
      parsed.pathname !== destination ||
      (preserveQuery && parsed.searchParams.get("legacy") !== "1") ||
      (!preserveQuery && parsed.search)
    ) {
      throw new Error(`${source}: expected ${destination} with query, received ${location}`);
    }
    console.log(`PASS legacy redirect ${source} -> ${destination}`);
  }
  const loginRedirect = await fetch(`${baseUrl}/referees/admin/login?next=${encodeURIComponent("/referees/admin/statistics")}`, { redirect: "manual" });
  const loginLocation = new URL(loginRedirect.headers.get("location") ?? "", baseUrl);
  if (![303, 307, 308].includes(loginRedirect.status) || loginLocation.pathname !== "/admin/login" || loginLocation.searchParams.get("next") !== "/admin/statistics") {
    throw new Error(`Legacy login next mapping failed: ${loginRedirect.status} ${loginLocation}`);
  }
}

async function verifyNavigation(cookies: Record<RoleName, string>) {
  const expected: Record<RoleName, { shown: string[]; hidden: string[] }> = {
    super: { shown: ["/admin/content/news", "/admin/competitions", "/admin/referees", "/admin/system/admins"], hidden: [] },
    content: { shown: ["/admin/content/news"], hidden: ["/admin/competitions", "/admin/referees", "/admin/system/admins"] },
    competition: { shown: ["/admin/competitions"], hidden: ["/admin/content/news", "/admin/referees", "/admin/system/admins"] },
    referee: { shown: ["/admin/referees"], hidden: ["/admin/content/news", "/admin/competitions", "/admin/system/admins"] },
    multi: { shown: ["/admin/competitions", "/admin/referees"], hidden: ["/admin/content/news", "/admin/system/admins"] },
  };
  for (const role of Object.keys(cookies) as RoleName[]) {
    const response = await fetch(`${baseUrl}/admin`, { headers: { cookie: cookies[role] } });
    expectStatus(`${role} dashboard navigation`, response.status, 200);
    const html = await response.text();
    for (const href of expected[role].shown) if (!html.includes(`href="${href}"`)) throw new Error(`${role} navigation missing ${href}`);
    for (const href of expected[role].hidden) if (html.includes(`href="${href}"`)) throw new Error(`${role} navigation exposed ${href}`);
  }
}

async function verifyLoginLandings() {
  await login("super", undefined, "/admin");
  await login("content", undefined, "/admin/content/news");
  await login("competition", undefined, "/admin/competitions");
  await login("referee", undefined, "/admin/referees");
  await login("multi", undefined, "/admin");
  await login("content", "/admin/media", "/admin/media");
  await login("content", "/admin/competitions", "/admin/content/news");
  await login("super", "//attacker.invalid", "/admin");
  await login("super", "admin/media", "/admin");
}

async function verifyRequiredPasswordChange() {
  const requiredCookies = Object.fromEntries(await Promise.all(
    (Object.keys(requiredUsernames) as Array<keyof typeof requiredUsernames>).map(async (role) => [
      role,
      await loginCredentials(requiredUsernames[role], password, `required ${role}`, "/admin/media", "/admin"),
    ] as const),
  )) as Record<keyof typeof requiredUsernames, string>;
  const contentOtherSession = await loginCredentials(
    requiredUsernames.content,
    password,
    "required content second session",
    undefined,
    "/admin",
  );

  await expectPasswordChangeGate(
    "required CONTENT_EDITOR canonical GET",
    await apiRequest({ path: "/api/admin/content/posts", method: "GET", cookie: requiredCookies.content }),
  );
  await expectPasswordChangeGate(
    "required CONTENT_EDITOR canonical POST",
    await apiRequest({ path: "/api/admin/content/posts", method: "POST", cookie: requiredCookies.content }),
  );
  await expectPasswordChangeGate(
    "required COMPETITION_ADMIN legacy API",
    await apiRequest({ path: "/api/referees/admin/competitions", method: "POST", cookie: requiredCookies.competition }),
  );
  await expectPasswordChangeGate(
    "required REFEREE_ADMIN unified admission API",
    await apiRequest({ path: "/api/referees/admin/admission-applications", method: "GET", cookie: requiredCookies.referee }),
  );
  await expectPasswordChangeGate(
    "required REFEREE_ADMIN legacy API",
    await apiRequest({ path: "/api/referees/admin/applications", method: "POST", cookie: requiredCookies.referee }),
  );
  await expectPasswordChangeGate(
    "required SUPER_ADMIN canonical system API",
    await apiRequest({ path: "/api/admin/system/admin-accounts", method: "POST", cookie: requiredCookies.super }),
  );

  const requiredPages: Array<{ label: string; path: string; cookie: string; forbiddenHref: string }> = [
    { label: "CONTENT_EDITOR", path: "/admin/content/news", cookie: requiredCookies.content, forbiddenHref: "/admin/content/news" },
    { label: "COMPETITION_ADMIN", path: "/admin/competitions", cookie: requiredCookies.competition, forbiddenHref: "/admin/competitions" },
    { label: "REFEREE_ADMIN", path: "/admin/referees", cookie: requiredCookies.referee, forbiddenHref: "/admin/referees" },
    { label: "SUPER_ADMIN", path: "/admin/system/admins", cookie: requiredCookies.super, forbiddenHref: "/admin/system/admins" },
  ];
  for (const page of requiredPages) {
    const response = await fetch(`${baseUrl}${page.path}`, {
      headers: { cookie: page.cookie },
      redirect: "manual",
    });
    expectStatus(`required ${page.label} locked page`, response.status, 200);
    const html = await response.text();
    if (
      !html.includes("完成首次密码修改") ||
      !html.includes("修改成功前不能使用后台业务功能") ||
      html.includes(`href="${page.forbiddenHref}"`) ||
      html.includes("aria-label=\"关闭\"") ||
      html.includes(">取消</button>")
    ) {
      throw new Error(`required ${page.label} page did not remain in the non-dismissible locked shell.`);
    }
    console.log(`PASS required ${page.label} server-rendered page lock`);
  }
  const requiredLoginPage = await fetch(`${baseUrl}/admin/login?next=${encodeURIComponent("/admin/media")}`, {
    headers: { cookie: requiredCookies.content },
    redirect: "manual",
  });
  if (![303, 307, 308].includes(requiredLoginPage.status) || new URL(requiredLoginPage.headers.get("location") ?? "", baseUrl).pathname !== "/admin") {
    throw new Error("Existing required-change session did not return to the locked admin shell.");
  }
  console.log("PASS required-change login page landing");

  const passwordRequest = (cookie: string, currentPassword: string, newPassword: string, origin = mutationOrigin) => apiRequest({
    path: "/api/referees/admin/account/password",
    method: "POST",
    cookie,
    origin,
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  expectStatus(
    "required password endpoint bad Origin",
    (await passwordRequest(requiredCookies.content, password, "Required-Content-New-2026!", "https://attacker.invalid")).status,
    403,
  );
  expectStatus(
    "required password endpoint wrong current password",
    (await passwordRequest(requiredCookies.content, "Wrong-Password-2026!", "Required-Content-New-2026!")).status,
    401,
  );
  expectStatus(
    "required password endpoint short new password",
    (await passwordRequest(requiredCookies.content, password, "too-short")).status,
    400,
  );
  expectStatus(
    "required password endpoint unchanged password",
    (await passwordRequest(requiredCookies.content, password, password)).status,
    400,
  );
  await expectPasswordChangeGate(
    "failed password change preserved required gate",
    await apiRequest({ path: "/api/admin/content/posts", method: "GET", cookie: requiredCookies.content }),
  );

  const newContentPassword = "Required-Content-New-2026!";
  const oldContentCookie = requiredCookies.content;
  const passwordChanged = await passwordRequest(oldContentCookie, password, newContentPassword);
  expectStatus(
    "required password endpoint success",
    passwordChanged.status,
    200,
  );
  const rotatedCookie = passwordChanged.headers.getSetCookie()
    .filter((value) => value.startsWith("nuaa_referee_admin=") && !value.startsWith("nuaa_referee_admin=;"))
    .at(-1)?.split(";", 1)[0];
  if (!rotatedCookie || rotatedCookie === oldContentCookie) throw new Error("Password change did not rotate the current session cookie.");
  expectStatus(
    "old current session invalidated after password change",
    (await apiRequest({ path: "/api/admin/content/posts", method: "GET", cookie: oldContentCookie })).status,
    401,
  );
  requiredCookies.content = rotatedCookie;
  expectAllowedStatus(
    "rotated current session restored after password change",
    (await apiRequest({ path: "/api/admin/content/posts", method: "GET", cookie: requiredCookies.content })).status,
  );
  expectStatus(
    "other session invalidated after password change",
    (await apiRequest({ path: "/api/admin/content/posts", method: "GET", cookie: contentOtherSession })).status,
    401,
  );
  const unlockedPage = await fetch(`${baseUrl}/admin/content/news`, {
    headers: { cookie: requiredCookies.content },
  });
  expectStatus("password-changed CONTENT_EDITOR page restored", unlockedPage.status, 200);
  const unlockedHtml = await unlockedPage.text();
  if (!unlockedHtml.includes("新闻公告") || unlockedHtml.includes("完成首次密码修改")) {
    throw new Error("Password-changed CONTENT_EDITOR did not regain the normal admin shell.");
  }
  const oldPasswordLogin = await fetch(`${baseUrl}/api/referees/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: mutationOrigin },
    body: JSON.stringify({ username: requiredUsernames.content, password }),
  });
  expectStatus("old password rejected after required change", oldPasswordLogin.status, 401);
  await loginCredentials(
    requiredUsernames.content,
    newContentPassword,
    "password-changed content",
    undefined,
    "/admin/content/news",
  );

  expectStatus(
    "failed COMPETITION_ADMIN password change",
    (await passwordRequest(requiredCookies.competition, "Wrong-Password-2026!", "Required-Competition-New-2026!")).status,
    401,
  );
  await expectPasswordChangeGate(
    "failed COMPETITION_ADMIN change preserved legacy gate",
    await apiRequest({ path: "/api/referees/admin/competitions", method: "POST", cookie: requiredCookies.competition }),
  );

  if (!legacyPassword) throw new Error("R1_2_LEGACY_PASSWORD is required for the synthetic legacy compatibility gate.");
  const legacyCookie = await loginCredentials("", legacyPassword, "synthetic legacy administrator", undefined, "/admin");
  expectAllowedStatus(
    "synthetic legacy administrator remains authorized",
    (await apiRequest({ path: "/api/admin/content/posts", method: "GET", cookie: legacyCookie })).status,
  );
  const legacyPage = await fetch(`${baseUrl}/admin`, { headers: { cookie: legacyCookie } });
  expectStatus("synthetic legacy administrator page", legacyPage.status, 200);
  const legacyPageHtml = await legacyPage.text();
  if (
    !legacyPageHtml.includes("Legacy 管理员") ||
    legacyPageHtml.includes("完成首次密码修改") ||
    !legacyPageHtml.includes('href="/admin/system/admins"')
  ) {
    throw new Error("Synthetic legacy administrator lost its compatibility identity.");
  }

  expectStatus(
    "required account logout remains available",
    (await apiRequest({ path: "/api/referees/admin/logout", method: "POST", cookie: requiredCookies.super })).status,
    200,
  );
  const loggedOutRequiredPage = await fetch(`${baseUrl}/admin`, {
    headers: { cookie: requiredCookies.super },
    redirect: "manual",
  });
  if (![303, 307, 308].includes(loggedOutRequiredPage.status) || !loggedOutRequiredPage.headers.get("location")?.includes("/admin/login")) {
    throw new Error("Required account logout did not invalidate the current session.");
  }
  console.log("PASS required-password exception, recovery, session invalidation, logout, and legacy compatibility");
}

async function verifyDatabaseNews() {
  const first = await fetch(`${baseUrl}/api/content/posts?pageSize=3`, { cache: "no-store" });
  expectStatus("database news list API", first.status, 200);
  const firstPage = await first.json() as { items: Array<Record<string, unknown>>; nextCursor: string | null };
  if (firstPage.items.length !== 3 || firstPage.items.some((item) => item.pinned !== true || "content" in item || "id" in item || "featured" in item)) {
    throw new Error("Database news first page did not honor pinned/List DTO rules.");
  }
  const second = await fetch(`${baseUrl}/api/content/posts?pageSize=3&cursor=${encodeURIComponent(firstPage.nextCursor ?? "")}`, { cache: "no-store" });
  expectStatus("database news cursor page", second.status, 200);
  const secondPage = await second.json() as { items: Array<Record<string, unknown>> };
  if (secondPage.items.filter((item) => item.pinned === true).length !== 2 || secondPage.items.filter((item) => item.pinned === false).length !== 1) {
    throw new Error("Database news pinned-to-normal cursor transition failed.");
  }
  expectStatus("malformed public cursor", (await fetch(`${baseUrl}/api/content/posts?cursor=not-a-valid-cursor`)).status, 400);

  const detail = await fetch(`${baseUrl}/api/content/posts/smoke-news-01`, { cache: "no-store" });
  expectStatus("database news Detail DTO", detail.status, 200);
  const detailDto = await detail.json() as Record<string, unknown>;
  if (!("content" in detailDto) || "id" in detailDto || "authorAdminId" in detailDto) throw new Error("Public Detail DTO contract failed over HTTP.");
  const discipline = await fetch(`${baseUrl}/api/content/posts/smoke-discipline`, { cache: "no-store" });
  expectStatus("database Discipline detail", discipline.status, 200);
  const disciplineDto = await discipline.json() as { discipline?: { officialMedia?: { url?: string } } };
  if (!disciplineDto.discipline?.officialMedia?.url) throw new Error("Discipline PDF relationship missing from public detail.");
  for (const slug of ["smoke-draft", "smoke-archived", "smoke-future", "missing-slug", "bad%20slug"]) {
    expectStatus(`${slug} public detail hidden`, (await fetch(`${baseUrl}/api/content/posts/${slug}`)).status, 404);
  }
  for (const page of ["/news", "/news/smoke-news-01", "/news/smoke-discipline"]) {
    expectStatus(`${page} database page`, (await fetch(`${baseUrl}${page}`, { cache: "no-store" })).status, 200);
  }
  expectStatus("/news missing slug page", (await fetch(`${baseUrl}/news/missing-slug`)).status, 404);
}

async function verifyMedia(cookies: Record<RoleName, string>) {
  const publicMediaId = process.env.R1_2_PUBLIC_MEDIA_ID;
  if (!publicMediaId) throw new Error("R1_2_PUBLIC_MEDIA_ID is required for the R1-2 HTTP gate.");
  const publicResponse = await fetch(`${baseUrl}/media/${publicMediaId}`);
  expectStatus("PUBLIC media", publicResponse.status, 200);
  if (publicResponse.headers.get("x-content-type-options") !== "nosniff") throw new Error("PUBLIC media missing nosniff");
  if (publicResponse.headers.get("cache-control") !== "private, no-store") throw new Error("PUBLIC media cache policy mismatch");
  if (publicResponse.headers.get("cdn-cache-control") !== "no-store") throw new Error("PUBLIC media CDN cache policy mismatch");
  if (!publicResponse.headers.get("content-disposition")?.includes("filename*=UTF-8''")) throw new Error("PUBLIC media RFC 5987 filename missing");

  const pdf = new Uint8Array(20 * 1024 * 1024);
  pdf.set(new TextEncoder().encode("%PDF-1.7\n"));
  const upload = await fetch(`${baseUrl}/api/admin/media`, {
    method: "POST",
    headers: {
      cookie: cookies.content,
      origin: mutationOrigin,
      "content-type": "application/pdf",
      "x-nuaafa-filename": encodeURIComponent("R1-2 处罚决定（测试）.pdf"),
      "x-nuaafa-visibility": "PRIVATE",
      "x-nuaafa-alt-text": encodeURIComponent("20 MB streaming HTTP proof"),
    },
    body: pdf,
  });
  expectStatus("20 MB streaming media HTTP upload", upload.status, 201);
  const uploaded = await upload.json() as { asset?: { id?: string; size?: number } };
  if (!uploaded.asset?.id || uploaded.asset.size !== pdf.length) throw new Error("Streaming upload response metadata mismatch.");
  expectStatus("PRIVATE media unauthenticated", (await fetch(`${baseUrl}/media/${uploaded.asset.id}`)).status, 401);
  expectStatus("PRIVATE media role denied", (await fetch(`${baseUrl}/media/${uploaded.asset.id}`, { headers: { cookie: cookies.competition } })).status, 403);
  const privateResponse = await fetch(`${baseUrl}/media/${uploaded.asset.id}`, { headers: { cookie: cookies.content } });
  expectStatus("PRIVATE media authorized", privateResponse.status, 200);
  if (privateResponse.headers.get("cache-control") !== "private, no-store") throw new Error("PRIVATE media cache policy mismatch");
  if (privateResponse.headers.get("x-content-type-options") !== "nosniff") throw new Error("PRIVATE media missing nosniff");
  if (!privateResponse.headers.get("content-disposition")?.includes("filename*=UTF-8''R1-2%20")) throw new Error("PRIVATE media RFC 5987 Unicode filename mismatch");
  if ((await privateResponse.arrayBuffer()).byteLength !== pdf.length) throw new Error("Streamed PRIVATE media length mismatch.");
  console.log("PASS PUBLIC / PRIVATE media headers and streaming body");
}

async function main() {
  const health = await fetch(`${baseUrl}/api/health`, { cache: "no-store" });
  expectStatus("isolated app health", health.status, 200);
  if (requiredPasswordOnly) {
    await verifyRequiredPasswordChange();
    return;
  }
  const cookies = {} as Record<RoleName, string>;
  for (const role of Object.keys(usernames) as RoleName[]) cookies[role] = await login(role);
  await verifyLegacyApiMatrix(cookies);
  await verifyAdminPageMatrix(cookies);
  await verifyLegacyRedirectMatrix(cookies.super);
  await verifyNavigation(cookies);
  await verifyLoginLandings();
  await verifyRequiredPasswordChange();
  await verifyDatabaseNews();
  await verifyMedia(cookies);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
