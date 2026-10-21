import type { Prisma } from "@/generated/prisma-v29/client";

/** Public appointment views may disclose only the referee display name. */
export const publicAppointmentRefereeSelect = {
  id: true,
  name: true,
} satisfies Prisma.RefereeSelect;

export type PublicRefereeDTO = Prisma.RefereeGetPayload<{
  select: typeof publicAppointmentRefereeSelect;
}>;

/** Public directory fields are explicitly allow-listed and deliberately omit security data. */
export const publicDirectoryRefereeSelect = {
  id: true,
  publicCode: true,
  name: true,
  elevenASide: true,
  futsal: true,
  publicBio: true,
  updatedAt: true,
} satisfies Prisma.RefereeSelect;

export type PublicDirectoryRefereeDTO = Prisma.RefereeGetPayload<{
  select: typeof publicDirectoryRefereeSelect;
}>;

/** Authenticated referee self-service fields. Never use this select for public queries. */
export const selfRefereeSelect = {
  id: true,
  publicCode: true,
  name: true,
  status: true,
  studentId: true,
  collegeId: true,
  college: { select: { id: true, name: true } },
  currentAffiliationUnitId: true,
  currentAffiliationUnit: { select: { id: true, name: true, type: true } },
  grade: true,
  gradeMode: true,
  enrollmentYear: true,
  gradeReason: true,
  phone: true,
  qq: true,
  refereeLevel: true,
  joinedAt: true,
  elevenASide: true,
  futsal: true,
  mustChangePassword: true,
  certificateNote: true,
  qualificationNote: true,
  trainingStatus: true,
  assignmentEligibility: true,
  publicDirectoryEnabled: true,
  publicBio: true,
  capabilities: {
    select: { id: true, format: true, positionKey: true, status: true },
    orderBy: [{ format: "asc" }, { positionKey: "asc" }],
  },
  affiliations: {
    select: { unit: { select: { id: true, name: true, type: true } } },
    orderBy: { unit: { name: "asc" } },
  },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.RefereeSelect;

export type SelfRefereeDTO = Prisma.RefereeGetPayload<{
  select: typeof selfRefereeSelect;
}>;

/** Administrator profile fields; password hashes and session security fields stay excluded. */
export const adminRefereeSelect = {
  id: true,
  publicCode: true,
  name: true,
  status: true,
  studentId: true,
  collegeId: true,
  college: { select: { id: true, name: true } },
  currentAffiliationUnitId: true,
  currentAffiliationUnit: { select: { id: true, name: true, type: true } },
  grade: true,
  gradeMode: true,
  enrollmentYear: true,
  gradeReason: true,
  phone: true,
  qq: true,
  refereeLevel: true,
  joinedAt: true,
  elevenASide: true,
  futsal: true,
  sourceNote: true,
  mustChangePassword: true,
  certificateNote: true,
  qualificationNote: true,
  trainingStatus: true,
  assignmentEligibility: true,
  publicDirectoryEnabled: true,
  publicBio: true,
  internalNote: true,
  capabilities: {
    select: { id: true, format: true, positionKey: true, status: true },
    orderBy: [{ format: "asc" }, { positionKey: "asc" }],
  },
  affiliations: {
    select: { unit: { select: { id: true, name: true, type: true } } },
    orderBy: { unit: { name: "asc" } },
  },
  lockedUntil: true,
  lastLoginAt: true,
  passwordChangedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.RefereeSelect;

export type AdminRefereeDTO = Prisma.RefereeGetPayload<{
  select: typeof adminRefereeSelect;
}>;
