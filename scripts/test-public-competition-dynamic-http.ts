import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";

import { createClient } from "@libsql/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../src/generated/prisma-v29/client";
import { hashPassword } from "../src/lib/referee-security";

const password = "Public-Dynamic-R3-Test-Only-2030!";
const mutationOrigin = "https://nuaafa.cn";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function homepageCards(html: string) {
  return [...html.matchAll(/<article class="next-match-forecast-card"[\s\S]*?<\/article>/gu)]
    .map((match) => match[0]);
}

function currentCompetitionSection(html: string) {
  const section = html.match(/<section[^>]*id="home-competitions"[^>]*>[\s\S]*?<\/section>/u)?.[0];
  assert(section, "Homepage omitted the current Competition section.");
  return section;
}

function assertHomepageCardCount(html: string, count: number, label: string) {
  assert(homepageCards(html).length === count, `${label} did not render ${count} homepage cards.`);
}

function assertHomepageEmptyState(html: string, label: string) {
  assertHomepageCardCount(html, 0, label);
  assert(html.includes("当前暂无首页重点赛事"), `${label} omitted the intentional homepage empty state.`);
}

function assertPublicFooter(html: string, route: string) {
  const footer = html.match(/<footer class="site-footer[^"]*" data-public-footer="shared">[\s\S]*?<\/footer>/u)?.[0];
  assert(footer, `${route} did not render the shared public footer.`);
  const currentYear = new Date().getFullYear();
  assert(footer.includes(`© 2021–${currentYear} 南京航空航天大学天目湖足球协会`), `${route} has the wrong copyright range.`);
  assert(footer.includes("网站建设与维护：HAN"), `${route} omitted the developer credit.`);
  assert(
    /<a[^>]*href="https:\/\/beian\.miit\.gov\.cn\/"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*>\s*鲁ICP备2026052413号\s*<\/a>/u.test(footer),
    `${route} omitted the secure official ICP link.`,
  );
  for (const placeholder of ["公安备案待补充", "公安备案号待确认", "XXXX号"]) {
    assert(!footer.includes(placeholder), `${route} rendered a Public Security filing placeholder.`);
  }
  assert(
    /<a[^>]*class="[^"]*footer-public-security-filing[^"]*"[^>]*href="https:\/\/beian\.mps\.gov\.cn\/#\/query\/webSearch\?code=37010302001865"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*aria-label="鲁公网安备37010302001865号[^"]*"[^>]*>[\s\S]*?<img[^>]*alt=""[^>]*width="18"[^>]*height="20"[^>]*class="footer-public-security-icon"[^>]*(?:%2Fcompliance%2Fbeian-police\.png|\/compliance\/beian-police\.png)[^>]*>[\s\S]*?鲁公网安备37010302001865号\s*<\/a>/u.test(footer),
    `${route} omitted the official Public Security filing link and icon.`,
  );
}

function findPort() {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") return probe.close(() => reject(new Error("Failed to allocate a port.")));
      probe.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function runPrismaMigrate(databaseUrl: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"],
      { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: "trace" }, stdio: "inherit" },
    );
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Prisma migrate deploy exited ${code ?? "unknown"}.`)));
  });
}

async function stopServer(server: ChildProcess) {
  if (server.exitCode !== null) return;
  server.kill();
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 5_000);
    server.once("exit", () => { clearTimeout(timeout); resolve(); });
  });
}

async function waitForHealth(origin: string, server: ChildProcess) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Next server exited before health was ready (${server.exitCode}).`);
    try {
      if ((await fetch(`${origin}/api/health`, { cache: "no-store" })).status === 200) return;
    } catch {
      // The isolated server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the isolated Next server.");
}

