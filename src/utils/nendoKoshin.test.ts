import { describe, expect, test } from "bun:test";
import { buildNendoTable, calcNendoDeclaration, koyoPartsOf, koyoRateOf, nendoDueDates, premiumOf, rousaiRateOf, type NendoSalary, specialBaseOf, specialPremiumOf } from "./nendoKoshin";

/** 令和８年度の書き方の記入例1（和菓子の卸売業・小売業）：労災 3/1000、雇用（一般）令和7年度 14.5/1000・令和8年度 13.5/1000 */
const example1 = {
  rousaiWages: 56765193, rousaiRate: 3, koyoParts: [{ ratePerMille: 14.5, wages: 54151093 }],
  estimateRousaiWages: null, estimateKoyoWages: null, estimateRousaiRate: 3, estimateKoyoRate: 13.5,
};

describe("労働保険の年度更新の申告書（令和８年度の書き方の記入例）", () => {
  test("記入例1：確定保険料 955,484円・一般拠出金 1,135円・概算保険料 901,333円・不足額 26,918円・延納で第1期 328,498円", () => {
    const d = calcNendoDeclaration({ ...example1, declared: 928566, installments: true, allocation: "3" });
    expect(d.confirmed).toMatchObject({ rousaiBase: 56765, rousaiPremium: 170295, koyoPremium: 785189, total: 955484, combined: false });
    expect(d.confirmed.koyoBases).toEqual([{ ratePerMille: 14.5, base: 54151, premium: 785189 }]);
    expect(d.general.amount).toBe(1135);
    expect(d.estimate).toMatchObject({ rousaiBase: 56765, koyoBase: 54151, total: 901333 });
    expect(d.shortage).toBe(26918);
    expect(d.periods.map((p) => p.premium)).toEqual([300445, 300444, 300444]);
    // 第1期：概算 300,445 ＋ 不足額 26,918 ＝ 327,363（労働保険料）、＋ 一般拠出金 1,135 ＝ 328,498
    expect(d.periods[0].premium + d.periods[0].shortage).toBe(327363);
    expect(d.periods.map((p) => p.pay)).toEqual([328498, 300444, 300444]);
  });

  test("記入例2①：充当意思「1」（労働保険料のみ）。申告済 1,350,000円 → 充当額 394,516円、第1期 1,135円・第2期 206,373円", () => {
    const d = calcNendoDeclaration({ ...example1, declared: 1350000, installments: true, allocation: "1" });
    expect(d.surplus).toBe(394516);
    expect(d.periods.map((p) => p.applied)).toEqual([300445, 94071, 0]);
    expect(d.periods.map((p) => p.pay)).toEqual([1135, 206373, 300444]);
    expect(d.refund).toBe(0);
  });

  test("記入例2②：充当意思「2」（一般拠出金のみ）。申告済 1,392,236円 → 一般拠出金に 1,135円、第1期 300,445円、残りは還付", () => {
    const d = calcNendoDeclaration({ ...example1, declared: 1392236, installments: true, allocation: "2" });
    expect(d.periods[0]).toMatchObject({ appliedGeneral: 1135, pay: 300445 });
    expect(d.periods[1].pay).toBe(300444);
    expect(d.refund).toBe(1392236 - 955484 - 1135);
  });

  test("記入例2③：充当意思「3」（両方）。第1期は 0円、第2期に 92,936円を充当して 207,508円", () => {
    const d = calcNendoDeclaration({ ...example1, declared: 1350000, installments: true, allocation: "3" });
    expect(d.periods.map((p) => p.pay)).toEqual([0, 207508, 300444]);
    expect(d.periods[1].applied).toBe(92936);
  });

  test("記入例4：労災と雇用の算定基礎額が同じときは、率の合計（17.50・16.50）をかけてから切り捨てる", () => {
    const d = calcNendoDeclaration({
      rousaiWages: 78083400, rousaiRate: 3, koyoParts: [{ ratePerMille: 14.5, wages: 78083400 }],
      estimateRousaiWages: null, estimateKoyoWages: null, estimateRousaiRate: 3, estimateKoyoRate: 13.5,
      declared: 0, installments: false, allocation: "3",
    });
    expect(d.confirmed).toMatchObject({ combined: true, total: 1366452 });
    expect(d.estimate).toMatchObject({ combined: true, total: 1288369 });
    expect(d.periods).toHaveLength(1);
  });

  test("概算保険料が40万円未満なら延納できない", () => {
    const d = calcNendoDeclaration({
      rousaiWages: 10000000, rousaiRate: 3, koyoParts: [{ ratePerMille: 14.5, wages: 9000000 }],
      estimateRousaiWages: null, estimateKoyoWages: null, estimateRousaiRate: 3, estimateKoyoRate: 13.5,
      declared: 0, installments: true, allocation: "3",
    });
    expect(d.canInstall).toBe(false);
    expect(d.periods).toHaveLength(1);
  });

  test("率と端数：1円未満切り捨て（小数の誤差なし）・雇用保険率・労災保険率（卸売業・小売業 98 は 3/1000）", () => {
    expect(premiumOf(54151, 14.5)).toBe(785189);
    expect(premiumOf(56765, 0.02)).toBe(1135);
    expect(koyoRateOf(2025, 4, "general")).toBe(14.5);
    expect(koyoRateOf(2026, 4, "general")).toBe(13.5);
    expect(koyoRateOf(2026, 4, "construction")).toBe(16.5);
    expect(rousaiRateOf(2025, "98")?.rate).toBe(3);
    expect(rousaiRateOf(2025, "03")?.name).toBe("林業");
  });

  test("延納の納期限：令和8年は第1期 7月10日・第2期 11月2日（10月31日は土曜）・第3期 2月1日（1月31日は日曜）", () => {
    expect(nendoDueDates(2026)).toEqual(["2026-07-10", "2026-11-02", "2027-02-01"]);
  });
});

