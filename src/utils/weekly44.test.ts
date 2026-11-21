/**
 * 週44時間の特例（特例措置対象事業場。労働基準法施行規則25条の2）のテスト
 * 実行方法: bun test
 *
 * 数（40時間・8時間・44時間・10人未満・別表第一の号・フレックスタイム制の1か月と50時間）は、条文の XML から scripts/import_work_hours.py で作る。
 * 2026年11月（11月15日が日曜。週の起算は日曜）で確かめる。
 */
import { describe, expect, test } from "bun:test";
import { FLEX_LIMITS, LEGAL_WORK_HOURS, WEEKLY_44, WEEKLY_44_BUSINESSES } from "../constants/workHours";
import * as Master from "../constants";
import {
  branchWorkerCount, parseWeekly44Business, weekly44BusinessLabel, weekly44BusinessOf, weekly44Problem, weeklyLegalHoursFor, WEEKLY_44_OPTIONS,
} from "./weekly44";
import { calculateSalary, type SalaryExtras } from "./calcSalary";
import { DEFAULT_FLEX_RULE } from "./flexTime";

const company = { week_start_day: 0, round_overtime: "round", round_social_ins: "currency_law", round_emp_ins: "currency_law" };
const extras = (o: Partial<SalaryExtras> = {}): SalaryExtras => ({
  allowanceName: "", allowanceAmount: 0, residentTax: 0, prefecture: "東京", dependents: 0, customItems: [], ...o,
});
const day = (date: string, hours: number, type = "normal") =>
  ({ work_date: `2026-11-${date}`, work_hours: hours, night_hours: 0, work_type: type });

/** 時給 1,200円・1日の所定労働時間 7時間30分・月〜土（小売店のパート） */
const shop = {
  wage_type: "hourly", base_wage: 1200, scheduled_work_hours: 7.5, calendar_pattern_id: 0, work_days: "mon,tue,wed,thu,fri,sat",
  commute_type: "none", commute_amount: 0, standard_remuneration: 0, birthday: "1985-05-05", is_employment_ins_eligible: 0,
};
/** 11月16日（月）〜21日（土）に7時間30分ずつ（週45時間） */
const week = ["16", "17", "18", "19", "20", "21"].map((d) => day(d, 7.5));

describe("条文から作った数", () => {
  test("労働基準法32条（週40時間・1日8時間）・32条の3（3か月・週平均50時間）・施行規則25条の2（44時間・10人未満・第8・10・13・14号・1か月）", () => {
    expect(LEGAL_WORK_HOURS).toEqual({ weekly: 40, daily: 8 });
    expect(FLEX_LIMITS).toEqual({ maxMonths: 3, monthCapWeeklyHours: 50 });
    expect(WEEKLY_44).toEqual({ weekly: 44, daily: 8, workersBelow: 10, flexMaxMonths: 1 });
    expect(WEEKLY_44_BUSINESSES.map((b) => b.item)).toEqual([8, 10, 13, 14]);
    // いままで手で書いていた数と同じ（constants/labor.ts は、作った数を使う）
    expect([Master.LEGAL_WORK_HOURS_WEEKLY, Master.LEGAL_WORK_HOURS_DAILY]).toEqual([40, 8]);
  });
  test("事業の名前は労働基準法 別表第一から。第10号は映画の製作の事業を除く", () => {
    expect(weekly44BusinessLabel(8)).toBe("第8号：物品の販売、配給、保管若しくは賃貸又は理容の事業");
    expect(weekly44BusinessLabel(10)).toBe("第10号：映画の製作又は映写、演劇その他興行の事業（映画の製作の事業を除く）");
    expect(weekly44BusinessLabel(14)).toBe("第14号：旅館、料理店、飲食店、接客業又は娯楽場の事業");
    expect(weekly44BusinessLabel(9)).toBe("");
    expect(WEEKLY_44_OPTIONS.map((o) => o.value)).toEqual([8, 10, 13, 14]);
  });
});

