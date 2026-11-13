import { describe, expect, test } from "bun:test";
import {
  DEFAULT_FLEX_RULE, describeFlexRule, flexHoursLabel, isFlexStaff, parseFlexRule, settleFlex, stringifyFlexRule,
  type FlexAttendanceRow, type FlexRule,
} from "./flexTime";

/** 2026年6月（30日。平日22日）を清算期間にする */
const JUNE = { from: "2026-06-01", to: "2026-06-30", workDays: 22, dayHours: 8 };
const rule = (o: Partial<FlexRule> = {}): FlexRule => ({ ...DEFAULT_FLEX_RULE, ...o });
/** 6月1日から、その時間ずつ働いた日を n 日 */
const days = (n: number, hours: number, type = "normal"): FlexAttendanceRow[] =>
  Array.from({ length: n }, (_, i) => ({ work_date: `2026-06-${String(i + 1).padStart(2, "0")}`, work_type: type, work_hours: hours }));
const settle = (r: FlexRule, rows: FlexAttendanceRow[], carryInHours = 0) => settleFlex({ ...JUNE, rule: r, rows, carryInHours });

describe("決まりを読む", () => {
  test("初めは、総労働時間＝所定労働日数 × 1日の所定労働時間、法定の総枠は原則、不足時間はその月で清算", () => {
    expect(parseFlexRule(null)).toEqual(DEFAULT_FLEX_RULE);
    expect(parseFlexRule("こわれた値")).toEqual(DEFAULT_FLEX_RULE);
    const r: FlexRule = { total: { mode: "fixed", hours: 160 }, limit: "fiveDay", shortage: "carry" };
    expect(parseFlexRule(stringifyFlexRule(r))).toEqual(r);
    expect(parseFlexRule(JSON.stringify({ total: { mode: "fixed", hours: -1 } }))).toEqual(DEFAULT_FLEX_RULE);
    expect(describeFlexRule(DEFAULT_FLEX_RULE)).toBe("総労働時間：所定労働日数 × 1日の所定労働時間／法定の総枠：40時間 × 暦日数 ÷ 7（原則）／不足時間：その月で清算する（給与から引く）");
  });
  test("フレックスタイム制で計算するのは、印を付けた月給制・時給制の人（日給制はまだ）", () => {
    expect(isFlexStaff({ is_flex: 1, wage_type: "monthly" })).toBe(true);
    expect(isFlexStaff({ is_flex: 1, wage_type: "hourly" })).toBe(true);
    expect(isFlexStaff({ is_flex: 1, wage_type: "daily" })).toBe(false);
    expect(isFlexStaff({ is_flex: 0, wage_type: "monthly" })).toBe(false);
  });
});

describe("法定の総枠と総労働時間", () => {
  test("原則：40時間 × 30日 ÷ 7 ＝ 171時間25分（1分に満たない端数は切り捨て）。22日 × 8時間 ＝ 176時間は総枠を超えるので知らせる", () => {
    const s = settle(rule(), []);
    expect(flexHoursLabel(s.limitHours)).toBe("171時間25分");
    expect(s.totalHours).toBe(176);
    expect(s.notes.join("")).toContain("法定の総枠（171時間25分）を超えています");
  });
  test("完全週休2日制の特例：所定労働日数 × 8時間 ＝ 176時間", () => {
    const s = settle(rule({ limit: "fiveDay" }), []);
    expect([s.limitHours, s.totalHours, s.notes]).toEqual([176, 176, []]);
  });
  test("所定労働日数がわからないときは、平日の日数で数えて知らせる", () => {
    const s = settleFlex({ ...JUNE, workDays: null, rule: rule({ limit: "fiveDay" }), rows: [], carryInHours: 0 });
    expect(s.totalHours).toBe(176);
    expect(s.notes[0]).toContain("平日（月〜金）の日数 22日");
  });
});

