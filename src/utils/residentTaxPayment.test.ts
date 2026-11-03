/**
 * 住民税（特別徴収）の納入（residentTaxPayment.ts）のテスト
 * 実行方法: bun test
 */
import { describe, expect, test } from "bun:test";
import { simpleAmounts, stringifyResidentTaxSchedule } from "./residentTax";
import { buildPaymentSummary, rollForward, specialPeriodOf, statutoryDueOf } from "./residentTaxPayment";

describe("納期限", () => {
  test("毎月：引いた月の翌月10日（12月分は翌年1月10日）", () => {
    expect(statutoryDueOf(2026, 6, false)).toBe("2026-07-10");
    expect(statutoryDueOf(2026, 12, false)).toBe("2027-01-10");
  });
  test("納期の特例：6月〜11月分は12月10日、12月〜翌年5月分は6月10日", () => {
    expect(statutoryDueOf(2026, 6, true)).toBe("2026-12-10");
    expect(statutoryDueOf(2026, 11, true)).toBe("2026-12-10");
    expect(statutoryDueOf(2026, 12, true)).toBe("2027-06-10");
    expect(statutoryDueOf(2027, 5, true)).toBe("2027-06-10");
  });
  test("納期の特例の期間", () => {
    expect(specialPeriodOf(2026, 8)).toEqual([[2026, 6], [2026, 7], [2026, 8], [2026, 9], [2026, 10], [2026, 11]]);
    expect(specialPeriodOf(2027, 2)).toEqual([[2026, 12], [2027, 1], [2027, 2], [2027, 3], [2027, 4], [2027, 5]]);
  });
  test("土曜日・日曜日・祝日なら次の日", () => {
    expect(rollForward("2026-07-10", new Set())).toBe("2026-07-10"); // 金曜日
    expect(rollForward("2026-10-10", new Set())).toBe("2026-10-12"); // 土曜日 → 月曜日
    expect(rollForward("2026-10-10", new Set(["2026-10-12"]))).toBe("2026-10-13"); // 月曜日も祝日なら火曜日
    expect(rollForward("2026-12-29", new Set())).toBe("2027-01-01"); // 12月29日〜31日も延ばす
  });
});

describe("納付先ごとの額", () => {
  const staff = [
    // 2026年度は横浜市の通知（その後、従業員の市区町村を千代田区に直した）
    { id: "1", name: "国税 太郎", join_date: "2010-04-01", resident_tax_municipality: "131016", resident_tax_schedule: stringifyResidentTaxSchedule([{ fiscalYear: 2026, amounts: simpleAmounts(10900, 10700), municipality: "141003" }]) },
    { id: "2", name: "国税 花子", join_date: "2010-04-01", resident_tax_municipality: "131016", resident_tax_schedule: stringifyResidentTaxSchedule([{ fiscalYear: 2026, amounts: simpleAmounts(8500, 8100) }]) },
    { id: "3", name: "国税 次郎", join_date: "2010-04-01", resident_tax_municipality: "131016", resident_tax_schedule: stringifyResidentTaxSchedule([{ fiscalYear: 2026, amounts: simpleAmounts(5000, 5000) }]) },
    { id: "4", name: "退職 四郎", join_date: "2010-04-01", retirement_date: "2026-05-31", resident_tax_municipality: "131016", resident_tax_schedule: stringifyResidentTaxSchedule([{ fiscalYear: 2026, amounts: simpleAmounts(3000, 3000) }]) },
  ];
  const salaries = [
    { staff_id: "1", target_year: 2026, target_month: 7, resident_tax: 10700 },
    { staff_id: "2", target_year: 2026, target_month: 6, resident_tax: 8500 },
    { staff_id: "2", target_year: 2026, target_month: 7, resident_tax: 8100 },
  ];
  test("毎月：その月に引いた額を、年度の納付先ごとに合計する。確定していない人は別に出す", () => {
    const s = buildPaymentSummary(staff, salaries, {}, 2026, 7, new Set());
    expect(s.groups.map((g) => [g.code, g.total, g.due, g.people.map((p) => p.name)])).toEqual([
      ["131016", 8100, "2026-08-10", ["国税 花子"]],
      ["141003", 10700, "2026-08-10", ["国税 太郎"]],
    ]);
    expect(s.pending).toEqual([{ staffId: "3", name: "国税 次郎", code: "131016", expected: 5000 }]); // 退職した人は出さない
  });
  test("納期の特例：期間の6か月の合計（確定していない月は空）で、12月10日まで", () => {
    const s = buildPaymentSummary(staff, salaries, { "131016": { designation: "", atena: "", specialDue: true } }, 2026, 7, new Set());
    const chiyoda = s.groups.find((g) => g.code === "131016")!;
    expect([chiyoda.total, chiyoda.statutoryDue, chiyoda.due]).toEqual([16600, "2026-12-10", "2026-12-10"]);
    expect(chiyoda.people[0].byMonth).toEqual([8500, 8100, null, null, null, null]);
  });
});
