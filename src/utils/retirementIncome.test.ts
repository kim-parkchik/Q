import { describe, expect, test } from "bun:test";
import {
  calcRetirement, defaultRetirementKind, emptyOtherRetirement, emptyPriorRetirement, emptyRetirementInput, noDeclarationTax, parseRetirementInput,
  nonResidentSummaryOf, quickTableOf, retirementDeduction, retirementIncomeTax, retirementLocalTax, retirementSummaryOf, servicePeriodOf, taxableRetirementIncome,
  type OtherRetirement, type PriorRetirement, type RetirementInput, type RetirementRecord,
} from "./retirementIncome";

const input = (o: Partial<RetirementInput>): RetirementInput => ({ ...emptyRetirementInput(), ...o });
const other = (o: Partial<OtherRetirement>): OtherRetirement => ({ ...emptyOtherRetirement(), ...o });
const prior = (o: Partial<PriorRetirement>): PriorRetirement => ({ ...emptyPriorRetirement(), ...o });

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
    const o = other({ payer: "株式会社まえの", amount: 5_000_000, years: 8, incomeTax: 45_945, cityTax: 54_000, prefTax: 36_000 });
    const r = calcRetirement(2026, 3_000_000, false, input({ serviceFrom: "2016-04-01", serviceTo: "2026-03-31", others: [o] }));
    // 合計 800万円・10年：控除 400万円 → 200万円。（2,000,000 × 10％ − 97,500）× 102.1％ ＝ 104,652円 − 45,945円
    expect([r.section, r.years, r.baseAmount, r.taxable, r.incomeTax, r.cityTax, r.prefTax]).toEqual(["middle", 10, 8_000_000, 2_000_000, 58_707, 66_000, 44_000]);
    expect(r.remarks.some((x) => x.startsWith("支払済みの他の退職手当等：株式会社まえの 支払金額 5,000,000円・勤続年数 8年"))).toBe(true);
    // 申告書を出していなければ、合わせない
    const lower = calcRetirement(2026, 3_000_000, false, input({ serviceFrom: "2016-04-01", serviceTo: "2026-03-31", others: [o], declared: false }));
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

