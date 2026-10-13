import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checker = path.join(repository, "scripts/check-unicode-safety.mjs");
const approvedPath = "vendor/next-default-root-glob/next-default-root-glob-1.0.0.tgz";
const archive = readFileSync(path.join(repository, approvedPath));
assert.equal(
  createHash("sha256").update(archive).digest("hex"),
  "8a6127cb43588a0069625c5df5a1e1662dc642f59dc669127c324e64d41a6a19",
);
const root = mkdtempSync(path.join(os.tmpdir(), "nuaafa-unicode-regression-"));
// Each case uses real Git selection and the real checker in its own repository.
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);
let cases = 0;
function check(name, files, expectedStatus, diagnostic, linked = false) {
  const cwd = path.join(root, String(cases++));
  mkdirSync(cwd);
  const git = (args, input) => {
    const result = spawnSync("git", args, { cwd, env: environment, input, encoding: "utf8", timeout: 10_000 });
    assert.equal(result.error, undefined, name);
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    return result.stdout.trim();
  };
  git(["init", "--quiet"]);
  const base = git(["hash-object", "-w", "-t", "tree", "--stdin"], "");
  for (const [file, bytes] of Object.entries(files)) {
    const target = path.join(cwd, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
  if (linked) {
    const target = path.join(cwd, approvedPath);
    mkdirSync(path.dirname(target), { recursive: true });
    symlinkSync(path.join(repository, approvedPath), target);
  }
  git(["add", "--all"]);
  const result = spawnSync(process.execPath, [checker], {
    cwd,
    env: { ...environment, UNICODE_BASE: base, GIT_BINARY: "git" },
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(result.error, undefined, name);
  assert.equal(result.status, expectedStatus, `${name}: ${result.stdout}${result.stderr}`);
  if (diagnostic) assert(result.stderr.includes(diagnostic), `${name}: ${result.stderr}`);
  console.log(`PASS Unicode: ${name}`);
}

try {
  check("approved path and digest accept the real tarball", { [approvedPath]: archive }, 0);
  const changed = Buffer.from(archive);
  changed[changed.length - 1] ^= 1;
  check("changed tarball digest fails", { [approvedPath]: changed }, 1, "BINARY_SHA256_MISMATCH");
  check("plain text at the approved path fails its digest", { [approvedPath]: "export {};\n" }, 1, "BINARY_SHA256_MISMATCH");
  check("symlink at the approved path fails", {}, 1, "INVALID_BINARY_FILE_TYPE", true);
  check("same tarball outside the approved path fails UTF-8", { "vendor/other/next-default-root-glob-1.0.0.tgz": archive }, 1, "INVALID_UTF8");
  check("unknown tar.gz is not exempt", { "vendor/unknown.tar.gz": archive }, 1, "INVALID_UTF8");
  check("ordinary mjs, ts and tsx text passes", {
    "src/ordinary.mjs": "export const text = '正常文本';\n",
    "src/ordinary.ts": "export const value: number = 1;\n",
    "src/ordinary.tsx": "export const view = <p>正常文本</p>;\n",
  }, 0);
  for (const extension of ["mjs", "ts", "tsx"]) {
    const file = `src/unsafe.${extension}`;
    check(`${extension} invalid UTF-8 fails`, { [file]: Buffer.from([0xc3, 0x28]) }, 1, "INVALID_UTF8");
    check(`${extension} UTF-8 BOM fails`, { [file]: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("export {};\n")]) }, 1, "byte-order mark");
    // Construct the prohibited characters so this regression's source remains safe.
    for (const codePoint of [0x200b, 0x202e, 0x2066]) {
      check(`${extension} hidden U+${codePoint.toString(16)} fails`, { [file]: `// unsafe ${String.fromCodePoint(codePoint)}\n` }, 1, "hidden Unicode");
    }
  }
  check("UTF-16 BOM fails", { "src/unsafe.ts": Buffer.from([0xff, 0xfe, 0x61, 0x00]) }, 1, "byte-order mark");
  check("vendor text is not exempt", { "vendor/other/index.mjs": `// ${String.fromCodePoint(0x200b)}\n` }, 1, "hidden Unicode");
  console.log(`PASS Unicode safety regression: ${cases} cases`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
