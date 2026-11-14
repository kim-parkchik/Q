import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  DEFAULT_FLEX_RULE, describeFlexRule, describeFlexSettlement, flexHoursLabel, flexPositionOf, flexStartMonthOptions, isFlexStaff,
  loadFlexPeriod, parseFlexMonthRecord, parseFlexRule, settleFlex, stringifyFlexRule, weeklyAverageLimitMinutes,
  type FlexAttendanceRow, type FlexMonthRecord, type FlexRule,
} from "./flexTime";

/** 2026年6月（30日。平日22日）を清算期間にする */
const JUNE = { from: "2026-06-01", to: "2026-06-30", workDays: 22, dayHours: 8 };
const rule = (o: Partial<FlexRule> = {}): FlexRule => ({ ...DEFAULT_FLEX_RULE, ...o });
/** 6月1日から、その時間ずつ働いた日を n 日 */
const days = (n: number, hours: number, type = "normal"): FlexAttendanceRow[] =>
  Array.from({ length: n }, (_, i) => ({ work_date: `2026-06-${String(i + 1).padStart(2, "0")}`, work_type: type, work_hours: hours }));
const settle = (r: FlexRule, rows: FlexAttendanceRow[], carryInHours = 0) => settleFlex({ ...JUNE, rule: r, rows, carryInHours });
/** 分にする（時間の比べ方を、端数の誤差なく） */
const min = (hours: number) => Math.round(hours * 60);

describe("決まりを読む", () => {
  test("初めは、清算期間1か月・総労働時間＝所定労働日数 × 1日の所定労働時間・法定の総枠は原則・不足時間は清算期間の終わりに清算", () => {
    expect(parseFlexRule(null)).toEqual(DEFAULT_FLEX_RULE);
    expect(parseFlexRule("こわれた値")).toEqual(DEFAULT_FLEX_RULE);
    const r: FlexRule = { total: { mode: "fixed", hours: 160 }, limit: "fiveDay", shortage: "carry", months: 3, startMonth: 1 };
    expect(parseFlexRule(stringifyFlexRule(r))).toEqual(r);
    expect(parseFlexRule(JSON.stringify({ total: { mode: "fixed", hours: -1 } }))).toEqual(DEFAULT_FLEX_RULE);
    // いままでの決まり（清算期間がない）は1か月
    expect(parseFlexRule(JSON.stringify({ total: { mode: "workdays" }, limit: "standard", shortage: "deduct" }))).toEqual(DEFAULT_FLEX_RULE);
    expect(describeFlexRule(DEFAULT_FLEX_RULE)).toBe("清算期間：1か月／総労働時間：所定労働日数 × 1日の所定労働時間／法定の総枠：40時間 × 暦日数 ÷ 7（原則）／不足時間：清算期間の終わりに清算する（給与から引く）");
  });
  test("起算の月は、清算期間の長さでそろえる（3か月なら4月と1月は同じ。手引きの協定の例：4月・7月・10月・1月の1日から3箇月）", () => {
    expect(parseFlexRule(JSON.stringify({ months: 3, startMonth: 4 })).startMonth).toBe(1);
    expect(parseFlexRule(JSON.stringify({ months: 3, startMonth: 11 })).startMonth).toBe(2);
    expect(parseFlexRule(JSON.stringify({ months: 2, startMonth: 12 })).startMonth).toBe(2);
    expect(parseFlexRule(JSON.stringify({ months: 4, startMonth: 3 }))).toMatchObject({ months: 1, startMonth: 1 });
    expect(flexStartMonthOptions(3).map((o) => o.label)).toEqual(["1月・4月・7月・10月から", "2月・5月・8月・11月から", "3月・6月・9月・12月から"]);
    expect(flexStartMonthOptions(2)[1].label).toBe("2月・4月・6月・8月・10月・12月から");
    expect(flexStartMonthOptions(1)).toEqual([]);
    expect(describeFlexRule(rule({ months: 3, startMonth: 1, total: { mode: "fixed", hours: 160 } })))
      .toBe("清算期間：3か月（1月・4月・7月・10月から）／総労働時間：1か月あたり160時間／法定の総枠：40時間 × 暦日数 ÷ 7（原則）／不足時間：清算期間の終わりに清算する（給与から引く）");
  });
  test("フレックスタイム制で計算するのは、印を付けた月給制・日給制・時給制の人", () => {
    expect(isFlexStaff({ is_flex: 1, wage_type: "monthly" })).toBe(true);
    expect(isFlexStaff({ is_flex: 1, wage_type: "hourly" })).toBe(true);
    expect(isFlexStaff({ is_flex: 1, wage_type: "daily" })).toBe(true);
    expect(isFlexStaff({ is_flex: 0, wage_type: "monthly" })).toBe(false);
  });
});

