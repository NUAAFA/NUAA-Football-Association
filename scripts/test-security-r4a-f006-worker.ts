import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@libsql/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../src/generated/prisma-v29/client";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function rejects(
  action: () => unknown | Promise<unknown>,
  expected: string,
) {
  try {
    await action();
  } catch (error) {
    assert(
      error instanceof Error && error.message.includes(expected),
      `Expected rejection containing ${expected}.`,
    );
    return;
  }
  throw new Error(`Expected rejection containing ${expected}.`);
}

async function applyMigrations(url: string) {
  const client = createClient({ url });
  const entries = (await readdir(path.resolve("prisma/migrations"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    await client.executeMultiple(
      await readFile(path.resolve("prisma/migrations", entry.name, "migration.sql"), "utf8"),
    );
  }
  client.close();
}

async function sourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(target));
    else if (/\.(?:ts|tsx)$/u.test(entry.name)) files.push(target);
  }
  return files;
}

async function main() {
  const databasePath = process.env.SECURITY_R4A_F006_DATABASE_PATH;
  if (!databasePath) throw new Error("SECURITY_R4A_F006_DATABASE_PATH is required.");
  const url = `file:${databasePath.replaceAll("\\", "/")}`;
  process.env.DATABASE_URL = url;
  process.env.NUAAFA_ISOLATED_SECURITY_TEST = "1";
  await applyMigrations(url);

  const verifier = new PrismaClient({ adapter: new PrismaLibSql({ url }) });
  const accounts = await import("../src/lib/unified-admin-account-service");
  const referees = await import("../src/lib/referee-service");
  const capabilities = await import("./security-r4a-test-capabilities");

  try {
    const superActor = capabilities.testUnifiedAdminActor({
      displayName: "R4A isolated SUPER_ADMIN",
      isLegacy: true,
    });
    const systemAuthorization = capabilities.issueTestAdminServiceAuthorization(
      "system:write",
      superActor,
    );
    const created = await accounts.createUnifiedAdminAccount({
      username: "r4a-capability-admin",
      displayName: "R4A capability administrator",
      password: "R4A-Capability-Password-2026!",
      roles: ["CONTENT_EDITOR"],
    }, systemAuthorization);
    assert(created.username === "r4a-capability-admin", "Authorized service capability did not succeed.");

    await rejects(
      () => capabilities.issueTestAdminServiceAuthorization(
        "system:write",
        capabilities.testUnifiedAdminActor({ roles: ["CONTENT_EDITOR"] }),
      ),
      "没有执行此操作的权限",
    );
    await rejects(
      () => accounts.createUnifiedAdminAccount({
        username: "r4a-missing-context",
        displayName: "Missing context",
        password: "R4A-Missing-Context-2026!",
        roles: ["CONTENT_EDITOR"],
      }, undefined as never),
      "可信服务授权上下文无效",
    );
    await rejects(
      () => accounts.createUnifiedAdminAccount({
        username: "r4a-forged-context",
        displayName: "Forged context",
        password: "R4A-Forged-Context-2026!",
        roles: ["CONTENT_EDITOR"],
      }, { permission: "system:write", actor: superActor } as never),
      "可信服务授权上下文无效",
    );
    assert(
      await verifier.adminAccount.count({
        where: { username: { in: ["r4a-missing-context", "r4a-forged-context"] } },
      }) === 0,
      "Rejected service authorization produced an account mutation.",
    );

    const unionActor = capabilities.testUnifiedAdminActor({
      roles: ["CONTENT_EDITOR", "REFEREE_ADMIN"],
    });
    const refereeAuthorization = capabilities.issueTestAdminServiceAuthorization(
      "referees:write",
      unionActor,
    );
    const referee = await referees.createRefereeAccount({
      publicCode: "R4A-CAP-001",
      name: "R4A multi-role referee",
      initialPassword: "R4A-Referee-Password-2026!",
      status: "ACTIVE",
      assignmentEligibility: "NOT_ELIGIBLE",
      elevenASide: false,
      futsal: false,
      trainingStatus: "PENDING_ASSESSMENT",
      publicDirectoryEnabled: false,
    }, refereeAuthorization);
    assert(Boolean(referee.id), "Multi-role union did not preserve REFEREE_ADMIN permission.");
    await rejects(
      () => capabilities.issueTestAdminServiceAuthorization("competitions:write", unionActor),
      "没有执行此操作的权限",
    );

    const selfAuthorization = capabilities.issueTestRefereeSelfServiceAuthorization(referee.id);
    await rejects(
      () => referees.changeRefereePassword(
        "different-referee-id",
        "irrelevant",
        "irrelevant-new",
        selfAuthorization,
      ),
      "裁判员服务授权上下文无效",
    );
    await rejects(
      () => referees.changeRefereePassword(
        referee.id,
        "irrelevant",
        "irrelevant-new",
        { refereeId: referee.id } as never,
      ),
      "裁判员服务授权上下文无效",
    );

    const allowedIssuerImports = new Set([
      path.normalize("src/lib/legacy-admin-authorization.ts"),
      path.normalize("src/lib/referee-member-api.ts"),
      path.normalize("src/lib/unified-admin-api.ts"),
    ]);
    for (const file of await sourceFiles(path.resolve("src"))) {
      const relative = path.normalize(path.relative(process.cwd(), file));
      const source = await readFile(file, "utf8");
      if (/issue(?:Admin|RefereeSelf)ServiceAuthorization/u.test(source)) {
        assert(
          relative === path.normalize("src/lib/privileged-service-authorization.ts") ||
          allowedIssuerImports.has(relative),
          `Unauthorized production issuer import: ${relative}`,
        );
      }
      assert(
        !source.includes("security-r4a-test-capabilities"),
        `Production source imported isolated test authorization: ${relative}`,
      );
      if (
        source.includes("createRefereeAccountInTransaction") &&
        relative !== path.normalize("src/lib/referee-service.ts")
      ) {
        assert(
          relative === path.normalize("src/lib/referee-admission-service.ts"),
          `Unauthorized low-level referee transaction helper import: ${relative}`,
        );
      }
    }

    const routeEvidence = [
      ["src/app/api/admin/system/admin-accounts/route.ts", "authorizeUnifiedAdminServiceRequest"],
      ["src/app/api/admin/competitions/import/commit/route.ts", "authorizeUnifiedAdminServiceRequest"],
      ["src/app/api/referees/admin/accounts/route.ts", "authorizeUnifiedAdminRequest"],
      ["src/app/api/referees/admin/appointments/[matchId]/route.ts", "authorizeLegacyAdminRequest"],
      ["src/app/api/referees/account/password/route.ts", "authorizeRefereeMemberSecurityRequest"],
    ] as const;
    for (const [file, marker] of routeEvidence) {
      assert((await readFile(path.resolve(file), "utf8")).includes(marker), `${file} lost ${marker}.`);
    }
    const accountRoute = await readFile(path.resolve("src/app/api/referees/admin/accounts/route.ts"), "utf8");
    assert(
      /await\s+authorizeUnifiedAdminRequest\(request,\s*"referees:write",\s*\{\s*mutation:\s*true\s*\}\)/u.test(accountRoute),
      "Referee account creation lost referees:write mutation authorization.",
    );

    console.log("R4A_F006_AUTHORIZED=PASS");
    console.log("R4A_F006_INSUFFICIENT=PASS");
    console.log("R4A_F006_MISSING=PASS");
    console.log("R4A_F006_FORGED=PASS");
    console.log("R4A_F006_MULTI_ROLE=PASS");
    console.log("R4A_F006_SUPER_ADMIN=PASS");
    console.log("R4A_F006_ROUTE_GUARDS=PASS");
    console.log("R4A_F006_IMPORT_BOUNDARY=PASS");
  } finally {
    await verifier.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