describe("区分の違う退職手当等（タックスアンサー No.2741）", () => {
  const t2026 = quickTableOf(2026)!;
  test("具体例：短期退職手当等と特定役員退職手当等（勤続5年・重複4年 → 特定役員 120万円・短期 80万円・退職所得 1,650万円）", () => {
    // A社（この会社）：役員 令和4年5月1日〜令和8年5月31日・1,500万円、B社：使用人 令和4年8月1日〜令和8年5月31日・500万円
    const r = calcRetirement(2026, 15_000_000, true, input({
      serviceFrom: "2022-05-01", serviceTo: "2026-05-31",
      others: [other({ payer: "B社", kind: "short", amount: 5_000_000, from: "2022-08-01", to: "2026-05-31" })],
    }));
    expect([r.error, r.kind, r.section, r.years, r.deduction, r.baseAmount]).toEqual([null, "officer", "middle", 5, 2_000_000, 20_000_000]);
    expect(r.mixed!.map((x) => [x.kind, x.years, x.overlapYears, x.deduction])).toEqual([["officer", 5, 4, 1_200_000], ["short", 4, 4, 800_000]]);
    expect(r.taxable).toBe(16_500_000);
    expect(r.incomeTax).toBe(retirementIncomeTax(16_500_000, t2026));
    expect(r.remarks).toContain("特定役員退職手当等 15,000,000円・特定役員等勤続年数 5年（令和4年5月1日～令和8年5月31日（4年1か月））");
    expect(r.remarks).toContain("特定役員退職手当等の重複勤続年数 4年");
    expect(r.remarks.some((x) => x.includes("（短期退職手当等・短期勤続年数 4年（令和4年8月1日～令和8年5月31日（3年10か月）））"))).toBe(true);
  });
  test("具体例：3つの区分（勤続10年・全重複5年・部分重複1年 → 特定役員 90万円・短期 85万円・一般 225万円・退職所得 3,155万円）", () => {
    // C社（この会社）：役員 令和3年12月1日〜令和8年11月30日・3,000万円、A社：使用人 令和3年2月1日〜令和8年1月31日・300万円、
    // B社：使用人 平成29年1月1日〜令和8年3月31日・500万円
    const r = calcRetirement(2026, 30_000_000, true, input({
      serviceFrom: "2021-12-01", serviceTo: "2026-11-30",
      others: [
        other({ payer: "A社", kind: "short", amount: 3_000_000, from: "2021-02-01", to: "2026-01-31", incomeTax: 1_000 }),
        other({ payer: "B社", kind: "general", amount: 5_000_000, from: "2017-01-01", to: "2026-03-31", incomeTax: 2_000 }),
      ],
    }));
    expect([r.error, r.years, r.deduction]).toEqual([null, 10, 4_000_000]);
    expect(r.mixed!.map((x) => [x.kind, x.overlapYears, x.fullOverlapYears, x.deduction])).toEqual([
      ["officer", 1, 5, 900_000], ["short", 1, 5, 850_000], ["general", 0, 5, 2_250_000],
    ]);
    expect(r.taxable).toBe(31_550_000);
    expect(r.incomeTax).toBe(retirementIncomeTax(31_550_000, t2026) - 3_000);
    expect(r.remarks).toContain("勤続年数の計算の基礎：平成29年1月1日～令和8年11月30日（9年11か月）");
    expect(r.remarks).toContain("短期退職手当等の重複勤続年数 1年・全重複勤続年数 5年");
  });
  test("この退職手当等を使用人の期間の分と役員の期間の分に分けて払う（使用人 13年・1,000万円、役員 3年・500万円）", () => {
    const parts = [
      { kind: "general" as const, amount: 10_000_000, from: "2010-04-01", to: "2023-03-31" },
      { kind: "officer" as const, amount: 5_000_000, from: "2023-04-01", to: "2026-03-31" },
    ];
    const r = calcRetirement(2026, 15_000_000, true, input({ serviceFrom: "2010-04-01", serviceTo: "2026-03-31", parts }));
    // 勤続16年：640万円。特定役員 40万円 × 3年 ＝ 120万円、一般 520万円。（500万 − 120万）＋（1,000万 − 520万）× 1/2 ＝ 620万円
    expect([r.error, r.kind, r.years, r.deduction, r.taxable]).toEqual([null, "general", 16, 6_400_000, 6_200_000]);
    expect(r.mixed!.map((x) => [x.kind, x.deduction])).toEqual([["officer", 1_200_000], ["general", 5_200_000]]);
    expect(r.remarks).toContain("特定役員退職手当等 5,000,000円・特定役員等勤続年数 3年（令和5年4月1日～令和8年3月31日（3年））");
    // 額の合計が支払金額と違う
    expect(calcRetirement(2026, 14_000_000, true, input({ serviceFrom: "2010-04-01", serviceTo: "2026-03-31", parts })).error).toContain("合いません");
  });
});