describe("法定の総枠と総労働時間", () => {
  test("総枠・週平均50時間は、0.1時間に満たない端数を切り捨てる（厚生労働省の手引きの表とすべて同じ）", () => {
    const tenths = (weekly: number, d: number) => weeklyAverageLimitMinutes(weekly, d) / 6;
    // 1か月単位・2か月単位・3か月単位の法定労働時間の総枠
    expect([31, 30, 29, 28].map((d) => tenths(40, d))).toEqual([1771, 1714, 1657, 1600]);
    expect([62, 61, 60, 59].map((d) => tenths(40, d))).toEqual([3542, 3485, 3428, 3371]);
    expect([92, 91, 90, 89].map((d) => tenths(40, d))).toEqual([5257, 5200, 5142, 5085]);
    // 週平均50時間となる月間の労働時間数
    expect([31, 30, 29, 28].map((d) => tenths(50, d))).toEqual([2214, 2142, 2071, 2000]);
  });
  test("原則：40時間 × 30日 ÷ 7 ＝ 171.4時間（171時間24分）。22日 × 8時間 ＝ 176時間は総枠を超えるので知らせる", () => {
    const s = settle(rule(), []);
    expect(flexHoursLabel(s.limitHours)).toBe("171時間24分");
    expect(s.totalHours).toBe(176);
    expect(s.notes.join("")).toContain("法定の総枠（171時間24分）を超えています");
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
  test("決めた時間は、休業の日・入社前の日がある月は、計算期間の所定労働日数のうち在籍していて休業していない日の割合で減らす", () => {
    const fixed = rule({ total: { mode: "fixed", hours: 160 } });
    expect(settleFlex({ ...JUNE, from: "2026-06-16", workDays: 11, periodWorkDays: 22, rule: fixed, rows: [], carryInHours: 0 }).totalHours).toBe(80);
    expect(settleFlex({ ...JUNE, periodWorkDays: 22, rule: fixed, rows: [], carryInHours: 0 }).totalHours).toBe(160);
  });
});

describe("時間外労働・法定内の時間（清算期間1か月）", () => {
  test("総枠を超えた実労働は時間外（1日8時間・週40時間では数えない）：176時間の総枠で180時間働いたら4時間", () => {
    const s = settle(rule({ limit: "fiveDay" }), days(20, 9));
    expect(s).toMatchObject({ actualHours: 180, excessHours: 4, overtimeHours: 4, fullOvertimeHours: 4, premiumOnlyHours: 0, innerHours: 0, shortageHours: 0 });
  });
  test("総労働時間が総枠を超えるとき（原則・176時間）：総労働時間どおり働いても、総枠を超えた4時間36分は割増だけを払う", () => {
    const s = settle(rule(), days(22, 8));
    expect(s).toMatchObject({ excessHours: 0, fullOvertimeHours: 0, shortageHours: 0 });
    expect(min(s.premiumOnlyHours)).toBe(276);
  });
  test("総労働時間160時間：168時間なら8時間は法定内、175時間なら総枠を超えた3時間36分が時間外", () => {
    const fixed = rule({ total: { mode: "fixed", hours: 160 } });
    expect(settle(fixed, days(21, 8))).toMatchObject({ excessHours: 8, innerHours: 8, overtimeHours: 0 });
    const s = settle(fixed, [...days(21, 8), { work_date: "2026-06-30", work_type: "normal", work_hours: 7 }]);
    expect(s.excessHours).toBe(15);
    expect([min(s.overtimeHours), min(s.fullOvertimeHours), min(s.innerHours)]).toEqual([216, 216, 15 * 60 - 216]);
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

describe("不足時間（清算期間1か月）", () => {
  const fixed160 = { total: { mode: "fixed" as const, hours: 160 } };
  test("清算期間の終わりに清算：足りない時間を給与から引く", () => {
    expect(settle(rule(fixed160), days(19, 8).concat(days(1, 2).map((r) => ({ ...r, work_date: "2026-06-25" })))))
      .toMatchObject({ actualHours: 154, shortageHours: 6, deductHours: 6, carryOutHours: 0 });
  });
  test("次の清算期間に繰り越す：法定の総枠と総労働時間の差（11時間24分）まで。残りはその月で引く", () => {
    const carry = rule({ ...fixed160, shortage: "carry" });
    expect(settle(carry, days(19, 8).concat([{ work_date: "2026-06-25", work_type: "normal", work_hours: 2 }])))
      .toMatchObject({ shortageHours: 6, carryOutHours: 6, deductHours: 0 });
    const s = settle(carry, days(18, 8).concat([{ work_date: "2026-06-25", work_type: "normal", work_hours: 1 }]));
    expect(s.shortageHours).toBe(15);
    expect([min(s.carryOutHours), min(s.deductHours)]).toEqual([11 * 60 + 24, 15 * 60 - (11 * 60 + 24)]);
    expect(s.notes.join("")).toContain("繰り越せるのは");
  });
  test("退職する月は、繰り越さずに引く", () => {
    const s = settleFlex({ ...JUNE, rule: rule({ ...fixed160, shortage: "carry" }), rows: days(19, 8), carryInHours: 0, retiring: true });
    expect([s.shortageHours, s.carryOutHours, s.deductHours]).toEqual([8, 0, 8]);
    expect(s.notes.join("")).toContain("退職するので");
  });
  test("前の清算期間から繰り越した時間は、総労働時間に足す。総枠を超えた時間には割増を払う", () => {
    const fixed = rule(fixed160);
    expect(settle(fixed, days(20, 8).concat([{ work_date: "2026-06-25", work_type: "normal", work_hours: 6 }]), 6))
      .toMatchObject({ requiredHours: 166, carryInHours: 6, excessHours: 0, shortageHours: 0 });
    // 総労働時間168時間 ＋ 繰り越し6時間 ＝ 174時間（総枠171時間24分を超える）。174時間働いたら、総枠を超えた2時間36分は割増だけ
    const s = settle(rule({ total: { mode: "fixed", hours: 168 } }), days(21, 8).concat([{ work_date: "2026-06-25", work_type: "normal", work_hours: 6 }]), 6);
    expect(s).toMatchObject({ requiredHours: 174, excessHours: 0, shortageHours: 0 });
    expect(min(s.premiumOnlyHours)).toBe(156);
  });
});

describe("日給制（日給を払った日数 × 1日の所定労働時間 ＋ 有給の時間と比べる）", () => {
  const base = { ...JUNE, rule: rule({ total: { mode: "fixed", hours: 160 } }), wageType: "daily", carryInHours: 0 };
  test("20日に日給を払い、年休1日、実労働170時間：総労働時間は 160 ＋ 8 ＝ 168時間で、超えた10時間は法定内（決めた時間は使わない）", () => {
    const rows = [...days(17, 10), { work_date: "2026-06-18", work_type: "normal", work_hours: 0 }, { work_date: "2026-06-20", work_type: "paid_full", work_hours: 0 }];
    const s = settleFlex({ ...base, rows, coveredHours: 20 * 8 });
    expect(s).toMatchObject({ totalHours: 168, requiredHours: 168, actualHours: 170, leaveHours: 8, excessHours: 10, innerHours: 10, overtimeHours: 0 });
  });
  test("欠勤の日は日給を払わないので、足りない時間にしない。働いた日の時間が短ければ、その分が足りない時間", () => {
    const s = settleFlex({ ...base, rows: days(19, 7.5), coveredHours: 19 * 8 });
    expect(s).toMatchObject({ requiredHours: 152, actualHours: 142.5, shortageHours: 9.5, deductHours: 9.5 });
  });
});

/** 清算期間（3か月など）の月を、前の月から順に清算する。hours は各月の実労働（その月の初めの日に1行で入れる） */
const runPeriod = (
  months: { from: string; to: string; hours: number; workDays?: number; rows?: FlexAttendanceRow[] }[],
  o: { rule?: FlexRule; periodStart?: string; periodEnd?: string; carryInHours?: number; retiring?: boolean; wageType?: string } = {},
) => {
  const r = o.rule ?? rule({ months: months.length as 1 | 2 | 3, total: { mode: "fixed", hours: 160 } });
  const periodStart = o.periodStart ?? months[0].from;
  const periodEnd = o.periodEnd ?? months[months.length - 1].to;
  const previous: FlexMonthRecord[] = [];
  return months.map((m, index) => {
    const final = index === months.length - 1;
    const s = settleFlex({
      rule: r, from: m.from, to: m.to, workDays: m.workDays ?? 20, periodWorkDays: m.workDays ?? 20, dayHours: 8,
      carryInHours: o.carryInHours ?? 0, wageType: o.wageType,
      rows: m.rows ?? [{ work_date: m.from, work_type: "normal", work_hours: m.hours }],
      retiring: final ? o.retiring : false,
      multi: { months: r.months, index, final, periodStart, periodEnd, previous: [...previous] },
    });
    previous.push(s.record);
    return s;
  });
};
const Q2 = [{ from: "2026-04-01", to: "2026-04-30" }, { from: "2026-05-01", to: "2026-05-31" }, { from: "2026-06-01", to: "2026-06-30" }];
const Q3 = [{ from: "2026-07-01", to: "2026-07-31" }, { from: "2026-08-01", to: "2026-08-31" }, { from: "2026-09-01", to: "2026-09-30" }];
const Q4 = [{ from: "2026-10-01", to: "2026-10-31" }, { from: "2026-11-01", to: "2026-11-30" }, { from: "2026-12-01", to: "2026-12-31" }];
const Q1 = [{ from: "2027-01-01", to: "2027-01-31" }, { from: "2027-02-01", to: "2027-02-28" }, { from: "2027-03-01", to: "2027-03-31" }];
const withHours = (q: { from: string; to: string }[], hours: number[]) => q.map((m, i) => ({ ...m, hours: hours[i] }));
/** 各月の時間外労働（0.1時間の単位） */
const overtimeTenths = (ss: ReturnType<typeof runPeriod>) => ss.map((s) => Math.round(s.overtimeHours * 10));

describe("清算期間が3か月（厚生労働省「フレックスタイム制のわかりやすい解説＆導入の手引き」の例と同じ数字になる）", () => {
  test("時間外労働時間の算定の例：4月220・5月180・6月140時間 → 4月 5.8時間（週平均50時間 214.2時間を超えた）、6月 14.2時間（540 − 5.8 − 520）", () => {
    const [apr, may, jun] = runPeriod(withHours(Q2, [220, 180, 140]));
    expect([apr.final, may.final, jun.final]).toEqual([false, false, true]);
    expect(overtimeTenths([apr, may, jun])).toEqual([58, 0, 142]);
    expect([min(apr.monthLimit50Hours!), min(may.monthLimit50Hours!), min(jun.monthLimit50Hours!)]).toEqual([2142 * 6, 2214 * 6, 2142 * 6]);
    // 途中の月は、週平均50時間を超えた時間を、通常の賃金も払う時間外にする（過不足は最後の月）
    expect(apr).toMatchObject({ fullOvertimeHours: apr.overtimeHours, premiumOnlyHours: 0, innerHours: 0, shortageHours: 0, deductHours: 0 });
    expect(jun).toMatchObject({ limitHours: 520, actualHours: 540, partial: false });
    expect([min(jun.previousOver50Hours), min(jun.periodOverHours)]).toEqual([348, 852]);
    // 総労働時間 160 × 3 ＝ 480時間：超えた60時間のうち、4月に払った5.8時間を除いて、時間外14.2時間・法定内40時間
    expect(jun.excessHours).toBe(60);
    expect([min(jun.fullOvertimeHours), min(jun.innerHours), jun.premiumOnlyHours]).toEqual([852, 40 * 60, 0]);
  });
  test("時間外労働の上限規制の例（ⅰ）：4〜6月 45.8・0・49.2、7〜9月 48.6・0・45.7、10〜12月 0・55.8・48.5、1〜3月 0・0・45.8時間", () => {
    expect(overtimeTenths(runPeriod(withHours(Q2, [260, 220, 135])))).toEqual([458, 0, 492]);
    expect(overtimeTenths(runPeriod(withHours(Q3, [270, 220, 130])))).toEqual([486, 0, 457]);
    expect(overtimeTenths(runPeriod(withHours(Q4, [220, 270, 140])))).toEqual([0, 558, 485]);
    expect(overtimeTenths(runPeriod(withHours(Q1, [220, 200, 140])))).toEqual([0, 0, 458]);
  });
  test("例（ⅱ）（ⅲ）：各月は週平均50時間の中でも、最後の月に総枠を超えた時間がまとめて時間外になる（6月 95.0時間・89.0時間、9月 67.1時間）", () => {
    expect(overtimeTenths(runPeriod(withHours(Q2, [210, 220, 185])))).toEqual([0, 0, 950]);
    expect(overtimeTenths(runPeriod(withHours(Q2, [210, 220, 179])))).toEqual([0, 0, 890]);
    expect(overtimeTenths(runPeriod(withHours(Q3, [271, 295, 150])))).toEqual([496, 736, 671]);
  });
  test("最後の月そのものが週平均50時間を超えたら、その時間は時間外（総枠を超えた時間と重ねて数えない）", () => {
    const [, , jun] = runPeriod(withHours(Q2, [150, 150, 240]));
    expect([Math.round(jun.over50Hours * 10), jun.periodOverHours, Math.round(jun.overtimeHours * 10)]).toEqual([258, 0, 258]);
  });
  test("総労働時間に足りなければ、最後の月に引く（前の月に払った時間外の賃金は引き戻さない）", () => {
    const [apr, , jun] = runPeriod(withHours(Q2, [230, 130, 100]));
    expect(Math.round(apr.overtimeHours * 10)).toBe(158);
    expect(jun).toMatchObject({ actualHours: 460, requiredHours: 480, shortageHours: 20, deductHours: 20, overtimeHours: 0, excessHours: 0 });
  });
  test("総労働時間を超えた時間が、前の月に払った時間外より少なければ、法定内も時間外もない", () => {
    const [, , jun] = runPeriod(withHours(Q2, [230, 140, 120]));
    expect(jun).toMatchObject({ actualHours: 490, excessHours: 10, innerHours: 0, fullOvertimeHours: 0, overtimeHours: 0, shortageHours: 0 });
  });
  test("完全週休2日制の特例：法定の総枠は、清算期間の所定労働日数 × 8時間", () => {
    const r = rule({ months: 3, limit: "fiveDay" });
    const [, , jun] = runPeriod(Q2.map((m, i) => ({ ...m, hours: 180, workDays: [21, 19, 22][i] })), { rule: r });
    expect(jun).toMatchObject({ limitHours: 62 * 8, totalHours: 62 * 8, actualHours: 540, periodOverHours: 540 - 62 * 8 });
  });
  test("不足時間を次の清算期間に繰り越す：法定の総枠と総労働時間の差まで（520 − 480 ＝ 40時間）", () => {
    const r = rule({ months: 3, shortage: "carry", total: { mode: "fixed", hours: 160 } });
    const [, , jun] = runPeriod(withHours(Q2, [150, 150, 130]), { rule: r });
    expect(jun).toMatchObject({ shortageHours: 50, carryOutHours: 40, deductHours: 10 });
    // 前の清算期間から繰り越した時間は、清算する月の総労働時間に足す
    const [, , next] = runPeriod(withHours(Q3, [170, 170, 180]), { rule: r, carryInHours: 20 });
    expect(next).toMatchObject({ carryInHours: 20, requiredHours: 500, actualHours: 520, excessHours: 20, shortageHours: 0 });
  });
});

describe("清算期間の途中で入社・退職した人（働いた期間で清算する。労働基準法32条の3の2）", () => {
  test("5月31日に退職：退職する月（5月）に、4・5月の61日で清算する（総枠 40 × 61 ÷ 7 ＝ 348.5時間。4月の週平均50時間超 5.8時間を除いて 45.7時間）", () => {
    const ss = runPeriod(withHours(Q2.slice(0, 2), [220, 180]), { rule: rule({ months: 3, shortage: "carry", total: { mode: "fixed", hours: 160 } }), periodEnd: "2026-06-30", retiring: true });
    const may = ss[1];
    expect(may).toMatchObject({ final: true, partial: true, actualHours: 400, requiredHours: 320, excessHours: 80 });
    expect([min(may.limitHours), Math.round(may.overtimeHours * 10)]).toEqual([3485 * 6, 457]);
    expect(may.notes.join("")).toContain("清算期間の途中で退職するので、働いた期間（61日）で清算します");
    const short = runPeriod(withHours(Q2.slice(0, 2), [150, 140]), { rule: rule({ months: 3, shortage: "carry", total: { mode: "fixed", hours: 160 } }), periodEnd: "2026-06-30", retiring: true })[1];
    expect(short).toMatchObject({ shortageHours: 30, carryOutHours: 0, deductHours: 30 });
  });
  test("4月16日に入社：入社した月の週平均50時間は在籍した15日で数え（107.1時間）、最後の月に入社してからの76日で清算する", () => {
    const months = [{ from: "2026-04-16", to: "2026-04-30", hours: 110, workDays: 11 }, ...withHours(Q2.slice(1), [180, 170])];
    const [apr, , jun] = runPeriod(months, { rule: rule({ months: 3, total: { mode: "workdays" } }), periodStart: "2026-04-01" });
    expect([min(apr.monthLimit50Hours!), Math.round(apr.over50Hours * 10)]).toEqual([1071 * 6, 29]);
    expect(jun).toMatchObject({ partial: true, actualHours: 460, totalHours: (11 + 20 + 20) * 8 });
    // 総枠 40 × 76 ÷ 7 ＝ 434.2時間。460 − 2.9 − 434.2 ＝ 22.9時間
    expect([min(jun.limitHours), Math.round(jun.periodOverHours * 10)]).toEqual([4342 * 6, 229]);
    expect(jun.notes.join("")).toContain("入社したので、働いた期間（76日）");
  });
});

describe("清算期間の位置（給与の計算期間の月で数える）", () => {
  const monthEnd = { closing_day: 99, is_next_month: 1 };
  test("3か月・1月・4月・7月・10月から・末日締め翌月払い：7月支給（6月の計算期間）は4〜6月の3か月目", () => {
    const p = flexPositionOf(rule({ months: 3, startMonth: 1 }), monthEnd, 2026, 7);
    expect(p).toMatchObject({ months: 3, index: 2, from: "2026-04-01", to: "2026-06-30", label: "2026年4月1日〜6月30日" });
    expect(p.previousPays).toEqual([{ year: 2026, month: 5 }, { year: 2026, month: 6 }]);
    expect([p.finalPay, p.carryFrom]).toEqual([{ year: 2026, month: 7 }, { year: 2026, month: 4 }]);
  });
  test("15日締め当月払い：5月支給（4月16日〜5月15日）は、4月の計算期間（3月16日〜）から始まる清算期間の2か月目", () => {
    const p = flexPositionOf(rule({ months: 3, startMonth: 1 }), { closing_day: 15, is_next_month: 0 }, 2026, 5);
    expect(p).toMatchObject({ index: 1, from: "2026-03-16", to: "2026-06-15" });
    expect([p.previousPays, p.finalPay, p.carryFrom]).toEqual([[{ year: 2026, month: 4 }], { year: 2026, month: 6 }, { year: 2026, month: 3 }]);
  });
  test("年をまたぐ清算期間（2月・5月・8月・11月から）と、2か月・1か月", () => {
    const p = flexPositionOf(rule({ months: 3, startMonth: 2 }), { closing_day: 99, is_next_month: 0 }, 2027, 1);
    expect(p).toMatchObject({ index: 2, from: "2026-11-01", to: "2027-01-31", label: "2026年11月1日〜2027年1月31日" });
    expect(flexPositionOf(rule({ months: 2, startMonth: 2 }), { closing_day: 99, is_next_month: 0 }, 2026, 3).index).toBe(1);
    const one = flexPositionOf(DEFAULT_FLEX_RULE, monthEnd, 2026, 7);
    expect(one).toMatchObject({ months: 1, index: 0, from: "2026-06-01", to: "2026-06-30" });
    expect([one.previousPays, one.carryFrom]).toEqual([[], { year: 2026, month: 6 }]);
  });
});

describe("前の月の記録を、確定した給与から読む", () => {
  const setup = () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE payroll_groups (id INTEGER PRIMARY KEY, closing_day INTEGER, is_next_month INTEGER)");
    db.exec("CREATE TABLE salary_results (staff_id TEXT, target_year INTEGER, target_month INTEGER, flex_carry_hours REAL, flex_month TEXT)");
    db.exec("INSERT INTO payroll_groups VALUES (1, 99, 1)");
    return { db, asyncDb: { select: async (sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as never[])) } };
  };
  const r3 = rule({ months: 3, total: { mode: "fixed", hours: 160 } });
  test("同じ清算期間の前の月の記録・前の清算期間からの繰り越しを読み、確定していない月を知らせる", async () => {
    const { db, asyncDb } = setup();
    const [apr] = runPeriod(withHours(Q2, [220, 180, 140]));
    db.prepare("INSERT INTO salary_results VALUES (?, ?, ?, ?, ?)").run("S001", 2026, 4, 12, null);
    db.prepare("INSERT INTO salary_results VALUES (?, ?, ?, ?, ?)").run("S001", 2026, 5, 0, JSON.stringify(apr.record));
    const ctx = await loadFlexPeriod(asyncDb, { id: "S001", payroll_group_id: 1 }, r3, 2026, 7);
    expect([ctx.index, ctx.previous.length, ctx.carryIn]).toEqual([2, 1, 12]);
    expect(ctx.previous[0]).toEqual(apr.record);
    expect(ctx.missing).toEqual(["2026年6月支給の給与を確定していません"]);
  });
  test("入社する前の月は記録がなくてよい。別の決まりで確定した月は、確定し直してもらう", async () => {
    const { db, asyncDb } = setup();
    const one = settleFlex({ ...JUNE, from: "2026-05-01", to: "2026-05-31", rule: DEFAULT_FLEX_RULE, rows: [], carryInHours: 0 });
    db.prepare("INSERT INTO salary_results VALUES (?, ?, ?, ?, ?)").run("S001", 2026, 6, 0, JSON.stringify(one.record));
    const ctx = await loadFlexPeriod(asyncDb, { id: "S001", payroll_group_id: 1, join_date: "2026-05-01" }, r3, 2026, 7);
    expect(ctx.previous).toEqual([]);
    expect(ctx.missing).toEqual(["2026年6月支給の給与に、この清算期間のフレックスタイム制の記録がありません（その月を確定し直してください）"]);
  });
  test("記録の JSON が読めなければ null", () => {
    expect(parseFlexMonthRecord(null)).toBeNull();
    expect(parseFlexMonthRecord("{}")).toBeNull();
    expect(parseFlexMonthRecord("こわれた値")).toBeNull();
  });
});

describe("画面と給与明細に出す文", () => {
  test("途中の月：この月の実労働と週平均50時間を超えた時間、最後の月にまとめて清算すること", () => {
    const [apr] = runPeriod(withHours(Q2, [220, 180, 140]));
    const t = describeFlexSettlement({ ...apr, periodLabel: "2026年4月1日〜6月30日", finalPayLabel: "2026年7月支給" });
    expect(t.title).toBe("フレックスタイム制（清算期間 2026年4月1日〜6月30日・3か月の1か月目）");
    expect(t.lines).toEqual([
      "この月の実労働 220時間・週平均50時間の上限 214時間12分（50時間 × 30日 ÷ 7） → 超えた 5時間48分 は、この月の時間外労働として払います",
      "総労働時間との過不足と、法定の総枠を超えた時間は、清算期間の最後の月（2026年7月支給）の給与でまとめて清算します",
    ]);
  });
  test("最後の月：清算期間の合計と、前の月に払った時間外を除いたこと", () => {
    const [, , jun] = runPeriod(withHours(Q2, [220, 180, 140]));
    const t = describeFlexSettlement({ ...jun, periodLabel: "2026年4月1日〜6月30日" });
    expect(t.title).toBe("フレックスタイム制（清算期間 2026年4月1日〜6月30日・3か月の最後の月。清算期間の合計で清算します）");
    expect(t.lines).toEqual([
      "総労働時間 480時間・法定の総枠 520時間・実労働 540時間（この月の実労働 140時間）",
      "この月の週平均50時間の上限 214時間12分 → 超えていません。清算期間を通じて法定の総枠を超えた時間 14時間12分（前の月までに時間外労働として払った 5時間48分 を除く） → この月の時間外労働 14時間12分",
      "総労働時間を超えた時間 60時間（法定内 40時間・時間外 14時間12分・前の月までに払った時間外 5時間48分）",
    ]);
  });
  test("清算期間1か月：いままでどおりの見出しで、時給制は足りない時間を引かない", () => {
    const s = settle(rule({ total: { mode: "fixed", hours: 160 } }), days(19, 8));
    expect(describeFlexSettlement({ ...s, deductHours: 0 }, "hourly")).toEqual({
      title: "フレックスタイム制（清算期間はこの計算期間）",
      lines: ["総労働時間 160時間・法定の総枠 171時間24分・実労働 152時間", "足りない時間 8時間（時給制なので引きません）"],
    });
  });
});
