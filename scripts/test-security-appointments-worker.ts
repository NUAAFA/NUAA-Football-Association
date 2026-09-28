import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@libsql/client";
import type { AppointmentStatus } from "../src/generated/prisma-v29/client";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function applyMigrations(url: string) {
  const client = createClient({ url });
  const entries = (await readdir(path.resolve("prisma/migrations"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    await client.executeMultiple(await readFile(path.resolve("prisma/migrations", entry.name, "migration.sql"), "utf8"));
  }
  client.close();
}

async function main() {
  const databasePath = process.env.SECURITY_APPOINTMENTS_DATABASE_PATH;
  if (!databasePath) throw new Error("SECURITY_APPOINTMENTS_DATABASE_PATH is required.");
  const url = `file:${databasePath.replaceAll("\\", "/")}`;
  process.env.DATABASE_URL = url;
  process.env.NUAAFA_ISOLATED_SECURITY_TEST = "1";
  await applyMigrations(url);

  const service = await import("../src/lib/referee-service");
  const { prisma } = await import("../src/lib/prisma");
  const capabilities = await import("./security-r4a-test-capabilities");
  const states = ["NONE", "DRAFT", "PUBLISHED", "WITHDRAWN", "COMPLETED", "CANCELLED"] as const;
  const actions = ["saveDraft", "publish", "withdraw", "complete", "cancel"] as const;
  const refereeAuthorization = capabilities.issueTestAdminServiceAuthorization(
    "referees:write",
    capabilities.testUnifiedAdminActor({ isLegacy: true }),
  );

  try {
    const competition = await prisma.competition.create({
      data: {
        slug: "security-appointment-matrix",
        name: "Security appointment matrix",
        campus: "isolated",
        format: "ELEVEN_A_SIDE",
        status: "ONGOING",
      },
    });
    const home = await prisma.team.create({ data: { competitionId: competition.id, name: "Matrix Home" } });
    const away = await prisma.team.create({ data: { competitionId: competition.id, name: "Matrix Away" } });
    const referees = await Promise.all(Array.from({ length: 6 }, async (_, index) => prisma.referee.create({
      data: {
        publicCode: `SEC-MATRIX-${index + 1}`,
        name: `Matrix Referee ${index + 1}`,
        status: "ACTIVE",
        trainingStatus: "QUALIFIED",
        assignmentEligibility: "ELIGIBLE",
        elevenASide: true,
        capabilities: { create: { format: "ELEVEN_A_SIDE", positionKey: "REFEREE", status: "READY" } },
      },
    })));
    let sequence = 0;
    async function createFixture(state: typeof states[number], label: string, slots = 1) {
      sequence += 1;
      const match = await prisma.match.create({
        data: {
          slug: `security-${label}-${sequence}`,
          competitionId: competition.id,
          stage: label,
          kickoff: new Date(Date.UTC(2035, 0, sequence, 8)),
          venue: "Isolated",
          homeTeamId: home.id,
          awayTeamId: away.id,
          status: "SCHEDULED",
          applicationWindowStatus: "CLOSED",
          positionRequirements: {
            create: { key: "REFEREE", label: "裁判员", count: slots, sortOrder: 10 },
          },
        },
      });
      if (state === "NONE") return { match, appointmentId: null as string | null };
      const appointment = await prisma.refereeAppointment.create({
        data: {
          matchId: match.id,
          status: state,
          revision: state === "DRAFT" ? 0 : 1,
          publishedAt: ["PUBLISHED", "WITHDRAWN", "COMPLETED"].includes(state) ? new Date("2034-01-01T00:00:00Z") : null,
          withdrawnAt: state === "WITHDRAWN" ? new Date("2034-01-02T00:00:00Z") : null,
          completedAt: state === "COMPLETED" ? new Date("2034-01-03T00:00:00Z") : null,
          cancelledAt: state === "CANCELLED" ? new Date("2034-01-04T00:00:00Z") : null,
          cancellationReason: state === "CANCELLED" ? "matrix seed" : null,
          positions: {
            create: { key: "REFEREE", label: "裁判员", sortOrder: 10, slot: 1, refereeId: referees[0].id },
          },
        },
      });
      await prisma.refereeApplication.create({
        data: {
          matchId: match.id,
          refereeId: referees[0].id,
          preferredPositions: "REFEREE",
          status: state === "CANCELLED" ? "NOT_SELECTED" : "APPOINTED",
        },
      });
      return { match, appointmentId: appointment.id };
    }

    async function snapshot(matchId: string) {
      return JSON.stringify({
        appointment: await prisma.refereeAppointment.findUnique({
          where: { matchId },
          include: { positions: { orderBy: { id: "asc" } }, versions: { orderBy: { revision: "asc" } } },
        }),
        applications: await prisma.refereeApplication.findMany({ where: { matchId }, orderBy: { id: "asc" } }),
        audits: await prisma.auditLog.findMany({ where: { metadata: { contains: matchId } }, orderBy: { id: "asc" } }),
      });
    }

    async function invoke(action: typeof actions[number], matchId: string, state: typeof states[number]) {
      if (action === "saveDraft") {
        return service.saveAppointmentDraft({
          matchId,
          publicationNote: "matrix",
          changeReason: state === "WITHDRAWN" ? "matrix resave" : "",
          positions: [{ key: "REFEREE", slot: 1, refereeId: referees[0].id }],
        }, refereeAuthorization);
      }
      if (action === "publish") return service.publishAppointment(matchId, state === "WITHDRAWN" ? "matrix republish" : "", "", refereeAuthorization);
      if (action === "withdraw") return service.withdrawAppointment(matchId, "matrix withdraw", refereeAuthorization);
      if (action === "complete") return service.completeAppointment(matchId, "matrix complete", refereeAuthorization);
      return service.cancelAppointment(matchId, "matrix cancel", refereeAuthorization);
    }

    let allowedCount = 0;
    let rejectedCount = 0;
    for (const state of states) {
      for (const action of actions) {
        const fixture = await createFixture(state, `${state.toLowerCase()}-${action.toLowerCase()}`);
        const expected = service.appointmentTransitionTable[state][action as keyof typeof service.appointmentTransitionTable[typeof state]] as AppointmentStatus | undefined;
        if (expected && action === "complete") await prisma.match.update({ where: { id: fixture.match.id }, data: { status: "COMPLETED", kickoff: new Date(Date.now() - 7200000), homeScore: 0, awayScore: 0 } });
        const before = await snapshot(fixture.match.id);
        let status = 0;
        try {
          await invoke(action, fixture.match.id, state);
        } catch (error) {
          if (error instanceof service.RefereeServiceError) status = error.status;
          else throw error;
        }
        if (expected) {
          assert(status === 0, `${state} x ${action} unexpectedly failed with ${status}.`);
          const appointment = await prisma.refereeAppointment.findUniqueOrThrow({ where: { matchId: fixture.match.id } });
          assert(appointment.status === expected, `${state} x ${action} reached ${appointment.status}, expected ${expected}.`);
          allowedCount += 1;
        } else {
          assert(status === 409, `${state} x ${action} returned ${status || "success"}, expected 409.`);
          assert(await snapshot(fixture.match.id) === before, `${state} x ${action} mutated rows, versions, timestamps, applications, or audits.`);
          rejectedCount += 1;
        }
      }
    }

    async function createApplication(refereeId: string, matchId: string, status: "APPROVED" | "WITHDRAWN" | "REJECTED" = "APPROVED") {
      return prisma.refereeApplication.create({
        data: { matchId, refereeId, preferredPositions: "REFEREE", status },
      });
    }

    const replacement = await createFixture("NONE", "replace-a-with-b");
    const appA = await createApplication(referees[0].id, replacement.match.id);
    const appB = await createApplication(referees[1].id, replacement.match.id);
    await service.saveAppointmentDraft({ matchId: replacement.match.id, publicationNote: "A", positions: [{ key: "REFEREE", refereeId: referees[0].id }] }, refereeAuthorization);
    await service.publishAppointment(replacement.match.id, "", "", refereeAuthorization);
    await service.withdrawAppointment(replacement.match.id, "replace A", refereeAuthorization);
    await service.saveAppointmentDraft({ matchId: replacement.match.id, publicationNote: "B", changeReason: "replace A with B", positions: [{ key: "REFEREE", refereeId: referees[1].id }] }, refereeAuthorization);
    await service.publishAppointment(replacement.match.id, "replace A with B", "", refereeAuthorization);
    assert((await prisma.refereeApplication.findUniqueOrThrow({ where: { id: appA.id } })).status === "NOT_SELECTED", "Removed A remained APPOINTED.");
    assert((await prisma.refereeApplication.findUniqueOrThrow({ where: { id: appB.id } })).status === "APPOINTED", "Selected B was not APPOINTED.");

    const multi = await createFixture("NONE", "remove-a-add-c", 2);
    const multiA = await createApplication(referees[0].id, multi.match.id);
    const multiB = await createApplication(referees[1].id, multi.match.id);
    const multiC = await createApplication(referees[2].id, multi.match.id);
    const withdrawn = await createApplication(referees[3].id, multi.match.id, "WITHDRAWN");
    const rejected = await createApplication(referees[4].id, multi.match.id, "REJECTED");
    await service.saveAppointmentDraft({ matchId: multi.match.id, publicationNote: "A+B", positions: [
      { key: "REFEREE", slot: 1, refereeId: referees[0].id },
      { key: "REFEREE", slot: 2, refereeId: referees[1].id },
    ] }, refereeAuthorization);
    await service.publishAppointment(multi.match.id, "", "", refereeAuthorization);
    await service.withdrawAppointment(multi.match.id, "remove A add C", refereeAuthorization);
    await service.saveAppointmentDraft({ matchId: multi.match.id, publicationNote: "B+C", changeReason: "remove A add C", positions: [
      { key: "REFEREE", slot: 1, refereeId: referees[1].id },
      { key: "REFEREE", slot: 2, refereeId: referees[2].id },
    ] }, refereeAuthorization);
    await service.publishAppointment(multi.match.id, "remove A add C", "", refereeAuthorization);
    const finalApplications = await prisma.refereeApplication.findMany({ where: { matchId: multi.match.id } });
    const statusById = new Map(finalApplications.map((item) => [item.id, item.status]));
    assert(statusById.get(multiA.id) === "NOT_SELECTED", "Removed A remained APPOINTED in multi-selection reconciliation.");
    assert(statusById.get(multiB.id) === "APPOINTED" && statusById.get(multiC.id) === "APPOINTED", "Final B+C set is not APPOINTED.");
    assert(statusById.get(withdrawn.id) === "WITHDRAWN" && statusById.get(rejected.id) === "REJECTED", "Terminal application semantics were overwritten.");

    console.log(JSON.stringify({
      matrixCases: states.length * actions.length,
      allowedCount,
      rejectedCount,
      illegalMutationChecks: rejectedCount,
      completedAndCancelledTerminal: true,
      replaceAWithB: true,
      removeAAddC: true,
      terminalApplicationStatusesPreserved: true,
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
