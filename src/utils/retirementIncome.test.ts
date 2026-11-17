import { describe, expect, test } from "bun:test";
import {
  calcRetirement, defaultRetirementKind, emptyRetirementInput, noDeclarationTax, parseRetirementInput, quickTableOf, retirementDeduction,
  retirementIncomeTax, retirementLocalTax, retirementSummaryOf, servicePeriodOf, taxableRetirementIncome, type RetirementInput, type RetirementRecord,
} from "./retirementIncome";

const input = (o: Partial<RetirementInput>): RetirementInput => ({ ...emptyRetirementInput(), ...o });

describe("勤続年数・退職所得控除額", () => {
  test("1年未満の端数は1年（タックスアンサー No.2732 の例：10年2か月 → 11年、29年2か月 → 30年。手引の見本：平成19年4月1日〜令和8年12月20日 → 20年）", () => {
    expect(servicePeriodOf("2016-04-01", "2026-05-31")).toEqual({ years: 10, months: 2, days: 0, counted: 11 });
    expect(servicePeriodOf("1997-04-01", "2026-05-31")?.counted).toBe(30);
    expect(servicePeriodOf("2007-04-01", "2026-12-20")).toEqual({ years: 19, months: 8, days: 20, counted: 20 });
    // ちょうど10年は10年。1日でも超えれば11年
    expect(servicePeriodOf("2016-04-01", "2026-03-31")?.counted).toBe(10);
    expect(servicePeriodOf("2016-04-01", "2026-04-01")?.counted).toBe(11);
    expect(servicePeriodOf("2026-04-01", "2026-03-31")).toBeNull();
  });
  test("40万円 × 勤続年数（20年以下）、800万円 ＋ 70万円 ×（勤続年数 − 20年）、80万円未満は80万円、障害者は100万円を加える", () => {
    expect(retirementDeduction(11, false)).toBe(4_400_000);
    expect(retirementDeduction(30, false)).toBe(15_000_000);
    expect(retirementDeduction(20, false)).toBe(8_000_000);
    expect(retirementDeduction(1, false)).toBe(800_000);
    expect(retirementDeduction(1, true)).toBe(1_800_000);
    expect(retirementDeduction(30, true)).toBe(16_000_000);
  });
});

