/**
 * 残業代の割増率（premiumRates.ts）のテスト
 * 実行方法: bun test
 */
import { describe, expect, test } from "bun:test";
import {
  kyoteiOverLimitRates, kyoteiRateGaps, LEGAL_PREMIUM_RATES, overtimeSegments, parsePremiumRates, premiumLineNames, premiumRateProblems,
  stringifyPremiumRates, sumYearOvertime, yearStartOf, type PremiumRates,
} from "./premiumRates";
import { emptyKyotei36, emptySpecialRow } from "./kyotei36";

const rates = (o: Partial<PremiumRates>): PremiumRates => ({ ...LEGAL_PREMIUM_RATES, ...o });
const seg = (p: Partial<Parameters<typeof overtimeSegments>[0]>) => overtimeSegments({
  hours: 0, within: 0, monthSoFar: 0, yearSoFar: null, workDate: "2026-06-10", isSmallBusiness: false, rates: LEGAL_PREMIUM_RATES, ...p,
}).map((s) => [s.hours, s.within, s.rate, s.high, s.overLimitMonth, s.overLimitYear]);

describe("割増率の決まり（法律の率より低くはできない。入れていない欄は法律の率）", () => {
  test("法律の率：時間外25%・月60時間超50%・休日35%・深夜25%・法定内残業0%（限度時間を超えた分も25%）", () => {
    expect(LEGAL_PREMIUM_RATES).toEqual({ overtime: 25, overLimitMonth: 25, over60: 50, overLimitYear: 25, holiday: 35, night: 25, statutory: 0 });
  });
  test("保存した率を読む：法律の率より低い欄・読めない欄は法律の率。法律の率と同じなら保存しない（null）", () => {
    expect(parsePremiumRates(null)).toEqual(LEGAL_PREMIUM_RATES);
    expect(parsePremiumRates("壊れた")).toEqual(LEGAL_PREMIUM_RATES);
    expect(parsePremiumRates(JSON.stringify({ overtime: 30, holiday: 20, night: "x", statutory: 25 })))
      .toEqual(rates({ overtime: 30, statutory: 25 }));
    expect(stringifyPremiumRates(LEGAL_PREMIUM_RATES)).toBeNull();
    expect(JSON.parse(stringifyPremiumRates(rates({ overLimitMonth: 35 }))!)).toMatchObject({ overLimitMonth: 35, overtime: 25 });
  });
  test("入れた率の誤り：法律の率より低い・数でない", () => {
    expect(premiumRateProblems(LEGAL_PREMIUM_RATES)).toEqual([]);
    expect(premiumRateProblems(rates({ over60: 40 }))[0]).toContain("法律の率（50%）より低くできません");
    expect(premiumRateProblems(rates({ night: NaN }))[0]).toContain("数で入れてください");
  });
});

describe("時間外労働を率の違う段に分ける（月45時間・60時間・年360時間。所定労働時間の中の時間ははじめの方）", () => {
  test("法律の率なら、60時間までは25%、60時間を超えた分は50%（いままでと同じ）", () => {
    expect(seg({ hours: 10, monthSoFar: 55 })).toEqual([[5, false, 25, false, true, false], [5, false, 50, true, true, false]]);
  });
  test("月40時間まで働いた人の10時間（うち所定の中が2時間）：45時間を超えた5時間は、限度時間を超えた分の率（35%）", () => {
    expect(seg({ hours: 10, within: 2, monthSoFar: 40, rates: rates({ overLimitMonth: 35 }) })).toEqual([
      [2, true, 25, false, false, false],
      [3, false, 25, false, false, false],
      [5, false, 35, false, true, false],
    ]);
  });
  test("年の限度時間：36協定の年のそれまでの時間外労働が355時間なら、6時間目から年360時間を超えた分の率（40%）。わからなければ使わない", () => {
    const r = rates({ overLimitYear: 40 });
    expect(seg({ hours: 10, monthSoFar: 10, yearSoFar: 355, rates: r })).toEqual([[5, false, 25, false, false, false], [5, false, 40, false, false, true]]);
    expect(seg({ hours: 10, monthSoFar: 10, yearSoFar: null, rates: r })).toEqual([[10, false, 25, false, false, false]]);
    // 60時間を超えた時間でも、年の率の方が高ければ年の率
    expect(seg({ hours: 2, monthSoFar: 60, yearSoFar: 400, rates: rates({ overLimitYear: 60 }) })).toEqual([[2, false, 60, true, true, true]]);
  });
  test("時間外労働の率の方が高ければ、限度時間を超えた分もその率（率が重なる時間は高い方）", () => {
    expect(seg({ hours: 2, monthSoFar: 44, rates: rates({ overtime: 30 }) })).toEqual([[1, false, 30, false, false, false], [1, false, 30, false, true, false]]);
  });
  test("中小企業が2023年3月31日までに働かせた60時間を超えた分は、60時間超の率にしない（猶予）", () => {
    const s = overtimeSegments({ hours: 4, within: 0, monthSoFar: 58, yearSoFar: null, workDate: "2023-03-31", isSmallBusiness: true, rates: LEGAL_PREMIUM_RATES });
    expect(s.map((x) => [x.hours, x.rate, x.high, x.deferred])).toEqual([[2, 25, false, false], [2, 25, false, true]]);
  });
});

