/**
 * 所定労働時間（1日の所定労働時間・曜日ごとの時間・その日だけ直した時間）のテスト
 * 実行方法: bun test
 *
 * 2026年11月（11月1日が日曜。3日（火）文化の日・23日（月）勤労感謝の日）で確かめる。
 * 決まり：時給の人の有給の日は「時給 × その日の所定労働時間数」（労働基準法施行規則25条1項1号）、
 * 日給の残業代の時給は「1週間の1日平均所定労働時間数」で割る（19条1項2号）、月給は「1年間の1月平均所定労働時間数」で割る（4号）、
 * 時間単位の有給の1日は「1年間の1日平均所定労働時間数」を下回らない（24条の4）。
 */
import { describe, expect, test } from "bun:test";
import {
  averageDailyHoursOf, dayScheduledHours, describeWeekdayHours, hasWeekdayHours, hoursText, parseHoursText, parseWeekdayHours,
  scheduledHoursMissing, stringifyWeekdayHours, sumScheduledHours, weeklyScheduledHoursOf,
} from "./scheduledHours";
import { parseWorkDays, type CalendarContext } from "./annualWorkDays";
import { calculateSalary, tardyDeductionOf, type SalaryExtras } from "./calcSalary";
import { workScaleOf } from "./annualLeaveGrant";
import { weeklyMinutesOf } from "./koyoInfo";
import { laborDefaults, type LaborContext } from "./laborConditions";
import { leaveHoursPerDay } from "./paidLeave";
import { isPartTime, standardDailyHours } from "./maikin";

const company = { week_start_day: 0, round_overtime: "round", round_social_ins: "currency_law", round_emp_ins: "currency_law" };
const extras = (o: Partial<SalaryExtras> = {}): SalaryExtras => ({
  allowanceName: "", allowanceAmount: 0, residentTax: 0, prefecture: "東京", dependents: 0, customItems: [], ...o,
});
const day = (date: string, hours: number, type = "normal", o: Record<string, unknown> = {}) =>
  ({ work_date: `2026-11-${date}`, work_hours: hours, night_hours: 0, work_type: type, ...o });

/** パート：時給 1,200円・契約曜日 月・水・金・1日の所定労働時間4時間・水曜は6時間 */
const part = {
  wage_type: "hourly", base_wage: 1200, scheduled_work_hours: 4, weekday_hours: JSON.stringify({ wed: 6 }),
  calendar_pattern_id: 0, work_days: "mon,wed,fri",
  commute_type: "none", commute_amount: 0, standard_remuneration: 0, birthday: "1980-01-10", is_employment_ins_eligible: 0,
};
/** 正社員：月給 300,000円・会社カレンダー・1日8時間・土曜（会社カレンダーで出勤の日）は4時間 */
const fullTime = {
  wage_type: "monthly", base_wage: 300000, scheduled_work_hours: 8, weekday_hours: JSON.stringify({ sat: 4 }),
  calendar_pattern_id: 1, work_days: "sat",
  commute_type: "none", commute_amount: 0, standard_remuneration: 300000, birthday: "1990-06-15",
};

describe("曜日ごとの時間の読み書きと、入力欄の字", () => {
  test("曜日ごとの時間（JSON）：使えない値（0・24時間超・ほかのキー）は入れず、日曜から順に保存する", () => {
    expect(parseWeekdayHours(JSON.stringify({ wed: 6, mon: "4.5", sun: 0, xxx: 3, sat: 30 }))).toEqual({ mon: 4.5, wed: 6 });
    expect(parseWeekdayHours("{こわれた")).toEqual({});
    expect(parseWeekdayHours(null)).toEqual({});
    expect(stringifyWeekdayHours({ wed: 6, mon: 4 })).toBe('{"mon":4,"wed":6}');
    expect(stringifyWeekdayHours({})).toBeNull();
  });
  test("入力欄の字：「4:30」「４：３０」「6」は読み、空は直していない、読めない字・0分・24時間を超える時間は読まない", () => {
    expect(hoursText(4.5)).toBe("4:30");
    expect(hoursText(4 + 40 / 60)).toBe("4:40");
    expect(hoursText(null)).toBe("");
    expect(parseHoursText("4:30")).toBe(4.5);
    expect(parseHoursText("４：３０")).toBe(4.5);
    expect(parseHoursText("6")).toBe(6);
    expect(parseHoursText("24")).toBe(24);
    expect(parseHoursText("")).toBeNull();
    for (const bad of ["4:60", "0", "0:00", "24:01", "4時間", "-1"]) expect(parseHoursText(bad)).toBeUndefined();
  });
});