describe("区分の違う退職手当等で、収入金額がその区分の控除額に満たないとき（所得税法施行令71条の2）", () => {
  test("2つの区分（特定役員と一般。3項）：特定役員 100万円が控除額 120万円に満たない 20万円を、一般の残額 480万円から引く → 230万円", () => {
    const r = calcRetirement(2026, 11_000_000, true, input({
      serviceFrom: "2010-04-01", serviceTo: "2026-03-31", parts: [
        { kind: "general", amount: 10_000_000, from: "2010-04-01", to: "2023-03-31" },
        { kind: "officer", amount: 1_000_000, from: "2023-04-01", to: "2026-03-31" },
      ],
    }));
    expect([r.error, r.deduction, r.taxable]).toEqual([null, 6_400_000, 2_300_000]);
    expect(r.mixed!.map((x) => [x.kind, x.deduction, x.shortfall, x.absorbed, x.income])).toEqual([
      ["officer", 1_200_000, 200_000, 0, 0], ["general", 5_200_000, 0, 200_000, 2_300_000],
    ]);
    expect(r.notes.some((x) => x.includes("満たない部分（200,000円）を一般退職手当等の残額から 200,000円引きました"))).toBe(true);
  });
  test("2つの区分（短期と一般。1項）：一般の満たない 240万円を短期の残額 440万円から引くと 200万円で、300万円以下なので 1/2 → 100万円", () => {
    // この会社：使用人 令和5年4月1日〜令和8年3月31日（3年）・500万円（短期）。他社：平成28年4月1日〜令和8年3月31日（10年）・100万円（一般）
    const r = calcRetirement(2026, 5_000_000, false, input({
      serviceFrom: "2023-04-01", serviceTo: "2026-03-31",
      others: [other({ payer: "A社", kind: "general", amount: 1_000_000, from: "2016-04-01", to: "2026-03-31" })],
    }));
    // 勤続10年 400万円。短期 40万円 ×（3 − 3）＋ 20万円 × 3 ＝ 60万円、一般 340万円（100万円に 240万円足りない）
    expect([r.error, r.kind, r.years, r.deduction, r.taxable, r.incomeTax]).toEqual([null, "short", 10, 4_000_000, 1_000_000, 51_050]);
    expect(r.mixed!.map((x) => [x.kind, x.deduction, x.shortfall, x.absorbed, x.income])).toEqual([
      ["short", 600_000, 0, 2_400_000, 1_000_000], ["general", 3_400_000, 2_400_000, 0, 0],
    ]);
    // 調整しなければ 150万円 ＋（500万円 −（300万円 ＋ 60万円））＝ 290万円になるところ
    expect([r.cityTax, r.prefTax]).toEqual([60_000, 40_000]);
  });
  test("3つの区分（9項）：特定役員の満たない部分の2分の1ずつを短期と一般の残額から引き、短期が足りない分は一般から引く", () => {
    // 一般 平成28年4月1日〜令和8年3月31日（10年）、短期・特定役員 令和3年4月1日〜令和8年3月31日（5年。全重複 5年）
    const base = {
      serviceFrom: "2021-04-01", serviceTo: "2026-03-31", kind: "officer" as const,
      others: [
        other({ payer: "A社", kind: "short", amount: 4_000_000, from: "2021-04-01", to: "2026-03-31" }),
        other({ payer: "B社", kind: "general", amount: 10_000_000, from: "2016-04-01", to: "2026-03-31" }),
      ],
    };
    // 控除額：特定役員 14万円 × 5 ＝ 70万円、短期 13万円 × 5 ＝ 65万円、一般 400万円 − 135万円 ＝ 265万円
    // 特定役員 50万円（20万円足りない）→ 10万円ずつ。短期の残額 335万円は300万円を超えるので「ロ」：35万円 − 10万円 ＝ 25万円 ＋ 150万円、
    // 一般 735万円 − 10万円 ＝ 725万円 × 1/2 ＝ 362.5万円。合計 537.5万円
    const r = calcRetirement(2026, 500_000, true, input(base));
    expect(r.mixed!.map((x) => [x.kind, x.deduction, x.shortfall, x.absorbed])).toEqual([
      ["officer", 700_000, 200_000, 0], ["short", 650_000, 0, 100_000], ["general", 2_650_000, 0, 100_000],
    ]);
    expect([r.error, r.taxable]).toEqual([null, 5_375_000]);
    // 特定役員 10万円（60万円足りない → 30万円ずつ）・短期 380万円（「ロ」の残額 15万円）：短期は 15万円だけ引き、足りない 15万円を一般から引く
    const r2 = calcRetirement(2026, 100_000, true, input({ ...base, others: [{ ...base.others[0], amount: 3_800_000 }, base.others[1]] }));
    expect(r2.mixed!.map((x) => [x.kind, x.absorbed, x.income])).toEqual([["officer", 0, 0], ["short", 150_000, 1_500_000], ["general", 450_000, 3_450_000]]);
    expect(r2.taxable).toBe(4_950_000);
  });
  test("前年以前の退職手当等と短期勤続期間が重なる（11項2号）：短期の控除額から、重なる1年の40万円を引く", () => {
    const r = calcRetirement(2026, 5_000_000, false, input({
      serviceFrom: "2023-04-01", serviceTo: "2026-03-31",
      others: [other({ payer: "A社", kind: "general", amount: 10_000_000, from: "2016-04-01", to: "2026-03-31" })],
      priors: [prior({ payer: "前", paidOn: "2024-03-31", amount: 3_000_000, from: "2021-04-01", to: "2024-03-31" })],
    }));
    // 全体：400万円 − 重なる3年 120万円 ＝ 280万円。短期：60万円 − 40万円 ＝ 20万円、一般 260万円
    // 短期 500万円 − 20万円 ＝ 480万円 → 150万円 ＋ 180万円 ＝ 330万円、一般（1,000万円 − 260万円）× 1/2 ＝ 370万円
    expect([r.error, r.overlapReduction, r.deduction, r.taxable]).toEqual([null, 1_200_000, 2_800_000, 7_000_000]);
    expect(r.mixedCuts).toEqual([{ kind: "short", type: "overlap", period: "令和5年4月1日～令和6年3月31日", years: 1, amount: 400_000 }]);
    expect(r.mixed!.map((x) => [x.kind, x.priorCut, x.deduction])).toEqual([["short", 400_000, 200_000], ["general", 0, 2_600_000]]);
    expect(r.remarks).toContain("短期勤続期間が前の退職手当等と重複：令和5年4月1日～令和6年3月31日（1年）・短期退職所得控除額から 400,000円（40万円 × 1年）を引いた");
  });
  test("今回の勤続期間に含めた前の退職手当等が特定役員退職手当等（12項1号）：特定役員の控除額から、その期間の年数で計算した額を引く", () => {
    const r = calcRetirement(2026, 15_000_000, true, input({
      serviceFrom: "2010-04-01", serviceTo: "2026-03-31", parts: [
        { kind: "general", amount: 10_000_000, from: "2010-04-01", to: "2021-03-31" },
        { kind: "officer", amount: 5_000_000, from: "2021-04-01", to: "2026-03-31" },
      ],
      priors: [prior({ payer: "子会社", amount: 1_000_000, from: "2021-04-01", to: "2023-03-31", included: true, kind: "officer" })],
    }));
    // 全体：16年 640万円 − 含めた2年 80万円 ＝ 560万円。特定役員：200万円 − 80万円 ＝ 120万円、一般 440万円
    expect([r.error, r.deduction]).toEqual([null, 5_600_000]);
    expect(r.mixed!.map((x) => [x.kind, x.priorCut, x.deduction])).toEqual([["officer", 800_000, 1_200_000], ["general", 0, 4_400_000]]);
    expect(r.taxable).toBe(3_800_000 + 2_800_000);
  });
});