describe("時間外労働・法定内の時間", () => {
  test("総枠を超えた実労働は時間外（1日8時間・週40時間では数えない）：176時間の総枠で180時間働いたら4時間", () => {
    const s = settle(rule({ limit: "fiveDay" }), days(20, 9));
    expect(s).toMatchObject({ actualHours: 180, excessHours: 4, overtimeHours: 4, fullOvertimeHours: 4, premiumOnlyHours: 0, innerHours: 0, shortageHours: 0 });
  });
  test("総労働時間が総枠を超えるとき（原則・176時間）：総労働時間どおり働いても、総枠を超えた4時間35分は割増だけを払う", () => {
    const s = settle(rule(), days(22, 8));
    expect(s).toMatchObject({ excessHours: 0, fullOvertimeHours: 0, shortageHours: 0 });
    expect(Math.round(s.premiumOnlyHours * 60)).toBe(275);
  });
  test("総労働時間160時間：168時間なら8時間は法定内、175時間なら総枠を超えた3時間35分が時間外", () => {
    const fixed = rule({ total: { mode: "fixed", hours: 160 } });
    expect(settle(fixed, days(21, 8))).toMatchObject({ excessHours: 8, innerHours: 8, overtimeHours: 0 });
    const s = settle(fixed, [...days(21, 8), { work_date: "2026-06-30", work_type: "normal", work_hours: 7 }]);
    expect(s.excessHours).toBe(15);
    expect(Math.round(s.overtimeHours * 60)).toBe(215);
    expect(Math.round(s.fullOvertimeHours * 60)).toBe(215);
    expect(Math.round(s.innerHours * 60)).toBe(15 * 60 - 215);
  });
  test("年休の日は、総労働時間に足りているかを見るときだけ所定の時間働いたものとし、時間外は実労働で数える", () => {
    const fixed = rule({ total: { mode: "fixed", hours: 160 } });
    const rows = [...days(19, 8), { work_date: "2026-06-20", work_type: "paid_full", work_hours: 0 }];
    expect(settle(fixed, rows)).toMatchObject({ actualHours: 152, leaveHours: 8, excessHours: 0, shortageHours: 0 });
    // 実労働170時間 ＋ 年休8時間：18時間は総労働時間を超えるが、実労働は総枠の中なので割増はない
    const many = [...days(17, 10), { work_date: "2026-06-20", work_type: "paid_full", work_hours: 0 }];
    expect(settle(fixed, many)).toMatchObject({ actualHours: 170, excessHours: 18, overtimeHours: 0, innerHours: 18 });
  });
  test("法定休日の労働は、清算に入れない（休日労働として別に払う）。期間の外の日も入れない", () => {
    const rows = [...days(22, 8), { work_date: "2026-06-07", work_type: "statutory_holiday", work_hours: 8 }, { work_date: "2026-07-01", work_type: "normal", work_hours: 8 }];
    expect(settle(rule({ limit: "fiveDay" }), rows).actualHours).toBe(176);
  });
});

describe("不足時間", () => {
  const fixed160 = { total: { mode: "fixed" as const, hours: 160 } };
  test("その月で清算：足りない時間を給与から引く", () => {
    expect(settle(rule(fixed160), days(19, 8).concat(days(1, 2).map((r) => ({ ...r, work_date: "2026-06-25" })))))
      .toMatchObject({ actualHours: 154, shortageHours: 6, deductHours: 6, carryOutHours: 0 });
  });
  test("次の月に繰り越す：法定の総枠と総労働時間の差（11時間25分）まで。残りはその月で引く", () => {
    const carry = rule({ ...fixed160, shortage: "carry" });
    expect(settle(carry, days(19, 8).concat([{ work_date: "2026-06-25", work_type: "normal", work_hours: 2 }])))
      .toMatchObject({ shortageHours: 6, carryOutHours: 6, deductHours: 0 });
    const s = settle(carry, days(18, 8).concat([{ work_date: "2026-06-25", work_type: "normal", work_hours: 1 }]));
    expect(s.shortageHours).toBe(15);
    expect(Math.round(s.carryOutHours * 60)).toBe(11 * 60 + 25);
    expect(Math.round(s.deductHours * 60)).toBe(15 * 60 - (11 * 60 + 25));
    expect(s.notes.join("")).toContain("繰り越せるのは");
  });
  test("前の月から繰り越した時間は、その月の総労働時間に足す。総枠を超えた時間には割増を払う", () => {
    const fixed = rule(fixed160);
    expect(settle(fixed, days(20, 8).concat([{ work_date: "2026-06-25", work_type: "normal", work_hours: 6 }]), 6))
      .toMatchObject({ requiredHours: 166, carryInHours: 6, excessHours: 0, shortageHours: 0 });
    // 総労働時間168時間 ＋ 繰り越し6時間 ＝ 174時間（総枠171時間25分を超える）。174時間働いたら、総枠を超えた2時間35分は割増だけ
    const s = settle(rule({ total: { mode: "fixed", hours: 168 } }), days(21, 8).concat([{ work_date: "2026-06-25", work_type: "normal", work_hours: 6 }]), 6);
    expect(s).toMatchObject({ requiredHours: 174, excessHours: 0, shortageHours: 0 });
    expect(Math.round(s.premiumOnlyHours * 60)).toBe(155);
  });
});