describe("確定保険料・一般拠出金算定基礎賃金集計表", () => {
  const groups = [{ id: 1, closing_day: 99, is_next_month: 1 }];
  const staff = [
    { id: "1", name: "常用", is_employment_ins_eligible: 1, join_date: "2020-04-01" },
    { id: "2", name: "パート", is_employment_ins_eligible: 0, join_date: "2020-04-01" },
    { id: "3", name: "役員", is_executive: 1, is_employment_ins_eligible: 0, join_date: "2020-04-01" },
  ];
  /** 末日締め・翌月払い：支払った月の前の月が、賃金締切日の月 */
  const salaries: NendoSalary[] = [];
  for (let i = 0; i < 13; i++) {
    const d = new Date(2025, 4 + i, 1); // 2025年5月払い（4月分）〜 2026年5月払い（2026年4月分）
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    salaries.push({ staff_id: "1", target_year: y, target_month: m, total_earnings: 300000, emp_insurance: 1500 });
    salaries.push({ staff_id: "2", target_year: y, target_month: m, total_earnings: 80000, non_remuneration: 5000, emp_insurance: 0 });
    salaries.push({ staff_id: "3", target_year: y, target_month: m, total_earnings: 500000, emp_insurance: 0 });
  }
  const t = buildNendoTable({
    fiscalYear: 2025, staff, groups, salaries, empInsType: "general",
    bonuses: [{ staff_id: "1", payDate: "2025-07-10", total_earnings: 400000, emp_insurance: 2000 }, { staff_id: "1", payDate: "2026-07-10", total_earnings: 1, emp_insurance: 0 }],
  });

  test("月は賃金締切日の月（3月末締め・4月払いは3月の分）。役員報酬（雇用保険に入っていない役員）は入れない", () => {
    expect(t.rows.filter((r) => r.kind === "month").map((r) => `${r.year}-${r.month}`)).toEqual([
      "2025-4", "2025-5", "2025-6", "2025-7", "2025-8", "2025-9", "2025-10", "2025-11", "2025-12", "2026-1", "2026-2", "2026-3",
    ]);
    const april = t.rows[0];
    expect(april.rousai.regular).toEqual({ count: 1, wages: 300000 });
    expect(april.rousai.temporary).toEqual({ count: 1, wages: 75000 });
    expect(april.rousai.officer).toEqual({ count: 0, wages: 0 });
    expect(april.koyo.total).toEqual({ count: 1, wages: 300000 });
    expect(t.notes.join("")).toContain("役員報酬");
  });

  test("賞与は支払った月（保険年度の中だけ）。合計と、常時使用労働者数・雇用保険被保険者数", () => {
    const bonus = t.rows.filter((r) => r.kind === "bonus");
    expect(bonus).toHaveLength(1);
    expect(bonus[0].rousai.total.wages).toBe(400000);
    expect(t.totals.total.wages).toBe(300000 * 12 + 75000 * 12 + 400000);
    expect(t.totals.koyo.total.wages).toBe(300000 * 12 + 400000);
    expect(t.workers).toBe(2);
    expect(t.insured).toBe(1);
    expect(koyoPartsOf(t)).toEqual([{ ratePerMille: 14.5, wages: 300000 * 12 + 400000 }]);
  });
});

describe("労災保険の特別加入（第1種）", () => {
  test("保険料算定基礎額：1年加入は表の額（日額 × 365日）、年度の途中は 1/12 の額 × 月数。表にない日額は null", () => {
    expect(specialBaseOf(10_000, 12)).toBe(3_650_000);
    expect(specialBaseOf(4_000, 6)).toBe(121_667 * 6);
    expect(specialBaseOf(4_000, 0)).toBe(0);
    expect(specialBaseOf(4_100, 12)).toBeNull();
  });
  test("特別加入保険料：全員の合計を千円未満切り捨てにして、労災保険率をかける（手引きの記入例 5,748千円 × 9.5/1000 ＝ 54,606円）", () => {
    const r = specialPremiumOf([{ daily: 10_000, months: 12 }, { daily: 4_000, months: 6 }], 9.5);
    expect([r.total, r.kilo, r.premium, r.unknown]).toEqual([4_380_002, 4_380, 41_610, false]);
    expect(premiumOf(5_748, 9.5)).toBe(54_606);
  });
});
