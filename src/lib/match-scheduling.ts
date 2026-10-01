import { RefereeServiceError } from "@/lib/referee-service-error";

export function isMatchScheduled(match: { kickoff: Date | null; venue: string | null }) {
  return Boolean(match.kickoff && match.venue?.trim());
}
export function assertMatchScheduled(match: { kickoff: Date | null; venue: string | null }) {
  if (!isMatchScheduled(match)) throw new RefereeServiceError("比赛待排期，请先安排真实比赛时间和场地。", 409);
}
export function validateMatchSchedule(input: { kickoff: Date | null; endAt?: Date | null; venue: string | null; applicationWindowStatus: string; applicationDeadline?: Date | null; status: string }) {
  if (input.kickoff && Number.isNaN(input.kickoff.getTime())) throw new RefereeServiceError("比赛时间无效。");
  if (input.venue !== null && input.venue.length > 120) throw new RefereeServiceError("比赛场地不能超过120个字符。");
  if (input.endAt && (!input.kickoff || input.endAt <= input.kickoff)) throw new RefereeServiceError("结束时间须有开球时间且晚于开球时间。");
  if (input.applicationWindowStatus === "OPEN" || input.status === "COMPLETED") assertMatchScheduled(input);
  if (input.applicationWindowStatus === "OPEN" && (!input.applicationDeadline || input.applicationDeadline <= new Date() || !input.kickoff || input.applicationDeadline >= input.kickoff)) throw new RefereeServiceError("开放报名时，截止时间须晚于当前时间且早于开球时间。");
}
