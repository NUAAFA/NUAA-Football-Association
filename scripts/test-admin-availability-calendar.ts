import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { availabilityDayState, availabilityDayTime, beijingCalendarDateTime, beijingDateKey, calendarDays, isFullCalendarDay, recordsOnCalendarDay } from "../src/lib/referee-availability-calendar";

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "nuaafa-availability-calendar-"));
  process.env.DATABASE_URL = `file:${path.join(root, "test.db")}`;
  process.env.NUAAFA_UPLOAD_DIR = path.join(root, "uploads");
  await writeFile(path.join(root, "test.db"), "");
  const migration = spawnSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], { env: process.env, encoding: "utf8" });
  assert.equal(migration.status, 0, migration.stdout + migration.stderr);
  const { prisma } = await import("../src/lib/prisma");
  const { getAdminAvailabilityCalendar, getAdminAvailabilityDetail } = await import("../src/lib/admin-availability-page");
  try {
    const referee = await prisma.referee.create({ data: { publicCode: "001", name: "月历验收裁判" } });
    const other = await prisma.referee.create({ data: { publicCode: "002", name: "另一位裁判" } });
    const archived = await prisma.referee.create({ data: { publicCode: "003", name: "已归档裁判", status: "ARCHIVED" } });
    for (let i = 1; i <= 25; i++) {
      const day = `2026-10-${String(i).padStart(2, "0")}`;
      const next = `2026-10-${String(i + 1).padStart(2, "0")}`;
      await prisma.refereeAvailability.create({ data: { refereeId: referee.id, kind: i % 2 ? "AVAILABLE" : "UNAVAILABLE", startAt: new Date(`${day}T00:00:00+08:00`), endAt: new Date(`${next}T00:00:00+08:00`) } });
    }
    const crossDay = await prisma.refereeAvailability.create({ data: { refereeId: referee.id, kind: "AVAILABLE", startAt: new Date("2026-09-27T23:00:00+08:00"), endAt: new Date("2026-09-28T02:00:00+08:00") } });
    const partial = await prisma.refereeAvailability.create({ data: { refereeId: referee.id, kind: "UNAVAILABLE", startAt: new Date("2026-10-03T10:00:00+08:00"), endAt: new Date("2026-10-03T12:00:00+08:00"), competitionFormat: "FUTSAL", note: "上午有课，其他时间可安排" } });
    await prisma.refereeAvailability.create({ data: { refereeId: referee.id, kind: "AVAILABLE", startAt: new Date("2026-12-01T00:00:00+08:00"), endAt: new Date("2026-12-02T00:00:00+08:00") } });
    await prisma.refereeAvailability.create({ data: { refereeId: other.id, kind: "UNAVAILABLE", startAt: new Date("2026-10-01T00:00:00+08:00"), endAt: new Date("2026-10-02T00:00:00+08:00") } });
    const calendar = await getAdminAvailabilityCalendar(referee.id, "2026-10");
    assert(calendar); assert.equal(calendar.records.length, 27);
    assert(calendar.records.every((r) => r.refereeId === referee.id));
    assert.equal((await getAdminAvailabilityDetail(referee.id, {}))?.records.length, 20);
    const records = calendar.records.map((r) => ({ ...r, startAt: r.startAt.toISOString(), endAt: r.endAt.toISOString() }));
    assert.equal(calendarDays("2026-10")[0], "2026-09-28"); assert.equal(calendarDays("2026-10").at(-1), "2026-11-08");
    assert.equal(calendarDays("2028-02").filter((d) => d.startsWith("2028-02")).length, 29);
    assert.equal(beijingDateKey(new Date("2026-10-03T16:30:00Z")), "2026-10-04");
    const day = (key: string) => recordsOnCalendarDay(records, key);
    assert.equal(availabilityDayState(day("2026-10-01"), "2026-10-01"), "available");
    assert.equal(availabilityDayState(day("2026-10-02"), "2026-10-02"), "unavailable");
    assert.equal(availabilityDayState(day("2026-10-03"), "2026-10-03"), "window");
    assert.equal(availabilityDayState(day("2026-10-26"), "2026-10-26"), "unset");
    assert.equal(availabilityDayTime(day("2026-10-01")[0], "2026-10-01"), "全天");
    const segment = (start: string, end: string, kind = "UNAVAILABLE") => ({ id: start, refereeId: referee.id, kind, startAt: `2026-10-10T${start}:00+08:00`, endAt: end === "24:00" ? "2026-10-11T00:00:00+08:00" : `2026-10-10T${end}:00+08:00`, competitionFormat: null, note: null });
    assert.equal(availabilityDayState([segment("00:00", "07:00"), segment("07:00", "24:00")], "2026-10-10"), "unavailable");
    assert.equal(availabilityDayState([segment("07:00", "24:00")], "2026-10-10"), "window");
    assert.equal(availabilityDayState([segment("00:00", "07:00"), segment("07:01", "24:00")], "2026-10-10"), "window");
    assert.equal(availabilityDayState([segment("00:00", "08:00", "AVAILABLE"), segment("08:00", "24:00", "AVAILABLE")], "2026-10-10"), "available");
    const fullDay = { ...segment("00:00", "24:00"), startAt: beijingCalendarDateTime("2026-10-25", "00:00"), endAt: beijingCalendarDateTime("2026-10-26", "00:00") };
    assert.equal(fullDay.startAt, "2026-10-24T16:00:00.000Z");
    assert.equal(Date.parse(fullDay.endAt) - Date.parse(fullDay.startAt), 86400000); // UK DST transition must not turn Beijing all-day into 25 hours.
    assert(isFullCalendarDay(fullDay));
    assert.equal(recordsOnCalendarDay([fullDay], "2026-10-26").length, 0);
    const timezoneCheck = `import assert from 'node:assert/strict'; import {beijingCalendarDateTime,isFullCalendarDay,calendarClock} from './src/lib/referee-availability-calendar.ts'; const r={startAt:beijingCalendarDateTime('2026-10-25','00:00'),endAt:beijingCalendarDateTime('2026-10-26','00:00')}; assert.equal(r.startAt,'2026-10-24T16:00:00.000Z'); assert(isFullCalendarDay(r)); assert.equal(calendarClock(beijingCalendarDateTime('2026-10-25','09:00')),'09:00');`;
    for (const zone of ["Europe/London", "Asia/Shanghai", "America/Los_Angeles"]) {
      const check = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", timezoneCheck], { env: { ...process.env, TZ: zone }, encoding: "utf8" });
      assert.equal(check.status, 0, zone + check.stdout + check.stderr);
    }
    assert.equal(availabilityDayTime(day("2026-09-28")[0], "2026-09-28"), "00:00–02:00");
    assert(!day("2026-09-29").some((r) => r.id === crossDay.id));
    const november = await getAdminAvailabilityCalendar(referee.id, "2026-11");
    assert.equal(november?.records.length, 1); // The 42-day November grid includes December 1.
    assert.equal(beijingDateKey(november!.records[0].startAt), "2026-12-01");
    assert.equal(await getAdminAvailabilityCalendar(archived.id, "2026-10"), null);
    assert.equal(await getAdminAvailabilityCalendar("missing", "2026-10"), null);
    await assert.rejects(() => getAdminAvailabilityCalendar(referee.id, "2026-13"));
    assert(!JSON.stringify(calendar).includes("passwordHash"));
    const { hashPassword } = await import("../src/lib/referee-security");
    const password = "Calendar-Isolated-verify-only!";
    const passwordHash = await hashPassword(password);
    await prisma.referee.update({ where: { id: referee.id }, data: { studentId: "2026000001", passwordHash, mustChangePassword: false } });
    await prisma.adminAccount.create({ data: { username: "calendar-super", displayName: "隔离验收", passwordHash, role: "SUPER_ADMIN" } });
    await prisma.adminAccount.create({ data: { username: "calendar-content", displayName: "无裁判权限", passwordHash, role: "REFEREE_MANAGER", unifiedRoles: { create: { role: "CONTENT_EDITOR" } } } });
    await writeFile(path.join(root, "fixture.json"), JSON.stringify({ root, databaseUrl: process.env.DATABASE_URL, refereeId: referee.id, archivedId: archived.id, partialId: partial.id, password }, null, 2));
    console.log("PASS: complete month, Beijing all-day across 3 timezones and UK DST, continuous coverage/gaps, cross-day boundaries, referee isolation and safe DTO");
    console.log(`ISOLATED_FIXTURE=${root}`);
  } finally { await prisma.$disconnect(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
