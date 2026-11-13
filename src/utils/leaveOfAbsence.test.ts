/**
 * 休業・休職の日の数え方（utils/leaveOfAbsence.ts）。給与の計算は calcSalary.test.ts、出勤率は annualLeaveGrant.test.ts、
 * 支払基礎日数は santei.test.ts、出勤簿は legalBooks.test.ts
 */
import { describe, expect, test } from "bun:test";
import { countNonLeaveWorkDays, employedRangeOf, hasWorkRecord, leaveByDate, leaveOn, periodLeaveOf, toLeaveProrationMethod } from "./leaveOfAbsence";
import { parseWorkDays, type CalendarContext } from "./annualWorkDays";
import { stringifyLeavePeriods, type LeavePeriod } from "./leaveExemption";

const JUNE = { start: "2026-06-01", end: "2026-06-30" }; // 2026年6月：1日が月曜、平日22日
const ctx: CalendarContext = { patternId: 0, workDays: parseWorkDays("mon,tue,wed,thu,fri"), holidays: new Set(), companyCalendar: {} };
const staffWith = (leaves: LeavePeriod[], o: Record<string, unknown> = {}) => ({ join_date: "2020-04-01", leave_periods: stringifyLeavePeriods(leaves), ...o });

describe("休業の日", () => {
  test("その日の休業（終了日が空なら、ずっと続く。入力の誤りがある期間は使わない）", () => {
    const leaves: LeavePeriod[] = [
      { type: "childcare", start: "2026-06-10", end: "2026-06-20" },
      { type: "other", start: "2026-06-25", end: "" },
      { type: "family_care", start: "2026-06-05", end: "2026-06-01" }, // 終了日が開始日より前
    ];
    expect(leaveOn(leaves, "2026-06-09")).toBeNull();
    expect(leaveOn(leaves, "2026-06-10")?.type).toBe("childcare");
    expect(leaveOn(leaves, "2026-06-20")?.type).toBe("childcare");
    expect(leaveOn(leaves, "2027-01-01")?.type).toBe("other");
    expect(leaveOn(leaves, "2026-06-03")).toBeNull();
    expect(Object.keys(leaveByDate(staffWith(leaves), ["2026-06-09", "2026-06-10", "2026-06-30"]))).toEqual(["2026-06-10", "2026-06-30"]);
    expect(leaveByDate({ leave_periods: "" }, ["2026-06-10"])).toEqual({});
  });
  test("計算期間の休業：在籍した日のうちの休業の日と、まるごと休業か", () => {
    const part = periodLeaveOf(staffWith([{ type: "childcare", start: "2026-06-16", end: "2027-03-31" }]), JUNE);
    expect(part).toMatchObject({ types: ["childcare"], periodDays: 30, employedDays: 30, allDays: false });
    expect(part?.dates).toHaveLength(15);
    const full = periodLeaveOf(staffWith([{ type: "maternity", start: "2026-05-01", end: "2026-06-10" }, { type: "childcare", start: "2026-06-11", end: "" }]), JUNE);
    expect(full).toMatchObject({ types: ["maternity", "childcare"], allDays: true });
    // 退職した日の後は数えない（6月20日に退職、6月16日から休業 → 在籍20日のうち5日）
    const retired = periodLeaveOf(staffWith([{ type: "other", start: "2026-06-16", end: "" }], { retirement_date: "2026-06-20" }), JUNE);
    expect(retired).toMatchObject({ employedDays: 20, allDays: false });
    expect(retired?.dates).toHaveLength(5);
    expect(periodLeaveOf(staffWith([]), JUNE)).toBeNull();
    expect(periodLeaveOf(staffWith([{ type: "childcare", start: "2026-07-01", end: "" }]), JUNE)).toBeNull();
    expect(periodLeaveOf(staffWith([{ type: "childcare", start: "2026-06-01", end: "" }]), null)).toBeNull();
  });
  test("在籍していて休業していない日の所定労働日数（会社カレンダー）", () => {
    expect(countNonLeaveWorkDays(ctx, staffWith([{ type: "childcare", start: "2026-06-16", end: "" }]), JUNE)).toBe(11);
    expect(countNonLeaveWorkDays(ctx, staffWith([]), JUNE)).toBe(22);
    expect(countNonLeaveWorkDays(ctx, staffWith([{ type: "family_care", start: "2026-06-01", end: "2026-06-30" }]), JUNE)).toBe(0);
    // 6月16日に入社して、6月22日から休業：16〜19日の4日
    expect(countNonLeaveWorkDays(ctx, staffWith([{ type: "injury", start: "2026-06-22", end: "" }], { join_date: "2026-06-16" }), JUNE)).toBe(4);
    expect(employedRangeOf({ join_date: "2026-07-01" }, JUNE)).toBeNull();
  });
  test("働いた記録（働いた時間・時間有給・時間休・休暇の区分）と、日割りの設定の読み方", () => {
    expect(hasWorkRecord({ work_type: "normal", work_hours: 2 })).toBe(true);
    expect(hasWorkRecord({ work_type: "paid_full", work_hours: 0 })).toBe(true);
    expect(hasWorkRecord({ work_type: "normal", work_hours: 0, paid_leave_hours: 1 })).toBe(true);
    expect(hasWorkRecord({ work_type: "absent", work_hours: 0 })).toBe(false);
    expect(hasWorkRecord({ work_type: "holiday", work_hours: 0 })).toBe(false);
    expect([toLeaveProrationMethod(undefined), toLeaveProrationMethod("calendar"), toLeaveProrationMethod("none"), toLeaveProrationMethod("x")])
      .toEqual(["workdays", "calendar", "none", "workdays"]);
  });
});
