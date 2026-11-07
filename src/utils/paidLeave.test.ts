/**
 * 年次有給休暇の残り（paidLeave.ts）のテスト
 * 実行方法: bun test
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { DB_SCHEMAS } from "../types/dbSchema";
import {
  collectLeaveTaken,
  defaultExpiryDate,
  formatLeaveMinutes,
  formatTakenAmount,
  isAnnualLeaveGrant,
  leaveHoursPerDay,
  loadPaidLeaveData,
  summarizePaidLeave,
  type LeaveGrantRow,
  type LeaveTaken,
} from "./paidLeave";

const grant = (id: number, grantDate: string, days: number, name = "法定有給"): LeaveGrantRow => ({
  id,
  name,
  grant_date: grantDate,
  expiry_date: defaultExpiryDate(grantDate),
  days_granted: days,
});
const full = (date: string): LeaveTaken => ({ date, days: 1, hours: 0, source: "attendance" });
const half = (date: string): LeaveTaken => ({ date, days: 0.5, hours: 0, source: "attendance" });
const hours = (date: string, h: number): LeaveTaken => ({ date, days: 0, hours: h, source: "attendance" });
const DAY = 8 * 60;

describe("年次有給休暇の付与か", () => {
  test("名前が「法定有給」か空なら年次有給休暇、夏季休暇などは違う", () => {
    expect(isAnnualLeaveGrant({ name: "法定有給" })).toBe(true);
    expect(isAnnualLeaveGrant({ name: " 法定有給 " })).toBe(true);
    expect(isAnnualLeaveGrant({ name: "" })).toBe(true);
    expect(isAnnualLeaveGrant({ name: null })).toBe(true);
    expect(isAnnualLeaveGrant({ name: "夏季休暇" })).toBe(false);
    expect(isAnnualLeaveGrant({ name: "特別休暇" })).toBe(false);
  });
});

describe("時間単位の有給の1日の時間数（労基則24条の4：1日の所定労働時間を下回らない）", () => {
  test("1時間に満たない端数は切り上げる", () => {
    expect(leaveHoursPerDay(8)).toEqual({ hours: 8, assumed: false });
    expect(leaveHoursPerDay(7.5)).toEqual({ hours: 8, assumed: false });
    expect(leaveHoursPerDay(7 + 20 / 60)).toEqual({ hours: 8, assumed: false });
    expect(leaveHoursPerDay(6)).toEqual({ hours: 6, assumed: false });
    expect(leaveHoursPerDay("4")).toEqual({ hours: 4, assumed: false });
  });
  test("所定労働時間が入っていないときは8時間とし、そう知らせる", () => {
    expect(leaveHoursPerDay(0)).toEqual({ hours: 8, assumed: true });
    expect(leaveHoursPerDay(null)).toEqual({ hours: 8, assumed: true });
    expect(leaveHoursPerDay(undefined)).toEqual({ hours: 8, assumed: true });
  });
});

describe("有効期限の初めの値（付与日から2年。労働基準法115条）", () => {
  test("2年後の応当日の前日", () => {
    expect(defaultExpiryDate("2024-04-01")).toBe("2026-03-31");
    expect(defaultExpiryDate("2025-03-01")).toBe("2027-02-28");
    expect(defaultExpiryDate("2023-02-28")).toBe("2025-02-27");
    expect(defaultExpiryDate("2026-10-15")).toBe("2028-10-14");
  });
  test("2月29日の付与は、2年後に応当日がないので2月の末日", () => {
    expect(defaultExpiryDate("2024-02-29")).toBe("2026-02-28");
  });
  test("日付でないときは空", () => {
    expect(defaultExpiryDate("")).toBe("");
  });
});

describe("残りの出し方", () => {
  test("日と時間で出す（半日ちょうどは 0.5日）", () => {
    expect(formatLeaveMinutes(0, 8)).toBe("0日");
    expect(formatLeaveMinutes(10 * DAY, 8)).toBe("10日");
    expect(formatLeaveMinutes(9 * DAY + 240, 8)).toBe("9.5日");
    expect(formatLeaveMinutes(9 * DAY + 300, 8)).toBe("9日と5時間");
    expect(formatLeaveMinutes(120, 8)).toBe("2時間");
    expect(formatLeaveMinutes(2 * DAY + 90, 8)).toBe("2日と1時間30分");
    expect(formatLeaveMinutes(210, 7)).toBe("0.5日");
    expect(formatLeaveMinutes(-30, 8)).toBe("0日");
  });
  test("取った日の日数", () => {
    expect(formatTakenAmount({ days: 1, hours: 0 })).toBe("1日");
    expect(formatTakenAmount({ days: 0.5, hours: 0 })).toBe("0.5日");
    expect(formatTakenAmount({ days: 0, hours: 3 })).toBe("3時間");
    expect(formatTakenAmount({ days: 0.5, hours: 2 })).toBe("0.5日と2時間");
    expect(formatTakenAmount({ days: 0, hours: 1.5 })).toBe("1時間30分");
  });
});

describe("有給を取った日（勤怠と前の記録）", () => {
  const attendance = [
    { work_date: "2026-05-01", work_type: "paid_full", paid_leave_hours: 0 },
    { work_date: "2026-05-02", work_type: "paid_half", paid_leave_hours: 0 },
    { work_date: "2026-05-07", work_type: "normal", paid_leave_hours: 2 },
    { work_date: "2026-05-08", work_type: "normal", paid_leave_hours: 0 },
    { work_date: "2026-05-09", work_type: "holiday", paid_leave_hours: null },
  ];
  test("勤怠の全休・半休・時間有給を数える", () => {
    const { taken } = collectLeaveTaken(attendance, []);
    expect(taken).toEqual([
      { date: "2026-05-01", days: 1, hours: 0, source: "attendance" },
      { date: "2026-05-02", days: 0.5, hours: 0, source: "attendance" },
      { date: "2026-05-07", days: 0, hours: 2, source: "attendance" },
    ]);
  });
  test("前に有給の画面で記録した取得は、その日に確定した勤怠がないときだけ数える", () => {
    const manual = [
      { id: 11, usage_date: "2026-05-01", days_used: 1 },   // 勤怠にも有給 → 勤怠のほうを数える
      { id: 12, usage_date: "2026-05-08", days_used: 1 },   // 勤怠では出勤 → 数えない
      { id: 13, usage_date: "2026-05-09", days_used: 0.5 }, // 勤怠では公休 → 数えない
      { id: 14, usage_date: "2026-04-20", days_used: 1 },   // 勤怠がない → 数える
      { id: 15, usage_date: "2026-04-21", days_used: 0 },   // 0日 → 数えない
    ];
    const { taken, manualChecks } = collectLeaveTaken(attendance, manual);
    expect(taken.map((t) => [t.date, t.source])).toEqual([
      ["2026-04-20", "manual"],
      ["2026-05-01", "attendance"],
      ["2026-05-02", "attendance"],
      ["2026-05-07", "attendance"],
    ]);
    expect(taken[0].manualId).toBe(14);
    expect(manualChecks.map((c) => [c.record.id, c.counted])).toEqual([
      [11, false], [12, false], [13, false], [14, true], [15, false],
    ]);
    expect(manualChecks[0].reason).toBe("勤怠にもこの日の有給が入っているので、勤怠のほうを数えています。");
    expect(manualChecks[1].reason).toBe("勤怠ではこの日が「出勤（平日）」になっているので、数えていません。");
    expect(manualChecks[2].reason).toBe("勤怠ではこの日が「公休」になっているので、数えていません。");
  });
});

describe("年次有給休暇の残り", () => {
  test("有効期限が過ぎた付与は数えない（いままでは足していた）", () => {
    // 2024年4月1日に10日、2025年4月1日に11日。1日も使っていない
    const s = summarizePaidLeave([grant(2, "2025-04-01", 11), grant(1, "2024-04-01", 10)], [], 8, "2026-11-07");
    expect(s.remainingMinutes).toBe(11 * DAY);
    expect(formatLeaveMinutes(s.remainingMinutes, 8)).toBe("11日");
    expect(s.grants.map((g) => [g.grant.id, g.state, g.remainingMinutes, g.expiredMinutes])).toEqual([
      [2, "active", 11 * DAY, 0],
      [1, "expired", 0, 10 * DAY],
    ]);
  });

  test("勤怠で入れた有給で減る（いままでは有給の画面でも記録しないと減らなかった）", () => {
    const s = summarizePaidLeave(
      [grant(1, "2026-04-01", 10)],
      [full("2026-05-01"), full("2026-06-01"), full("2026-07-01")],
      8, "2026-11-07");
    expect(formatLeaveMinutes(s.remainingMinutes, 8)).toBe("7日");
    expect(s.grants[0].usedMinutes).toBe(3 * DAY);
  });

  test("期限の早い付与（古い付与）から引き、使い残しが期限で消える", () => {
    const grants = [grant(2, "2025-04-01", 11), grant(1, "2024-04-01", 10)];
    const taken = [full("2025-05-01")];
    const may = summarizePaidLeave(grants, taken, 8, "2025-06-01");
    expect(may.taken[0].allocations).toEqual([{ grantId: 1, minutes: DAY }]);
    expect(formatLeaveMinutes(may.remainingMinutes, 8)).toBe("20日");
    const after = summarizePaidLeave(grants, taken, 8, "2026-04-01");
    expect(formatLeaveMinutes(after.remainingMinutes, 8)).toBe("11日");
    expect(after.grants[1].expiredMinutes).toBe(9 * DAY);
  });

  test("1つの付与で足りない分は、次に期限の早い付与から引く", () => {
    const s = summarizePaidLeave(
      [grant(1, "2024-04-01", 0.5), grant(2, "2025-04-01", 11)],
      [full("2025-06-02")],
      8, "2025-07-01");
    expect(s.taken[0].allocations).toEqual([{ grantId: 1, minutes: 240 }, { grantId: 2, minutes: 240 }]);
    expect(formatLeaveMinutes(s.remainingMinutes, 8)).toBe("10.5日");
  });

  test("付与日より前に取った日は、その付与から引かない（いままでは引いていた）", () => {
    // 前の付与は 0.5日しか残っていない。2026年10月1日の付与は、9月15日にはまだない
    const s = summarizePaidLeave(
      [grant(1, "2025-04-01", 0.5), grant(2, "2026-10-01", 11)],
      [full("2026-09-15")],
      8, "2026-11-07");
    expect(s.taken[0].allocations).toEqual([{ grantId: 1, minutes: 240 }]);
    expect(s.taken[0].shortageMinutes).toBe(240);
    expect(formatLeaveMinutes(s.remainingMinutes, 8)).toBe("11日");
  });

  test("残りが足りない日は、足りない分を知らせる（いままでは「記録しました」と出していた）", () => {
    const s = summarizePaidLeave([grant(1, "2026-04-01", 1)], [half("2026-05-01"), full("2026-05-02")], 8, "2026-11-07");
    expect(s.taken.map((t) => t.shortageMinutes)).toEqual([0, 240]);
    expect(s.remainingMinutes).toBe(0);
  });

  test("最初の付与より前の有給は、Q で有給を管理する前の分として引かない", () => {
    const s = summarizePaidLeave([grant(1, "2026-10-01", 10)], [full("2026-09-15")], 8, "2026-11-07");
    expect(s.firstGrantDate).toBe("2026-10-01");
    expect(s.taken[0]).toMatchObject({ beforeFirstGrant: true, shortageMinutes: 0, allocations: [] });
    expect(formatLeaveMinutes(s.remainingMinutes, 8)).toBe("10日");
  });

  test("付与が登録されていなければ、残りを数えない（ほかで有給を管理している会社）", () => {
    const s = summarizePaidLeave([], [full("2026-05-01")], 8, "2026-11-07");
    expect(s.hasGrants).toBe(false);
    expect(s.taken[0]).toMatchObject({ beforeFirstGrant: true, shortageMinutes: 0 });
  });

  test("時間単位の有給は、1日の所定労働時間で1日と数える（いままでは、いつも8時間で1日）", () => {
    // 1日6時間の人が6時間の時間有給を取ると1日（8時間で割ると0.75日になっていた）
    const six = summarizePaidLeave([grant(1, "2026-04-01", 2)], [hours("2026-05-07", 6)], 6, "2026-11-07");
    expect(formatLeaveMinutes(six.remainingMinutes, 6)).toBe("1日");
    // 1日8時間の人が3時間取ると、10日のうち残りは9日と5時間
    const eight = summarizePaidLeave([grant(1, "2026-04-01", 10)], [hours("2026-05-07", 3)], 8, "2026-11-07");
    expect(formatLeaveMinutes(eight.remainingMinutes, 8)).toBe("9日と5時間");
  });

  test("基準の日より後の日（予定）の有給は、まだ引かない", () => {
    const s = summarizePaidLeave([grant(1, "2026-04-01", 10)], [full("2026-11-01"), full("2026-12-01")], 8, "2026-11-07");
    expect(formatLeaveMinutes(s.remainingMinutes, 8)).toBe("9日");
    expect(s.grants[0]).toMatchObject({ usedMinutes: DAY, laterMinutes: DAY });
    expect(s.taken.map((t) => t.afterAsOf)).toEqual([false, true]);
  });

  test("有効期限の日までは使え、次の日から期限切れ", () => {
    const g = grant(1, "2024-04-01", 10); // 2026-03-31 まで
    const onLastDay = summarizePaidLeave([g], [full("2026-03-31")], 8, "2026-03-31");
    expect(onLastDay.taken[0].allocations).toEqual([{ grantId: 1, minutes: DAY }]);
    expect(onLastDay.grants[0]).toMatchObject({ state: "active", remainingMinutes: 9 * DAY });
    const nextDay = summarizePaidLeave([g], [full("2026-03-31")], 8, "2026-04-01");
    expect(nextDay.grants[0]).toMatchObject({ state: "expired", remainingMinutes: 0, expiredMinutes: 9 * DAY });
    expect(nextDay.remainingMinutes).toBe(0);
  });

  test("付与日の前は、まだ残りに数えない", () => {
    const s = summarizePaidLeave([grant(1, "2026-12-01", 10)], [], 8, "2026-11-07");
    expect(s.grants[0]).toMatchObject({ state: "upcoming", remainingMinutes: 0 });
    expect(s.remainingMinutes).toBe(0);
  });

  test("夏季休暇などの付与は、有給の残りに足さない（いままでは足していた）", () => {
    const s = summarizePaidLeave(
      [grant(1, "2026-04-01", 10), grant(2, "2026-07-01", 3, "夏季休暇")],
      [full("2026-08-10")],
      8, "2026-11-07");
    expect(s.grants.map((g) => g.grant.id)).toEqual([1]);
    expect(formatLeaveMinutes(s.remainingMinutes, 8)).toBe("9日");
    expect(summarizePaidLeave([grant(2, "2026-07-01", 3, "夏季休暇")], [], 8, "2026-11-07").hasGrants).toBe(false);
  });
});

describe("会社ファイルの表から読む（loadPaidLeaveData）", () => {
  test("付与・確定した勤怠・前の記録を読み、確定していない勤怠とほかの人の記録は読まない", async () => {
    const db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    for (const schema of DB_SCHEMAS) db.exec(schema);
    db.exec("INSERT INTO calendar_patterns (id, name) VALUES (1, '標準')");
    db.exec("INSERT INTO payroll_groups (id, name, closing_day, is_next_month, payment_day) VALUES (1, '全社共通規定', 99, 0, 25)");
    db.exec("INSERT INTO social_insurance_groups (id, name) VALUES (1, '協会けんぽ')");
    for (const id of ["S001", "S002"]) {
      db.prepare("INSERT INTO staff (id, name, base_wage) VALUES (?, ?, 1200)").run(id, `従業員${id}`);
    }
    const addGrant = db.prepare("INSERT INTO paid_leave_grants (staff_id, name, grant_date, expiry_date, days_granted, days_used) VALUES (?, ?, ?, ?, ?, ?)");
    addGrant.run("S001", "法定有給", "2025-04-01", "2027-03-31", 11, 5); // days_used（前の画面の数）は使わない
    addGrant.run("S001", "夏季休暇", "2026-07-01", "2028-06-30", 3, 0);
    addGrant.run("S002", "法定有給", "2025-04-01", "2027-03-31", 20, 0);
    const addDay = db.prepare("INSERT INTO attendance (staff_id, work_date, work_type, paid_leave_hours, is_finalized) VALUES (?, ?, ?, ?, ?)");
    addDay.run("S001", "2026-05-01", "paid_full", 0, 1);
    addDay.run("S001", "2026-05-02", "paid_half", 0, 0); // 確定していない → 勤怠としては数えない
    addDay.run("S001", "2026-05-07", "normal", 2, 1);
    addDay.run("S001", "2026-05-08", "normal", 0, 1);
    addDay.run("S002", "2026-05-01", "paid_full", 0, 1);
    const addManual = db.prepare("INSERT INTO paid_leave_usage (staff_id, usage_date, days_used) VALUES (?, ?, ?)");
    addManual.run("S001", "2026-05-08", 1);   // 勤怠では出勤 → 数えない
    addManual.run("S001", "2026-04-20", 1);   // 勤怠がない → 数える
    addManual.run("S001", "2026-05-02", 0.5); // 確定した勤怠がない → 数える

    const sqlDb = { select: async (sql: string, params: unknown[] = []) => db.query(sql).all(...(params as string[])) };
    const loaded = await loadPaidLeaveData(sqlDb, "S001");
    expect(loaded.grants.map((g) => [g.name, g.grant_date])).toEqual([["夏季休暇", "2026-07-01"], ["法定有給", "2025-04-01"]]);
    expect(loaded.attendance.map((a) => a.work_date).sort()).toEqual(["2026-05-01", "2026-05-07", "2026-05-08"]);
    expect(loaded.manual.map((m) => m.usage_date)).toEqual(["2026-05-08", "2026-05-02", "2026-04-20"]);

    const { taken, manualChecks } = collectLeaveTaken(loaded.attendance, loaded.manual);
    expect(taken.map((t) => [t.date, t.source, formatTakenAmount(t)])).toEqual([
      ["2026-04-20", "manual", "1日"],
      ["2026-05-01", "attendance", "1日"],
      ["2026-05-02", "manual", "0.5日"],
      ["2026-05-07", "attendance", "2時間"],
    ]);
    expect(manualChecks.filter((c) => !c.counted).map((c) => c.record.usage_date)).toEqual(["2026-05-08"]);
    const s = summarizePaidLeave(loaded.grants, taken, 8, "2026-11-07");
    expect(formatLeaveMinutes(s.remainingMinutes, 8)).toBe("8日と2時間");
  });
});
