import { RefereeApiInputError } from "@/lib/referee-api-input-error";

const beijingPartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function beijingParts(value: Date) {
  const parts = Object.fromEntries(
    beijingPartsFormatter
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
  };
}

export function parseBeijingDateTime(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new RefereeApiInputError(`${label}格式不正确。`);
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u.exec(value);
  if (!match) {
    throw new RefereeApiInputError(`${label}须使用北京时间（UTC+8）。`);
  }
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    throw new RefereeApiInputError(`${label}格式不正确。`);
  }
  const parsed = new Date(Date.UTC(year, month - 1, day, hour - 8, minute));
  const actual = beijingParts(parsed);
  if (
    actual.year !== yearText ||
    actual.month !== monthText ||
    actual.day !== dayText ||
    actual.hour !== hourText ||
    actual.minute !== minuteText
  ) {
    throw new RefereeApiInputError(`${label}不是有效的北京时间。`);
  }
  return parsed;
}

export function formatBeijingDateTime(value: Date | null) {
  if (!value) return { dateLabel: "时间待定", timeLabel: "时间待定", dateTimeLabel: "时间待定" };
  const parts = beijingParts(value);
  const dateLabel = `${parts.year}.${parts.month}.${parts.day}`;
  const timeLabel = `${parts.hour}:${parts.minute}`;
  return {
    dateLabel,
    timeLabel,
    dateTimeLabel: `${dateLabel} ${timeLabel}`,
  };
}

export function formatBeijingDateTimeInput(value: Date | null | undefined) {
  if (!value) return "";
  const parts = beijingParts(value);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function formatBeijingWindow(
  start: Date | null | undefined,
  end: Date | null | undefined,
  fallback: string,
) {
  if (start && end) {
    return `${formatBeijingDateTime(start).dateTimeLabel} - ${formatBeijingDateTime(end).dateTimeLabel}`;
  }
  if (start) return `自 ${formatBeijingDateTime(start).dateTimeLabel} 起`;
  if (end) return `截至 ${formatBeijingDateTime(end).dateTimeLabel}`;
  return fallback;
}
