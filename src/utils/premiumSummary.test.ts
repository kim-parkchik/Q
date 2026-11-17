import { describe, expect, test } from "bun:test";
import * as Master from "../constants";
import { premiumSummary, type PremiumSalary } from "./premiumSummary";

const history = (amount: number) => JSON.stringify([{ from: "", amount, reason: "shutoku" }]);
const staffList = [
  { id: "A", name: "当月　徴収", birthday: "1980-04-01", branch_id: 1, payroll_group_id: 1, social_insurance_group_id: 1, join_date: "2020-04-01", standard_remuneration_history: history(300000) },
  { id: "B", name: "翌月　徴収", birthday: "1996-04-01", branch_id: 1, payroll_group_id: 2, social_insurance_group_id: 1, join_date: "2020-04-01", standard_remuneration_history: history(200000) },
];
const sal = (o: Partial<PremiumSalary> & { staff_id: string; target_year: number; target_month: number }): PremiumSalary => ({
  health_insurance: 0, nursing_insurance: 0, child_support: 0, welfare_pension: 0, kokuho_premium: 0, emp_insurance: 0, total_earnings: 0, non_remuneration: 0, in_kind_emp: 0, ...o,
});
const input = (salaries: PremiumSalary[]) => ({
  year: 2026, month: 11, staffList, salaries, bonuses: [], insurers: new Map(),
  prefectureOf: () => "東京", collectionOf: (g: unknown) => (Number(g) === 2 ? "next" : "current"), rousaiRateOf: () => 3,
});

describe("社会保険料・労働保険料の集計表（日本年金機構「保険料の計算方法について」）", () => {
  test("納入告知額は、標準報酬月額 × 料率を全員分足して1円未満を切り捨て、会社負担はそこから本人負担を引いた額", () => {
    const r = premiumSummary(input([
      // Aさん（当月徴収）：11月に支給した給与で11月分を引く
      sal({ staff_id: "A", target_year: 2026, target_month: 11, health_insurance: 14775, nursing_insurance: 2430, child_support: 345, welfare_pension: 27450, emp_insurance: 1650, total_earnings: 330000 }),
      // Bさん（翌月徴収）：12月に支給する給与で11月分を引く
      sal({ staff_id: "B", target_year: 2026, target_month: 12, health_insurance: 9850, child_support: 230, welfare_pension: 18300 }),
    ]));
    // 東京（令和8年度）：健康保険 9.85%・介護 1.62%・子ども・子育て支援金 0.23%・厚生年金 18.3%・拠出金 0.36%
    expect(r.social.map((l) => [l.label.slice(0, 6), l.total, l.employee, l.company])).toEqual([
      ["健康保険料（", 54110, 27055, 27055],
      ["子ども・子育", 1150, 575, 575],
      ["厚生年金保険", 91500, 45750, 45750],
      ["子ども・子育", 1800, 0, 1800],
    ]);
    expect(r.socialPersons).toBe(2);
    expect(r.notes).toEqual([]);
    // 労働保険料：その月に支給した給与（Aさんの 330,000円）。雇用保険の会社負担は 賃金 × 事業主負担の率、労災は 1,000分の3
    const rates = Master.getInsuranceMaster(2026, 11).LABOR_INSURANCE_RATES.general;
    expect(r.labor).toEqual([
      { label: "雇用保険料", wages: 330000, employee: 1650, company: Math.floor(330000 * (Math.round(rates[1] * 100000) - Math.round(rates[0] * 100000)) / 100000) },
      { label: "労災保険料（会社だけが負担）", wages: 330000, employee: 0, company: 990 },
    ]);
  });
  test("本人負担を引く給与がまだ確定していなければ知らせる", () => {
    const r = premiumSummary(input([sal({ staff_id: "A", target_year: 2026, target_month: 11, health_insurance: 14775 })]));
    expect(r.notes[0]).toContain("翌月　徴収");
  });
});