describe("拠点の特例", () => {
  test("読み取り：特例の号だけ。拠点を選んでいない人は本店", () => {
    expect(parseWeekly44Business(8)).toBe(8);
    expect(parseWeekly44Business("13")).toBe(13);
    expect(parseWeekly44Business(9)).toBeNull();
    expect(parseWeekly44Business("")).toBeNull();
    expect(parseWeekly44Business(null)).toBeNull();
    const branches = [{ id: 1, weekly44_business: null }, { id: 2, weekly44_business: 14 }];
    expect(weekly44BusinessOf(branches, 2)).toBe(14);
    expect(weekly44BusinessOf(branches, null)).toBeNull();
    expect(weekly44BusinessOf([{ id: 1, weekly44_business: 8 }], undefined)).toBe(8);
  });
  test("週の法定労働時間：特例の拠点は44時間。清算期間が1か月を超えるフレックスタイム制の人は40時間（4項）", () => {
    expect(weeklyLegalHoursFor(null)).toEqual({ hours: 40, special: false, flexIgnored: false });
    expect(weeklyLegalHoursFor(8)).toEqual({ hours: 44, special: true, flexIgnored: false });
    expect(weeklyLegalHoursFor(13, 1)).toEqual({ hours: 44, special: true, flexIgnored: false });
    expect(weeklyLegalHoursFor(13, 2)).toEqual({ hours: 40, special: false, flexIgnored: true });
    expect(weeklyLegalHoursFor(null, 3)).toEqual({ hours: 40, special: false, flexIgnored: false });
  });
  test("在籍している人（退職した人・役員を除く）が10人以上なら知らせる", () => {
    const people = [
      ...Array.from({ length: 8 }, () => ({ branch_id: 2, status: "active" })),
      { branch_id: 2, status: "on_leave" },
      { branch_id: 2, status: "retired" },
      { branch_id: 2, status: "active", is_executive: 1 },
      { branch_id: null, status: "active" },
    ];
    expect(branchWorkerCount(people, 2)).toBe(9);
    expect(branchWorkerCount(people, 1)).toBe(1);
    expect(weekly44Problem(8, 9)).toBeNull();
    expect(weekly44Problem(null, 25)).toBeNull();
    expect(weekly44Problem(8, 10)).toContain("在籍している人（役員を除く）が10人います");
  });
});

describe("給与の計算", () => {
  test("月〜土に7時間30分ずつ（週45時間）：週40時間なら5時間、特例なら1時間が時間外労働（時給 1,200円 × 25%）", () => {
    const normal = calculateSalary(shop, week, extras(), 2026, 11, company);
    expect(normal.weeklyLegalHours).toBe(40);
    expect(normal.standardPremiumHours).toBe(5);
    expect(normal.standardOvertimePay).toBe(1500);
    const special = calculateSalary(shop, week, extras({ weekly44Business: 8 }), 2026, 11, company);
    expect([special.weeklyLegalHours, special.weekly44, special.weekly44FlexIgnored]).toEqual([44, true, false]);
    expect(special.standardPremiumHours).toBe(1);
    expect(special.standardOvertimePay).toBe(300);
    // 1日8時間を超えた分は、特例でも時間外労働（21日に9時間）
    const longDay = calculateSalary(shop, [...week.slice(0, 5), day("21", 9)], extras({ weekly44Business: 8 }), 2026, 11, company);
    expect(longDay.standardPremiumHours).toBe(2.5); // 9時間 − 8時間 ＝ 1時間 ＋ 週44時間を超えた 1時間30分（46時間30分 − 1時間 − 44時間）
  });
  test("フレックスタイム制：清算期間1か月なら法定の総枠は 44時間 × 30日 ÷ 7 ＝ 188.5時間（40時間なら171.4時間）", () => {
    const flexStaff = { ...shop, wage_type: "monthly", base_wage: 300000, scheduled_work_hours: 8, is_flex: 1, calendar_pattern_id: 1, work_days: "" };
    const o = { period: { start: "2026-11-01", end: "2026-11-30" }, periodWorkDays: 19, employedWorkDays: 19, annualWorkDays: 243, flexRule: { ...DEFAULT_FLEX_RULE, months: 1 as const } };
    const normal = calculateSalary(flexStaff, week, extras(o), 2026, 11, company);
    expect(normal.flex?.limitHours).toBe(171.4);
    const special = calculateSalary(flexStaff, week, extras({ ...o, weekly44Business: 13 }), 2026, 11, company);
    expect(special.flex?.limitHours).toBe(188.5);
    expect(special.weekly44).toBe(true);
    // 清算期間2か月：特例は使わない（40時間で数える。4項）
    const twoMonths = calculateSalary(flexStaff, week, extras({ ...o, weekly44Business: 13, flexRule: { ...DEFAULT_FLEX_RULE, months: 2 as const } }), 2026, 11, company);
    expect([twoMonths.weeklyLegalHours, twoMonths.weekly44, twoMonths.weekly44FlexIgnored]).toEqual([40, false, true]);
  });
});
