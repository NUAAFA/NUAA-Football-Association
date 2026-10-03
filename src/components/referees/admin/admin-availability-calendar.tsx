"use client";

import { useEffect, useMemo, useState } from "react";
import { WorkspaceDialog } from "@/components/admin/workspace-dialog";
import {
  availabilityCalendarLabels, availabilityDayState, availabilityDayTime, beijingDateKey,
  calendarDays, recordsOnCalendarDay, type CalendarAvailabilityRecord,
} from "@/lib/referee-availability-calendar";
import styles from "./admin-availability-calendar.module.css";

type CalendarDetail = { month: string; records: CalendarAvailabilityRecord[] };
export function AdminAvailabilityCalendar({ referee, initialDay, onClose, onDelete }: {
  referee: { id: string; name: string; publicCode: string };
  initialDay: string;
  onClose: () => void;
  onDelete: (record: CalendarAvailabilityRecord) => Promise<boolean>;
}) {
  const today = beijingDateKey(new Date());
  const [selectedDay, setSelectedDay] = useState(initialDay || today);
  const [month, setMonth] = useState((initialDay || today).slice(0, 7));
  const [detail, setDetail] = useState<CalendarDetail | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [deleting, setDeleting] = useState("");
  const [message, setMessage] = useState("");
  const days = useMemo(() => calendarDays(month), [month]);
  const loading = detail?.month !== month && !error;
  const recordsByDay = useMemo(() => new Map(days.map((day) => [day, recordsOnCalendarDay(detail?.records ?? [], day)])), [days, detail]);
  const selectedRecords = recordsByDay.get(selectedDay) ?? [];
  const state = availabilityDayState(selectedRecords, selectedDay);
  const monthFilledDays = days.filter((day) => day.startsWith(month) && recordsByDay.get(day)?.length).length;

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/referees/admin/availability/${referee.id}?${new URLSearchParams({ month })}`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "读取失败。");
        if (!controller.signal.aborted) { setDetail(result); setError(""); }
      })
      .catch((e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "读取失败。"); });
    return () => controller.abort();
  }, [referee.id, month, revision]);

  function changeMonth(value: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return;
    setMonth(value); setSelectedDay(value === today.slice(0, 7) ? today : `${value}-01`);
    setDetail(null); setError(""); setMessage("");
  }
  function shiftMonth(offset: number) {
    const value = new Date(`${month}-01T12:00:00Z`);
    value.setUTCMonth(value.getUTCMonth() + offset);
    changeMonth(value.toISOString().slice(0, 7));
  }
  async function remove(record: CalendarAvailabilityRecord) {
    setDeleting(record.id); setMessage("");
    try {
      if (await onDelete(record)) { setDetail(null); setRevision((value) => value + 1); setMessage("记录已删除。"); }
      else setMessage("删除失败，请稍后重试。");
    } finally { setDeleting(""); }
  }

  return <WorkspaceDialog title={`${referee.name} · 可执裁时间`} onClose={onClose} busy={Boolean(deleting)} className={styles.dialog}>
    <div className={styles.toolbar}>
      <p>{referee.publicCode} · 时间按北京时间展示{!loading && !error ? ` · 本月已填写 ${monthFilledDays} 天` : ""}</p>
      <label>跳转月份 <input aria-label="跳转月份" type="month" value={month} disabled={Boolean(deleting)} onChange={(event) => changeMonth(event.target.value)} /></label>
      <button className="admin-button admin-button-secondary" type="button" disabled={Boolean(deleting)} onClick={() => { changeMonth(today.slice(0, 7)); setSelectedDay(today); }}>本月</button>
    </div>
    <div className={styles.layout}>
      <section className={`referee-calendar ${styles.calendar}`} aria-label="可执裁时间月历" aria-busy={loading}>
        <header><button aria-label="上个月" type="button" disabled={Boolean(deleting)} onClick={() => shiftMonth(-1)}>←</button><div><span>MONTH VIEW</span><h3>{Number(month.slice(0, 4))} 年 {Number(month.slice(5))} 月</h3></div><button aria-label="下个月" type="button" disabled={Boolean(deleting)} onClick={() => shiftMonth(1)}>→</button></header>
        <div aria-label="状态图例" className="referee-calendar-legend">{Object.entries(availabilityCalendarLabels).map(([key, label]) => <span data-state={key} key={key}><i aria-hidden="true" />{label}</span>)}</div>
        <p className={styles.hint}>指定时段表示当天只设置了部分时间；点击日期查看具体安排。</p>
        <div className="referee-calendar-weekdays">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>周{day}</span>)}</div>
        <div className="referee-calendar-grid">{days.map((day) => {
          const records = recordsByDay.get(day) ?? [];
          const status = availabilityDayState(records, day);
          const label = loading || error ? "待加载" : availabilityCalendarLabels[status];
          return <button key={day} type="button" aria-label={`${day}，${label}`} aria-pressed={day === selectedDay} data-current-month={day.startsWith(month)} data-state={loading || error ? undefined : status} disabled={loading || Boolean(error) || Boolean(deleting)} onClick={() => { setSelectedDay(day); setMessage(""); }}><strong>{Number(day.slice(8))}</strong><small><i aria-hidden="true" />{label}</small></button>;
        })}</div>
      </section>
      <section className={styles.dayDetail} aria-label="当日时间记录" aria-live="polite">
        <header><div><span>已选日期</span><h3>{selectedDay}</h3></div>{!loading && !error ? <strong data-state={state}>{availabilityCalendarLabels[state]}</strong> : null}</header>
        {loading ? <p role="status">正在读取本月时间记录…</p> : error ? <div role="alert"><p>{error}</p><button className="admin-button admin-button-secondary" type="button" onClick={() => { setError(""); setDetail(null); setRevision((value) => value + 1); }}>重新加载</button></div> : <>
          <p className={styles.hint}>{selectedRecords.length} 条记录 · 未设置不代表可执裁</p>
          {selectedRecords.length ? selectedRecords.map((record) => <article key={record.id} className={styles.record}>
            <div><strong className="admin-status-badge" data-status={record.kind}>{record.kind === "AVAILABLE" ? "可执裁" : "不可执裁"}</strong><h4>{availabilityDayTime(record, selectedDay)}</h4><small>{record.competitionFormat === "FUTSAL" ? "五人制" : record.competitionFormat === "ELEVEN_A_SIDE" ? "十一人制" : record.competitionFormat === "CUSTOM" ? "无预设模板" : "两种制式均可"}</small>{record.note ? <p>{record.note}</p> : null}</div>
            <button className="admin-button admin-button-danger admin-button-danger-quiet" aria-label={`删除${availabilityDayTime(record, selectedDay)}${record.kind === "AVAILABLE" ? "可执裁" : "不可执裁"}记录`} type="button" disabled={Boolean(deleting)} onClick={() => void remove(record)}>{deleting === record.id ? "删除中…" : "删除"}</button>
          </article>) : <div className="admin-empty-state"><strong>这一天尚未设置</strong><p>该裁判员没有填写当天的可执裁时间。</p></div>}
        </>}
        <p role="status" className="admin-form-message">{message}</p>
      </section>
    </div>
  </WorkspaceDialog>;
}