describe("非居住者・1月1日に住所がなかった人（所得税法212条・213条、地方税法328条）", () => {
  test("非居住者：国内源泉所得 × 20.42％（1円未満切り捨て）。住民税はかからない。退職所得控除額・勤続年数は支払調書のために計算する", () => {
    const r = calcRetirement(2026, 10_000_000, false, input({ serviceFrom: "2007-04-01", serviceTo: "2026-12-20", nonResident: true, domesticAmount: 8_000_000 }));
    expect([r.error, r.nonResident, r.domesticAmount, r.incomeTax, r.cityTax, r.prefTax, r.taxable]).toEqual([null, true, 8_000_000, 1_633_600, 0, 0, 0]);
    expect([r.years, r.deduction, r.netPay]).toEqual([20, 8_000_000, 10_000_000 - 1_633_600]);
    expect(r.notes[0]).toContain("所得税法212条・213条");
    // 国内源泉所得を入れなければ全部（知らせる）・支払金額より大きければ直す
    const all = calcRetirement(2026, 10_000_000, false, input({ serviceFrom: "2007-04-01", serviceTo: "2026-12-20", nonResident: true }));
    expect([all.incomeTax, all.notes.some((x) => x.includes("支払金額の全部"))]).toEqual([2_042_000, true]);
    expect(calcRetirement(2026, 10_000_000, false, input({ serviceFrom: "2007-04-01", serviceTo: "2026-12-20", nonResident: true, domesticAmount: 11_000_000 })).error)
      .toContain("国内源泉所得");
  });
  test("居住者でも、その年の1月1日に国内に住所がなかった人は住民税がかからない", () => {
    const r = calcRetirement(2026, 10_000_000, false, input({ serviceFrom: "2007-04-01", serviceTo: "2026-12-20", noJanuaryAddress: true }));
    expect([r.incomeTax, r.cityTax, r.prefTax]).toEqual([51_050, 0, 0]);
    expect(r.notes.some((x) => x.includes("2026年1月1日に国内に住所がなかった"))).toBe(true);
  });
  test("合計表：非居住者は退職所得の源泉徴収票合計表に入れず、非居住者等の支払調書合計表に入れる（国内源泉所得の額）", () => {
    const rec = (id: number, nonResident: boolean, amount: number, incomeTax: number, domesticAmount: number | null = null): RetirementRecord => ({
      id, staffId: String(id), payDate: "2026-12-25", fixedDate: "2026-12-20", amount, incomeTax, cityTax: 0, prefTax: 0, municipality: "",
      input: input({ nonResident, domesticAmount, unpaid: id === 2 ? 1_000_000 : null }),
    });
    const list = [rec(1, false, 10_000_000, 51_050), rec(2, true, 10_000_000, 1_633_600, 8_000_000), rec(3, true, 3_000_000, 612_600)];
    expect(retirementSummaryOf(list, 2026)).toEqual({ persons: 1, amount: 10_000_000, tax: 51_050 });
    expect(nonResidentSummaryOf(list, 2026)).toEqual({ persons: 2, amount: 11_000_000, unpaid: 1_000_000, tax: 2_246_200 });
  });
});

