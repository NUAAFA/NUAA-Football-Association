import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { createClient } from "@libsql/client";
import type { Prisma } from "../src/generated/prisma-v29/client";

async function run(args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, args, { env, stdio: "inherit" });
  const [code] = await once(child, "exit");
  assert.equal(code, 0, `Command failed: ${args.join(" ")}`);
}

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function main() {
  // Every write is confined to a fresh temporary database and upload directory.
  const root = await mkdtemp(path.join(os.tmpdir(), "nuaafa-home-notices-"));
  const url = `file:${path.join(root, "notices.db")}`;
  process.env.DATABASE_URL = url;
  process.env.NUAAFA_UPLOAD_DIR = path.join(root, "uploads");
  process.env.NUAAFA_CONTENT_SOURCE = "database";
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production" };
  let server: ChildProcess | undefined;
  const { prisma } = await import("../src/lib/prisma");
  try {
    const raw = createClient({ url });
    try {
      const migrations = (await readdir("prisma/migrations", { withFileTypes: true }))
        .filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
      for (const migration of migrations) {
        await raw.executeMultiple(await readFile(path.join("prisma/migrations", migration.name, "migration.sql"), "utf8"));
      }
    } finally {
      raw.close();
    }

    const day = new Date();
    day.setUTCHours(17, 0, 0, 0);
    day.setUTCDate(day.getUTCDate() - 2);
    const at = (days: number) => new Date(day.getTime() + days * 86_400_000);
    const post = (id: string, extra: Partial<Prisma.ContentPostCreateManyInput> = {}): Prisma.ContentPostCreateManyInput => ({
      id, slug: id, type: "ANNOUNCEMENT", title: `隔离公告 ${id}`, summary: `隔离摘要 ${id}`,
      content: { schemaVersion: 1, document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `隔离正文 ${id}` }] }] } },
      status: "PUBLISHED", publishedAt: day, ...extra,
    });
    await prisma.contentPost.createMany({ data: [
      post("pinned-old", { pinned: true, publishedAt: at(-7) }),
      post("pinned-new", { type: "DISCIPLINE", pinned: true, publishedAt: at(-6) }),
      post("latest-z", { type: "DISCIPLINE" }), post("latest-a"),
      post("older", { publishedAt: at(-1) }),
      post("draft", { status: "DRAFT", pinned: true }),
      post("archived", { status: "ARCHIVED", pinned: true }),
      post("future", { publishedAt: at(10), pinned: true }),
      post("no-date", { publishedAt: null, pinned: true }),
      ...Array.from({ length: 15 }, (_, index) => post(`news-${index}`, { type: "NEWS", pinned: true, publishedAt: at(1) })),
    ] });
    const { getPublishedContentPage } = await import("../src/lib/admin-content-service");
    const types = ["ANNOUNCEMENT", "DISCIPLINE"] as const;
    const page = await getPublishedContentPage({ type: [...types], pageSize: 3 });
    assert.deepEqual(page.items.map((item) => item.slug), ["pinned-new", "pinned-old", "latest-z"]);
    assert(page.nextCursor);
    const next = await getPublishedContentPage({ type: [...types], pageSize: 3, cursor: page.nextCursor });
    assert.deepEqual(next.items.map((item) => item.slug), ["latest-a", "older"]);
    assert.equal(next.nextCursor, null);
    const discipline = await getPublishedContentPage({ type: "DISCIPLINE", pageSize: 50 });
    assert.deepEqual(discipline.items.map((item) => item.slug), ["pinned-new", "latest-z"]);
    const all = await getPublishedContentPage({ pageSize: 50 });
    assert.equal(all.items.length, 20);
    console.log("PASS: real database filtering before limit, mixed types, pinned/date/id order, hidden states, future dates, null dates, pagination and existing callers.");

    // Build and serve with the same isolated data; subsequent writes must appear without rebuilding.
    await run(["node_modules/next/dist/bin/next", "build"], env);
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const nextBin = "node_modules/next/dist/bin/next";
    const start = async (contentSource: string) => {
      const child = spawn(process.execPath, [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
        env: { ...env, NUAAFA_CONTENT_SOURCE: contentSource }, stdio: "inherit",
      });
      server = child;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        assert.equal(child.exitCode, null, "Preview server exited before becoming ready");
        try {
          const response = await fetch(base, { signal: AbortSignal.timeout(5000) });
          if (response.ok) return;
        } catch { /* Server is still starting. */ }
        await delay(200);
      }
      throw new Error("Preview server did not become ready");
    };
    const stop = async () => {
      if (server && server.exitCode === null) {
        const exited = once(server, "exit");
        server.kill("SIGTERM");
        await exited;
      }
      server = undefined;
    };
    const section = async () => {
      const response = await fetch(base, { signal: AbortSignal.timeout(15_000) });
      assert.equal(response.status, 200);
      const html = await response.text();
      const match = html.match(/<section\b[^>]*id="home-notices"[\s\S]*?<\/section>/);
      assert(match, "Homepage notice section must render");
      return match[0];
    };
    const expectNotices = async (slugs: string[]) => {
      const html = await section();
      const hrefs = [...html.matchAll(/href="\/news\/([^"?#]+)"/g)].map((match) => match[1]);
      assert.deepEqual(hrefs, slugs);
      assert.equal([...html.matchAll(/<h3>/g)].length, slugs.length);
      return html;
    };

    await start("database");
    const initial = await expectNotices(["pinned-new", "pinned-old", "latest-z"]);
    const beijingDate = new Date(day.getTime() + 8 * 3_600_000).toISOString().slice(0, 10).replaceAll("-", "/");
    const times = [...initial.matchAll(/<time\b[^>]*datetime="([^"]+)"[^>]*>([^<]+)<\/time>/gi)]
      .map((match) => [match[1], match[2]]);
    assert(times.some(([timestamp, label]) => timestamp === day.toISOString() && label === beijingDate), JSON.stringify(times));
    assert(initial.includes("DISCIPLINE") && initial.includes("NOTICE"));
    for (const slug of ["pinned-new", "pinned-old", "latest-z"]) {
      const response = await fetch(`${base}/news/${slug}`);
      assert.equal(response.status, 200);
      assert((await response.text()).includes(`隔离正文 ${slug}`));
    }
    assert.equal((await fetch(`${base}/news`)).status, 200);
    console.log("PASS: production homepage shows exactly three correct links, both badges, Beijing dates, working details and news listing.");

    await prisma.contentPost.updateMany({ where: { id: { in: ["pinned-new", "pinned-old"] } }, data: { pinned: false } });
    await expectNotices(["latest-z", "latest-a", "older"]);
    await prisma.contentPost.update({ where: { id: "draft" }, data: { status: "PUBLISHED", publishedAt: at(1), pinned: false } });
    await expectNotices(["draft", "latest-z", "latest-a"]);
    await prisma.contentPost.update({ where: { id: "draft" }, data: { status: "ARCHIVED" } });
    await prisma.contentPost.update({ where: { id: "latest-z" }, data: { status: "DRAFT" } });
    await expectNotices(["latest-a", "older", "pinned-new"]);
    console.log("PASS: unpinning, publishing, archiving and withdrawing immediately update the next homepage request without a rebuild.");

    await prisma.contentPost.updateMany({ where: { type: { in: [...types] } }, data: { status: "ARCHIVED" } });
    const empty = await expectNotices([]);
    assert(empty.includes("暂无已发布公告。"));
    assert(!empty.includes("discipline-bai-yile"));
    await prisma.contentPost.update({ where: { id: "latest-a" }, data: { status: "PUBLISHED" } });
    await expectNotices(["latest-a"]);
    console.log("PASS: empty and short database lists never refill with old static announcements or ordinary news.");

    await stop();
    await start("static");
    const { publicAnnouncements } = await import("../src/data/content");
    await expectNotices(publicAnnouncements.slice(0, 3).map((item) => item.href.replace("/news/", "")));
    console.log("PASS: explicitly configured static content mode retains its original three announcements.");
    await stop();
  } finally {
    if (server && server.exitCode === null) {
      const exited = once(server, "exit");
      server.kill("SIGTERM");
      await exited;
    }
    await prisma.$disconnect();
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
