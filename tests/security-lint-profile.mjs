import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (name) => JSON.parse(readFileSync(path.join(root, name), "utf8"));
const pkg = readJson("package.json");
const lock = readJson("package-lock.json");
assert.equal(require("@next/eslint-plugin-next/package.json").version, "16.4.1");
assert.equal(require("fast-glob/package.json").name, "@nuaafa/next-default-root-glob");
assert.equal(require("fast-glob/package.json").version, "1.0.0");
assert.equal(pkg.overrides["@next/eslint-plugin-next@16.4.1"]["fast-glob"], "$fast-glob");
for (const [name, entry] of Object.entries(lock.packages)) {
  if (entry.dependencies?.["fast-glob"]) assert.equal(name, "node_modules/@next/eslint-plugin-next", "Unexpected scanner consumer");
  assert(!name.endsWith("/braces") && !name.endsWith("/micromatch"), "Original affected dependency reintroduced");
}
for (const name of ["braces", "micromatch"]) assert.equal(existsSync(path.join(root, "node_modules", name)), false);
assert.deepEqual(readFileSync(require.resolve("fast-glob")), readFileSync(path.join(root, "vendor/next-default-root-glob/index.cjs")));

const eslint = new ESLint({ cwd: root });
function assertDefaultRoot(config) {
  assert(!Object.hasOwn(config.settings?.next ?? {}, "rootDir"), "Custom rootDir requires a reviewed lint/dependency profile");
}
for (const file of ["src/app/page.tsx", "src/lib/prisma.ts", "scripts/backup-unified-data.ts", "eslint.config.mjs"]) {
  const config = await eslint.calculateConfigForFile(file);
  assertDefaultRoot(config);
}
assert.throws(() => assertDefaultRoot({ settings: { next: { rootDir: [] } } }), /Custom rootDir requires/);
const { getRootDirs } = require("@next/eslint-plugin-next/dist/utils/get-root-dirs");
assert.deepEqual(getRootDirs({ cwd: root, settings: {} }), [root]);
assert.throws(() => getRootDirs({ cwd: root, settings: { next: { rootDir: root } } }), /Custom Next rootDir scanning is unsupported/);
assert.throws(() => getRootDirs({ cwd: root, settings: { next: { rootDir: [root] } } }), /Custom Next rootDir scanning is unsupported/);
assert.throws(() => require("fast-glob").globSync("ordinary/*", { onlyDirectories: true }), /Custom Next rootDir scanning is unsupported/);
console.log("PASS Next default root and all existing official rules retained; custom-root profile fails closed; external braces/micromatch absent");
