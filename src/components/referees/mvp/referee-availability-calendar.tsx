"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  availabilityDayState, availabilityDayTime, beijingCalendarDateTime, beijingDateKey,
  calendarClock, calendarDays, isFullCalendarDay, recordsOnCalendarDay, shiftCalendarDay,
} from "@/lib/referee-availability-calendar";

type AvailabilityRecord = {
  id: string;
  refereeId: string;
  startAt: string;
  endAt: string;
  kind: "AVAILABLE" | "UNAVAILABLE";
  competitionFormat: "ELEVEN_A_SIDE" | "FUTSAL" | "CUSTOM" | null;
  note: string;
};

type AvailabilityMode = "FULL_AVAILABLE" | "FULL_UNAVAILABLE" | "WINDOW";
type CalendarState = "available" | "unavailable" | "window" | "unset";

const modeOptions: Array<{ value: AvailabilityMode; icon: string; label: string; description: string }> = [
  { value: "FULL_AVAILABLE", icon: "✓", label: "整天可执裁", description: "当天任意时段均可安排" },
  { value: "FULL_UNAVAILABLE", icon: "×", label: "整天不可执裁", description: "当天不接受比赛安排" },
  { value: "WINDOW", icon: "◷", label: "指定时段可执裁", description: "只在填写的时间范围内可安排" },
];

const stateLabels: Record<CalendarState, string> = {
  available: "可执裁",
  unavailable: "不可执裁",
  window: "指定时段",
  unset: "未设置",
};

function inferredMode(records: AvailabilityRecord[]): AvailabilityMode {
  if (records.some((record) => record.kind === "UNAVAILABLE" && isFullCalendarDay(record))) return "FULL_UNAVAILABLE";
  if (records.some((record) => record.kind === "AVAILABLE" && isFullCalendarDay(record))) return "FULL_AVAILABLE";
  return records.length ? "WINDOW" : "FULL_AVAILABLE";
}

