// Reading a legacy COMPLETED assignment must never rewrite its match result.
export function completedAssignmentReviewReason(match: {
  status: string;
  kickoff: Date | null;
  homeScore: number | null;
  awayScore: number | null;
}, now = new Date()) {
  const reasons: string[] = [];
  if (match.status !== "COMPLETED") reasons.push("比赛状态尚未完成");
  if (!match.kickoff) reasons.push("比赛时间待安排");
  if (match.kickoff && match.kickoff > now) reasons.push("比赛时间尚未到达");
  if (match.homeScore === null || match.awayScore === null) reasons.push("比分未完整记录");
  return reasons.length ? reasons.join("；") : null;
}