describe("36協定の年（起算日から1年）と、この給与より前の時間外労働", () => {
  test("その日が入る協定の年の初めの日（2月29日の起算日は、うるう年でない年は2月28日）", () => {
    expect(yearStartOf("2026-04-01", "2026-03-31")).toBe("2025-04-01");
    expect(yearStartOf("2026-04-01", "2026-04-01")).toBe("2026-04-01");
    expect(yearStartOf("2025-04-01", "2027-11-30")).toBe("2027-04-01");
    expect(yearStartOf("2024-02-29", "2025-03-01")).toBe("2025-02-28");
    expect(yearStartOf("", "2026-04-01")).toBeNull();
  });
  test("賃金締切日がその年に入る、この給与より前の給与の時間外労働を足す（起算日がなければ null）", () => {
    const months = [
      { periodEnd: "2026-03-31", overtimeHours: 50 },
      { periodEnd: "2026-04-30", overtimeHours: 30 },
      { periodEnd: "2026-05-31", overtimeHours: 40 },
      { periodEnd: "2026-06-30", overtimeHours: 20 },
    ];
    expect(sumYearOvertime(months, "2026-04-01", "2026-06-30")).toBe(70);
    expect(sumYearOvertime(months, "2026-04-01", "2026-04-30")).toBe(0);
    expect(sumYearOvertime(months, null, "2026-06-30")).toBeNull();
  });
});

describe("36協定の「限度時間を超えた労働の割増率」と照らす", () => {
  const k = { ...emptyKyotei36(), special: true, specialRows: [{ ...emptySpecialRow(), monthRate: "30", yearRate: "25" }, { ...emptySpecialRow(), monthRate: "35％", yearRate: "" }] };
  test("協定の率（業務の行のうちいちばん高い率）より低ければ知らせる。時間外労働の率の方が高ければ知らせない", () => {
    expect(kyoteiOverLimitRates(k)).toEqual({ month: 35, year: 25 });
    expect(kyoteiOverLimitRates({ ...k, special: false })).toEqual({ month: null, year: null });
    expect(kyoteiRateGaps(LEGAL_PREMIUM_RATES, k, "本店")).toEqual([
      "本店の36協定では、1か月の限度時間を超えた時間外労働の割増率を35%と決めていますが、給与規定グループの率は25%です",
    ]);
    expect(kyoteiRateGaps(rates({ overLimitMonth: 35 }), k, "本店")).toEqual([]);
    expect(kyoteiRateGaps(rates({ overtime: 40 }), k, "本店")).toEqual([]);
  });
});

describe("給与明細・賃金台帳の行の名前", () => {
  test("法律の率なら、いままでと同じ名前", () => {
    expect(premiumLineNames(LEGAL_PREMIUM_RATES)).toEqual({
      statutory: "時間外手当(法定内)", standard: "時間外手当(25%割増)", high: "時間外手当(50%割増)", holiday: "休日出勤手当(35%割増)", night: "深夜手当",
    });
  });
  test("会社の率なら、その率を書く（限度時間を超えた分の率が高ければ、それも）", () => {
    expect(premiumLineNames(rates({ overtime: 30, overLimitMonth: 35, overLimitYear: 40, holiday: 40, night: 30, statutory: 25 }))).toEqual({
      statutory: "時間外手当(法定内・25%割増)", standard: "時間外手当(30%割増。月45時間超35%・年360時間超40%)", high: "時間外手当(50%割増)",
      holiday: "休日出勤手当(40%割増)", night: "深夜手当(30%割増)",
    });
  });
});
