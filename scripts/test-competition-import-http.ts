import path from "node:path";

type RoleName = "super" | "content" | "competition" | "referee";

const usernames: Record<RoleName, string> = {
  super: "smoke-super",
  content: "smoke-content",
  competition: "smoke-competition",
  referee: "smoke-referee",
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectStatus(label: string, actual: number, expected: number) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, received ${actual}`);
  console.log(`PASS ${label}: ${actual}`);
}

async function main() {
  const smokeRoot = process.argv[2];
  const baseUrl = process.argv[3] ?? "http://127.0.0.1:3104";
  if (!smokeRoot || !path.isAbsolute(smokeRoot)) throw new Error("An absolute isolated smoke root is required.");
  const mutationOrigin = "https://nuaafa.cn";
  const password = "Smoke-Password-2026!";
  process.env.DATABASE_URL = `file:${path.join(smokeRoot, "smoke.db").replaceAll("\\", "/")}`;
  const { prisma } = await import("../src/lib/prisma");

  async function login(role: RoleName) {
    const response = await fetch(`${baseUrl}/api/referees/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: mutationOrigin },
      body: JSON.stringify({ username: usernames[role], password }),
      redirect: "manual",
    });
    expectStatus(`${role} login`, response.status, 200);
    const cookie = response.headers.get("set-cookie")?.match(/nuaa_referee_admin=[^;]+/)?.[0];
    assert(cookie, `${role} login did not set an admin cookie.`);
    return cookie;
  }

  function importForm(input: { competitionId: string; importType: "TEAM" | "MATCH"; inputMethod: "CSV" | "PASTE"; content: string }) {
    const form = new FormData();
    form.set("competitionId", input.competitionId);
    form.set("importType", input.importType);
    form.set("inputMethod", input.inputMethod);
    if (input.inputMethod === "CSV") form.set("file", new File([input.content], "r1-3b-smoke.csv", { type: "text/csv" }));
    else form.set("content", input.content);
    return form;
  }

  async function postImport(pathname: "preview" | "commit", cookie: string | undefined, origin: string, form: FormData) {
    if (pathname === "commit" && cookie) {
      const checked = await fetch(`${baseUrl}/api/admin/competitions/import/preview`, { method: "POST", headers: { cookie, origin }, body: form });
      const checkedBody = await checked.json() as { preview?: { planHash?: string } };
      if (checkedBody.preview?.planHash) form.set("planHash", checkedBody.preview.planHash);
    }
    return fetch(`${baseUrl}/api/admin/competitions/import/${pathname}`, {
      method: "POST",
      headers: { ...(cookie ? { cookie } : {}), origin },
      body: form,
      redirect: "manual",
    });
  }

  try {
    const competition = await prisma.competition.findUniqueOrThrow({ where: { slug: "smoke-competition" } });
    const cookies = Object.fromEntries(await Promise.all((Object.keys(usernames) as RoleName[]).map(async (role) => [role, await login(role)] as const))) as Record<RoleName, string>;

    const unauthenticatedPage = await fetch(`${baseUrl}/admin/competitions/import`, { redirect: "manual" });
    assert([303, 307, 308].includes(unauthenticatedPage.status) && unauthenticatedPage.headers.get("location")?.includes("/admin/login"), "Unauthenticated import page did not redirect to the unified login.");
    for (const role of ["super", "competition"] as const) {
      const response = await fetch(`${baseUrl}/admin/competitions/import`, { headers: { cookie: cookies[role] }, redirect: "manual" });
      expectStatus(`${role} import page`, response.status, 200);
      const html = await response.text();
      assert(html.includes("赛事批量导入") && html.includes("检查导入内容"), `${role} import page did not render the functional workflow.`);
    }
    for (const role of ["content", "referee"] as const) {
      const response = await fetch(`${baseUrl}/admin/competitions/import`, { headers: { cookie: cookies[role] }, redirect: "manual" });
      assert([303, 307, 308].includes(response.status) && response.headers.get("location")?.includes("/admin?denied="), `${role} direct import page did not fail closed.`);
      console.log(`PASS ${role} import page denied`);
    }

    expectStatus("template unauthenticated", (await fetch(`${baseUrl}/api/admin/competitions/import/templates/team`)).status, 401);
    expectStatus("template COMPETITION_ADMIN", (await fetch(`${baseUrl}/api/admin/competitions/import/templates/team`, { headers: { cookie: cookies.competition } })).status, 200);
    expectStatus("template SUPER_ADMIN", (await fetch(`${baseUrl}/api/admin/competitions/import/templates/match`, { headers: { cookie: cookies.super } })).status, 200);
    expectStatus("template CONTENT_EDITOR denied", (await fetch(`${baseUrl}/api/admin/competitions/import/templates/team`, { headers: { cookie: cookies.content } })).status, 403);
    expectStatus("template REFEREE_ADMIN denied", (await fetch(`${baseUrl}/api/admin/competitions/import/templates/team`, { headers: { cookie: cookies.referee } })).status, 403);

    const teamCsv = "\uFEFFname,teamType\r\nHTTP导入甲,FREEFORM\r\nHTTP导入乙,FREEFORM\r\n";
    const teamInput = { competitionId: competition.id, importType: "TEAM" as const, inputMethod: "CSV" as const, content: teamCsv };
    expectStatus("preview unauthenticated", (await postImport("preview", undefined, mutationOrigin, importForm(teamInput))).status, 401);
    expectStatus("preview CONTENT_EDITOR direct API bypass denied", (await postImport("preview", cookies.content, mutationOrigin, importForm(teamInput))).status, 403);
    expectStatus("preview REFEREE_ADMIN direct API bypass denied", (await postImport("preview", cookies.referee, mutationOrigin, importForm(teamInput))).status, 403);
    expectStatus("preview bad Origin", (await postImport("preview", cookies.super, "https://attacker.invalid", importForm(teamInput))).status, 403);

    const beforePreview = { teams: await prisma.team.count(), matches: await prisma.match.count(), audits: await prisma.auditLog.count() };
    for (const role of ["competition", "super"] as const) {
      const response = await postImport("preview", cookies[role], mutationOrigin, importForm(teamInput));
      expectStatus(`team CSV preview ${role}`, response.status, 200);
      const body = await response.json() as { preview?: { summary?: { createRows?: number } } };
      assert(body.preview?.summary?.createRows === 2, `${role} team preview summary mismatch.`);
    }
    assert(await prisma.team.count() === beforePreview.teams && await prisma.match.count() === beforePreview.matches && await prisma.auditLog.count() === beforePreview.audits, "HTTP preview produced a business write.");

    const teamCommitResponse = await postImport("commit", cookies.competition, mutationOrigin, importForm(teamInput));
    expectStatus("team CSV commit COMPETITION_ADMIN", teamCommitResponse.status, 201);
    const teamCommit = await teamCommitResponse.json() as { result?: { createdTeams?: number; auditId?: string } };
    assert(teamCommit.result?.createdTeams === 2 && teamCommit.result.auditId, "Team HTTP commit summary mismatch.");
    const teamSecondResponse = await postImport("commit", cookies.super, mutationOrigin, importForm(teamInput));
    expectStatus("team CSV second commit SUPER_ADMIN", teamSecondResponse.status, 201);
    const teamSecond = await teamSecondResponse.json() as { result?: { createdTeams?: number; reusedTeams?: number } };
    assert(teamSecond.result?.createdTeams === 0 && teamSecond.result.reusedTeams === 2, "Team HTTP re-import was not idempotent.");

    const matchPaste = "homeTeam\tawayTeam\tkickoff\tendAt\tvenue\tstage\tround\nHTTP导入甲\tHTTP导入乙\t2026-12-15 18:30\t\tHTTP隔离场地\t小组赛\t第1轮";
    const matchInput = { competitionId: competition.id, importType: "MATCH" as const, inputMethod: "PASTE" as const, content: matchPaste };
    const pastePreview = await postImport("preview", cookies.competition, mutationOrigin, importForm(matchInput));
    expectStatus("match Paste preview", pastePreview.status, 200);
    const matchCommitResponse = await postImport("commit", cookies.super, mutationOrigin, importForm(matchInput));
    expectStatus("match Paste commit", matchCommitResponse.status, 201);
    const matchCommit = await matchCommitResponse.json() as { result?: { createdMatches?: number } };
    assert(matchCommit.result?.createdMatches === 1, "Match HTTP commit summary mismatch.");
    const matchSecondResponse = await postImport("commit", cookies.competition, mutationOrigin, importForm(matchInput));
    expectStatus("match Paste second commit", matchSecondResponse.status, 201);
    const matchSecond = await matchSecondResponse.json() as { result?: { createdMatches?: number; skippedMatches?: number } };
    assert(matchSecond.result?.createdMatches === 0 && matchSecond.result.skippedMatches === 1, "Match HTTP re-import was not idempotent.");
    const persisted = await prisma.match.findFirstOrThrow({ where: { competitionId: competition.id, venue: "HTTP隔离场地" } });
    assert(persisted.applicationWindowStatus === "CLOSED" && persisted.applicationDeadline === null, "HTTP-imported match opened referee applications.");

    const oversized = new FormData();
    oversized.set("competitionId", competition.id);
    oversized.set("importType", "TEAM");
    oversized.set("inputMethod", "CSV");
    oversized.set("file", new File([new Uint8Array(5 * 1024 * 1024 + 1)], "oversized.csv", { type: "text/csv" }));
    expectStatus("oversized import", (await postImport("preview", cookies.super, mutationOrigin, oversized)).status, 413);

    console.log("R1-3B real HTTP import page, RBAC, Origin, CSV, Paste, commit and idempotency smoke passed.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
