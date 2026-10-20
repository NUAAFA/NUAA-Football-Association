import { Prisma } from "@/generated/prisma-v29/client";
import { prisma } from "@/lib/prisma";
import { beijingAcademicYear, getEffectiveRefereeGrade } from "@/lib/referee-grade";
import { queryPage, queryText, type AdminQuery } from "@/lib/admin-match-query";
export const rosterCategories = { all: "在册", eligible: "可正式选派", training: "培养中", pending: "待启用", inactive: "停用 / 归档" };
export async function getAdminRefereeList(query: AdminQuery, now = new Date()) {
  const categories: Record<string, Prisma.Sql> = {
    all: Prisma.sql`1=1`,
    eligible: Prisma.sql`r.status='ACTIVE' AND r."assignmentEligibility"='ELIGIBLE' AND EXISTS (SELECT 1 FROM "RefereePositionCapability" c WHERE c."refereeId"=r.id AND c.status IN ('TRAINING','READY'))`,
    training: Prisma.sql`r."trainingStatus"='IN_TRAINING' OR EXISTS (SELECT 1 FROM "RefereePositionCapability" c WHERE c."refereeId"=r.id AND c.status='TRAINING')`,
    pending: Prisma.sql`r.status='PENDING_ACTIVATION'`, inactive: Prisma.sql`r.status IN ('INACTIVE','ARCHIVED')`,
  };
  const category = Object.hasOwn(categories, queryText(query, "category")) ? queryText(query, "category") : "all";
  const terms: Prisma.Sql[] = [Prisma.sql`1=1`];
  const q = queryText(query, "q").trim(); if (q) terms.push(Prisma.sql`instr(lower(r.name),lower(${q}))>0 OR instr(lower(r."publicCode"),lower(${q}))>0 OR instr(lower(r."studentId"),lower(${q}))>0`);
  const college = queryText(query, "college"); if (college) terms.push(Prisma.sql`r."collegeId"=${college}`);
  const status = queryText(query, "status"); if (["ACTIVE", "PENDING_ACTIVATION", "INACTIVE", "ARCHIVED"].includes(status)) terms.push(Prisma.sql`r.status=${status}`);
  const format = queryText(query, "format"); if (["FUTSAL", "ELEVEN_A_SIDE"].includes(format)) terms.push(Prisma.sql`EXISTS (SELECT 1 FROM "RefereePositionCapability" c WHERE c."refereeId"=r.id AND c.format=${format} AND c.status!='NOT_ASSIGNED')`);
  const eligibility = queryText(query, "eligibility"); if (["ELIGIBLE", "NOT_ELIGIBLE", "SUSPENDED"].includes(eligibility)) terms.push(Prisma.sql`r."assignmentEligibility"=${eligibility}`);
  const training = queryText(query, "training"); if (["IN_TRAINING", "PENDING_ASSESSMENT", "QUALIFIED"].includes(training)) terms.push(Prisma.sql`r."trainingStatus"=${training}`);
  const mode = queryText(query, "gradeMode"), grade = queryText(query, "grade"), enrollment = queryText(query, "enrollment");
  if (["AUTO_STUDENT_ID", "MANUAL", "UNVERIFIED"].includes(mode)) terms.push(Prisma.sql`r."gradeMode"=${mode}`);
  const academic = beijingAcademicYear(now), year = new Date(now.getTime() + 8 * 3600000).getUTCFullYear();
  const inferred = Prisma.sql`CASE WHEN length(r."studentId")=9 AND r."studentId" NOT GLOB '*[^0-9]*' AND (2000+CAST(substr(r."studentId",3,2) AS INTEGER)) BETWEEN 2000 AND ${year + 1} THEN 2000+CAST(substr(r."studentId",3,2) AS INTEGER) ELSE NULL END`;
  const automatic = Prisma.sql`(r."gradeMode"='AUTO_STUDENT_ID' AND r."enrollmentYear"=(${inferred}))`;
  const effective = Prisma.sql`CASE WHEN ${automatic} THEN CASE ${academic}+1-r."enrollmentYear" WHEN 1 THEN '大一' WHEN 2 THEN '大二' WHEN 3 THEN '大三' WHEN 4 THEN '大四' ELSE NULL END ELSE r."grade" END`;
  if (grade) terms.push(grade === "unknown" ? Prisma.sql`(${effective}) IS NULL OR (${effective})=''` : Prisma.sql`(${effective})=${grade}`);
  if (enrollment) terms.push(/^20\d{2}$/.test(enrollment) ? Prisma.sql`(${inferred})=${Number(enrollment)}` : Prisma.sql`0=1`);
  if (mode === "review") terms.push(Prisma.sql`r."gradeMode"='UNVERIFIED' OR (r."gradeMode"='AUTO_STUDENT_ID' AND (NOT COALESCE(${automatic},0) OR (${effective}) IS NULL)) OR (r."gradeMode"='MANUAL' AND (r."grade" IS NULL OR r."grade"=''))`);
  const base = Prisma.join(terms.map(t => Prisma.sql`(${t})`), " AND ");
  const count = async (term: Prisma.Sql) => Number((await prisma.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*) AS n FROM "Referee" r WHERE ${base} AND (${term})`))[0].n);
  const counts = Object.fromEntries(await Promise.all(Object.entries(categories).map(async ([key, term]) => [key, await count(term)])));
  const total = counts[category], pages = Math.max(1, Math.ceil(total / 20)), page = Math.min(queryPage(queryText(query, "page")), pages);
  const ids = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT r.id FROM "Referee" r WHERE ${base} AND (${categories[category]}) ORDER BY r."publicCode" ASC,r.id ASC LIMIT 20 OFFSET ${(page - 1) * 20}`);
  const referees = await prisma.referee.findMany({ where: { id: { in: ids.map(r => r.id) } }, orderBy: [{ publicCode: "asc" }, { id: "asc" }], select: { id: true, name: true, publicCode: true, studentId: true, grade: true, gradeMode: true, enrollmentYear: true, status: true, trainingStatus: true, assignmentEligibility: true, college: { select: { name: true } }, currentAffiliationUnit: { select: { name: true } }, capabilities: { where: { status: { not: "NOT_ASSIGNED" } }, select: { format: true } } } });
  return { category, counts, total, page, pages, referees: referees.map(({ studentId, ...r }) => ({ ...r, effectiveGrade: getEffectiveRefereeGrade(now, { ...r, studentId }) })) };
}