export function RefereeAvailabilityCalendar({ records }: { records: AvailabilityRecord[] }) {
  const router = useRouter();
  const today = beijingDateKey(new Date());
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selectedDay, setSelectedDay] = useState(today);
  const [mode, setMode] = useState<AvailabilityMode>("FULL_AVAILABLE");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("12:00");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const monthDays = useMemo(() => calendarDays(month), [month]);
  const recordsByDay = useMemo(() => new Map(monthDays.map((day) => [day, recordsOnCalendarDay(records, day) as AvailabilityRecord[]])), [monthDays, records]);
  const selectedRecords = recordsByDay.get(selectedDay) ?? [];
  const selectedState = availabilityDayState(selectedRecords, selectedDay);

  function shiftMonth(offset: number) {
    const value = new Date(`${month}-01T12:00:00Z`);
    value.setUTCMonth(value.getUTCMonth() + offset);
    setMonth(value.toISOString().slice(0, 7));
  }

  function selectDay(key: string) {
    const dayRecords = recordsByDay.get(key) ?? [];
    const partial = dayRecords.find((record) => record.kind === "AVAILABLE" && !isFullCalendarDay(record));
    setSelectedDay(key);
    setMode(inferredMode(dayRecords));
    if (partial) { setStartTime(calendarClock(partial.startAt)); setEndTime(calendarClock(partial.endAt)); }
    setMessage("");
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fullDay = mode !== "WINDOW";
    const startAt = beijingCalendarDateTime(selectedDay, fullDay ? "00:00" : startTime);
    const endAt = beijingCalendarDateTime(fullDay ? shiftCalendarDay(selectedDay, 1) : selectedDay, fullDay ? "00:00" : endTime);
    setSubmitting(true);
    const response = await fetch("/api/referees/availability", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        startAt,
        endAt,
        kind: mode === "FULL_UNAVAILABLE" ? "UNAVAILABLE" : "AVAILABLE",
        competitionType: form.get("competitionType"),
        note: form.get("note"),
      }),
    });
    const result = (await response.json()) as { error?: string };
    setMessage(response.ok ? "可执裁时间已保存。指定日期仍可继续添加其他时段。" : result.error ?? "保存失败。");
    setSubmitting(false);
    if (response.ok) router.refresh();
  }

  async function remove(id: string) {
    const response = await fetch("/api/referees/availability", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    const result = (await response.json()) as { error?: string };
    setMessage(response.ok ? "记录已删除。" : result.error ?? "删除失败。");
    if (response.ok) router.refresh();
  }

  return <div className="referee-availability-layout">
    <section className="referee-calendar" aria-label="可执裁时间月历">
      <header><button aria-label="上个月" onClick={() => shiftMonth(-1)} type="button">←</button><div><span>MONTH VIEW</span><h2>{Number(month.slice(0, 4))} 年 {Number(month.slice(5))} 月</h2></div><button aria-label="下个月" onClick={() => shiftMonth(1)} type="button">→</button></header>
      <div aria-label="状态图例" className="referee-calendar-legend">{(["available", "unavailable", "window", "unset"] as const).map((state) => <span data-state={state} key={state}><i aria-hidden="true" />{stateLabels[state]}</span>)}</div>
      <p>日期和时间均按北京时间（UTC+8）填写及展示。</p>
      <div className="referee-calendar-weekdays">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>周{day}</span>)}</div>
      <div className="referee-calendar-grid">{monthDays.map((day) => {
        const key = day;
        const state = availabilityDayState(recordsByDay.get(key) ?? [], key);
        return <button aria-label={`${key}，${stateLabels[state]}`} aria-pressed={key === selectedDay} data-current-month={key.startsWith(month)} data-state={state} key={key} onClick={() => selectDay(key)} type="button"><strong>{Number(key.slice(8))}</strong><small><i aria-hidden="true" />{stateLabels[state]}</small></button>;
      })}</div>
    </section>
    <section className="referee-availability-editor">
      <header><div><span>已选日期</span><h2>{selectedDay}</h2></div><strong data-state={selectedState}>{stateLabels[selectedState]}</strong></header>
      <form className="referee-form" onSubmit={save}>
        <fieldset className="referee-status-options"><legend>选择当天状态</legend>{modeOptions.map((option) => <label data-selected={mode === option.value} key={option.value}><input checked={mode === option.value} name="availabilityMode" onChange={() => setMode(option.value)} type="radio" value={option.value} /><i aria-hidden="true">{option.icon}</i><span><strong>{option.label}</strong><small>{option.description}</small></span></label>)}</fieldset>
        {mode === "WINDOW" ? <fieldset className="referee-time-window"><legend>可执裁时段</legend><label><span>开始</span><input name="start" onChange={(event) => setStartTime(event.target.value)} required type="time" value={startTime} /></label><label><span>结束</span><input name="end" onChange={(event) => setEndTime(event.target.value)} required type="time" value={endTime} /></label></fieldset> : null}
        <div className="referee-editor-fields"><label><span>比赛制式</span><select name="competitionType"><option value="BOTH">十一人制与五人制均可</option><option value="ELEVEN_A_SIDE">仅十一人制</option><option value="FUTSAL">仅五人制</option></select></label><label><span>说明（选填）</span><input maxLength={240} name="note" placeholder="例如：需提前确认交通安排" /></label></div>
        <button disabled={submitting} type="submit">{submitting ? "保存中…" : "保存此日期"}</button>
      </form>
      <div className="referee-day-records"><header><h3>已保存记录</h3><span>{selectedRecords.length} 条</span></header>{selectedRecords.length ? selectedRecords.map((record) => <article key={record.id}><div><strong>{record.kind === "AVAILABLE" ? isFullCalendarDay(record) ? "整天可执裁" : "指定时段可执裁" : isFullCalendarDay(record) ? "整天不可执裁" : "指定时段不可执裁"}</strong><span>{availabilityDayTime(record, selectedDay)} · {record.competitionFormat === null ? "两种制式" : record.competitionFormat === "ELEVEN_A_SIDE" ? "十一人制" : record.competitionFormat === "FUTSAL" ? "五人制" : "无预设模板"}</span>{record.note ? <p>{record.note}</p> : null}</div><button aria-label={`删除${record.kind === "AVAILABLE" ? "可执裁" : "不可执裁"}记录`} onClick={() => void remove(record.id)} type="button">删除</button></article>) : <div className="referee-day-empty"><strong>这一天尚未设置</strong><p>选择上方状态并保存后，管理员选派时会看到对应提示。</p></div>}</div>
      <p aria-live="polite" className="referee-form-message">{message}</p>
    </section>
  </div>;
}
