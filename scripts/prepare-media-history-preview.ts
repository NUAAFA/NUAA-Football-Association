import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createMediaHistoryFixtureDatabase, seedMediaHistoryFixture } from "./lib/media-history-fixture";

async function main() {
  const root = path.resolve(".local-preview/media-history");
  const database = path.join(root, "preview.db");
  try { await access(".env.local"); throw new Error(".env.local 已存在；为保留现有配置，不自动覆盖。"); } catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
  try { await access(database); throw new Error("本地预览数据库已存在；请沿用它，不自动覆盖。"); } catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
  await mkdir(root, { recursive: true });
  process.env.DATABASE_URL = `file:${database}`;
  process.env.NUAAFA_CONTENT_SOURCE = "database";
  process.env.NUAAFA_UPLOAD_DIR = path.join(root, "uploads");
  await createMediaHistoryFixtureDatabase(process.env.DATABASE_URL);
  const { prisma } = await import("../src/lib/prisma");
  try { await seedMediaHistoryFixture(prisma, process.env.NUAAFA_UPLOAD_DIR); } finally { await prisma.$disconnect(); }
  await writeFile(".env.local", `DATABASE_URL=file:${database}\nNUAAFA_CONTENT_SOURCE=database\nNUAAFA_UPLOAD_DIR=${process.env.NUAAFA_UPLOAD_DIR}\n`);
  console.log("独立本地预览已准备：保留历史资料，另有两条明确标注的示例报道。");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
