/** Validated standard undergraduate format supplied by the task: nine ASCII digits.
 * Wider/special IDs remain unverified. No century guessing before 2000 or after asOf+1.
 * This module is pure and safe in browser code; it never changes account/affiliation state.
 */
export const gradeModes = ["AUTO_STUDENT_ID", "MANUAL", "UNVERIFIED"] as const;
export type GradeMode = typeof gradeModes[number];
export type GradeProfile = { studentId?: string | null; grade?: string | null; gradeMode?: string; enrollmentYear?: number | null };
export function beijingAcademicYear(asOf = new Date()) {
  const local = new Date(asOf.getTime() + 8 * 3600000);
  return local.getUTCFullYear() - (local.getUTCMonth() < 8 ? 1 : 0);
}
export function inferEnrollmentYear(studentId: string | null | undefined, asOf = new Date()) {
  if (!studentId || !/^[0-9]{9}$/.test(studentId)) return null;
  const year = 2000 + Number(studentId.slice(2, 4));
  const currentYear = new Date(asOf.getTime() + 8 * 3600000).getUTCFullYear();
  return year >= 2000 && year <= currentYear + 1 ? year : null;
}
export function getEffectiveRefereeGrade(asOf: Date, referee: GradeProfile) {
  const inferredYear = inferEnrollmentYear(referee.studentId, asOf);
  if (referee.gradeMode === "MANUAL") return { grade: referee.grade || null, source: "人工指定", enrollmentYear: referee.enrollmentYear ?? inferredYear, needsReview: !referee.grade };
  if (referee.gradeMode === "AUTO_STUDENT_ID" && inferredYear !== null && referee.enrollmentYear === inferredYear) {
    const level = beijingAcademicYear(asOf) - inferredYear + 1;
    return { grade: ["大一", "大二", "大三", "大四"][level - 1] ?? null, source: "自动识别", enrollmentYear: inferredYear, needsReview: level < 1 || level > 4 };
  }
  return { grade: referee.grade || null, source: "待确认", enrollmentYear: inferredYear, needsReview: true };
}
