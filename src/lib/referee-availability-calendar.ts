export type CalendarAvailabilityRecord = {
  id: string; refereeId: string; kind: string; startAt: string; endAt: string;
  competitionFormat: string | null; note: string | null;
};
export type AvailabilityCalendarState = "available" | "unavailable" | "window" | "unset";
export const availabilityCalendarLabels: Record<AvailabilityCalendarState, string> = {
  available: "可执裁", unavailable: "不可执裁", window: "指定时段", unset: "未设置",
};
const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
});
const clockFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
export function beijingDateKey(value: Date) {
  const parts = Object.fromEntries(dayFormatter.formatToParts(value).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function shiftCalendarDay(day: string, offset: number) {
  const value = new Date(`${day}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}
export function calendarDays(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("月份格式不正确。");
  const first = `${month}-01`;
  const offset = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => shiftCalendarDay(first, i - offset));
}
export function calendarDayBounds(day: string) {
  const start = new Date(`${day}T00:00:00+08:00`).getTime();
  return { start, end: start + 86400000 };
}
export function beijingCalendarDateTime(day: string, time: string) {
  return new Date(`${day}T${time}:00+08:00`).toISOString();
}
export function calendarClock(value: string) {
  return clockFormatter.format(new Date(value));
}
export function isFullCalendarDay(record: Pick<CalendarAvailabilityRecord, "startAt" | "endAt">) {
  const from = Date.parse(record.startAt), to = Date.parse(record.endAt);
  const { start, end } = calendarDayBounds(beijingDateKey(new Date(from)));
  return from === start && to === end;
}
export function recordsOnCalendarDay(records: CalendarAvailabilityRecord[], day: string) {
  const { start, end } = calendarDayBounds(day);
  return records.filter((r) => Date.parse(r.startAt) < end && Date.parse(r.endAt) > start);
}
export function availabilityDayState(records: CalendarAvailabilityRecord[], day: string): AvailabilityCalendarState {
  const { start, end } = calendarDayBounds(day);
  const overlapping = recordsOnCalendarDay(records, day);
  const coversDay = (kind: string) => {
    const windows = overlapping.filter((r) => r.kind === kind)
      .map((r) => ({ from: Math.max(start, Date.parse(r.startAt)), to: Math.min(end, Date.parse(r.endAt)) }))
      .sort((a, b) => a.from - b.from);
    let coveredUntil = start;
    for (const window of windows) {
      if (window.from > coveredUntil) return false;
      coveredUntil = Math.max(coveredUntil, window.to);
      if (coveredUntil >= end) return true;
    }
    return false;
  };
  if (coversDay("UNAVAILABLE")) return "unavailable";
  if (!overlapping.length) return "unset";
  if (!overlapping.some((r) => r.kind === "UNAVAILABLE") && coversDay("AVAILABLE")) return "available";
  return "window";
}
export function availabilityDayTime(record: CalendarAvailabilityRecord, day: string) {
  const { start, end } = calendarDayBounds(day);
  const from = Math.max(start, Date.parse(record.startAt)), to = Math.min(end, Date.parse(record.endAt));
  if (from === start && to === end) return "全天";
  return `${clockFormatter.format(new Date(from))}–${to === end ? "24:00" : clockFormatter.format(new Date(to))}`;
}
