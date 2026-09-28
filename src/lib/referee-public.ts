import type { Prisma } from "@/generated/prisma-v29/client";
import { prisma } from "@/lib/prisma";
import {
  publicAppointmentRefereeSelect,
  publicDirectoryRefereeSelect,
} from "@/lib/referee-dto";

const publicAppointmentSelect = {
  id: true,
  publicationNote: true,
  publishedAt: true,
  updatedAt: true,
  match: {
    select: {
      id: true,
      stage: true,
      kickoff: true,
      venue: true,
      status: true,
      competition: { select: { name: true } },
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
    },
  },
  positions: {
    select: {
      id: true,
      key: true,
      label: true,
      slot: true,
      referee: { select: publicAppointmentRefereeSelect },
    },
    orderBy: [{ sortOrder: "asc" }, { slot: "asc" }],
  },
} satisfies Prisma.RefereeAppointmentSelect;

export async function getPublicRefereeDirectory() {
  return prisma.referee.findMany({
    where: { status: "ACTIVE", publicDirectoryEnabled: true },
    select: publicDirectoryRefereeSelect,
    orderBy: { publicCode: "asc" },
  });
}

export async function getPublicUpcomingAppointments() {
  return prisma.refereeAppointment.findMany({
    where: {
      status: "PUBLISHED",
      match: {
        status: "SCHEDULED",
        isTestData: false,
        competition: { isTestData: false },
      },
    },
    select: publicAppointmentSelect,
    orderBy: { publishedAt: "desc" },
  });
}

export async function getPublicHistoricalAppointments(now = new Date()) {
  return prisma.refereeAppointment.findMany({
    where: {
      status: "COMPLETED",
      match: {
        status: "COMPLETED",
        kickoff: { lte: now },
        homeScore: { not: null },
        awayScore: { not: null },
        isTestData: false,
        competition: { isTestData: false },
      },
    },
    select: publicAppointmentSelect,
    orderBy: { match: { kickoff: "desc" } },
  });
}

export async function getPublicAppointmentById(id: string) {
  return prisma.refereeAppointment.findFirst({
    where: {
      id,
      status: { in: ["PUBLISHED", "COMPLETED"] },
      match: { isTestData: false, competition: { isTestData: false } },
    },
    select: publicAppointmentSelect,
  });
}
