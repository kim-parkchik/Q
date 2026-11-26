/**
 * 18歳未満の人（年少者）の時間外・休日・深夜の労働（見直しの P13。utils/minorWork.ts）
 * 労働基準法56条・57条・60条・61条（数は constants/laborStandards.ts。条文から scripts/import_labor_standards.py で作る）
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  MINIMUM_WORK_AGE, MINOR_AGE, MINOR_NIGHT_EXCEPTIONS, MINOR_SHORTENED_DAY_HOURS,
} from "../constants/laborStandards";
import {
  describeMinorStaff, describeMinorWork, hasMinorWorkIssue, isMinorOn, minimumWorkDate, minorUntil, minorWorkExceptionsNote, minorWorkLogText,
} from "./minorWork";
import { calculateSalary, type SalaryExtras } from "./calcSalary";
import { DEFAULT_FLEX_RULE } from "./flexTime";

const company = { week_start_day: 0, round_overtime: "round", round_social_ins: "currency_law", round_emp_ins: "currency_law" };
const extras = (o: Partial<SalaryExtras> = {}): SalaryExtras => ({
  allowanceName: "", allowanceAmount: 0, residentTax: 0, prefecture: "東京", dependents: 0, customItems: [],
  period: { start: "2026-11-01", end: "2026-11-30" }, ...o,
});
const day = (date: string, hours: number, night = 0, type = "normal") =>
  ({ work_date: `2026-11-${date}`, work_hours: hours, night_hours: night, work_type: type });

/** 時給 1,200円・1日の所定労働時間 7時間30分・月〜土（16歳の高校生のアルバイト） */
const student = {
  wage_type: "hourly", base_wage: 1200, scheduled_work_hours: 7.5, calendar_pattern_id: 0, work_days: "mon,tue,wed,thu,fri,sat",
  commute_type: "none", commute_amount: 0, standard_remuneration: 0, birthday: "2010-05-05", is_employment_ins_eligible: 0,
};
/** 11月16日（月）〜21日（土）に7時間30分ずつ（週45時間） */
const week = ["16", "17", "18", "19", "20", "21"].map((d) => day(d, 7.5));

describe("条文から作った数", () => {
  test("60条・61条の18歳、56条の15歳、61条1項ただし書の16歳、61条4項の別表第一6号・7号・13号、60条3項1号の4時間・10時間", () => {
    expect([MINOR_AGE, MINIMUM_WORK_AGE, MINOR_NIGHT_EXCEPTIONS.shiftMaleAge]).toEqual([18, 15, 16]);
    expect(MINOR_NIGHT_EXCEPTIONS.businesses.map((b) => b.item)).toEqual([6, 7, 13]);
    expect(MINOR_NIGHT_EXCEPTIONS.businesses[2].name).toBe("病者又は虚弱者の治療、看護その他保健衛生の事業");
    expect(MINOR_SHORTENED_DAY_HOURS).toEqual({ short: 4, long: 10 });
  });
});

describe("18歳未満の日", () => {
  test("18歳の誕生日より前の日（誕生日の前日も）", () => {
    expect(minorUntil("2008-12-01")).toBe("2026-12-01");
    expect(isMinorOn("2008-12-01", "2026-11-30")).toBe(true);
    expect(isMinorOn("2008-12-01", "2026-12-01")).toBe(false);
    // 2月29日生まれは、うるう年でない年は3月1日から18歳
    expect(minorUntil("2008-02-29")).toBe("2026-03-01");
    expect(isMinorOn("2008-02-29", "2026-02-28")).toBe(true);
    expect(isMinorOn("", "2026-11-30")).toBe(false);
    expect(minorUntil(null)).toBeNull();
  });
  test("最低年齢（56条1項）：満15歳に達した日（誕生日の前日）以後の最初の3月31日の次の日から", () => {
    // 4月1日生まれは、3月31日に15歳に達するので、その年の4月1日から
    expect(minimumWorkDate("2011-04-01")).toBe("2026-04-01");
    // 4月2日生まれは、4月1日に15歳に達するので、次の年の4月1日から
    expect(minimumWorkDate("2011-04-02")).toBe("2027-04-01");
    expect(minimumWorkDate("2011-12-25")).toBe("2027-04-01");
    expect(minimumWorkDate("")).toBeNull();
  });
});

