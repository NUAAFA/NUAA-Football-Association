import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
async function main() {
  const root = process.env.OPS_R312_ROOT!, origin = "http://127.0.0.1:3192";
  assert(path.isAbsolute(root) && path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(root).startsWith("nuaafa-ops-r312-"));
  const fixture = JSON.parse(await readFile(path.join(root, "fixture.json"), "utf8")); process.env.DATABASE_URL = fixture.databaseUrl;
  const { prisma } = await import("../src/lib/prisma");
  const accounts = JSON.parse(await readFile(path.join(root, "accounts.json"), "utf8"));
  async function api(route: string, body: unknown, cookie = "", status = 200, method = "POST") {
    const response = await fetch(origin + route, { method, headers: { "content-type": "application/json", origin: "https://nuaafa.cn", cookie }, body: JSON.stringify(body) });
    const data = await response.json(); assert.equal(response.status, status, JSON.stringify(data)); return data;
  }
  async function login(username: string) { const r = await fetch(origin + "/api/referees/admin/login", { method: "POST", headers: { "content-type": "application/json", origin: "https://nuaafa.cn" }, body: JSON.stringify({ username, password: accounts.password }) }); assert.equal(r.status, 200); return r.headers.get("set-cookie")!.split(";")[0]; }
  async function html(route: string, cookie = "") { const r = await fetch(origin + route, { headers: { cookie }, cache: "no-store" }); assert.equal(r.status, 200, route); return (await r.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ""); }
  const featured = await prisma.competition.findMany({ where: { homepageFeatured: true }, select: { id: true } });
  try {
    await prisma.competition.updateMany({ where: { id: { in: featured.map((c) => c.id) } }, data: { homepageFeatured: false } });
    const admin = await login("r312-super"), content = await login("r312-content");
    const c = await prisma.competition.create({ data: { slug: `r312-http-pending-${Date.now()}`, name: "R312全部待排期公开隔离", format: "FUTSAL", playingFormat: "五人制", campus: "隔离", status: "ONGOING", publicPublished: true, homepageFeatured: true } });
    const home = await prisma.team.create({ data: { competitionId: c.id, name: "HTTP主队" } }), away = await prisma.team.create({ data: { competitionId: c.id, name: "HTTP客队" } });
    const payload = { competitionId: c.id, slug: `r312-http-match-${Date.now()}`, stage: "正式对阵", kickoff: "", venue: "", homeTeamId: home.id, awayTeamId: away.id, status: "SCHEDULED", applicationWindowStatus: "CLOSED", positionCounts: {} };
    const created = await api("/api/referees/admin/matches", payload, admin, 201); const id = created.matchId;
    for (const route of ["/", "/competitions", `/competitions/${c.slug}`]) { const page = await html(route); assert(page.includes("赛程已公布，具体比赛时间待定"), route); }
    const detail = await html(`/competitions/${c.slug}`); assert(detail.includes("时间待定") && detail.includes("场地待定") && detail.includes("HTTP主队")); assert(!detail.includes("赛事已结束"));
    const edit = await html(`/admin/matches/${id}/edit`, admin); assert(edit.includes("待排期可留空"));
    const schedule = `/api/admin/matches/${id}/schedule`, real = { kickoff: "2030-10-01T18:30", venue: "HTTP真实场地" };
    await api(schedule, real, "", 401); await api(schedule, real, content, 403);
    await api(schedule, { ...real, kickoff: "bad" }, admin, 400);
    await api(schedule, { ...real, endAt: "2030-10-01T17:30" }, admin, 400);
    await api(`/api/referees/admin/matches/${id}`, { ...payload, applicationWindowStatus: "OPEN", applicationDeadline: "2030-09-30T12:00" }, admin, 409, "PATCH");
    await api(`/api/admin/matches/${id}/result`, { homeScore: 1, awayScore: 0, homePenaltyScore: null, awayPenaltyScore: null, actualEnded: true, expectedVersion: 0, reason: "隔离" }, admin, 409);
    await api(schedule, real, admin); await api(schedule, real, admin, 409);
    const persisted = await prisma.match.findUniqueOrThrow({ where: { id } }); assert.equal(persisted.kickoff?.toISOString(), "2030-10-01T10:30:00.000Z"); assert.equal(persisted.venue, real.venue); assert.equal(persisted.applicationWindowStatus, "CLOSED");
    const scheduled = await html(`/competitions/${c.slug}`); assert(scheduled.includes("18:30") && scheduled.includes("HTTP真实场地")); assert(!scheduled.includes("赛程已公布，具体比赛时间待定"));
    await api(`/api/referees/admin/matches/${id}`, { ...payload, kickoff: "2025-10-01T18:30", venue: "HTTP真实场地" }, admin, 200, "PATCH");
    await api(`/api/admin/matches/${id}/result`, { homeScore: 2, awayScore: 1, homePenaltyScore: null, awayPenaltyScore: null, actualEnded: true, expectedVersion: 0, reason: "隔离真实赛果" }, admin);
    assert((await html(`/competitions/${c.slug}`)).includes("2 : 1"));
    console.log("PASS HTTP: empty API create; pending homepage/catalog/detail; schedule auth/date/end guards; result/open blocked; real schedule -> confirmed result");
  } finally { await prisma.competition.updateMany({ where: { id: { in: featured.map((c) => c.id) } }, data: { homepageFeatured: true } }); await prisma.$disconnect(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