describe("その日の所定労働時間", () => {
  test("勤怠でその日だけ直した時間 → 曜日の時間 → 1日の所定労働時間", () => {
    expect(dayScheduledHours(part, "2026-11-16")).toBe(4); // 月曜
    expect(dayScheduledHours(part, "2026-11-18")).toBe(6); // 水曜
    expect(dayScheduledHours(part, "2026-11-20", 5)).toBe(5); // 金曜をシフトで5時間に直した
    expect(dayScheduledHours(part, "2026-11-20", "")).toBe(4);
    expect(describeWeekdayHours(part)).toBe("水6時間");
    expect(hasWeekdayHours(part)).toBe(true);
    // 曜日の時間が1日の所定労働時間と同じなら、曜日で違わない
    expect(hasWeekdayHours({ scheduled_work_hours: 6, weekday_hours: JSON.stringify({ wed: 6 }) })).toBe(false);
  });
  test("フレックスタイム制の人は、曜日の時間・その日だけ直した時間を使わない（標準となる1日の労働時間）", () => {
    const flex = { ...part, is_flex: 1 };
    expect(dayScheduledHours(flex, "2026-11-18")).toBe(4);
    expect(dayScheduledHours(flex, "2026-11-20", 5)).toBe(4);
    expect(hasWeekdayHours(flex)).toBe(false);
  });
  test("1日の所定労働時間を入れていない人（役員は要らない）", () => {
    expect(scheduledHoursMissing({ scheduled_work_hours: null })).toBe(true);
    expect(scheduledHoursMissing({ scheduled_work_hours: 0 })).toBe(true);
    expect(scheduledHoursMissing({ scheduled_work_hours: 0, is_executive: 1 })).toBe(false);
    expect(scheduledHoursMissing(part)).toBe(false);
    expect(dayScheduledHours({ scheduled_work_hours: null }, "2026-11-16")).toBeNull();
  });
  test("1日平均と1週間の所定労働時間：月・金4時間・水6時間は 14時間 ÷ 3日 ＝ 4時間40分。土曜が半日の正社員は 44時間 ÷ 6日 ＝ 7時間20分", () => {
    expect(hoursText(averageDailyHoursOf(part))).toBe("4:40");
    expect(weeklyScheduledHoursOf(part)).toBe(14);
    expect(hoursText(averageDailyHoursOf(fullTime))).toBe("7:20");
    expect(weeklyScheduledHoursOf(fullTime)).toBe(44);
    // 曜日で違わない人は、1日の所定労働時間そのもの
    expect(averageDailyHoursOf({ scheduled_work_hours: 7.5, calendar_pattern_id: 1 })).toBe(7.5);
    // 時間単位の有給の1日は、1日平均の4時間40分を切り上げて5時間（労基則24条の4）
    expect(leaveHoursPerDay(averageDailyHoursOf(part))).toEqual({ hours: 5, assumed: false });
  });
  test("1年間・計算期間の所定労働時間の合計：所定労働日ごとに、その曜日の時間を足す", () => {
    // 契約曜日（月・水・金）：11月は月曜5日 × 4時間 ＋ 水曜4日 × 6時間 ＋ 金曜4日 × 4時間 ＝ 60時間
    const partCtx: CalendarContext = { patternId: 0, workDays: parseWorkDays("mon,wed,fri"), holidays: new Set(), companyCalendar: {} };
    expect(sumScheduledHours(partCtx, part, "2026-11-01", "2026-11-30")).toBe(60);
    // 会社カレンダー：平日21日から祝日2日を除いた19日 × 8時間 ＋ 出勤にした土曜（14日）の4時間 ＝ 156時間
    const calCtx: CalendarContext = {
      patternId: 1, workDays: parseWorkDays("sat"), holidays: new Set(["2026-11-03", "2026-11-23"]), companyCalendar: { "2026-11-14": 0 },
    };
    expect(sumScheduledHours(calCtx, fullTime, "2026-11-01", "2026-11-30")).toBe(156);
    // 所定労働時間がわからない人は出さない
    expect(sumScheduledHours(calCtx, { scheduled_work_hours: null }, "2026-11-01", "2026-11-30")).toBeNull();
  });
});