describe("前年以前の退職手当等と勤続期間が重なるとき（所得税法施行令70条）", () => {
  test("前年以前4年内の確定拠出年金の一時金（収入金額が控除額に満たないので、前の期間を 300万円 ÷ 40万円 ＝ 7年に短くする → 280万円を引く）", () => {
    const r = calcRetirement(2026, 20_000_000, false, input({
      serviceFrom: "2006-04-01", serviceTo: "2026-03-31",
      priors: [
        prior({ payer: "確定拠出年金", paidOn: "2025-05-01", amount: 3_000_000, from: "2016-04-01", to: "2025-03-31", dc: true }),
        prior({ payer: "前の会社", paidOn: "2021-12-01", amount: 1_000_000, from: "2018-04-01", to: "2021-11-30" }),
      ],
    }));
    expect([r.error, r.years, r.overlapReduction, r.deduction, r.taxable]).toEqual([null, 20, 2_800_000, 5_200_000, 7_400_000]);
    expect(r.overlaps.map((x) => [x.type, x.years, x.period])).toEqual([["overlap", 7, "平成28年4月1日～令和5年3月31日"]]);
    expect(r.notes.some((x) => x.includes("前の勤続期間等を7年"))).toBe(true);
    expect(r.notes.some((x) => x.startsWith("前の会社の退職手当等は、重なる期間を数える年（その年の前年以前4年内）より前に"))).toBe(true);
    expect(r.remarks).toContain("勤続期間等が前の退職手当等（確定拠出年金 令和7年5月1日支払・収入金額 3,000,000円）と重複：平成28年4月1日～令和5年3月31日（7年）・退職所得控除額から 2,800,000円（40万円 × 7年）を引いた");
  });
  test("前の勤務先の期間を今回の勤続期間に含めた（1項1号：その期間の年数で計算した額を引く。年数は切り捨て）", () => {
    const r = calcRetirement(2026, 15_000_000, false, input({
      serviceFrom: "2003-04-01", serviceTo: "2026-03-31",
      priors: [prior({ payer: "前の会社", amount: 2_000_000, from: "2003-04-01", to: "2006-09-30", included: true })],
    }));
    // 勤続23年：800万円 ＋ 70万円 × 3年 ＝ 1,010万円。前の期間 3年6か月 → 3年 → 120万円を引く
    expect([r.error, r.years, r.overlapReduction, r.deduction]).toEqual([null, 23, 1_200_000, 8_900_000]);
    expect(r.remarks[0]).toBe("前の退職手当等の期間を今回の計算の基礎に含めた：前の会社の期間 平成15年4月1日～平成18年9月30日（3年）・退職所得控除額から 1,200,000円（40万円 × 3年）を引いた");
  });
  test("その年に確定拠出年金の一時金も受けるときは、前年以前19年内の退職手当等と重なる期間を数える（1項2号ハ）", () => {
    const priors = [prior({ payer: "前の会社", paidOn: "2012-03-31", amount: 10_000_000, from: "2000-04-01", to: "2012-03-31" })];
    const dc = other({ payer: "確定拠出年金", amount: 2_000_000, from: "2008-04-01", to: "2026-03-31", dc: true });
    const r = calcRetirement(2026, 10_000_000, false, input({ serviceFrom: "2012-04-01", serviceTo: "2026-03-31", others: [dc], priors }));
    // 合わせた勤続期間 平成20年4月1日〜令和8年3月31日（18年）：720万円。前の会社の期間と重なる4年：160万円を引く
    expect([r.error, r.years, r.overlapReduction, r.deduction]).toEqual([null, 18, 1_600_000, 5_600_000]);
    const noDc = calcRetirement(2026, 10_000_000, false, input({ serviceFrom: "2012-04-01", serviceTo: "2026-03-31", others: [{ ...dc, dc: false }], priors }));
    expect([noDc.overlapReduction, noDc.deduction]).toEqual([0, 7_200_000]);
  });
  test("引いたあとも80万円は残す・申告書がなければ引かない・同じ年に受けたものは入れられない", () => {
    const priors = [prior({ payer: "前", paidOn: "2024-03-31", amount: 5_000_000, from: "2020-04-01", to: "2024-03-31" })];
    const r = calcRetirement(2026, 3_000_000, false, input({ serviceFrom: "2020-04-01", serviceTo: "2026-03-31", priors }));
    // 勤続6年 240万円 − 重なる4年 160万円 ＝ 80万円
    expect([r.overlapReduction, r.deduction]).toEqual([1_600_000, 800_000]);
    const r2 = calcRetirement(2026, 3_000_000, false, input({ serviceFrom: "2023-04-01", serviceTo: "2026-03-31", priors }));
    expect([r2.overlapReduction, r2.deduction]).toEqual([400_000, 800_000]); // 3年 120万円 − 1年 40万円 → 80万円
    const lower = calcRetirement(2026, 3_000_000, false, input({ serviceFrom: "2020-04-01", serviceTo: "2026-03-31", priors, declared: false }));
    expect([lower.overlapReduction, lower.deduction]).toEqual([0, 2_400_000]);
    expect(calcRetirement(2026, 3_000_000, false, input({ serviceFrom: "2020-04-01", serviceTo: "2026-03-31", priors: [{ ...priors[0], paidOn: "2026-01-10" }] })).error)
      .toContain("その年に支払済みの他の退職手当等");
  });
});

