import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";

const expectedNode = "v22.23.4";
const npmCli = process.env.npm_execpath;
const env = {
  ...process.env,
  PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}`,
  REFEREE_ADMIN_SESSION_SECRET: "PLACEHOLDER_R1_3C_RC_ADMIN_SESSION_SECRET_32_CHARS",
  REFEREE_MEMBER_SESSION_SECRET: "PLACEHOLDER_R1_3C_RC_MEMBER_SESSION_SECRET_32_CHARS",
};
const gates = [];

function logGate(label, status) {
  gates.push({ label, status });
  console.log(`[R1-3C RC] ${status}: ${label}`);
}

async function run(command, args, label, options = {}) {
  console.log(`\n[R1-3C RC] RUN: ${label}`);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (options.capture) {
      child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    }
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
  if (!options.allowNonZero && result.code !== 0) {
    throw new Error(`${label} exited ${result.code}.`);
  }
  logGate(label, result.code === 0 ? "PASS" : `EXIT_${result.code}`);
  return result;
}

async function npm(args, label, options) {
  if (!npmCli || !path.isAbsolute(npmCli)) throw new Error("RC check must be invoked through npm with an explicit npm_execpath.");
  return run(process.execPath, [npmCli, ...args], label, options);
}

async function securityGate() {
  await access(path.resolve("docs/operations/R1-3C_SECURITY_ADVISORY_DISPOSITION.md"));
  const reports = [];
  for (const scope of ["full", "production"]) {
    const audit = await npm(["audit", ...(scope === "production" ? ["--omit=dev"] : []), "--json"], `${scope} dependency audit JSON`, { capture: true, allowNonZero: true });
    process.stdout.write(audit.stdout);
    if (audit.stderr) process.stderr.write(audit.stderr);
    let report;
    try { report = JSON.parse(audit.stdout); } catch { throw new Error("Audit JSON is unverifiable: release blocked."); }
    const inventory = report.metadata?.vulnerabilities;
    if (report.error || !inventory || ![0, 1].includes(audit.code) ||
        !["critical", "high", "moderate", "low"].every((key) => Number.isSafeInteger(inventory[key]) && inventory[key] >= 0)) {
      throw new Error("Audit inventory is unverifiable: release blocked.");
    }
    reports.push({ scope, inventory, code: audit.code });
  }
  if (reports.some(({ inventory, code }) => code !== 0 || inventory.critical || inventory.high || inventory.moderate || inventory.low)) {
    throw new Error("Unresolved dependency advisories: release BLOCKED. Historical dispositions grant no new risk approval.");
  }
  logGate("Full and production dependency audits contain no unresolved advisories", "PASS");
  return "SECURITY_CLEAN";
}

async function main() {
  if (process.version !== expectedNode) throw new Error(`Node ${expectedNode} is mandatory; current ${process.version}.`);
  logGate(`Node ${expectedNode}`, "PASS");
  const securityClassification = await securityGate();
  await npm(["ls", "prisma", "@prisma/config", "deepmerge-ts", "fast-uri"], "Dependency path");
  await run(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "format", "--check"], "Prisma format");
  await run(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "validate"], "Prisma validate");
  await run(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "generate"], "Prisma generate");
  await run(process.execPath, [path.resolve("node_modules/next/dist/bin/next"), "typegen"], "Next.js typegen");
  await run(process.execPath, [path.resolve("node_modules/typescript/bin/tsc"), "--noEmit"], "TypeScript --noEmit");
  await npm(["run", "lint"], "ESLint");
  await npm(["run", "check:unicode"], "Unicode safety");
  await run("git", ["diff", "--check"], "git diff --check");
  const status = await run("git", ["status", "--short"], "clean working tree", { capture: true });
  if (status.stdout.trim()) throw new Error("Working tree is not clean during RC check.");

  const regressionScripts = [
    "test:unified-admin-r1",
    "test:unified-admin-r1-2",
    "test:unified-admin-rbac",
    "test:unified-admin-migration",
    "test:referee-r1",
    "test:referee-admission",
    "test:referee-r1-3a",
    "test:referee-r1-3a:migration",
    "test:referee-r1-3a:migration:fresh",
    "test:referee-flow",
    "test:referee-match-deletion",
    "test:competition-import",
    "test:deployer",
    "test:production-hardening",
    "test:static-content-import-gate",
  ];
  for (const script of regressionScripts) await npm(["run", script], script);
  await npm(["run", "build"], "Node 22 production build");
  await npm(["run", "restore:rehearsal"], "isolated restore and application rehearsal");
  await npm(["run", "test:clean-install"], "isolated npm ci reproducibility");

  await run("git", ["diff", "--check"], "final git diff --check");
  const finalStatus = await run("git", ["status", "--short"], "final clean working tree", { capture: true });
  if (finalStatus.stdout.trim()) throw new Error("Working tree is not clean after all RC checks.");

  console.log(JSON.stringify({
    classification: securityClassification,
    mandatoryGateCount: gates.length,
    gates,
    security: "KNOWN-ADVISORIES",
    r1_3dMandatoryRecheck: "RECHECK DOCUMENTED ADVISORY INVENTORY",
  }, null, 2));
  console.log(`R1-3C RC RESULT: ${securityClassification}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : "R1-3C RC check failed.");
  console.error("R1-3C RC RESULT: NOT_READY");
  process.exitCode = 1;
});
