import { lstatSync, realpathSync } from "node:fs";
import { fork } from "node:child_process";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const maximumRows = 250_000;
const failure = { scanComplete: 0, readOnlyVerified: 0, releaseAllowed: 0 };

// Keep these semantics in parity with the approved getRefereeStudentIdCompatibility.
// This operational entry point needs only Node, without loading Prisma, tsx or .env.
export function scanStudentIds(databasePath) {
  if (!path.isAbsolute(databasePath)) throw new Error("Explicit absolute database path required.");
  const file = lstatSync(databasePath);
  if (!file.isFile() || file.isSymbolicLink() || realpathSync(databasePath) !== databasePath) {
    throw new Error("Canonical regular database file required.");
  }
  const db = new DatabaseSync(databasePath, { readOnly: true, allowExtension: false, timeout: 1000 });
  try {
    db.exec("PRAGMA query_only = ON; PRAGMA trusted_schema = OFF; BEGIN");
    if (db.prepare("PRAGMA query_only").get()?.query_only !== 1) throw new Error("Read-only verification failed.");
    const integrity = db.prepare("PRAGMA quick_check").all();
    if (integrity.length !== 1 || integrity[0].quick_check !== "ok") throw new Error("Database integrity not verified.");
    const table = db.prepare("SELECT type FROM sqlite_schema WHERE name = 'Referee'").get();
    if (table?.type !== "table") throw new Error("Referee table not verified.");
    const count = db.prepare('SELECT COUNT(*) AS total FROM "Referee"').get()?.total;
    if (!Number.isSafeInteger(count) || count < 0 || count > maximumRows) throw new Error("Scan bound exceeded.");
    const report = {
      totalReferees: 0, totalActiveAccounts: 0, missingStudentId: 0,
      activeMissingStudentId: 0, activeNonNormalizedStudentId: 0,
      duplicateStudentIdGroups: 0, unsafeLoginMigrationBlockers: 0,
    };
    const normalizedCounts = new Map();
    for (const row of db.prepare('SELECT "status", "studentId" FROM "Referee"').iterate()) {
      if (!["PENDING_ACTIVATION", "ACTIVE", "INACTIVE", "ARCHIVED"].includes(row.status) ||
          (row.studentId !== null && (typeof row.studentId !== "string" || row.studentId.length > 256))) {
        throw new Error("Unverifiable identity data.");
      }
      report.totalReferees++;
      if (report.totalReferees > count) throw new Error("Incomplete scan.");
      const active = row.status === "ACTIVE";
      if (active) report.totalActiveAccounts++;
      if (!row.studentId?.trim()) {
        report.missingStudentId++;
        if (active) report.activeMissingStudentId++;
      } else {
        const normalized = row.studentId.trim().normalize("NFKC").toUpperCase();
        normalizedCounts.set(normalized, (normalizedCounts.get(normalized) ?? 0) + 1);
        if (active && row.studentId !== normalized) report.activeNonNormalizedStudentId++;
      }
    }
    if (report.totalReferees !== count) throw new Error("Incomplete scan.");
    report.duplicateStudentIdGroups = [...normalizedCounts.values()].filter((value) => value > 1).length;
    report.unsafeLoginMigrationBlockers = report.activeMissingStudentId +
      report.activeNonNormalizedStudentId + report.duplicateStudentIdGroups;
    db.exec("COMMIT");
    return { ...report, scanComplete: 1, readOnlyVerified: 1, releaseAllowed: Number(report.unsafeLoginMigrationBlockers === 0) };
  } finally {
    db.close();
  }
}

export async function runPreflight(databasePath, timeoutMs = 30_000) {
  return new Promise((resolve) => {
    let worker;
    try {
      worker = fork(fileURLToPath(import.meta.url), [], {
        execArgv: ["--max-old-space-size=128"],
        env: {},
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
    } catch {
      resolve(failure);
      return;
    }
    // A separate process makes the deadline enforceable during native SQLite
    // calls too. Never forward database errors or rows from a failed scan.
    let result = failure;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      result = failure;
      worker.kill("SIGKILL");
    }, timeoutMs);
    worker.once("message", (value) => { result = value; });
    worker.once("error", () => { worker.kill("SIGKILL"); finish(failure); });
    worker.once("exit", (code) => finish(code === 0 ? result : failure));
    worker.send({ databasePath }, (error) => {
      if (error) { worker.kill("SIGKILL"); finish(failure); }
    });
  });
}

if (process.send) {
  process.once("message", ({ databasePath }) => {
    let report = failure;
    try { report = scanStudentIds(databasePath); } catch { /* Fail closed without private diagnostics. */ }
    process.send(report, () => process.disconnect());
  });
} else if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const valid = process.version === "v22.23.2" && args.length === 1 && args[0].startsWith("--database=");
  const report = valid ? await runPreflight(args[0].slice("--database=".length)) : failure;
  console.log(JSON.stringify(report));
  process.exitCode = report.scanComplete !== 1 ? 2 : report.releaseAllowed === 1 ? 0 : 1;
}