describe("給与の計算（その日の所定労働時間で数える）", () => {
  test("時給の人の有給：月曜4時間・水曜6時間・シフトで5時間にした金曜・水曜の半休3時間 → 18時間 × 1,200円 ＝ 21,600円", () => {
    const rows = [
      day("16", 0, "paid_full"), // 月曜
      day("18", 0, "paid_full"), // 水曜
      day("20", 0, "paid_full", { scheduled_hours: 5 }), // 金曜（シフトで5時間）
      day("25", 3, "paid_half"), // 水曜の半休（6時間の半分）
    ];
    const r = calculateSalary(part, rows, extras(), 2026, 11, company);
    expect(r.paidLeaveHours).toBe(18);
    expect(r.paidLeavePay).toBe(21600);
    expect(r.basePay).toBe(3600);
    expect(r.paidLeaveDays).toEqual([
      { date: "2026-11-16", hours: 4 }, { date: "2026-11-18", hours: 6 }, { date: "2026-11-20", hours: 5 }, { date: "2026-11-25", hours: 3 },
    ]);
    expect(r.scheduledHoursVary).toBe(true);
    expect(r.scheduledHoursMissing).toBe(false);
  });
  test("法定内残業は、その日の所定労働時間を超えた時間：月曜（4時間）に6時間働くと2時間、水曜（6時間）に6時間働くと0時間", () => {
    const r = calculateSalary(part, [day("16", 6), day("18", 6)], extras(), 2026, 11, company);
    expect(r.totalStatutoryOvertimeHours).toBe(2);
    expect(r.basePay).toBe(14400);
  });
  test("1日の所定労働時間を入れていない人は、8時間として計算して、確定できない印を付ける（役員は付けない）", () => {
    const noHours = { ...part, scheduled_work_hours: null, weekday_hours: null };
    const r = calculateSalary(noHours, [day("16", 0, "paid_full")], extras(), 2026, 11, company);
    expect(r.paidLeavePay).toBe(9600);
    expect(r.scheduledHoursMissing).toBe(true);
    const exec = calculateSalary({ ...noHours, wage_type: "monthly", base_wage: 500000, is_executive: 1 }, [], extras(), 2026, 11, company);
    expect(exec.scheduledHoursMissing).toBe(false);
  });
  test("日給の人：残業代の時給は 日給 ÷ 1週間の1日平均（月曜4時間・火〜金6時間 → 5.6時間）、有給・法定内残業はその日の時間", () => {
    const daily = {
      wage_type: "daily", base_wage: 6000, scheduled_work_hours: 6, weekday_hours: JSON.stringify({ mon: 4 }),
      calendar_pattern_id: 0, work_days: "mon,tue,wed,thu,fri",
      commute_type: "none", commute_amount: 0, standard_remuneration: 0, birthday: "1980-01-10", is_employment_ins_eligible: 0,
    };
    const r = calculateSalary(daily, [day("16", 5), day("17", 6), day("30", 0, "paid_full")], extras(), 2026, 11, company);
    expect(r.dailyRateHours).toBe(5.6);
    expect(r.overtimeHourlyRate).toBeCloseTo(6000 / 5.6, 9);
    // 月曜は4時間を超えた1時間が法定内残業（日給は4時間の分）。火曜は6時間どおり
    expect(r.totalStatutoryOvertimeHours).toBe(1);
    expect(r.basePay).toBe(12000);
    // 月曜（30日）の有給は、日給1日分（労基則25条1項2号）
    expect(r.paidLeavePay).toBe(6000);
    expect(r.paidLeaveDays).toEqual([{ date: "2026-11-30", hours: 4 }]);
  });
  test("月給の人（土曜は半日）：残業代の時給は 月給 ÷（1年間の所定労働時間 2,000時間 ÷ 12）＝ 1,800円。遅刻は 1時間 × 1,800円", () => {
    const rows = [day("14", 5), day("16", 7)]; // 14日（土・4時間）に5時間、16日（月・8時間）に7時間
    const r = calculateSalary(fullTime, rows, extras({ annualWorkDays: 255, annualWorkHours: 2000, tardyDeductionMethod: "annual" }), 2026, 11, company);
    expect(r.overtimeBaseHours).toBeCloseTo(2000 / 12, 9);
    expect(r.overtimeHourlyRate).toBeCloseTo(1800, 9);
    expect(r.totalStatutoryOvertimeHours).toBe(1); // 土曜の4時間を超えた1時間
    expect(r.tardyDeduction).toBe(1800); // 月曜の8時間に足りない1時間
    expect(r.tardyDeductionDetail).toContain("1年間の所定労働時間 2000時間 ÷ 12");
    // 曜日で違わない人は、いままでどおり 1年間の所定労働日数 × 1日の所定労働時間 ÷ 12（255日 × 8時間 ÷ 12 ＝ 170時間）
    const plain = calculateSalary({ ...fullTime, weekday_hours: null }, [], extras({ annualWorkDays: 255, annualWorkHours: 2000 }), 2026, 11, company);
    expect(plain.overtimeBaseHours).toBe(170);
  });
  test("遅刻・早退の控除（計算期間の所定労働時間で割る）：月給 300,000円 × 30分 ÷ 150時間 ＝ 1,000円", () => {
    const t = tardyDeductionOf("period", 300000, 30, 999999, 8, 20, 245, 21, undefined, { period: 150 });
    expect(t.amount).toBe(1000);
    expect(t.detail).toContain("計算期間の所定労働時間（150時間）");
  });
});