describe("源泉徴収票の④番号・未払", () => {
  test("番号5〜7は経済的利益の価額、未払があれば未徴収税額を摘要に書く", () => {
    const r = calcRetirement(2026, 10_000_000, false, input({
      serviceFrom: "2007-04-01", serviceTo: "2026-12-20", slipNumber: "5", economicBenefit: 3_000_000, unpaid: 2_000_000, unwithheldTax: 10_210,
    }));
    expect(r.remarks).toEqual(["経済的利益の価額 3,000,000円", "未徴収税額 10,210円"]);
    const r2 = calcRetirement(2026, 10_000_000, false, input({ serviceFrom: "2007-04-01", serviceTo: "2026-12-20", slipNumber: "6", unpaid: 2_000_000 }));
    expect(r2.notes.filter((x) => x.includes("経済的利益") || x.includes("未徴収税額")).length).toBe(2);
  });
});

describe("記録", () => {
  test("detail の JSON を読む（壊れていれば初めの値）", () => {
    // 前の形（他の退職手当等を1つだけ持つ other）も読む
    const v = parseRetirementInput(JSON.stringify({ serviceFrom: "2016-04-01", declared: false, kind: "short", other: { payer: "A", amount: "100" }, yearsOverride: "12" }));
    expect([v.serviceFrom, v.declared, v.kind, v.others[0]?.amount, v.others[0]?.years, v.others[0]?.kind, v.yearsOverride, v.disability]).toEqual(["2016-04-01", false, "short", 100, 0, "general", 12, false]);
    const w = parseRetirementInput(JSON.stringify({ slipNumber: "9", parts: [{ kind: "officer", amount: 5 }, "x"], priors: [{ paidOn: "2024-01-01", included: 1 }] }));
    expect([w.slipNumber, w.parts, w.priors[0].included, w.priors[0].dc]).toEqual(["", [{ kind: "officer", amount: 5, from: "", to: "" }], true, false]);
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
