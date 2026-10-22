import { spawn } from "node:child_process";
import { access, cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function runNode(script, args, cwd, env) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (exitCode) => resolve(exitCode ?? 1));
  });
  if (code !== 0) throw new Error(`${path.basename(script)} ${args.join(" ")} exited ${code}.`);
}

async function main() {
  const npmCli = process.env.npm_execpath;
  if (!npmCli || !path.isAbsolute(npmCli)) throw new Error("Run this check through npm so npm_execpath is explicit.");
  const root = await mkdtemp(path.join(os.tmpdir(), "nuaafa-r1-3c-clean-install-"));
  try {
    await Promise.all([
      cp(path.resolve("package.json"), path.join(root, "package.json")),
      cp(path.resolve("package-lock.json"), path.join(root, "package-lock.json")),
      cp(path.resolve("prisma.config.ts"), path.join(root, "prisma.config.ts")),
      cp(path.resolve("prisma"), path.join(root, "prisma"), { recursive: true }),
      cp(path.resolve("vendor"), path.join(root, "vendor"), { recursive: true }),
      mkdir(path.join(root, "src"), { recursive: true }),
    ]);
    const env = {
      ...process.env,
      PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}`,
      DATABASE_URL: `file:${path.join(root, "install-check.sqlite").replaceAll("\\", "/")}`,
    };
    const started = performance.now();
    await runNode(npmCli, ["ci", "--no-audit", "--fund=false"], root, env);
    const installDurationMs = Math.round(performance.now() - started);
    await access(path.join(root, "node_modules", "prisma", "build", "index.js"));
    await access(path.join(root, "src", "generated", "prisma-v29", "index.js"));
    await runNode(path.join(root, "node_modules", "prisma", "build", "index.js"), ["validate"], root, env);
    console.log(JSON.stringify({
      npmCi: "PASS",
      isolatedDirectory: true,
      postinstallPrismaGenerate: "PASS",
      prismaValidate: "PASS",
      installDurationMs,
      node: process.version,
    }, null, 2));
  } finally {
    const resolved = path.resolve(root);
    const allowedPrefix = path.resolve(os.tmpdir(), "nuaafa-r1-3c-clean-install-");
    if (resolved.startsWith(allowedPrefix)) {
      await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : "Isolated npm ci failed.");
  process.exitCode = 1;
});