describe("課税退職所得金額と税額", () => {
  const t2026 = quickTableOf(2026)!;
  test("タックスアンサー No.2732 の例1（800万円・10年2か月）：控除 440万円・課税退職所得 180万円・所得税 91,890円", () => {
    const r = calcRetirement(2026, 8_000_000, false, input({ serviceFrom: "2016-04-01", serviceTo: "2026-05-31" }));
    expect([r.years, r.deduction, r.taxable, r.incomeTax, r.kind, r.section]).toEqual([11, 4_400_000, 1_800_000, 91_890, "general", "upper"]);
    expect([r.cityTax, r.prefTax]).toEqual([108_000, 72_000]);
    expect(r.netPay).toBe(8_000_000 - 91_890 - 108_000 - 72_000);
  });
  test("例2（2,300万円・29年2か月）：控除 1,500万円・課税退職所得 400万円・所得税 380,322円（380,322.5円の1円未満を切り捨て）", () => {
    const r = calcRetirement(2026, 23_000_000, false, input({ serviceFrom: "1997-04-01", serviceTo: "2026-05-31" }));
    expect([r.years, r.deduction, r.taxable, r.incomeTax, r.cityTax, r.prefTax]).toEqual([30, 15_000_000, 4_000_000, 380_322, 240_000, 160_000]);
  });
  test("申告書を出していない（800万円）：所得税は 1,633,600円（20.42％）。住民税は退職所得控除額を引いて計算する", () => {
    expect(noDeclarationTax(8_000_000)).toBe(1_633_600);
    const r = calcRetirement(2026, 8_000_000, false, input({ serviceFrom: "2016-04-01", serviceTo: "2026-05-31", declared: false }));
    expect([r.section, r.incomeTax, r.cityTax, r.prefTax]).toEqual(["lower", 1_633_600, 108_000, 72_000]);
  });
  test("法定調書の手引 第3章の見本（1,000万円・20年）：控除 800万円・所得税 51,050円・市町村民税 60,000円・道府県民税 40,000円", () => {
    const r = calcRetirement(2026, 10_000_000, false, input({ serviceFrom: "2007-04-01", serviceTo: "2026-12-20" }));
    expect([r.years, r.deduction, r.taxable, r.incomeTax, r.cityTax, r.prefTax]).toEqual([20, 8_000_000, 1_000_000, 51_050, 60_000, 40_000]);
  });
  test("課税退職所得金額の1,000円未満と、住民税の100円未満は切り捨て", () => {
    // 6,468,000円・10年：（6,468,000 − 4,000,000）× 1/2 ＝ 1,234,000円。所得税 61,700 × 102.1％ ＝ 62,995.7 → 62,995円
    const r = calcRetirement(2026, 6_468_000, false, input({ serviceFrom: "2016-04-01", serviceTo: "2026-03-31" }));
    expect([r.taxable, r.incomeTax, r.cityTax, r.prefTax]).toEqual([1_234_000, 62_995, 74_000, 49_300]);
    expect(taxableRetirementIncome(6_469_999, 4_000_000, "general")).toBe(1_234_000);
    expect(retirementLocalTax(1_234_000)).toEqual({ city: 74_000, pref: 49_300 });
  });
  test("短期退職手当等（役員でない人・勤続5年以下）：残額が300万円を超える分は 1/2 にしない", () => {
    expect(defaultRetirementKind(5, false, null)).toBe("short");
    expect(defaultRetirementKind(6, false, null)).toBe("general");
    // 600万円・3年：控除 120万円、残額 480万円 → 150万円 ＋（600万円 −（300万円 ＋ 120万円））＝ 330万円
    const r = calcRetirement(2026, 6_000_000, false, input({ serviceFrom: "2023-04-01", serviceTo: "2026-03-31" }));
    expect([r.kind, r.deduction, r.taxable, r.incomeTax, r.cityTax, r.prefTax]).toEqual(["short", 1_200_000, 3_300_000, 237_382, 198_000, 132_000]);
    expect(r.remarks).toContain("短期退職手当等 6,000,000円・短期勤続年数 3年（令和5年4月1日～令和8年3月31日（3年））");
    // 残額が300万円以下なら 1/2
    expect(taxableRetirementIncome(3_000_000, 1_200_000, "short")).toBe(900_000);
  });
  test("特定役員退職手当等（役員等勤続年数5年以下の役員）：1/2 にしない", () => {
    expect(defaultRetirementKind(4, true, null)).toBe("officer");
    expect(defaultRetirementKind(12, true, 8)).toBe("general");
    // 2,000万円・4年：控除 160万円 → 1,840万円。（18,400,000 × 40％ − 2,796,000）× 102.1％ ＝ 4,659,844円
    const r = calcRetirement(2026, 20_000_000, true, input({ serviceFrom: "2022-06-30", serviceTo: "2026-06-29" }));
    expect([r.kind, r.deduction, r.taxable, r.incomeTax, r.cityTax, r.prefTax]).toEqual(["officer", 1_600_000, 18_400_000, 4_659_844, 1_104_000, 736_000]);
    // 役員になる前に使用人だった期間があるときは知らせる
    const mixed = calcRetirement(2026, 20_000_000, true, input({ serviceFrom: "2010-04-01", serviceTo: "2026-06-29", officerYears: 3 }));
    expect(mixed.kind).toBe("officer");
    expect(mixed.notes.some((n) => n.includes("No.2741"))).toBe(true);
  });
  test("障害者になったことが原因の退職：100万円を加え、摘要に（障）", () => {
    const r = calcRetirement(2026, 3_000_000, false, input({ serviceFrom: "2025-10-01", serviceTo: "2026-03-31", disability: true }));
    expect([r.years, r.deduction, r.taxable]).toEqual([1, 1_800_000, 600_000]);
    expect(r.remarks).toContain("（障）");
  });
  test("その年に支払済みの他の退職手当等（中段）：合計額で計算した税額から、他の退職手当等の税額を引く", () => {
    // 他の退職手当等 500万円・8年（所得税 45,945円・住民税 54,000円と36,000円）、この退職手当等 300万円・10年
    const other = { payer: "株式会社まえの", amount: 5_000_000, years: 8, incomeTax: 45_945, cityTax: 54_000, prefTax: 36_000 };
    const r = calcRetirement(2026, 3_000_000, false, input({ serviceFrom: "2016-04-01", serviceTo: "2026-03-31", other }));
    // 合計 800万円・10年：控除 400万円 → 200万円。（2,000,000 × 10％ − 97,500）× 102.1％ ＝ 104,652円 − 45,945円
    expect([r.section, r.years, r.baseAmount, r.taxable, r.incomeTax, r.cityTax, r.prefTax]).toEqual(["middle", 10, 8_000_000, 2_000_000, 58_707, 66_000, 44_000]);
    expect(r.remarks.some((x) => x.startsWith("支払済みの他の退職手当等：株式会社まえの 支払金額 5,000,000円・勤続年数 8年"))).toBe(true);
    // 申告書を出していなければ、合わせない
    const lower = calcRetirement(2026, 3_000_000, false, input({ serviceFrom: "2016-04-01", serviceTo: "2026-03-31", other, declared: false }));
    expect([lower.section, lower.baseAmount, lower.incomeTax]).toEqual(["lower", 3_000_000, 612_600]);
  });
  test("退職所得控除額を手で決める・控除額以下は0円・死亡退職・速算表がない年", () => {
    const r = calcRetirement(2026, 5_000_000, false, input({ serviceFrom: "2016-04-01", serviceTo: "2026-03-31", deductionOverride: 2_400_000, deductionNote: "前の退職手当等の勤続期間と重複する4年分を引いた" }));
    expect([r.deduction, r.taxable]).toEqual([2_400_000, 1_300_000]);
    expect(r.remarks).toContain("退職所得控除額の計算の基礎：前の退職手当等の勤続期間と重複する4年分を引いた");
    const zero = calcRetirement(2026, 3_000_000, false, input({ serviceFrom: "2016-04-01", serviceTo: "2026-03-31" }));
    expect([zero.taxable, zero.incomeTax, zero.cityTax, zero.prefTax, zero.netPay]).toEqual([0, 0, 0, 0, 3_000_000]);
    const death = calcRetirement(2026, 10_000_000, false, input({ serviceFrom: "2016-04-01", serviceTo: "2026-03-31", death: true }));
    expect([death.incomeTax, death.cityTax, death.error]).toEqual([0, 0, null]);
    expect(calcRetirement(2025, 8_000_000, false, input({ serviceFrom: "2016-04-01", serviceTo: "2025-05-31" })).error).toContain("2025年分");
    expect(calcRetirement(2026, 8_000_000, false, input({})).error).toContain("勤続期間");
  });
  test("速算表の行（令和8年分と令和9年分）", () => {
    expect(retirementIncomeTax(1_950_000, t2026)).toBe(99_547); // 1,950,000 × 5％ × 102.1％ ＝ 99,547.5
    expect(retirementIncomeTax(1_951_000, t2026)).toBe(99_649); // （195,100 − 97,500）× 102.1％ ＝ 99,649.6
    expect(retirementIncomeTax(50_000_000, quickTableOf(2027)!)).toBe(18_075_784); // （22,500,000 − 4,796,000）× 102.1％ ＝ 17,704,000 × 102.1％
  });
});

