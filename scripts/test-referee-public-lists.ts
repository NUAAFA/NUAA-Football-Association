import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@libsql/client";
import type { Competition, Prisma, Team } from "../src/generated/prisma-v29/client";

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "nuaafa-referee-lists-"));
  const url = `file:${path.join(root, "synthetic.db")}`;
  process.env.DATABASE_URL = url;
  process.env.NUAAFA_UPLOAD_DIR = path.join(root, "uploads");
  process.env.REFEREE_MEMBER_SESSION_SECRET = "synthetic-referee-list-session-secret-only";
  const { prisma } = await import("../src/lib/prisma");
  let server: ChildProcess | undefined;
  try {
    const raw = createClient({ url });
    try {
      const dirs = (await readdir("prisma/migrations", { withFileTypes: true })).filter((d) => d.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
      for (const dir of dirs) await raw.executeMultiple(await readFile(path.join("prisma/migrations", dir.name, "migration.sql"), "utf8"));
    } finally { raw.close(); }
    const referee = await prisma.referee.create({ data: {
      publicCode: "LIST-SYNTHETIC", name: "模拟裁判林一", status: "ACTIVE", mustChangePassword: false,
      studentId: "PRIVATE-STUDENT-ID", phone: "PRIVATE-PHONE", internalNote: "PRIVATE-REFEREE-NOTE", passwordHash: "PRIVATE-PASSWORD-HASH",
    } });
    const secondReferee = await prisma.referee.create({ data: { publicCode: "LIST-SYNTHETIC-2", name: "模拟裁判周二", status: "ACTIVE" } });
    const now = new Date();
    const date = new Date(now); date.setUTCDate(date.getUTCDate() + 10); date.setUTCHours(16, 0, 0, 0);
    const at = (days: number) => new Date(date.getTime() + days * 86_400_000);
    const competitions: { competition: Competition; home: Team; away: Team }[] = [];
    for (const [id, name, format] of [["five", "南京航空航天大学2026年“跃动牧星·活力青年”男子足球联赛（天目湖五人制）", "FUTSAL"], ["cup", "南京航空航天大学2026年足球新生杯", "ELEVEN_A_SIDE"], ["women", "南京航空航天大学2026年女子足球联赛", "FUTSAL"], ["private", "未公开内部赛事", "FUTSAL"]] as const) {
      const competition = await prisma.competition.create({ data: { id, slug: id, name, campus: "隔离测试", format, status: "ONGOING" } });
      const home = await prisma.team.create({ data: { competitionId: id, name: `${id === "five" ? "模拟五人制" : id === "women" ? "模拟女子" : "模拟新生杯"}甲队` } });
      const away = await prisma.team.create({ data: { competitionId: id, name: "模拟乙队" } });
      competitions.push({ competition, home, away });
    }
    const make = async (id: string, index = 0, changes: Partial<Prisma.MatchUncheckedCreateInput> = {}, appointment: Partial<Prisma.RefereeAppointmentUncheckedCreateInput> = {}) => {
      const fixture = competitions[index];
      const match = await prisma.match.create({ data: {
        id, slug: id, competitionId: fixture.competition.id, homeTeamId: fixture.home.id, awayTeamId: fixture.away.id,
        stage: "小组赛 · 第一轮", kickoff: at(0), venue: "模拟西操场", status: "SCHEDULED",
        applicationWindowStatus: "OPEN", applicationDeadline: new Date(date.getTime() - 3_600_000), internalNote: "PRIVATE-MATCH-NOTE", ...changes,
        positionRequirements: { create: { key: "REFEREE", label: "裁判员", count: 2, sortOrder: 1 } },
      } });
      await prisma.refereeAppointment.create({ data: {
        id: `a-${id}`, matchId: match.id, status: "PUBLISHED", publishedAt: now, publicationNote: "模拟公开选派说明", lastChangeReason: "PRIVATE-CHANGE-REASON", ...appointment,
        positions: { create: [
          { key: "REFEREE", label: "裁判员", slot: 1, sortOrder: 1, refereeId: referee.id },
          { key: "SECOND_REFEREE", label: "第二裁判员", slot: 1, sortOrder: 2, refereeId: secondReferee.id },
        ] },
      } });
    };
    for (let c = 0; c < 3; c += 1) for (let i = 0; i < 17; i += 1) {
      await make(`open-${c}-${String(i).padStart(2, "0")}`, c, { kickoff: new Date(at(Math.floor(i / 2)).getTime() + (i % 2) * 3_600_000 + c * 600_000) });
      await make(`past-${c}-${String(i).padStart(2, "0")}`, c, {
        status: "COMPLETED", kickoff: new Date(at(-30 - Math.floor(i / 2)).getTime() + (i % 2) * 3_600_000 + c * 600_000), homeScore: 2, awayScore: 1, applicationWindowStatus: "CLOSED",
      }, { status: "COMPLETED" });
    }
    await make("overdue", 0, { kickoff: at(-12), applicationWindowStatus: "CLOSED" });
    await make("ancient", 0, { kickoff: at(-400), applicationWindowStatus: "CLOSED" });
    await make("draft", 3, { applicationWindowStatus: "CLOSED" }, { status: "DRAFT" });
    await make("withdrawn", 3, { applicationWindowStatus: "CLOSED" }, { status: "WITHDRAWN" });
    await make("cancelled", 3, { status: "CANCELLED" }, { status: "CANCELLED" });
    await make("test-match", 0, { isTestData: true });
    await make("no-time", 0, { kickoff: null, applicationWindowStatus: "CLOSED" }, { status: "DRAFT" });
    await make("no-venue", 0, { venue: null, applicationWindowStatus: "CLOSED" }, { status: "DRAFT" });
    await make("expired", 3, { applicationDeadline: new Date(now.getTime() - 1), applicationWindowStatus: "OPEN" }, { status: "DRAFT" });
    await make("post-private", 3, { status: "COMPLETED", kickoff: at(-30), homeScore: 0, awayScore: 0 }, { status: "COMPLETED", recordSource: "POST_MATCH_ENTRY", publicHistoryVisible: false });
    await make("post-public", 0, { status: "COMPLETED", kickoff: at(-11), homeScore: 0, awayScore: 0, applicationWindowStatus: "CLOSED" }, { status: "COMPLETED", recordSource: "POST_MATCH_ENTRY", publicHistoryVisible: true, recordedAt: now, publicationNote: "PRIVATE-POST-MATCH-NOTE" });
    await make("history-no-score", 3, { status: "COMPLETED", kickoff: at(-30) }, { status: "COMPLETED" });
    await make("history-future", 3, { status: "COMPLETED", kickoff: at(2), homeScore: 1, awayScore: 0 }, { status: "COMPLETED" });

    const { refereeListFilters: filters, refereeListHref } = await import("../src/lib/referee-list-filters");
    const { getPublicAppointmentPage: appointments, getPublicOpenMatchPage: open } = await import("../src/lib/referee-public-list-service");
    for (const kind of ["assignments", "history", "open"] as const) {
      const query = (params = {}) => kind === "open" ? open(filters(params), now) : appointments(kind, filters(params), now);
      const first = await query();
      assert.equal(first.total, kind === "open" ? 51 : kind === "history" ? 52 : 53);
      assert.equal(first.items.length, 3);
      assert.deepEqual(new Set(first.competitions.map((c) => c.id)), new Set(["five", "cup", "women"]));
      const seen = new Set<string>();
      let after: string | null = null;
      let previousDistance = -1;
      do {
        const result = await query(after ? { after } : {});
        assert(result.items.length <= (after ? 12 : 3));
        for (const item of result.items) {
          assert(!seen.has(item.id)); seen.add(item.id);
          const kickoff = "match" in item ? item.match.kickoff : item.kickoff;
          const distance = Math.abs(kickoff!.getTime() - now.getTime());
          assert(distance >= previousDistance); previousDistance = distance;
        }
        assert(!JSON.stringify(result).includes("PRIVATE-REFEREE-NOTE"));
        assert(!JSON.stringify(result).includes("PRIVATE-PHONE"));
        after = result.nextCursor;
      } while (after);
      assert.equal(seen.size, first.total);
      const shifted = kind === "open"
        ? await open(filters({ after: first.nextCursor! }), new Date(now.getTime() + 3_600_000))
        : await appointments(kind, filters({ after: first.nextCursor! }), new Date(now.getTime() + 3_600_000));
      const fixed = await query({ after: first.nextCursor! });
      assert.deepEqual(shifted.items.map((item) => item.id), fixed.items.map((item) => item.id), "Scroll ranking must keep its original time anchor");
      if (kind === "open") assert.deepEqual(first.items.map((item) => item.id), ["open-0-00", "open-1-00", "open-2-00"]);
      if (kind === "assignments") assert.deepEqual(first.items.map((item) => item.id), ["a-overdue", "a-open-0-00", "a-open-1-00"]);
      assert.equal((await query({ after: "invalid-cursor" })).total, 0);
      assert.equal((await query({ competition: "private" })).total, 0);
      assert.equal((await query({ competition: "five", format: "ELEVEN_A_SIDE" })).total, 0);
      assert.equal((await query({ format: "FUTSAL", competition: "five" })).items.every((item) => "match" in item ? item.match.competition.id === "five" : item.competition.id === "five"), true);
      assert.equal((await query({ q: "模拟五人制" })).total, kind === "open" ? 17 : kind === "history" ? 18 : 19);
      assert.equal((await query({ q: "模拟裁判林一" })).total, kind === "open" ? 0 : first.total);
      for (const invalid of [{ from: "2026-02-30" }, { from: "2026-10-22", to: "2026-10-21" }, { format: "invalid" }, { competition: ["five", "cup"] }]) {
        const parsed = filters(invalid); assert(parsed.error);
        assert.equal((await query(invalid)).total, 0);
      }
      console.log(`PASS ${kind}: three-item initial response and bounded continuation without a display cap, global nearest-time order, mixed competitions, no duplicates, competition/format/team/referee filters, invalid input, hidden publication states and private competition options.`);
    }
    const beijingDay = new Date(date.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
    assert.equal((await open(filters({ from: beijingDay, to: beijingDay }), now)).total, 6);
    const lastDay = new Date(date.getTime() + 8 * 86_400_000 + 8 * 3_600_000).toISOString().slice(0, 10);
    assert.equal((await open(filters({ competition: "five", from: lastDay, to: lastDay }), now)).items.length, 1);
    const earlyHistory = new Date(at(-30).getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
    assert.equal((await appointments("history", filters({ competition: "five", from: earlyHistory, to: earlyHistory }), now)).items.length, 2);
    const sorted = await appointments("assignments", filters({ competition: "five" }), now);
    assert.equal(sorted.items[0].id, "a-overdue", "Uncompleted scheduled matches remain public even after kickoff");
    for (let i = 1; i < sorted.items.length; i += 1) assert(sorted.items[i - 1].match.kickoff! <= sorted.items[i].match.kickoff!);
    const history = await appointments("history", filters({ competition: "five" }), now);
    assert.equal(history.items[0].recordSource, "POST_MATCH_ENTRY");
    for (let i = 1; i < history.items.length; i += 1) assert(history.items[i - 1].match.kickoff! >= history.items[i].match.kickoff!);
    const href = new URL(refereeListHref("/referees/history", filters({ competition: "five", format: "FUTSAL", from: beijingDay, to: beijingDay, q: "模拟 & 林一" }), "opaque-cursor"), "https://test.local");
    assert.equal(href.searchParams.get("q"), "模拟 & 林一"); assert.equal(href.hash, "#referee-results"); assert.equal(href.searchParams.get("after"), "opaque-cursor");
    console.log("PASS Beijing natural-day boundaries, time ordering, overdue scheduled visibility, post-match records and escaped pagination URLs.");

    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production" };
    const build = spawn(process.execPath, ["node_modules/next/dist/bin/next", "build"], { env, stdio: "inherit" });
    const [buildCode] = await once(build, "exit"); assert.equal(buildCode, 0);
    const socket = createServer(); socket.listen(0, "127.0.0.1"); await once(socket, "listening");
    const address = socket.address(); assert(address && typeof address !== "string");
    const port = address.port; await new Promise<void>((resolve) => socket.close(() => resolve()));
    const base = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], { env, stdio: "inherit" });
    for (let i = 0; i < 100; i += 1) {
      assert.equal(server.exitCode, null);
      try { if ((await fetch(`${base}/referees/assignments`, { signal: AbortSignal.timeout(5000) })).ok) break; } catch { /* Still starting. */ }
      await delay(200);
    }
    const token = "synthetic-list-session-token";
    await prisma.refereeSession.create({ data: { refereeId: referee.id, tokenHash: createHmac("sha256", process.env.REFEREE_MEMBER_SESSION_SECRET!).update(token).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) } });
    const body = async (route: string, member = false) => {
      const response = await fetch(base + route, { headers: member ? { Cookie: `nuaa_referee_member=${token}` } : {} });
      assert.equal(response.status, 200, route);
      const html = await response.text();
      for (const secret of ["PRIVATE-STUDENT-ID", "PRIVATE-PHONE", "PRIVATE-REFEREE-NOTE", "PRIVATE-PASSWORD-HASH", "PRIVATE-CHANGE-REASON", "PRIVATE-POST-MATCH-NOTE", "PRIVATE-MATCH-NOTE", "未公开内部赛事"]) assert(!html.includes(secret), secret);
      return html;
    };
    for (const route of ["assignments", "history", "open-matches"]) {
      const html = await body(`/referees/${route}`);
      assert.equal([...html.matchAll(/<article\b/g)].length, 3);
      assert(html.includes('aria-label="筛选比赛"') && html.includes('继续浏览'));
      const filtered = await body(`/referees/${route}?competition=five&format=FUTSAL&page=2&q=${encodeURIComponent("模拟五人制")}`);
      assert.equal([...filtered.matchAll(/<article\b/g)].length, 3);
      assert(!filtered.includes("模拟新生杯甲队"));
      assert((await body(`/referees/${route}?q=no-such-team`)).includes("共 "));
    }
    for (const kind of ["assignments", "open-matches", "history"]) {
      const response = await fetch(`${base}/api/referees/public-list?kind=${kind}&limit=10000`);
      assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
      const batch = await response.json(); assert.equal(batch.items.length, 3); assert(batch.nextCursor);
      for (const secret of ["PRIVATE-POST-MATCH-NOTE", "PRIVATE-PHONE", "PRIVATE-MATCH-NOTE", "lastChangeReason", "passwordHash"]) assert(!JSON.stringify(batch).includes(secret));
      const next = await fetch(`${base}/api/referees/public-list?kind=${kind}&after=${encodeURIComponent(batch.nextCursor)}`);
      assert.equal(next.status, 200); const more = await next.json(); assert.equal(more.items.length, 12);
      assert(more.items.every((item: { id: string }) => !batch.items.some((old: { id: string }) => old.id === item.id)));
    }
    assert.equal((await fetch(`${base}/api/referees/public-list?kind=invalid`)).status, 400);
    assert.equal((await fetch(`${base}/api/referees/public-list?kind=history&after=invalid`)).status, 400);
    assert.equal((await fetch(`${base}/api/referees/public-list?kind=assignments&competition=five&competition=cup`)).status, 400);
    assert((await body("/referees/assignments/a-open-0-00/print")).includes("模拟裁判林一"));
    assert((await body("/referees/open-matches/open-0-00")).includes("岗位"));
    assert((await body("/referees/open-matches?competition=five", true)).includes("可报名场次 / 执裁意向"));
    const historyHtml = await body("/referees/history");
    assert(historyHtml.includes("赛后执裁记录") && !historyHtml.includes("PRIVATE-POST-MATCH-NOTE"));
    console.log("PASS production HTTP: all three lists, first three SSR items, public cursor API and filtering, empty state, public field allow-list, print/detail links and signed-in referee workspace.");
    const previewFile = path.join(root, "preview.json");
    await writeFile(previewFile, JSON.stringify({ base, beijingDay, root }));
    if (process.env.PLAYWRIGHT_MODULE) {
      const browser = spawn(process.execPath, ["scripts/test-referee-public-lists-browser.mjs"], {
        env: { ...process.env, REFEREE_LIST_PREVIEW_FILE: previewFile }, stdio: "inherit",
      });
      const [browserCode] = await once(browser, "exit");
      assert.equal(browserCode, 0, "Browser acceptance failed");
    }
    if (process.env.REFEREE_LIST_KEEP_PREVIEW === "1") {
      await writeFile("/tmp/nuaafa-referee-list-preview.json", JSON.stringify({ base, beijingDay, root }));
      console.log(`PREVIEW_READY ${base}`);
      await new Promise<void>((resolve) => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); });
    }
  } finally {
    if (server && server.exitCode === null) { const exited = once(server, "exit"); server.kill("SIGTERM"); await exited; }
    await prisma.$disconnect();
    await rm(root, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