describe("給与の計算", () => {
  test("週44時間の特例の拠点でも、18歳未満の日は週40時間で数え、時間外・法定休日・深夜の日を返す", () => {
    const rows = [...week.slice(0, 2), day("18", 7.5, 1), ...week.slice(3), day("22", 4, 0, "statutory_holiday")];
    const r = calculateSalary(student, rows, extras({ weekly44Business: 8 }), 2026, 11, company);
    expect([r.weeklyLegalHours, r.weekly44]).toEqual([40, false]);
    expect(r.standardPremiumHours).toBe(5); // 45時間 − 40時間（特例なら1時間）
    expect(r.minorWork).toEqual({
      until: "2028-05-05",
      days: [
        { date: "2026-11-18", overtime: 0, holiday: 0, night: 1 },
        { date: "2026-11-21", overtime: 5, holiday: 0, night: 0 },
        { date: "2026-11-22", overtime: 0, holiday: 4, night: 0 },
      ],
      flexIgnored: false,
      weekly44Ignored: true,
    });
    expect(hasMinorWorkIssue(r.minorWork)).toBe(true);
    // 特例のない拠点：weekly44Ignored は false。1日8時間を超えた日も時間外
    const plain = calculateSalary(student, [day("16", 9)], extras(), 2026, 11, company);
    expect(plain.minorWork?.days).toEqual([{ date: "2026-11-16", overtime: 1, holiday: 0, night: 0 }]);
    expect(plain.minorWork?.weekly44Ignored).toBe(false);
  });
  test("月の途中で18歳になる人：誕生日の前日までだけ（特例は18歳になってから使う）", () => {
    const turning = { ...student, birthday: "2008-11-19" };
    const rows = [day("16", 7.5), day("17", 7.5), day("18", 7.5, 2), day("19", 7.5, 2), day("20", 7.5), day("21", 7.5)];
    const r = calculateSalary(turning, rows, extras({ weekly44Business: 8 }), 2026, 11, company);
    expect(r.weekly44).toBe(true);
    expect(r.standardPremiumHours).toBe(1); // 21日（18歳）に週44時間を超えた1時間
    expect(r.minorWork?.days).toEqual([{ date: "2026-11-18", overtime: 0, holiday: 0, night: 2 }]);
    expect(r.minorWork?.weekly44Ignored).toBe(true);
    // 計算期間がまるごと18歳以上：null
    const adult = calculateSalary({ ...student, birthday: "2008-11-01" }, rows, extras(), 2026, 11, company);
    expect(adult.minorWork).toBeNull();
    // 生年月日がない人：null
    expect(calculateSalary({ ...student, birthday: "" }, rows, extras(), 2026, 11, company).minorWork).toBeNull();
  });
  test("時間外・休日・深夜がない月は知らせない（18歳未満の日はあるので null ではない）", () => {
    const r = calculateSalary(student, [day("16", 7.5)], extras(), 2026, 11, company);
    expect(r.minorWork).toEqual({ until: "2028-05-05", days: [], flexIgnored: false, weekly44Ignored: false });
    expect(hasMinorWorkIssue(r.minorWork)).toBe(false);
    expect(describeMinorWork(r.minorWork)).toEqual([]);
  });
  test("フレックスタイム制の人：計算期間の初めの日に18歳未満なら、フレックスタイム制を使わず1日8時間・週40時間で数える", () => {
    const flexStaff = { ...student, wage_type: "monthly", base_wage: 300000, scheduled_work_hours: 8, is_flex: 1, calendar_pattern_id: 1, work_days: "" };
    const o = { periodWorkDays: 19, employedWorkDays: 19, annualWorkDays: 243, flexRule: { ...DEFAULT_FLEX_RULE, months: 1 as const } };
    const minor = calculateSalary(flexStaff, week, extras(o), 2026, 11, company);
    expect(minor.flex).toBeNull();
    expect(minor.minorWork?.flexIgnored).toBe(true);
    expect(minor.standardPremiumHours).toBe(5);
    expect(minor.minorWork?.days).toEqual([{ date: "2026-11-21", overtime: 5, holiday: 0, night: 0 }]);
    // 計算期間の初めの日に18歳：フレックスタイム制で清算する
    const adult = calculateSalary({ ...flexStaff, birthday: "2008-11-01" }, week, extras(o), 2026, 11, company);
    expect(adult.flex).not.toBeNull();
    expect(adult.minorWork).toBeNull();
  });
  test("残業代の対象外の人（労働基準法41条）は、深夜だけを見る", () => {
    const manager = { ...student, is_overtime_eligible: 0 };
    const r = calculateSalary(manager, [day("16", 10, 1), day("22", 4, 0, "statutory_holiday")], extras(), 2026, 11, company);
    expect(r.minorWork?.days).toEqual([{ date: "2026-11-16", overtime: 0, holiday: 0, night: 1 }]);
  });
});