describe("記録", () => {
  test("detail の JSON を読む（壊れていれば初めの値）", () => {
    const v = parseRetirementInput(JSON.stringify({ serviceFrom: "2016-04-01", declared: false, kind: "short", other: { payer: "A", amount: "100" }, yearsOverride: "12" }));
    expect([v.serviceFrom, v.declared, v.kind, v.other?.amount, v.other?.years, v.yearsOverride, v.disability]).toEqual(["2016-04-01", false, "short", 100, 0, 12, false]);
    expect(parseRetirementInput("壊れた")).toEqual(emptyRetirementInput());
  });
  test("法定調書合計表の「2 退職所得の源泉徴収票合計表」：その年に支払が確定したもの（死亡退職を除く）", () => {
    const rec = (id: number, staffId: string, fixedDate: string, amount: number, incomeTax: number, death = false): RetirementRecord => ({
      id, staffId, payDate: fixedDate, fixedDate, amount, incomeTax, cityTax: 0, prefTax: 0, municipality: "", input: input({ death }),
    });
    expect(retirementSummaryOf([
      rec(1, "1", "2026-03-31", 8_000_000, 91_890), rec(2, "2", "2026-12-20", 10_000_000, 51_050),
      rec(3, "2", "2026-12-25", 1_000_000, 0), rec(4, "3", "2025-12-31", 5_000_000, 1), rec(5, "4", "2026-06-01", 9_000_000, 0, true),
    ], 2026)).toEqual({ persons: 2, amount: 19_000_000, tax: 142_940 });
  });
});
