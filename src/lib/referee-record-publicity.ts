import type { Prisma } from "@/generated/prisma-v29/client";
/** One allow-list for every public consumer. Unknown sources fail closed. */
export const publicAppointmentSourceWhere = {
  OR: [{ recordSource: "PRE_MATCH" }, { recordSource: "POST_MATCH_ENTRY", publicHistoryVisible: true, status: "COMPLETED" }],
} satisfies Prisma.RefereeAppointmentWhereInput;
export function isPublicAppointmentRecord(record: { recordSource: string; status: string; publicHistoryVisible: boolean }) {
  return record.recordSource === "PRE_MATCH" ? ["PUBLISHED", "COMPLETED"].includes(record.status) : record.recordSource === "POST_MATCH_ENTRY" && record.status === "COMPLETED" && record.publicHistoryVisible;
}