describe("知らせの文", () => {
  const m = {
    until: "2028-05-05",
    days: [
      { date: "2026-11-18", overtime: 0, holiday: 0, night: 1.5 },
      { date: "2026-11-21", overtime: 5, holiday: 0, night: 0 },
      { date: "2026-11-22", overtime: 0, holiday: 4, night: 0 },
    ],
    flexIgnored: false,
    weekly44Ignored: true,
  };
  test("見出し・きまり・日・使わなかった決まり", () => {
    const lines = describeMinorWork(m);
    expect(lines[0]).toBe("18歳未満（2028年5月5日に18歳）の人に、時間外労働 5:00（1日）・法定休日の労働 4:00（1日）・深夜（午後10時から午前5時まで）の労働 1:30（1日）があります。");
    expect(lines[1]).toContain("36協定による時間外労働・休日労働をさせられず（労働基準法60条1項）");
    expect(lines[2]).toBe("日：11月18日（深夜 1:30）、11月21日（時間外 5:00）、11月22日（法定休日 4:00）");
    expect(lines[3]).toBe("満18歳に満たない人には週44時間の特例を使えないので（労働基準法60条1項・40条）、18歳未満の日は週40時間で数えています。");
    expect(describeMinorWork({ ...m, days: [], weekly44Ignored: false, flexIgnored: true }))
      .toEqual(["満18歳に満たない人にはフレックスタイム制を使えないので（労働基準法60条1項）、この月は1日8時間・週40時間で数えています。"]);
    expect(minorWorkLogText(m)).toBe("時間外労働 5:00・法定休日の労働 4:00・深夜の労働 1:30");
  });
  test("例外の説明（33条1項・61条1項ただし書・61条4項・60条3項1号）", () => {
    const note = minorWorkExceptionsNote();
    expect(note).toContain("（33条1項）");
    expect(note).toContain("交替制で使う満16歳以上の男性（61条1項ただし書）");
    expect(note).toContain("農林の事業・畜産、養蚕又は水産の事業・保健衛生の事業（別表第一6号・7号・13号）と電話交換の業務（61条4項）");
    expect(note).toContain("1日を4時間以内にした週は、ほかの日を10時間まで延ばせます（60条3項1号");
  });
  test("従業員の画面：18歳未満の人・最低年齢に満たない人・フレックスタイム制・週44時間の特例", () => {
    expect(describeMinorStaff({ birthday: "2008-11-01", on: "2026-11-26", isFlex: false, weekly44: false })).toBeNull();
    const s = describeMinorStaff({ birthday: "2010-05-05", on: "2026-11-26", isFlex: true, weekly44: true })!;
    expect(s.belowMinimumAge).toBe(false);
    expect(s.lines[0]).toBe("18歳未満の人です（2028年5月5日に18歳）。時間外労働（1日8時間・週40時間を超える労働）・法定休日の労働と、午後10時から午前5時までの労働はさせられません（労働基準法60条1項・61条1項。例外は、勤怠の画面と給与明細の知らせに書きます）。");
    expect(s.lines[1]).toBe("年齢を証明する戸籍証明書を、事業場に備え付けてください（57条1項）。");
    expect(s.lines[2]).toContain("フレックスタイム制は使えません（60条1項）");
    expect(s.lines[3]).toBe("拠点は週44時間の特例の事業場ですが、18歳未満の日は週40時間で計算します（60条1項・40条）。");
    const young = describeMinorStaff({ birthday: "2011-12-25", on: "2026-11-26", isFlex: false, weekly44: false })!;
    expect(young.belowMinimumAge).toBe(true);
    expect(young.lines[0]).toBe("満15歳に達した日以後の最初の3月31日（2027年3月31日）が終わるまでは、使えません（労働基準法56条1項。軽易な仕事について労働基準監督署長の許可を受けたときを除く。56条2項）。");
  });
});

describe("画面につないでいること", () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  test("給与明細：確かめは保存より前、このまま確定すると WARN の記録", () => {
    const hook = read("features/payroll/usePayStubModal.ts");
    const ask = hook.indexOf('title: "18歳未満の人の時間外・休日・深夜の労働があります"');
    expect(ask).toBeGreaterThan(0);
    expect(ask).toBeLessThan(hook.indexOf("await saveSalaryResult("));
    expect(hook).toContain('okLabel: "このまま確定する", cancelLabel: "やめる"');
    expect(hook).toContain("があるまま確定しました");
    expect(read("features/payroll/PayStubModal.tsx")).toContain('data-note="minor-work"');
  });
  test("勤怠の画面と従業員の画面", () => {
    expect(read("features/attendance/AttendanceManager.tsx")).toContain("<MinorWorkNotice am={am} />");
    expect(read("features/settings/staff/BasicInfoSection.tsx")).toContain("<MinorNotice cm={cm} />");
  });
});
