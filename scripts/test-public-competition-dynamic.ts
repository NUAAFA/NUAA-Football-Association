import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import os from "node:os";
import path from "node:path";

import { createClient, type Client } from "@libsql/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../src/generated/prisma-v29/client";

const migrationName = "20260922120000_public_competition_true_dynamic_r3";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function run(command: string, args: string[], environment: NodeJS.ProcessEnv = process.env, echo = true) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); if (echo) process.stdout.write(chunk); });
    child.stderr.on("data", (chunk) => { output += String(chunk); if (echo) process.stderr.write(chunk); });
    child.once("error", reject);
    child.once("exit", (code) => code === 0
      ? resolve(output)
      : reject(new Error(`${command} ${args.join(" ")} exited ${code ?? "unknown"}.`)));
  });
}

function runPrisma(databaseUrl: string, args: string[]) {
  return run(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), ...args], {
    ...process.env,
    DATABASE_URL: databaseUrl,
    RUST_LOG: "trace",
  });
}

async function migrationEntries() {
  return (await readdir(path.resolve("prisma/migrations"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

async function apply(client: Client, name: string) {
  const sql = await readFile(path.resolve("prisma/migrations", name, "migration.sql"), "utf8");
  await client.executeMultiple(sql);
}

async function rowCount(client: Client, table: string) {
  const result = await client.execute(`SELECT COUNT(*) AS count FROM "${table}"`);
  return Number(result.rows[0]?.count ?? 0);
}

async function verifyLegacyClient(root: string, databaseUrl: string) {
  const legacySchema = await readFile(path.resolve("scripts/fixtures/pre-r3-schema.prisma"), "utf8");
  assert(!legacySchema.includes("playingFormat"), "Fixture no longer represents the pre-R3 Prisma schema.");
  assert(!legacySchema.includes("CUSTOM"), "Fixture unexpectedly contains the R3 CUSTOM enum value.");
  const cacheRoot = path.join(process.cwd(), "node_modules", ".cache", `nuaafa-legacy-${path.basename(root)}`);
  const outputDirectory = path.join(cacheRoot, "client").replaceAll("\\", "/");
  const schemaPath = path.join(cacheRoot, "legacy-schema.prisma");
  await mkdir(cacheRoot, { recursive: true });
  try {
    await writeFile(
      schemaPath,
      legacySchema.replace(
        'output   = "../src/generated/prisma-v29"',
        `output   = "${outputDirectory}"`,
      ),
      "utf8",
    );
    await runPrisma(databaseUrl, ["generate", "--schema", schemaPath]);
    const legacyModule = await import(pathToFileURL(path.join(outputDirectory, "client.js")).href) as {
    PrismaClient: new (options: unknown) => {
      competition: {
        count(): Promise<number>;
        findMany(options: unknown): Promise<Array<{ format: string }>>;
        create(options: unknown): Promise<{ format: string }>;
      };
      $disconnect(): Promise<void>;
    };
  };
    const legacy = new legacyModule.PrismaClient({ adapter: new PrismaLibSql({ url: databaseUrl }) });
    try {
      assert(await legacy.competition.count() === 2, "The pre-R3 Prisma Client could not read the migrated database.");
      const rows = await legacy.competition.findMany({ select: { format: true }, orderBy: { slug: "asc" } });
      assert(
        rows.some((row) => row.format === "ELEVEN_A_SIDE") && rows.some((row) => row.format === "FUTSAL"),
        "The pre-R3 Prisma Client did not preserve both legacy enum meanings.",
      );
      const created = await legacy.competition.create({
        data: {
          slug: "legacy-client-write",
          name: "旧版客户端迁移后写入",
          campus: "天目湖校区",
          format: "FUTSAL",
          status: "PREPARING",
        },
        select: { format: true },
      });
      assert(created.format === "FUTSAL", "The pre-R3 Prisma Client could not write a legacy enum row after migration.");
      return {
        preR3ClientRead: "PASS",
        preR3ClientWrite: "PASS",
        safeBoundary: "legacy enum rows only; do not roll back after CUSTOM records are introduced",
      };
    } finally {
      await legacy.$disconnect();
    }
  } finally {
    await rm(cacheRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

async function verifyExistingDatabaseMigration(root: string, databasePath: string) {
  const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
  const client = createClient({ url: databaseUrl });
  try {
    const entries = await migrationEntries();
    const migrationIndex = entries.indexOf(migrationName);
    assert(migrationIndex >= 0, "The Public Competition R3 migration is missing.");
    for (const entry of entries.slice(0, migrationIndex)) await apply(client, entry);
    await client.executeMultiple(`
      INSERT INTO "Competition" ("id","slug","name","year","campus","format","status","isTestData","source","createdAt","updatedAt") VALUES
        ('existing-eleven','existing-eleven','既有十一人制赛事',2026,'天目湖校区','ELEVEN_A_SIDE','ONGOING',0,'MANUAL',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
        ('existing-futsal','existing-futsal','既有五人制赛事',2026,'天目湖校区','FUTSAL','ONGOING',0,'MANUAL',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
      INSERT INTO "Team" ("id","competitionId","name","teamType","source") VALUES
        ('existing-home','existing-eleven','既有主队','FREEFORM','MANUAL'),
        ('existing-away','existing-eleven','既有客队','FREEFORM','MANUAL');
      INSERT INTO "Match" ("id","slug","competitionId","stage","kickoff","venue","source","homeTeamId","awayTeamId","status","applicationWindowStatus","isTestData","createdAt","updatedAt")
      VALUES ('existing-match','existing-match','existing-eleven','小组赛','2030-09-01T10:00:00.000Z','既有球场','MANUAL','existing-home','existing-away','SCHEDULED','CLOSED',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
      INSERT INTO "Referee" ("id","publicCode","name","createdAt","updatedAt")
      VALUES ('existing-referee','998','既有裁判',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
      INSERT INTO "AuditLog" ("id","actorType","action","entityType","entityId","summary")
      VALUES ('existing-audit','SYSTEM','EXISTING_AUDIT','Competition','existing-eleven','既有审计记录');
    `);
    const tables = ["Competition", "Team", "Match", "Referee", "AuditLog"] as const;
    const before = Object.fromEntries(await Promise.all(tables.map(async (table) => [table, await rowCount(client, table)])));
    await apply(client, migrationName);
    const after = Object.fromEntries(await Promise.all(tables.map(async (table) => [table, await rowCount(client, table)])));
    assert(JSON.stringify(after) === JSON.stringify(before), "Existing row counts changed during the R3 migration.");
    const backfill = await client.execute(`SELECT "slug", "format", "playingFormat" FROM "Competition" ORDER BY "slug"`);
    assert(
      backfill.rows[0]?.format === "ELEVEN_A_SIDE" && backfill.rows[0]?.playingFormat === "十一人制"
      && backfill.rows[1]?.format === "FUTSAL" && backfill.rows[1]?.playingFormat === "五人制",
      "R3 playingFormat backfill was not deterministic.",
    );
    const relations = (await client.execute(`
      SELECT t."competitionId" AS teamCompetitionId, m."competitionId" AS matchCompetitionId,
             r."name" AS refereeName, a."summary" AS auditSummary
      FROM "Team" t
      JOIN "Match" m ON m."id" = 'existing-match'
      JOIN "Referee" r ON r."id" = 'existing-referee'
      JOIN "AuditLog" a ON a."id" = 'existing-audit'
      WHERE t."id" = 'existing-home'
    `)).rows[0];
    assert(
      relations?.teamCompetitionId === "existing-eleven"
      && relations.matchCompetitionId === "existing-eleven"
      && relations.refereeName === "既有裁判"
      && relations.auditSummary === "既有审计记录",
      "An existing relationship or history row changed during migration.",
    );
    const legacyCompatibility = await verifyLegacyClient(root, databaseUrl);
    const foreignKeys = await client.execute("PRAGMA foreign_key_check");
    const integrity = await client.execute("PRAGMA integrity_check");
    assert(foreignKeys.rows.length === 0, "Existing database migration produced foreign key violations.");
    assert(integrity.rows[0]?.integrity_check === "ok", "Existing database integrity check failed.");
    return {
      before,
      after,
      backfill: Object.fromEntries(backfill.rows.slice(0, 2).map((row) => [String(row.format), row.playingFormat])),
      legacyCompatibility,
      foreignKeyViolations: 0,
      integrity: "ok",
    };
  } finally {
    client.close();
  }
}

async function expectInputFailure(runInput: () => unknown, text: string) {
  try {
    runInput();
  } catch (error) {
    assert(error instanceof Error && error.message.includes(text), `Expected input failure containing ${text}.`);
    return;
  }
  throw new Error(`Expected input failure containing ${text}.`);
}

async function expectServiceFailure(runService: () => Promise<unknown>, status: number, message: string) {
  try {
    await runService();
  } catch (error) {
    assert(error instanceof Error && error.message === message, `Expected exact service failure: ${message}.`);
    assert("status" in error && error.status === status, `Expected service failure status ${status}.`);
    return;
  }
  throw new Error(`Expected service failure: ${message}.`);
}

async function verifyDomain(databaseUrl: string) {
  process.env.DATABASE_URL = databaseUrl;
  process.env.TZ = "Europe/London";
  const input = await import("../src/lib/referee-competition-input");
  const roles = await import("../src/lib/referee-roles");
  const service = await import("../src/lib/referee-competition-service");
  const refereeService = await import("../src/lib/referee-service");
  const verifier = new PrismaClient({ adapter: new PrismaLibSql({ url: databaseUrl }) });
  const actor = { id: "dynamic-test-admin", role: "SUPER_ADMIN" as const };
  const valid = {
    slug: "seven-a-side-test",
    name: "2030校园七人制联赛",
    shortName: "七人制联赛",
    year: 2030,
    campus: "天目湖校区",
    playingFormat: "七人制",
    format: "CUSTOM",
    status: "PREPARING",
    semesterLabel: "下半学期",
    teamFormation: "自由组队",
    publicPublished: false,
    homepageFeatured: false,
    publicOrder: 10,
    registrationStartAt: "2030-09-25T18:30",
    registrationEndAt: "2030-09-30T18:30",
    matchStartAt: "2030-10-01T18:30",
    matchEndAt: "2030-10-31T20:30",
    venue: "七人制测试场",
    host: "南京航空航天大学天目湖足球协会",
    organizer: "赛事部",
    summary: "七人制动态简介",
    notice: "七人制动态公告",
    registrationUrl: "https://example.edu.cn/register",
  } as const;
  try {
    const parsed = input.readCompetitionCreateInput(valid);
    const created = await service.createCompetition(parsed, actor);
    assert(created.playingFormat === "七人制" && created.format === "CUSTOM", "CUSTOM Competition semantics were not persisted.");
    assert(roles.getPositionTemplate("CUSTOM").length === 0, "CUSTOM inherited a referee position template.");
    assert(!roles.hasPositionTemplate("CUSTOM"), "CUSTOM was reported as template-configured.");
    await expectInputFailure(
      () => input.readCompetitionCreateInput({ ...valid, slug: "missing-playing-format", playingFormat: "" }),
      "比赛制式",
    );
    await expectServiceFailure(
      () => service.createCompetition({ name: "无制式 CUSTOM", format: "CUSTOM", status: "PREPARING" }, actor),
      400,
      "自定义赛事必须填写实际比赛制式。",
    );
    const legacy = await service.createCompetition({ name: "既有内部五人制调用", format: "FUTSAL", status: "PREPARING" }, actor);
    assert(legacy.playingFormat === "五人制", "Known legacy format did not receive its safe compatibility label.");
    const teams = await Promise.all([
      verifier.team.create({ data: { competitionId: created.id, name: "七人制主队" } }),
      verifier.team.create({ data: { competitionId: created.id, name: "七人制客队" } }),
    ]);
    await expectServiceFailure(
      () => refereeService.createMatch({
        slug: "custom-open-window",
        competitionId: created.id,
        stage: "小组赛",
        kickoff: new Date("2030-10-03T12:15:00.000Z"),
        venue: "七人制测试场",
        homeTeamId: teams[0].id,
        awayTeamId: teams[1].id,
        status: "SCHEDULED",
        applicationWindowStatus: "OPEN",
        applicationDeadline: new Date("2030-10-02T12:15:00.000Z"),
        positionCounts: {},
      }, actor),
      409,
      "该赛事暂未配置对应的裁判岗位模板。",
    );
    return {
      playingFormatRequiredAtInput: true,
      customPublicFormat: created.playingFormat,
      customRefereeTemplatePositions: 0,
      customOpenWindowFailsClosed: true,
      existingFutsalCompatibility: legacy.playingFormat,
    };
  } finally {
    await verifier.$disconnect();
    await (await import("../src/lib/prisma")).prisma.$disconnect();
  }
}

async function runWorker(root: string) {
  const freshPath = path.join(root, "fresh.db");
  const existingPath = path.join(root, "existing.db");
  const freshUrl = `file:${freshPath.replaceAll("\\", "/")}`;
  await runPrisma(freshUrl, ["migrate", "deploy"]);
  await runPrisma(freshUrl, ["migrate", "deploy"]);
  const status = await runPrisma(freshUrl, ["migrate", "status"]);
  assert(/up to date|up-to-date/iu.test(status), "Prisma migration status did not report an up-to-date schema.");
  const fresh = createClient({ url: freshUrl });
  const columns = await fresh.execute('PRAGMA table_info("Competition")');
  const columnNames = new Set(columns.rows.map((row) => String(row.name)));
  for (const name of ["publicPublished", "homepageFeatured", "playingFormat"]) {
    assert(columnNames.has(name), `Fresh migration is missing Competition.${name}.`);
  }
  const freshForeignKeys = await fresh.execute("PRAGMA foreign_key_check");
  assert(freshForeignKeys.rows.length === 0, "Fresh migration produced foreign key violations.");
  fresh.close();
  const existing = await verifyExistingDatabaseMigration(root, existingPath);
  const domain = await verifyDomain(freshUrl);
  console.log(JSON.stringify({
    migration: migrationName,
    schemaChanges: ["Competition.playingFormat String?", "CompetitionFormat.CUSTOM"],
    freshDatabase: "PASS",
    deployTwice: "PASS",
    migrationStatus: "up to date",
    freshForeignKeyViolations: 0,
    competitionFormatValues: ["ELEVEN_A_SIDE", "FUTSAL", "CUSTOM"],
    existing,
    domain,
  }, null, 2));
}

async function main() {
  const workerRoot = process.env.PUBLIC_COMPETITION_DYNAMIC_WORKER_ROOT;
  if (workerRoot) return runWorker(workerRoot);
  const root = await mkdtemp(path.join(os.tmpdir(), "nuaafa-public-competition-dynamic-"));
  try {
    await run(process.execPath, ["--import", "tsx", path.resolve("scripts/test-public-competition-dynamic.ts")], {
      ...process.env,
      PUBLIC_COMPETITION_DYNAMIC_WORKER_ROOT: root,
    });
  } finally {
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
