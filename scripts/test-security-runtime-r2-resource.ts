import { scrypt as scryptCallback } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import { createClient } from "@libsql/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { strToU8, zipSync } from "fflate";

import { PrismaClient } from "../src/generated/prisma-v29/client";

const scrypt = promisify(scryptCallback);
const fixturePassword = "Security-R2-Resource-Fixture-2026!";
const siteOrigin = "https://nuaafa.cn";
const requestTimeoutMs = 20_000;
const baselineCsvRssIncreaseBytes = 188_035_072;
const maximumFixtureBytes = 5 * 1024 * 1024 + 320 * 1024;

type Metric = {
  type: string;
  timestampMs: number;
  pid: number;
  rss: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
  cpuMicros: number;
};

type RunningServer = {
  child: ChildProcess;
  origin: string;
  metricsPath: string;
  output: () => string;
};

type ResourceCase = {
  label: string;
  method: "CSV" | "XLSX";
  filename: string;
  bytes: Buffer;
  transfer: "content-length" | "chunked";
  expectedStatus: number;
  rejectionPoint?: string;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function applyMigrations(url: string) {
  const client = createClient({ url });
  try {
    const entries = (await readdir(path.resolve("prisma/migrations"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      await client.executeMultiple(await readFile(path.resolve("prisma/migrations", entry.name, "migration.sql"), "utf8"));
    }
  } finally {
    client.close();
  }
}

async function prepareFixture(databasePath: string) {
  const url = `file:${databasePath.replaceAll("\\", "/")}`;
  await applyMigrations(url);
  const prisma = new PrismaClient({ adapter: new PrismaLibSql({ url }) });
  const salt = Buffer.from("R2ResourceSalt16", "utf8");
  const derived = await scrypt(fixturePassword, salt, 64) as Buffer;
  const passwordHash = `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
  try {
    const admin = await prisma.adminAccount.create({ data: {
      username: "security-r2-resource-admin",
      displayName: "Security R2 Resource Admin",
      passwordHash,
      role: "SUPER_ADMIN",
      isActive: true,
    } });
    await prisma.adminRoleAssignment.create({ data: { adminAccountId: admin.id, role: "SUPER_ADMIN" } });
    const competition = await prisma.competition.create({ data: {
      slug: "security-r2-resource",
      name: "Security R2 隔离资源回归",
      year: 2026,
      campus: "isolated-localhost",
      format: "ELEVEN_A_SIDE",
      status: "PREPARING",
    } });
    return { url, competitionId: competition.id, username: admin.username };
  } finally {
    await prisma.$disconnect();
  }
}

async function findPort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return server.close(() => reject(new Error("No isolated port.")));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function startServer(root: string, databasePath: string, label: string): Promise<RunningServer> {
  const port = await findPort();
  const origin = `http://127.0.0.1:${port}`;
  const metricsPath = path.join(root, `metrics-${label}.jsonl`);
  const preload = pathToFileURL(path.resolve("scripts/security-r2-resource-metrics.mjs")).href;
  const child = spawn(process.execPath, [path.resolve("node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: `file:${databasePath.replaceAll("\\", "/")}`,
      NUAAFA_UPLOAD_DIR: path.join(root, "uploads"),
      NUAAFA_CONTENT_SOURCE: "database",
      REFEREE_ADMIN_SESSION_SECRET: "security-r2-resource-admin-session-secret",
      REFEREE_MEMBER_SESSION_SECRET: "security-r2-resource-member-session-secret",
      NODE_OPTIONS: `--import=${preload}`,
      SECURITY_R2_RESOURCE_METRICS_PATH: metricsPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const append = (chunk: Buffer | string) => { output = `${output}${String(chunk)}`.slice(-16_384); };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Resource server exited ${child.exitCode}.\n${output}`);
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.status === 200) return { child, origin, metricsPath, output: () => output };
    } catch {
      // Server is still starting.
    }
    await delay(100);
  }
  child.kill();
  throw new Error(`Resource server health timeout.\n${output}`);
}

async function stopServer(server: RunningServer) {
  if (server.child.exitCode !== null) return;
  server.child.kill();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 5_000);
    server.child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
}

async function login(origin: string, username: string) {
  const response = await fetch(`${origin}/api/referees/admin/login`, {
    method: "POST",
    headers: { origin: siteOrigin, "content-type": "application/json", "x-real-ip": "127.0.0.1" },
    body: JSON.stringify({ username, password: fixturePassword }),
    signal: AbortSignal.timeout(5_000),
  });
  assert(response.status === 200, `Resource fixture login returned ${response.status}: ${await response.text()}`);
  const cookie = response.headers.get("set-cookie")?.match(/nuaa_referee_admin=[^;]+/u)?.[0];
  assert(cookie, "Resource fixture login did not return a session cookie.");
  return cookie;
}

function multipartBody(competitionId: string, testCase: ResourceCase) {
  const boundary = `----nuaafa-security-r2-${testCase.label.replaceAll(/[^A-Za-z0-9]/gu, "")}`;
  const head = [
    `--${boundary}\r\nContent-Disposition: form-data; name="competitionId"\r\n\r\n${competitionId}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="importType"\r\n\r\nTEAM\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="inputMethod"\r\n\r\n${testCase.method}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${testCase.filename}"\r\nContent-Type: ${testCase.method === "XLSX" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv"}\r\n\r\n`,
  ].join("");
  const body = Buffer.concat([Buffer.from(head), testCase.bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  assert(body.byteLength <= maximumFixtureBytes, `${testCase.label} exceeded the bounded fixture budget.`);
  return { boundary, body };
}

function sendMultipart(origin: string, cookie: string, boundary: string, body: Buffer, transfer: "content-length" | "chunked") {
  const url = new URL("/api/admin/competitions/import/preview", origin);
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: "POST",
      headers: {
        origin: siteOrigin,
        cookie,
        "x-real-ip": "127.0.0.1",
        "content-type": `multipart/form-data; boundary=${boundary}`,
        ...(transfer === "content-length" ? { "content-length": String(body.byteLength) } : { "transfer-encoding": "chunked" }),
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > 1024 * 1024) request.destroy(new Error("Response exceeded 1 MiB."));
        else chunks.push(chunk);
      });
      response.once("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.setTimeout(requestTimeoutMs, () => request.destroy(new Error("Resource request timeout.")));
    request.once("error", reject);
    if (transfer === "chunked") {
      for (let offset = 0; offset < body.byteLength; offset += 64 * 1024) request.write(body.subarray(offset, offset + 64 * 1024));
      request.end();
    } else request.end(body);
  });
}

async function metrics(pathname: string) {
  return (await readFile(pathname, "utf8")).split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as Metric);
}

function summarize(samples: Metric[], pid: number, startedAt: number, endedAt: number) {
  const processSamples = samples.filter((sample) => sample.pid === pid && sample.type !== "safety-stop");
  const baseline = [...processSamples].reverse().find((sample) => sample.timestampMs <= startedAt) ?? processSamples[0];
  const window = processSamples.filter((sample) => sample.timestampMs >= startedAt - 20 && sample.timestampMs <= endedAt + 150);
  assert(baseline && window.length, "No runtime metric window was captured.");
  const peak = (field: "rss" | "heapUsed" | "external" | "arrayBuffers") => Math.max(...window.map((sample) => sample[field]));
  const last = window.at(-1) ?? baseline;
  return {
    samples: window.length,
    baselineRssBytes: baseline.rss,
    peakRssBytes: peak("rss"),
    rssIncreaseBytes: peak("rss") - baseline.rss,
    heapIncreaseBytes: peak("heapUsed") - baseline.heapUsed,
    peakExternalBytes: peak("external"),
    peakArrayBuffersBytes: peak("arrayBuffers"),
    cpuTimeMs: Math.round((last.cpuMicros - baseline.cpuMicros) / 1000),
  };
}

function validXlsx(paddingBytes = 0) {
  const padding = "A".repeat(paddingBytes);
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:B2"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>name</t></is></c><c r="B1" t="inlineStr"><is><t>padding</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>资源回归队</t></is></c><c r="B2" t="inlineStr"><is><t>${padding}</t></is></c></row></sheetData></worksheet>`;
  const files = {
    "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    "_rels/.rels": '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml": '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Import" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": sheet,
  };
  const encoded = Object.fromEntries(Object.entries(files).map(([name, value]) => [name, strToU8(value)]));
  return Buffer.from(zipSync(encoded, { level: 9 }));
}

function nearFileCsv() {
  const targetBytes = Math.floor(4.75 * 1024 * 1024);
  const rows = 4_500;
  const header = "name,padding\r\n";
  const perRow = Math.floor((targetBytes - header.length) / rows);
  const padding = "A".repeat(Math.max(1, perRow - 32));
  const result = Buffer.from(`${header}${Array.from({ length: rows }, (_, index) => `R2-CSV-${index},${padding}\r\n`).join("")}`);
  assert(result.byteLength === 4_894_904, `Near-file fixture drifted to ${result.byteLength} bytes.`);
  return result;
}

async function measure(root: string, databasePath: string, fixture: Awaited<ReturnType<typeof prepareFixture>>, testCase: ResourceCase) {
  const server = await startServer(root, databasePath, testCase.label);
  try {
    const cookie = await login(server.origin, fixture.username);
    const multipart = multipartBody(fixture.competitionId, testCase);
    await delay(150);
    const startedAt = Date.now();
    const wallStart = performance.now();
    const response = await sendMultipart(server.origin, cookie, multipart.boundary, multipart.body, testCase.transfer);
    const wallTimeMs = Math.round((performance.now() - wallStart) * 1000) / 1000;
    const endedAt = Date.now();
    assert(response.status === testCase.expectedStatus, `${testCase.label} returned ${response.status}: ${response.body.slice(0, 300)}`);
    if (testCase.rejectionPoint) assert(response.body.includes(testCase.rejectionPoint), `${testCase.label} did not prove ${testCase.rejectionPoint} rejection.`);
    await delay(160);
    const samples = await metrics(server.metricsPath);
    assert(!samples.some((sample) => sample.type === "safety-stop"), `${testCase.label} crossed the RSS safety ceiling.`);
    return {
      label: testCase.label,
      transfer: testCase.transfer,
      fileBytes: testCase.bytes.byteLength,
      multipartBytes: multipart.body.byteLength,
      status: response.status,
      rejectionPoint: testCase.rejectionPoint ?? null,
      wallTimeMs,
      resources: summarize(samples, server.child.pid ?? -1, startedAt, endedAt),
    };
  } finally {
    await stopServer(server);
  }
}

async function main() {
  assert(process.version === "v22.23.4", `Node v22.23.4 is required; received ${process.version}.`);
  await readFile(path.resolve(".next/BUILD_ID"), "utf8");
  const root = await mkdtemp(path.join(os.tmpdir(), "nuaafa-security-r2-resource-"));
  const databasePath = path.join(root, "resource.db");
  try {
    const fixture = await prepareFixture(databasePath);
    const normalCsv = Buffer.from("name,teamType\r\n资源正常队,FREEFORM\r\n");
    const nearRows = Buffer.from(`name,teamType\r\n${Array.from({ length: 5_000 }, (_, index) => `资源边界队${index},FREEFORM`).join("\r\n")}\r\n`);
    const nearFile = nearFileCsv();
    const normalWorkbook = validXlsx();
    const highCompressionWorkbook = validXlsx(512 * 1024);
    const aboveEnvelope = Buffer.concat([Buffer.from("name\n"), Buffer.alloc(5 * 1024 * 1024 + 300 * 1024 - 5, 65)]);
    const cases: ResourceCase[] = [
      { label: "normal-csv", method: "CSV", filename: "normal.csv", bytes: normalCsv, transfer: "content-length", expectedStatus: 200 },
      { label: "normal-xlsx", method: "XLSX", filename: "normal.xlsx", bytes: normalWorkbook, transfer: "content-length", expectedStatus: 200 },
      { label: "near-row-limit-csv", method: "CSV", filename: "near-row.csv", bytes: nearRows, transfer: "content-length", expectedStatus: 200 },
      { label: "near-file-limit-csv", method: "CSV", filename: "near-file.csv", bytes: nearFile, transfer: "content-length", expectedStatus: 200 },
      { label: "small-csv-chunked", method: "CSV", filename: "chunked.csv", bytes: normalCsv, transfer: "chunked", expectedStatus: 411, rejectionPoint: "Content-Length" },
      { label: "declared-body-above-envelope", method: "CSV", filename: "above.csv", bytes: aboveEnvelope, transfer: "content-length", expectedStatus: 413 },
      { label: "high-compression-xlsx", method: "XLSX", filename: "ratio.xlsx", bytes: highCompressionWorkbook, transfer: "content-length", expectedStatus: 413, rejectionPoint: "压缩比" },
    ];
    assert(Math.max(...cases.map((item) => item.bytes.byteLength)) <= maximumFixtureBytes, "Fixture budget exceeded.");
    const measurements = [];
    for (const testCase of cases) measurements.push(await measure(root, databasePath, fixture, testCase));

    const nearFileMeasurement = measurements.find((item) => item.label === "near-file-limit-csv");
    assert(nearFileMeasurement, "Near-file measurement is missing.");
    assert(
      nearFileMeasurement.resources.rssIncreaseBytes < baselineCsvRssIncreaseBytes / 2,
      `Near-file RSS did not improve by at least 50% from the accepted R2 baseline: ${nearFileMeasurement.resources.rssIncreaseBytes}.`,
    );
    const verifier = new PrismaClient({ adapter: new PrismaLibSql({ url: fixture.url }) });
    try {
      assert(await verifier.team.count() === 0, "Preview resource test wrote Team rows.");
      assert(await verifier.match.count() === 0, "Preview resource test wrote Match rows.");
      assert(await verifier.auditLog.count() === 0, "Preview resource test wrote AuditLog rows.");
    } finally {
      await verifier.$disconnect();
    }
    console.log(JSON.stringify({
      node: process.version,
      acceptedR2Baseline: { nearFileCsvBytes: 4_894_904, rssIncreaseBytes: baselineCsvRssIncreaseBytes },
      comparison: {
        afterRssIncreaseBytes: nearFileMeasurement.resources.rssIncreaseBytes,
        reductionBytes: baselineCsvRssIncreaseBytes - nearFileMeasurement.resources.rssIncreaseBytes,
        reductionPercent: Math.round((1 - nearFileMeasurement.resources.rssIncreaseBytes / baselineCsvRssIncreaseBytes) * 10_000) / 100,
      },
      measurements,
      businessRowsAfter: { teams: 0, matches: 0, audits: 0 },
    }, null, 2));
    console.log("F-010 bounded production-mode resource regression passed.");
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
