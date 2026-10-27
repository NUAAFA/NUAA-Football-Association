import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function main() {
  const root = process.env.LEAGUE_TEST_ROOT;
  const origin = process.env.LEAGUE_TEST_ORIGIN ?? "http://127.0.0.1:3217";
  assert(root && path.basename(root).startsWith("nuaafa-league-"));
  assert.equal(new URL(origin).hostname, "127.0.0.1");
  const info = JSON.parse(await readFile(path.join(root, "fixture.json"), "utf8"));
  process.env.DATABASE_URL = info.databaseUrl;
  const { prisma } = await import("../src/lib/prisma");
  const requestOrigin = process.env.LEAGUE_TEST_REQUEST_ORIGIN ?? origin;
  const headers = { "content-type": "application/json", origin: requestOrigin };
  try {
    const login = await fetch(origin + "/api/referees/admin/login", { method: "POST", headers, body: JSON.stringify({ username: "league-test-admin", password: "League-Isolated-Only-2026!" }) });
    assert.equal(login.status, 200, await login.clone().text());
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const payload = { slug: "league-http-" + Date.now(), name: "HTTP隔离验证联赛", campus: "隔离校区", format: "FUTSAL", playingFormat: "五人制", competitionSystem: "LEAGUE", status: "PREPARING", publicPublished: true };
    assert.equal((await fetch(origin + "/api/referees/admin/competitions", { method: "POST", headers, body: JSON.stringify(payload) })).status, 401);
    const response = await fetch(origin + "/api/referees/admin/competitions", { method: "POST", headers: { ...headers, cookie }, body: JSON.stringify(payload) });
    assert.equal(response.status, 201, await response.clone().text());
    const { competitionId } = await response.json();
    assert.equal((await prisma.competition.findUniqueOrThrow({ where: { id: competitionId } })).competitionSystem, "LEAGUE");
    for (const name of ["致和书院女足", "致微书院女足", "致慧书院女足", "致元书院女足"]) await prisma.team.create({ data: { competitionId, name } });
    const bytes = await readFile("scripts/fixtures/league/2026-women-league.docx");
    const submit = async (endpoint: string, planHash?: string, auth = cookie, submittedOrigin = requestOrigin) => {
      const form = new FormData();
      form.set("competitionId", competitionId); form.set("importType", "MATCH"); form.set("inputMethod", "DOCX");
      form.set("file", new Blob([new Uint8Array(bytes)]), "2026women.docx");
      if (planHash) form.set("planHash", planHash);
      return fetch(origin + "/api/admin/competitions/import/" + endpoint, { method: "POST", headers: { cookie: auth, origin: submittedOrigin }, body: form });
    };
    assert.equal((await submit("preview", undefined, "")).status, 401);
    assert.equal((await submit("preview", undefined, cookie, "https://invalid.example")).status, 403);
    const previewResponse = await submit("preview");
    assert.equal(previewResponse.status, 200, await previewResponse.clone().text());
    const { preview } = await previewResponse.json();
    assert.equal(preview.summary.createRows, 12);
    assert.equal(preview.summary.errorRows, 0);
    assert.equal(await prisma.match.count({ where: { competitionId } }), 0);
    const commitResponse = await submit("commit", preview.planHash);
    assert.equal(commitResponse.status, 201, (await commitResponse.clone().json()).error);
    const { result } = await commitResponse.json();
    assert.equal(result.createdMatches, 12);
    const repeat = await submit("preview");
    const repeatedPreview = (await repeat.json()).preview;
    assert.equal(repeatedPreview.summary.skipRows, 12);
    assert.equal((await submit("commit", preview.planHash)).status, 409);
    assert.equal(await prisma.match.count({ where: { competitionId } }), 12);
    const publicPage = await fetch(origin + "/competitions/" + payload.slug);
    const html = await publicPage.text();
    assert.equal(publicPage.status, 200);
    assert(html.includes("联赛总积分榜") && html.includes("联赛积分榜") && html.includes("致和书院女足"));
    const adminPage = await fetch(origin + "/admin/competitions/" + competitionId + "?section=standings", { headers: { cookie } });
    const adminHtml = await adminPage.text();
    assert.equal(adminPage.status, 200);
    assert(adminHtml.includes("总积分榜") && !adminHtml.includes("确认出线球队"));
    console.log("PASS HTTP: competition create persists league; real Word multipart preview/commit/retry; auth and CSRF; stale preview rejected; public/admin total standings render");
  } finally { await prisma.$disconnect(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
