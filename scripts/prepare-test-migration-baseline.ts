import { cp, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
/** Portable fixed pre-Team-Directory fixture; retains migration-deploy upgrade coverage. */
export async function preparePreTeamDirectoryBaseline(root: string, url: string) {
  const directory = path.join(root, "baseline");
  await mkdir(path.join(directory, "prisma/migrations"), { recursive: true });
  await cp(path.resolve("scripts/fixtures/pre-team-directory-schema.prisma"), path.join(directory, "prisma/schema.prisma"));
  const entries = await readdir("prisma/migrations", { withFileTypes: true });
  for (const entry of entries) if (entry.name === "migration_lock.toml" || entry.isDirectory() && entry.name < "20260923120000_dynamic_public_team_directory_r1") await cp(path.resolve("prisma/migrations", entry.name), path.join(directory, "prisma/migrations", entry.name), { recursive: true });
  await writeFile(path.join(directory, "prisma.config.ts"), `export default ${JSON.stringify({ schema: "prisma/schema.prisma", migrations: { path: "prisma/migrations" }, datasource: { url } })};\n`);
  return directory;
}
