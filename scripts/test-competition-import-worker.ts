import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@libsql/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { strToU8, zipSync } from "fflate";
import { PrismaClient } from "../src/generated/prisma-v29/client";
import type { CompetitionImportIssue } from "../src/lib/competition-import-types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function rejects(action: () => unknown | Promise<unknown>, message: string) {
  try { await action(); } catch { return; }
  throw new Error(message);
}

async function applyMigrations(url: string) {
  const client = createClient({ url });
  const entries = (await readdir(path.resolve("prisma/migrations"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    await client.executeMultiple(await readFile(path.resolve("prisma/migrations", entry.name, "migration.sql"), "utf8"));
  }
  client.close();
}

function xml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

type XlsxCell = { value: string | number; date?: boolean } | null;

function xlsxBuffer(rows: XlsxCell[][]) {
  const columns = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const rowXml = rows.map((row, rowIndex) => {
    const cells = row.flatMap((cell, columnIndex) => {
      if (!cell) return [];
      const reference = `${columns[columnIndex]}${rowIndex + 1}`;
      if (typeof cell.value === "number") {
        return [`<c r="${reference}"${cell.date ? ' s="1"' : ""}><v>${cell.value}</v></c>`];
      }
      return [`<c r="${reference}" t="inlineStr"><is><t>${xml(cell.value)}</t></is></c>`];
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Import" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/></numFmts><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" xfId="0"/><xf numFmtId="164" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`,
  };
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name, content]) => [name, strToU8(content)]))));
}

function excelSerial(year: number, month: number, day: number, hour: number, minute: number) {
  return (Date.UTC(year, month - 1, day, hour, minute) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

async function main() {
  const databasePath = process.env.COMPETITION_IMPORT_TEST_DATABASE_PATH;
  if (!databasePath) throw new Error("COMPETITION_IMPORT_TEST_DATABASE_PATH is required.");
  const url = `file:${databasePath.replaceAll("\\", "/")}`;
  process.env.DATABASE_URL = url;
  process.env.NUAAFA_ISOLATED_SECURITY_TEST = "1";
  process.env.REFEREE_ADMIN_SESSION_SECRET = "r1-3b-import-test-session-secret";
  await applyMigrations(url);

  const parser = await import("../src/lib/competition-import-parser");
  const service = await import("../src/lib/competition-import-service");
  const types = await import("../src/lib/competition-import-types");
  const verifier = new PrismaClient({ adapter: new PrismaLibSql({ url }) });
  const actor = { id: null, displayName: "R1-3B 隔离管理员", isLegacy: true, roles: ["SUPER_ADMIN" as const] };
  const capabilities = await import("./security-r4a-test-capabilities");
  const competitionAuthorization = capabilities.issueTestAdminServiceAuthorization(
    "competitions:write",
    actor,
  );
  const makeInput = (competitionId: string, importType: "TEAM" | "MATCH", text: string, method: "CSV" | "PASTE" = "CSV") => {
    const parsed = method === "CSV"
      ? parser.parseCompetitionImportCsv(text, importType)
      : parser.parseCompetitionImportPaste(text, importType);
    return {
      competitionId,
      importType,
      inputMethod: method,
      inputHash: createHash("sha256").update(text).digest("hex"),
      ...parsed,
    };
  };

  try {
    const normalCsv = parser.parseCompetitionImportCsv("name,teamType\r\n球队A,FREEFORM\r\n", "TEAM");
    assert(normalCsv.rows[0]?.values.name === "球队A", "Normal CSV parse failed.");
    assert(parser.parseCompetitionImportCsv("\uFEFFname\n球队B\n", "TEAM").rows[0]?.values.name === "球队B", "UTF-8 BOM parse failed.");
    const quoted = parser.parseCompetitionImportCsv('name\n"球队,一队"\n"球队""二队"\n"跨\n行球队"\n', "TEAM");
    assert(quoted.rows[0]?.values.name === "球队,一队", "Quoted comma parse failed.");
    assert(quoted.rows[1]?.values.name === '球队"二队', "Escaped quote parse failed.");
    assert(quoted.rows[2]?.values.name === "跨\n行球队", "Quoted newline parse failed.");
    const paste = parser.parseCompetitionImportPaste("name\tteamType\n粘贴甲\tFREEFORM\n粘贴乙\tJOINT", "TEAM");
    assert(paste.rows.length === 2 && paste.rows[1]?.values.name === "粘贴乙", "TSV paste parse failed.");
    const headerlessPaste = parser.parseCompetitionImportPaste("无表头甲\n无表头乙", "TEAM");
    assert(headerlessPaste.rows.length === 2, "Headerless team paste fallback failed.");
    await rejects(() => parser.parseCompetitionImportCsv("teamType\nFREEFORM\n", "TEAM"), "Missing required CSV header was accepted.");

    const matchXlsx = xlsxBuffer([
      ["homeTeam", "awayTeam", "kickoff", "endAt", "venue", "stage", "round"].map((value) => ({ value })),
      [{ value: "表格主队" }, { value: "表格客队" }, { value: excelSerial(2026, 10, 15, 18, 30), date: true }, null, { value: "表格场地" }, { value: "小组赛" }, { value: 1 }],
      [null, null, null, null, null, null, null],
    ]);
    const parsedXlsx = await parser.parseCompetitionImportXlsx(matchXlsx, "MATCH");
    assert(parsedXlsx.rows.length === 1, "Empty XLSX rows were not ignored.");
    assert(parsedXlsx.rows[0]?.values.kickoff instanceof Date, "Formatted XLSX date cell was not parsed as Date.");
    assert(parsedXlsx.rows[0]?.values.round === 1, "Numeric XLSX cell was not preserved.");
    const teamXlsx = await parser.parseCompetitionImportXlsx(xlsxBuffer([
      [{ value: "name" }, { value: "teamType" }],
      [{ value: "XLSX球队" }, { value: "FREEFORM" }],
    ]), "TEAM");
    assert(teamXlsx.rows[0]?.values.name === "XLSX球队", "Team XLSX worksheet parse failed.");
    await rejects(
      () => parser.parseCompetitionImportXlsx(xlsxBuffer([[{ value: "teamType" }], [{ value: "FREEFORM" }]]), "TEAM"),
      "Missing required XLSX header was accepted.",
    );
    await rejects(
      () => parser.parseCompetitionImportCsv(`name\n${Array.from({ length: 5_001 }, (_, index) => `球队${index}`).join("\n")}`, "TEAM"),
      "Import row limit was not enforced.",
    );

    const competition = await verifier.competition.create({ data: {
      slug: "r1-3b-import-test",
      name: "R1-3B 隔离导入赛事",
      year: 2026,
      campus: "天目湖校区",
      format: "ELEVEN_A_SIDE",
      status: "PREPARING",
    } });
    const existingTeam = await verifier.team.create({ data: {
      competitionId: competition.id,
      name: "计算机学院",
      teamType: "ORGANIZATION",
    } });

    const invalidTeams = makeInput(competition.id, "TEAM", "name,teamType\n计算机学院,FREEFORM\n新球队,FREEFORM\n新球队,FREEFORM\n,FREEFORM\n类型错误队,INVALID\n");
    const invalidTeamPreview = await service.buildCompetitionImportPreview(invalidTeams);
    assert(invalidTeamPreview.rows[0]?.action === "REUSE_EXISTING", "Exact existing team was not reused.");
    assert(invalidTeamPreview.rows[1]?.action === "CREATE", "New team was not planned for creation.");
    assert(invalidTeamPreview.rows[2]?.errors.some((item) => item.errorCode === "DUPLICATE_INPUT"), "Duplicate input team was not detected.");
    assert(invalidTeamPreview.rows[3]?.errors.some((item) => item.errorCode === "REQUIRED"), "Trimmed empty team name was not rejected.");
    assert(invalidTeamPreview.rows[4]?.errors.some((item) => item.errorCode === "INVALID_TEAM_TYPE"), "Invalid teamType was not rejected.");

    const validTeams = makeInput(competition.id, "TEAM", "name,teamType,externalTeamId\n计算机学院,ORGANIZATION,\n计算机学院队,FREEFORM,\n航空学院,ORGANIZATION,TEAM-AVIATION\n");
    const beforeTeamDryRun = {
      teams: await verifier.team.count(),
      matches: await verifier.match.count(),
      audits: await verifier.auditLog.count(),
    };
    const validTeamPreview = await service.buildCompetitionImportPreview(validTeams);
    assert(validTeamPreview.rows[1]?.action === "CREATE", "Similar team was auto-merged instead of created.");
    assert(validTeamPreview.rows[1]?.warnings.some((item) => item.errorCode === "POTENTIAL_TEAM_MATCH"), "Similar team warning was not emitted.");
    assert(await verifier.team.count() === beforeTeamDryRun.teams, "Team dry-run wrote Team rows.");
    assert(await verifier.match.count() === beforeTeamDryRun.matches, "Team dry-run wrote Match rows.");
    assert(await verifier.auditLog.count() === beforeTeamDryRun.audits, "Team dry-run wrote AuditLog rows.");
    const teamCommit = await service.commitCompetitionImport(validTeams, competitionAuthorization);
    assert(teamCommit.createdTeams === 2 && teamCommit.reusedTeams === 1, "Team commit summary mismatch.");
    assert(await verifier.team.count() === beforeTeamDryRun.teams + 2, "Team commit did not create expected rows.");
    const teamCommitAgain = await service.commitCompetitionImport(validTeams, competitionAuthorization);
    assert(teamCommitAgain.createdTeams === 0 && teamCommitAgain.reusedTeams === 3, "Team re-import was not idempotent.");
    assert(await verifier.team.count() === beforeTeamDryRun.teams + 2, "Team re-import created duplicates.");

    const dateErrors: CompetitionImportIssue[] = [];
    const timezoneDate = service.parseCompetitionImportDate("2026-10-15 18:30", "kickoff", "开球时间", dateErrors);
    assert(timezoneDate?.toISOString() === "2026-10-15T10:30:00.000Z", "Asia/Shanghai timezone conversion is not deterministic.");
    const ambiguousErrors: CompetitionImportIssue[] = [];
    assert(service.parseCompetitionImportDate("10/11/26", "kickoff", "开球时间", ambiguousErrors) === null, "Ambiguous date was accepted.");
    assert(ambiguousErrors.some((item) => item.errorCode === "INVALID_OR_AMBIGUOUS_DATE"), "Ambiguous date error code missing.");

    const invalidMatches = makeInput(competition.id, "MATCH", "homeTeam,awayTeam,kickoff,endAt,venue,stage,round,externalMatchId\n计算机学院,航空学院,2026-10-15 18:30,,一号场,小组赛,1,VALID-ROW\n未知主队,未知客队,2026-10-16 18:30,,二号场,小组赛,2,UNKNOWN-ROW\n同队,同队,2026-10-17 18:30,,三号场,小组赛,3,\n甲队,乙队,not-a-date,,四号场,小组赛,4,\n甲队,乙队,10/11/26,,五号场,小组赛,5,\n甲队,乙队,2026-10-18 18:30,2026-10-18 18:00,六号场,小组赛,6,\n计算机学院,航空学院,2026-10-15 18:30,,一号场,小组赛,1,VALID-ROW\n");
    const invalidMatchPreview = await service.buildCompetitionImportPreview(invalidMatches);
    assert(invalidMatchPreview.rows[0]?.action === "CREATE", "Valid match was not planned for creation.");
    assert(invalidMatchPreview.rows[1]?.teamActions?.filter((item) => item.action === "CREATE_TEAM").length === 2, "Unknown match teams were not planned for creation.");
    assert(invalidMatchPreview.rows[2]?.errors.some((item) => item.errorCode === "SAME_TEAM"), "home == away was not rejected.");
    assert(invalidMatchPreview.rows[3]?.errors.some((item) => item.errorCode === "INVALID_OR_AMBIGUOUS_DATE"), "Invalid kickoff was not rejected.");
    assert(invalidMatchPreview.rows[4]?.errors.some((item) => item.errorCode === "INVALID_OR_AMBIGUOUS_DATE"), "Ambiguous kickoff was not rejected.");
    assert(invalidMatchPreview.rows[5]?.errors.some((item) => item.errorCode === "END_NOT_AFTER_KICKOFF"), "endAt <= kickoff was not rejected.");
    assert(invalidMatchPreview.rows[6]?.errors.some((item) => item.errorCode.includes("DUPLICATE_INPUT")), "Duplicate input match was not detected.");

    const existingAway = await verifier.team.findUniqueOrThrow({ where: { competitionId_name: { competitionId: competition.id, name: "航空学院" } } });
    await verifier.match.create({ data: {
      slug: "manual-identical-existing",
      competitionId: competition.id,
      stage: "淘汰赛",
      kickoff: new Date("2026-10-20T10:30:00.000Z"),
      endAt: null,
      venue: "一号场",
      round: "八强",
      homeTeamId: existingTeam.id,
      awayTeamId: existingAway.id,
      status: "SCHEDULED",
      applicationWindowStatus: "CLOSED",
    } });
    await verifier.match.create({ data: {
      slug: "manual-conflicting-existing",
      competitionId: competition.id,
      stage: "半决赛",
      kickoff: new Date("2026-10-21T10:30:00.000Z"),
      endAt: null,
      venue: "数据库场地",
      homeTeamId: existingTeam.id,
      awayTeamId: existingAway.id,
      status: "SCHEDULED",
      applicationWindowStatus: "CLOSED",
    } });
    await verifier.match.create({ data: {
      slug: "manual-external-collision",
      competitionId: competition.id,
      stage: "外部 ID 已占用",
      kickoff: new Date("2026-10-22T10:30:00.000Z"),
      venue: "三号场",
      externalMatchId: "EXT-COLLISION",
      homeTeamId: existingTeam.id,
      awayTeamId: existingAway.id,
      status: "SCHEDULED",
      applicationWindowStatus: "CLOSED",
    } });
    const reconciliationInput = makeInput(competition.id, "MATCH", "homeTeam,awayTeam,kickoff,endAt,venue,stage,round,externalMatchId\n计算机学院,航空学院,2026-10-20 18:30,,一号场,淘汰赛,八强,\n计算机学院,航空学院,2026-10-21 18:30,,导入场地,半决赛,,\n计算机学院,航空学院,2026-10-23 18:30,,四号场,决赛,,EXT-COLLISION\n");
    const reconciliation = await service.buildCompetitionImportPreview(reconciliationInput);
    assert(reconciliation.rows[0]?.action === "SKIP_DUPLICATE", "Identical existing match was not skipped.");
    assert(reconciliation.rows[1]?.action === "CONFLICT" && reconciliation.rows[1]?.differences?.venue, "Conflicting existing match did not report field differences.");
    assert(reconciliation.rows[2]?.action === "CONFLICT", "externalMatchId collision was not blocked.");

    const validMatches = makeInput(competition.id, "MATCH", "homeTeam,awayTeam,kickoff,endAt,venue,stage,round,externalMatchId\n计算机学院,航空学院,2026-10-25 18:30,2026-10-25 20:30,一号场,小组赛,第1轮,MATCH-001\n新赛程球队,航空学院,2026-10-26T18:30:00+08:00,,二号场,小组赛,第2轮,MATCH-002\n");
    const beforeMatchDryRun = { teams: await verifier.team.count(), matches: await verifier.match.count(), audits: await verifier.auditLog.count() };
    const validMatchPreview = await service.buildCompetitionImportPreview(validMatches);
    const repeatPreview = await service.buildCompetitionImportPreview(validMatches);
    assert(validMatchPreview.rows[0]?.slug === repeatPreview.rows[0]?.slug, "Stable match slug was not deterministic.");
    assert(validMatchPreview.summary.plannedTeamCreates === 1, "Unknown team creation summary mismatch.");
    assert(await verifier.team.count() === beforeMatchDryRun.teams && await verifier.match.count() === beforeMatchDryRun.matches && await verifier.auditLog.count() === beforeMatchDryRun.audits, "Match dry-run performed a write.");
    const matchCommit = await service.commitCompetitionImport(validMatches, competitionAuthorization);
    assert(matchCommit.createdTeams === 1 && matchCommit.createdMatches === 2, "Match commit summary mismatch.");
    const persistedMatch = await verifier.match.findUniqueOrThrow({ where: { source_externalMatchId: { source: "MANUAL", externalMatchId: "MATCH-001" } } });
    assert(persistedMatch.kickoff!.toISOString() === "2026-10-25T10:30:00.000Z", "Persisted kickoff timezone mismatch.");
    assert(persistedMatch.status === "SCHEDULED" && persistedMatch.applicationWindowStatus === "CLOSED" && persistedMatch.applicationDeadline === null, "Imported match safety defaults failed.");
    const matchCommitAgain = await service.commitCompetitionImport(validMatches, competitionAuthorization);
    assert(matchCommitAgain.createdTeams === 0 && matchCommitAgain.createdMatches === 0 && matchCommitAgain.skippedMatches === 2, "Match re-import was not idempotent.");
    assert(await verifier.match.count() === beforeMatchDryRun.matches + 2, "Match re-import created duplicates.");
    const audit = await verifier.auditLog.findUniqueOrThrow({ where: { id: matchCommit.auditId } });
    assert(audit.action === "COMPETITION_IMPORT_COMMITTED" && audit.metadata?.includes(validMatches.inputHash), "Batch AuditLog metadata is incomplete.");
    assert(!audit.metadata?.includes("homeTeam,awayTeam"), "AuditLog stored raw import payload.");

    const raceInput = makeInput(competition.id, "MATCH", "homeTeam,awayTeam,kickoff,endAt,venue,stage,round,externalMatchId\nRace主队,Race客队,2026-11-01 18:30,,Preview场地,小组赛,,\n");
    const racePreview = await service.buildCompetitionImportPreview(raceInput);
    assert(racePreview.rows[0]?.action === "CREATE", "Race precondition did not preview CREATE.");
    const raceTeams = await Promise.all(["Race主队", "Race客队"].map((name) => verifier.team.create({ data: { competitionId: competition.id, name } })));
    await verifier.match.create({ data: {
      slug: "race-conflicting-record",
      competitionId: competition.id,
      stage: "小组赛",
      kickoff: new Date("2026-11-01T10:30:00.000Z"),
      venue: "Commit前冲突场地",
      homeTeamId: raceTeams[0].id,
      awayTeamId: raceTeams[1].id,
      status: "SCHEDULED",
      applicationWindowStatus: "CLOSED",
    } });
    const beforeRaceCommit = { teams: await verifier.team.count(), matches: await verifier.match.count() };
    let raceConflict = false;
    try { await service.commitCompetitionImport(raceInput, competitionAuthorization); } catch (error) { raceConflict = error instanceof service.CompetitionImportCommitConflict; }
    assert(raceConflict, "Commit did not return a race conflict.");
    assert(await verifier.team.count() === beforeRaceCommit.teams && await verifier.match.count() === beforeRaceCommit.matches, "Race conflict left partial writes.");

    const formulaPreview = { ...validMatchPreview, rows: [{ ...validMatchPreview.rows[0], errors: [{ field: "=field", errorCode: "+code", message: "@message" }] }] };
    const errorCsv = types.buildCompetitionImportErrorCsv(formulaPreview);
    assert(errorCsv.includes("'=field") && errorCsv.includes("'+code") && errorCsv.includes("'@message"), "Error report did not prevent spreadsheet formula injection.");

    const atomicInput = makeInput(competition.id, "MATCH", "homeTeam,awayTeam,kickoff,endAt,venue,stage,round,externalMatchId\nAtomic甲,Atomic乙,2026-12-01 18:30,,原子场地,小组赛,,ATOMIC-1\nAtomic丙,Atomic丁,2026-12-02 18:30,,原子场地,小组赛,,ATOMIC-2\n");
    const beforeAtomic = { teams: await verifier.team.count(), matches: await verifier.match.count() };
    await verifier.$executeRawUnsafe('DROP TABLE "AuditLog"');
    await rejects(() => service.commitCompetitionImport(atomicInput, competitionAuthorization), "Forced commit-time failure did not reject.");
    assert(await verifier.team.count() === beforeAtomic.teams, "Atomic failure left partial Team rows.");
    assert(await verifier.match.count() === beforeAtomic.matches, "Atomic failure left partial Match rows.");

    console.log("R1-3B competition import parser, reconciliation, dry-run, atomicity, race and idempotency tests passed.");
  } finally {
    await verifier.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