describe("週の所定労働時間を使う書類・判定", () => {
  test("有給の比例付与と雇用保険の届書の1週間の所定労働時間は、曜日の時間の合計（14時間）", () => {
    expect(workScaleOf(part, null)).toEqual({ weeklyDays: 3, weeklyHours: 14, annualDays: null });
    expect(weeklyMinutesOf(part)).toBe(14 * 60);
  });
  test("毎月勤労統計のパートタイム労働者：1日平均で比べる（土曜が半日の正社員どうしは一般の労働者）", () => {
    const standard = standardDailyHours([fullTime, { ...fullTime }]);
    expect(hoursText(standard)).toBe("7:20");
    expect(isPartTime(fullTime, standard)).toBe(false);
    expect(isPartTime(part, standard)).toBe(true);
  });
  test("労働条件通知書：始業・終業と休憩を、時間ごとに曜日をまとめて書く", () => {
    const company = { name: "サンプル商事株式会社", address: "東京都千代田区丸の内1-1-1", representative: "代表取締役 見本 太郎", annual_holidays: 120, hourly_leave: 1 };
    const ctx: LaborContext = {
      staff: { ...part, id: "2", join_date: "2026-04-01", scheduled_in: "09:00", weekday_hours: JSON.stringify({ wed: 7 }) },
      company, branch: { name: "本社", address: "東京都千代田区丸の内1-1-1" },
      group: { closing_day: 99, is_next_month: 1, payment_day: 25, fixed_break: JSON.stringify({ mode: "length", rules: [{ overMinutes: 360, breakMinutes: 45 }], combine: "record" }) },
      allowances: [], leaveTypes: [], hasBankAccount: true, annualDays: null, socialInsured: false, today: "2026-11-21",
    };
    const d = laborDefaults(ctx);
    expect(d.workHours).toBe("始業（9時00分） 終業（13時00分）（月・金）、始業（9時00分） 終業（16時45分）（水）");
    expect(d.breakTime).toBe("45分（水）");
  });
});