async function seedAdministrators(databaseUrl: string) {
  const prisma = new PrismaClient({ adapter: new PrismaLibSql({ url: databaseUrl }) });
  try {
    const passwordHash = await hashPassword(password);
    const [competition, content, superAdmin] = await Promise.all([
      prisma.adminAccount.create({ data: { username: "dynamic-competition", displayName: "动态赛事管理员", passwordHash, role: "REFEREE_MANAGER" } }),
      prisma.adminAccount.create({ data: { username: "dynamic-content", displayName: "动态内容管理员", passwordHash, role: "REFEREE_MANAGER" } }),
      prisma.adminAccount.create({ data: { username: "dynamic-super", displayName: "动态超级管理员", passwordHash, role: "SUPER_ADMIN" } }),
    ]);
    await prisma.adminRoleAssignment.createMany({ data: [
      { adminAccountId: competition.id, role: "COMPETITION_ADMIN" },
      { adminAccountId: content.id, role: "CONTENT_EDITOR" },
      { adminAccountId: superAdmin.id, role: "SUPER_ADMIN" },
    ] });
  } finally {
    await prisma.$disconnect();
  }
}

async function login(origin: string, username: string) {
  const response = await fetch(`${origin}/api/referees/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: mutationOrigin },
    body: JSON.stringify({ username, password }),
    redirect: "manual",
  });
  assert(response.status === 200, `${username} login failed with ${response.status}.`);
  const cookie = response.headers.get("set-cookie")?.match(/nuaa_referee_admin=[^;]+/u)?.[0];
  assert(cookie, `${username} login did not return a session cookie.`);
  return cookie;
}

function apiRequest(origin: string, pathName: string, method: string, body: unknown, cookie?: string) {
  return fetch(`${origin}${pathName}`, {
    method,
    headers: { "content-type": "application/json", origin: mutationOrigin, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
    redirect: "manual",
  });
}

let proofRequest = 0;
async function fetchPage(origin: string, pathName: string, cookie?: string) {
  proofRequest += 1;
  const separator = pathName.includes("?") ? "&" : "?";
  const response = await fetch(`${origin}${pathName}${separator}dynamicProof=${proofRequest}`, {
    cache: "no-store",
    headers: cookie ? { cookie } : undefined,
  });
  return { status: response.status, html: await response.text() };
}

async function pageHtml(origin: string, pathName: string, cookie?: string) {
  const page = await fetchPage(origin, pathName, cookie);
  assert(page.status === 200, `${pathName} returned ${page.status}.`);
  return page.html;
}

function competitionPayload(input: {
  slug: string;
  name: string;
  playingFormat: string;
  publicPublished: boolean;
  homepageFeatured: boolean;
  publicOrder: number;
  marker: string;
}) {
  return {
    slug: input.slug,
    name: input.name,
    shortName: `${input.marker}简称`,
    year: 2030,
    campus: "天目湖校区",
    playingFormat: input.playingFormat,
    format: "CUSTOM",
    status: "ONGOING",
    semesterLabel: "下半学期",
    teamFormation: "自由组队",
    publicPublished: input.publicPublished,
    homepageFeatured: input.homepageFeatured,
    publicOrder: input.publicOrder,
    registrationStartAt: "2030-09-20T18:30",
    registrationEndAt: "2030-09-30T20:00",
    matchStartAt: "2030-10-01T18:30",
    matchEndAt: "2030-10-31T20:30",
    venue: `${input.marker}主场`,
    host: "南京航空航天大学天目湖足球协会",
    organizer: `${input.marker}赛事组`,
    summary: `${input.marker}赛事简介`,
    notice: `${input.marker}赛事公告`,
    registrationUrl: "",
  } as const;
}

function matchPayload(input: {
  slug: string;
  competitionId: string;
  stage: string;
  kickoff: string;
  venue: string;
  homeTeamId: string;
  awayTeamId: string;
  applicationWindowStatus?: "OPEN" | "CLOSED";
}) {
  return {
    slug: input.slug,
    competitionId: input.competitionId,
    stage: input.stage,
    kickoff: input.kickoff,
    endAt: "",
    venue: input.venue,
    round: input.stage,
    source: "MANUAL",
    externalMatchId: "",
    homeTeamSelection: `team:${input.homeTeamId}`,
    awayTeamSelection: `team:${input.awayTeamId}`,
    status: "SCHEDULED",
    applicationWindowStatus: input.applicationWindowStatus ?? "CLOSED",
    applicationDeadline: "",
    publicNote: `${input.stage}公开说明`,
    internalNote: "PRIVATE-MATCH-INTERNAL-NOTE",
    positionCounts: {},
  } as const;
}

function matchPatch(payload: ReturnType<typeof matchPayload>, overrides: Record<string, unknown> = {}) {
  const { homeTeamSelection, awayTeamSelection, ...body } = payload;
  return {
    ...body,
    homeTeamId: homeTeamSelection.slice("team:".length),
    awayTeamId: awayTeamSelection.slice("team:".length),
    cancellationReason: "",
    ...overrides,
  };
}

async function expectStatus(response: Response | Promise<Response>, status: number, label: string) {
  const result = await response;
  assert(result.status === status, `${label}: expected ${status}, received ${result.status}.`);
  return result;
}

async function expectError(response: Response | Promise<Response>, status: number, message: string, label: string) {
  const result = await response;
  assert(result.status === status, `${label}: expected ${status}, received ${result.status}.`);
  const body = await result.json() as { error?: string };
  assert(body.error === message, `${label}: expected exact error "${message}", received "${body.error ?? ""}".`);
}

async function createCompetition(origin: string, cookie: string, payload: ReturnType<typeof competitionPayload>) {
  const response = await expectStatus(
    apiRequest(origin, "/api/referees/admin/competitions", "POST", payload, cookie),
    201,
    `create ${payload.slug}`,
  );
  const id = (await response.json() as { competitionId?: string }).competitionId;
  assert(id, `${payload.slug} create response omitted its ID.`);
  return id;
}

async function createTeams(origin: string, cookie: string, verifier: PrismaClient, competitionId: string, names: string[]) {
  await expectStatus(
    apiRequest(origin, "/api/referees/admin/teams", "POST", { action: "bulk", competitionId, names }, cookie),
    201,
    `create teams for ${competitionId}`,
  );
  const teams = await verifier.team.findMany({ where: { competitionId }, orderBy: { name: "asc" } });
  assert(teams.length === names.length, `Competition ${competitionId} did not receive all teams.`);
  return teams;
}

async function createMatch(origin: string, cookie: string, payload: ReturnType<typeof matchPayload>) {
  const response = await expectStatus(
    apiRequest(origin, "/api/referees/admin/matches", "POST", payload, cookie),
    201,
    `create ${payload.slug}`,
  );
  const id = (await response.json() as { matchId?: string }).matchId;
  assert(id, `${payload.slug} create response omitted its ID.`);
  return id;
}

async function main() {
  await access(path.resolve(".next/BUILD_ID"));
  const root = await mkdtemp(path.join(os.tmpdir(), "nuaafa-public-competition-r3-http-"));
  const databasePath = path.join(root, "dynamic.db");
  const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
  const uploadRoot = path.join(root, "uploads");
  const port = await findPort();
  const origin = `http://127.0.0.1:${port}`;
  let server: ChildProcess | null = null;
  let verifier: PrismaClient | null = null;
  try {
    await mkdir(uploadRoot, { recursive: true });
    await runPrismaMigrate(databaseUrl);
    await seedAdministrators(databaseUrl);
    const runningServer = spawn(
      process.execPath,
      [path.resolve("node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: "production",
          DATABASE_URL: databaseUrl,
          NUAAFA_UPLOAD_DIR: uploadRoot,
          NUAAFA_CONTENT_SOURCE: "static",
          REFEREE_ADMIN_SESSION_SECRET: "public-competition-r3-http-session-secret",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    server = runningServer;
    runningServer.stdout?.pipe(process.stdout);
    runningServer.stderr?.pipe(process.stderr);
    await waitForHealth(origin, runningServer);
    const serverPid = runningServer.pid;

    const zeroHome = await pageHtml(origin, "/");
    const zeroCatalog = await pageHtml(origin, "/competitions");
    const zeroSitemap = await pageHtml(origin, "/sitemap.xml");
    assertHomepageEmptyState(zeroHome, "zero-row homepage");
    const zeroCurrentCompetitions = currentCompetitionSection(zeroHome);
    assert(
      !zeroCurrentCompetitions.includes("2026南京航空航天大学新生杯足球赛事")
      && !zeroCurrentCompetitions.includes("2026天目湖五人制联赛"),
      "Zero-row homepage injected legacy static Competition cards.",
    );
    assert(zeroCatalog.includes("当前暂无公开赛事"), "Zero-row Competition Center omitted its intentional empty state.");
    assert(
      !zeroSitemap.includes("/competitions/freshman-cup")
      && !zeroSitemap.includes("/competitions/tianmuhu-futsal-league"),
      "Zero-row sitemap published legacy current-Competition URLs.",
    );
    for (const slug of ["freshman-cup", "tianmuhu-futsal-league", "unknown-competition"]) {
      assert((await fetchPage(origin, `/competitions/${slug}`)).status === 404, `${slug} received a static public fallback.`);
    }
    const historicalMen = await pageHtml(origin, "/competitions/2026-mens-intercollege-cup");
    const historicalWomen = await pageHtml(origin, "/competitions/2026-womens-intercollege-cup");
    assert(historicalMen.includes("2026男子足球院际杯") && historicalWomen.includes("2026女子足球院际杯"), "Historical archive routes regressed.");

    const [competitionCookie, contentCookie, superCookie] = await Promise.all([
      login(origin, "dynamic-competition"),
      login(origin, "dynamic-content"),
      login(origin, "dynamic-super"),
    ]);
    const adminCreate = await pageHtml(origin, "/admin/competitions/new", competitionCookie);
    assert(
      adminCreate.includes("比赛制式")
      && adminCreate.includes("裁判岗位模板")
      && adminCreate.includes("无预设模板 / 自定义赛事")
      && adminCreate.includes("七人制"),
      "Admin create did not distinguish public playing format from referee template.",
    );

    const sevenPayload = competitionPayload({
      slug: "seven-a-side-test",
      name: "2030校园七人制联赛",
      playingFormat: "七人制",
      publicPublished: true,
      homepageFeatured: true,
      publicOrder: 20,
      marker: "七人制",
    });
    await expectStatus(apiRequest(origin, "/api/referees/admin/competitions", "POST", sevenPayload), 401, "anonymous competition create");
    await expectStatus(apiRequest(origin, "/api/referees/admin/competitions", "POST", sevenPayload, contentCookie), 403, "CONTENT_EDITOR competition create");
    await expectStatus(apiRequest(origin, "/api/referees/admin/competitions", "POST", { ...sevenPayload, playingFormat: "" }, competitionCookie), 400, "missing playing format");

    const sevenId = await createCompetition(origin, competitionCookie, sevenPayload);
    const sixPayload = competitionPayload({
      slug: "six-a-side-test",
      name: "2030六人制邀请赛",
      playingFormat: "六人制",
      publicPublished: true,
      homepageFeatured: false,
      publicOrder: 10,
      marker: "六人制",
    });
    const sixId = await createCompetition(origin, competitionCookie, sixPayload);
    const unpublishedPayload = competitionPayload({
      slug: "unpublished-test",
      name: "2030未公开测试赛",
      playingFormat: "九人制",
      publicPublished: false,
      homepageFeatured: false,
      publicOrder: 1,
      marker: "未公开",
    });
    const unpublishedId = await createCompetition(origin, competitionCookie, unpublishedPayload);
    assert(unpublishedId, "Unpublished fixture was not created.");

    verifier = new PrismaClient({ adapter: new PrismaLibSql({ url: databaseUrl }) });
    const sevenTeams = await createTeams(origin, competitionCookie, verifier, sevenId, ["A学院", "B学院", "E学院"]);
    const sixTeams = await createTeams(origin, competitionCookie, verifier, sixId, ["C学院", "D学院"]);
    const sevenMatchPayload = matchPayload({
      slug: "seven-match-one",
      competitionId: sevenId,
      stage: "七人制第一轮",
      kickoff: "2030-10-03T20:15",
      venue: "七人制测试场",
      homeTeamId: sevenTeams[0].id,
      awayTeamId: sevenTeams[1].id,
    });
    const sevenMatchId = await createMatch(origin, competitionCookie, sevenMatchPayload);
    const sevenSecondPayload = matchPayload({
      slug: "seven-match-two",
      competitionId: sevenId,
      stage: "七人制第二轮",
      kickoff: "2030-10-05T18:00",
      venue: "七人制第二场地",
      homeTeamId: sevenTeams[1].id,
      awayTeamId: sevenTeams[2].id,
    });
    const sevenSecondId = await createMatch(origin, competitionCookie, sevenSecondPayload);
    const sixMatchPayload = matchPayload({
      slug: "six-match-one",
      competitionId: sixId,
      stage: "六人制第一轮",
      kickoff: "2030-10-04T18:00",
      venue: "六人制测试场",
      homeTeamId: sixTeams[0].id,
      awayTeamId: sixTeams[1].id,
    });
    const sixMatchId = await createMatch(origin, competitionCookie, sixMatchPayload);

    await expectError(
      apiRequest(origin, "/api/referees/admin/matches", "POST", {
        ...sevenMatchPayload,
        slug: "custom-open-window",
        applicationWindowStatus: "OPEN",
        applicationDeadline: "2030-10-02T20:15",
      }, competitionCookie),
      409,
      "该赛事暂未配置对应的裁判岗位模板。",
      "CUSTOM referee template fail-closed",
    );

    const publicReferee = await verifier.referee.create({ data: {
      publicCode: "930",
      name: "B赛事裁判",
      studentId: "PRIVATE-STUDENT-ID",
      phone: "PRIVATE-PHONE",
      qq: "PRIVATE-QQ",
      passwordHash: "PRIVATE-PASSWORD-HASH",
      internalNote: "PRIVATE-REFEREE-NOTE",
    } });
    await verifier.refereeAppointment.create({ data: {
      matchId: sixMatchId,
      status: "PUBLISHED",
      publishedAt: new Date(),
      revision: 1,
      positions: { create: { key: "REFEREE", label: "主裁判", sortOrder: 1, slot: 1, refereeId: publicReferee.id } },
    } });
    await verifier.auditLog.create({ data: {
      actorType: "SYSTEM",
      action: "PRIVATE_AUDIT_MARKER",
      entityType: "Competition",
      entityId: sevenId,
      summary: "PRIVATE-AUDIT-SUMMARY",
      metadata: "PRIVATE-ADMIN-METADATA",
    } });

    const home = await pageHtml(origin, "/");
    const catalog = await pageHtml(origin, "/competitions");
    const sevenDetail = await pageHtml(origin, "/competitions/seven-a-side-test");
    const sixDetail = await pageHtml(origin, "/competitions/six-a-side-test");
    const sitemap = await pageHtml(origin, "/sitemap.xml");
    assertHomepageCardCount(home, 1, "initial R3 homepage");
    const onlyHomeCard = homepageCards(home)[0];
    assert(
      onlyHomeCard.includes("2030校园七人制联赛")
      && onlyHomeCard.includes("七人制")
      && onlyHomeCard.includes(`href="/competitions/seven-a-side-test#match-${sevenMatchId}"`)
      && !onlyHomeCard.includes("2030六人制邀请赛")
      && !onlyHomeCard.includes("2030未公开测试赛"),
      "Homepage feature selection or own-slug link is incorrect.",
    );
    const currentHomeCompetitions = currentCompetitionSection(home);
    assert(
      currentHomeCompetitions.includes("2030校园七人制联赛")
      && !currentHomeCompetitions.includes("2030六人制邀请赛")
      && !currentHomeCompetitions.includes("2026南京航空航天大学新生杯足球赛事")
      && !currentHomeCompetitions.includes("2026天目湖五人制联赛"),
      "Homepage rendered an unfeatured or legacy static Competition outside the featured section.",
    );
    assert(
      catalog.includes("2030校园七人制联赛")
      && catalog.includes("2030六人制邀请赛")
      && !catalog.includes("2030未公开测试赛")
      && catalog.indexOf("2030六人制邀请赛") < catalog.indexOf("2030校园七人制联赛"),
      "Competition Center discovery, publication filter, or public ordering is incorrect.",
    );
    assert(
      sitemap.includes("/competitions/seven-a-side-test")
      && sitemap.includes("/competitions/six-a-side-test")
      && !sitemap.includes("/competitions/unpublished-test"),
      "Sitemap did not use the published Competition catalogue.",
    );
    assert(
      sevenDetail.includes("2030校园七人制联赛")
      && sevenDetail.includes("七人制")
      && sevenDetail.includes("A学院")
      && sevenDetail.includes("B学院")
      && sevenDetail.includes("七人制测试场")
      && !sevenDetail.includes("六人制")
      && !sevenDetail.includes("C学院")
      && !sevenDetail.includes("D学院")
      && !sevenDetail.includes("B赛事裁判"),
      "Seven-a-side detail leaked Competition B or the internal template enum.",
    );
    assert(
      sixDetail.includes("2030六人制邀请赛")
      && sixDetail.includes("六人制")
      && sixDetail.includes("C学院")
      && sixDetail.includes("D学院")
      && sixDetail.includes("六人制测试场")
      && sixDetail.includes("B赛事裁判")
      && !sixDetail.includes("七人制")
      && !sixDetail.includes("A学院")
      && !sixDetail.includes("B学院"),
      "Six-a-side detail leaked Competition A or lost its scoped appointment.",
    );
    assert((await fetchPage(origin, "/competitions/unpublished-test")).status === 404, "Unpublished Competition detail was public.");
    for (const marker of [
      "PRIVATE-STUDENT-ID", "PRIVATE-PHONE", "PRIVATE-QQ", "PRIVATE-PASSWORD-HASH",
      "PRIVATE-REFEREE-NOTE", "PRIVATE-MATCH-INTERNAL-NOTE", "PRIVATE-AUDIT-SUMMARY",
      "PRIVATE-ADMIN-METADATA", competitionCookie, contentCookie, superCookie,
    ]) {
      assert(![home, catalog, sevenDetail, sixDetail].join("\n").includes(marker), `Public HTML exposed ${marker}.`);
    }

    const adminEdit = await pageHtml(origin, `/admin/competitions/${sevenId}/edit`, competitionCookie);
    assert(
      adminEdit.includes("seven-a-side-test")
      && adminEdit.includes("七人制")
      && adminEdit.includes("比赛制式")
      && adminEdit.includes("裁判岗位模板")
      && adminEdit.includes("无预设模板 / 自定义赛事"),
      "Admin edit lost the separated format fields.",
    );

    const { slug: sixSlug, ...sixEditable } = sixPayload;
    assert(sixSlug === "six-a-side-test", "Six-a-side fixture slug changed.");
    await expectStatus(
      apiRequest(origin, `/api/referees/admin/competitions/${sixId}`, "PATCH", { ...sixEditable, homepageFeatured: true }, competitionCookie),
      200,
      "enable second homepage feature",
    );
    assertHomepageCardCount(await pageHtml(origin, "/"), 2, "two-featured homepage");
    const thirdPayload = competitionPayload({
      slug: "third-featured-test",
      name: "2030第三项公开赛事",
      playingFormat: "八人制",
      publicPublished: true,
      homepageFeatured: false,
      publicOrder: 30,
      marker: "第三项",
    });
    const thirdId = await createCompetition(origin, competitionCookie, thirdPayload);
    const { slug: thirdSlug, ...thirdEditable } = thirdPayload;
    assert(thirdSlug === "third-featured-test", "Third fixture slug changed.");
    await expectStatus(apiRequest(origin, `/api/referees/admin/competitions/${thirdId}`, "PATCH", { ...thirdEditable, homepageFeatured: true }, competitionCookie), 200, "third homepage candidate allowed");
    assertHomepageCardCount(await pageHtml(origin, "/"), 2, "three candidates bounded to two");
    const featureRows = await verifier.competition.findMany({
      where: { id: { in: [sevenId, sixId, thirdId] } },
      select: { id: true, homepageFeatured: true },
    });
    const featured = new Map(featureRows.map((row) => [row.id, row.homepageFeatured]));
    assert(featured.get(sevenId) && featured.get(sixId) && featured.get(thirdId), "Third candidate flag did not persist.");
    await expectStatus(apiRequest(origin, `/api/referees/admin/competitions/${thirdId}`, "PATCH", { ...thirdEditable, homepageFeatured: false }, competitionCookie), 200, "remove third candidate after bounded selection check");
    await expectStatus(
      apiRequest(origin, `/api/referees/admin/competitions/${sixId}`, "PATCH", { ...sixEditable, homepageFeatured: false }, superCookie),
      200,
      "disable second homepage feature",
    );

    const editedSeven = matchPatch(sevenMatchPayload, {
      kickoff: "2030-10-03T21:30",
      venue: "新场地",
      homeTeamId: sevenTeams[2].id,
      awayTeamId: sevenTeams[0].id,
    });
    await expectStatus(
      apiRequest(origin, `/api/referees/admin/matches/${sevenMatchId}`, "PATCH", editedSeven, competitionCookie),
      200,
      "edit next Match",
    );
    for (const route of ["/", "/competitions", "/competitions/seven-a-side-test"]) {
      const html = await pageHtml(origin, route);
      assert(html.includes("21:30") && html.includes("新场地") && html.includes("E学院"), `${route} did not reflect the same-process Match edit.`);
    }

    await expectStatus(apiRequest(origin, `/api/referees/admin/matches/${sevenMatchId}`, "PATCH", { ...editedSeven, status: "COMPLETED" }, competitionCookie), 409, "future complete blocked");
    await expectStatus(apiRequest(origin, `/api/referees/admin/matches/${sevenMatchId}`, "PATCH", { ...editedSeven, kickoff: new Date(Date.now() - 7200000).toISOString() }, competitionCookie), 200, "set isolated ended fixture");
    await expectStatus(apiRequest(origin, `/api/admin/matches/${sevenMatchId}/result`, "POST", { homeScore: 3, awayScore: 1, homePenaltyScore: null, awayPenaltyScore: null, expectedVersion: 0, actualEnded: true, reason: "隔离赛果验证" }, competitionCookie), 200, "confirm actual result");
    for (const route of ["/", "/competitions", "/competitions/seven-a-side-test"]) {
      const html = await pageHtml(origin, route);
      assert(html.includes("2030.10.05") && html.includes("七人制第二场地"), `${route} did not advance to the next scheduled Match.`);
    }
    assert((await pageHtml(origin, "/competitions/seven-a-side-test")).includes("3 : 1"), "Completed Match result did not render where supported.");
    await expectError(
      apiRequest(origin, `/api/referees/admin/matches/${sevenMatchId}`, "DELETE", { reason: "不得删除正式历史" }, competitionCookie),
      409,
      "该比赛已有报名意向、选派或正式历史记录，不能直接删除。请使用“取消比赛”保留业务历史。",
      "completed Match deletion protection",
    );
    const disposablePayload = matchPayload({
      slug: "seven-disposable-match",
      competitionId: sevenId,
      stage: "安全删除测试场次",
      kickoff: "2030-10-06T18:00",
      venue: "待删除测试场地",
      homeTeamId: sevenTeams[0].id,
      awayTeamId: sevenTeams[1].id,
    });
    const disposableId = await createMatch(origin, competitionCookie, disposablePayload);
    await expectStatus(
      apiRequest(origin, `/api/referees/admin/matches/${disposableId}`, "DELETE", { reason: "R3 安全删除验证" }, competitionCookie),
      200,
      "safe-delete disposable Match",
    );
    assert(!(await pageHtml(origin, "/competitions/seven-a-side-test")).includes("待删除测试场地"), "Safely deleted Match remained public.");

    await expectStatus(
      apiRequest(origin, `/api/referees/admin/matches/${sevenSecondId}`, "PATCH", { ...matchPatch(sevenSecondPayload), status: "CANCELLED", cancellationReason: "赛程调整" }, competitionCookie),
      200,
      "cancel next Match",
    );
    for (const route of ["/", "/competitions", "/competitions/seven-a-side-test"]) {
      const html = await pageHtml(origin, route);
      assert(html.includes("暂无后续赛程，可查看现有赛果。"), `${route} did not return to the canonical no-Match state.`);
    }

    const { slug: sevenSlug, ...sevenEditable } = sevenPayload;
    assert(sevenSlug === "seven-a-side-test", "Seven-a-side fixture slug changed.");
    await expectStatus(
      apiRequest(origin, `/api/referees/admin/competitions/${sevenId}`, "PATCH", { ...sevenEditable, homepageFeatured: false }, competitionCookie),
      200,
      "disable homepage feature",
    );
    assertHomepageEmptyState(await pageHtml(origin, "/"), "unfeatured homepage");
    assert((await pageHtml(origin, "/competitions")).includes("2030校园七人制联赛"), "Unfeatured Competition left the catalog.");
    assert((await pageHtml(origin, "/competitions/seven-a-side-test")).includes("2030校园七人制联赛"), "Unfeatured Competition detail disappeared.");
    await expectStatus(
      apiRequest(origin, `/api/referees/admin/competitions/${sevenId}`, "PATCH", { ...sevenEditable, publicPublished: false, homepageFeatured: false }, competitionCookie),
      200,
      "unpublish Competition",
    );
    assert(!(await pageHtml(origin, "/competitions")).includes("2030校园七人制联赛"), "Unpublished Competition remained in the catalog.");
    assert((await fetchPage(origin, "/competitions/seven-a-side-test")).status === 404, "Unpublished Competition detail remained available.");
    assert(!(await pageHtml(origin, "/sitemap.xml")).includes("/competitions/seven-a-side-test"), "Unpublished Competition remained in the sitemap.");
    await expectStatus(
      apiRequest(origin, `/api/referees/admin/competitions/${sevenId}`, "PATCH", { ...sevenEditable, publicPublished: true, homepageFeatured: true }, competitionCookie),
      200,
      "restore Competition for footer smoke",
    );

    const footerPages = [
      ["/", await pageHtml(origin, "/")],
      ["/competitions", await pageHtml(origin, "/competitions")],
      ["/competitions/seven-a-side-test", await pageHtml(origin, "/competitions/seven-a-side-test")],
      ["/news", await pageHtml(origin, "/news")],
      ["/news/demo-detail", await pageHtml(origin, "/news/demo-detail")],
      ["/referees", await pageHtml(origin, "/referees")],
      ["/association", await pageHtml(origin, "/association")],
    ] as const;
    for (const [route, html] of footerPages) assertPublicFooter(html, route);
    const publicSecurityIcon = await fetch(`${origin}/compliance/beian-police.png`);
    assert(publicSecurityIcon.ok, "The official Public Security filing icon was not served.");
    assert(publicSecurityIcon.headers.get("content-type") === "image/png", "The Public Security filing icon has the wrong content type.");
    assert(
      createHash("sha256").update(Buffer.from(await publicSecurityIcon.arrayBuffer())).digest("hex")
        === "8dfecad0dfcb3dc584f2c2447943eefb1fd65a058856eb0611e2c56ddc4c1fe1",
      "The served Public Security filing icon differs from the official supplied asset.",
    );

    const [serviceSource, routeSource] = await Promise.all([
      readFile(path.resolve("src/lib/public-competition-service.ts"), "utf8"),
      readFile(path.resolve("src/app/competitions/[slug]/page.tsx"), "utf8"),
    ]);
    for (const forbidden of ["getCoreCompetition", "currentPublicCompetitionSlugs", 'slug === "freshman-cup"', 'slug === "tianmuhu-futsal-league"', "generateStaticParams"]) {
      assert(!`${serviceSource}\n${routeSource}`.includes(forbidden), `Generic public rendering reintroduced ${forbidden}.`);
    }
    const foreignKeyCheck = await createClient({ url: databaseUrl }).execute("PRAGMA foreign_key_check");
    assert(foreignKeyCheck.rows.length === 0, "HTTP data flow produced foreign key violations.");
    assert(runningServer.exitCode === null && runningServer.pid === serverPid, "The local server restarted during runtime propagation.");

    console.log(JSON.stringify({
      publicDiscovery: "PASS",
      publicationFilter: "PASS",
      arbitrarySevenAside: "PASS",
      arbitrarySixAside: "PASS",
      customTemplateFailClosed: "PASS",
      competitionIsolation: "PASS",
      teamIsolation: "PASS",
      matchIsolation: "PASS",
      appointmentIsolation: "PASS",
      canonicalNextMatch: "PASS",
      matchCreateUpdateCompleteCancelDelete: "PASS",
      sameProcessFreshness: "PASS",
      publicationToggle: "PASS",
      homepageToggle: "PASS",
      homepageFeatureLimit: "PASS",
      publicDtoPrivacy: "PASS",
      unpublished404: "PASS",
      dynamicSitemap: "PASS",
      genericRouteStaticInspection: "PASS",
      publicFooter: "PASS",
      historicalArchives: "PASS",
      serverStarts: 1,
      serverPid,
      rebuildsAfterStart: 0,
      restartsAfterStart: 0,
      foreignKeyViolations: 0,
    }, null, 2));
  } finally {
    if (verifier) await verifier.$disconnect();
    if (server) await stopServer(server);
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
  },
);
