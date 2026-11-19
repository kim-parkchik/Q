import { describe, expect, test } from "bun:test";
import * as Master from "../constants";
import { premiumSummary, type PremiumSalary } from "./premiumSummary";
import { buildWelfareJournal, journalBytes, journalCsv, parseJournalSettings } from "./payJournal";

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
  test("雇用保険の会社負担は、給与の賃金締切日がある月の率（2026年4月払いでも、3月31日締めの分は令和7年度の 14.5 − 5.5 ＝ 9/1,000）", () => {
    const april = (ledger: string | null, closingOf?: () => string | null) => premiumSummary({
      ...input([sal({ staff_id: "A", target_year: 2026, target_month: 4, emp_insurance: 1650, total_earnings: 300000, ledger })]),
      month: 4, ...(closingOf ? { closingOf } : {}),
    }).labor[0];
    expect(april(JSON.stringify({ periodEnd: "2026-03-31" })).company).toBe(2700); // 300,000円 × 9/1,000
    expect(april(JSON.stringify({ periodEnd: "2026-04-30" })).company).toBe(2550); // 300,000円 × 8.5/1,000
    // 内訳に締切日がなければ、渡された締切日（給与規定グループの締日から）で決める
    expect(april(null, () => "2026-03-31").company).toBe(2700);
  });
});

describe("健康保険組合の会社負担と法定福利費の仕訳", () => {
  const union = { id: 2, name: "確かめ健康保険組合", type: "union" as const, officeNumber: "", mediaSeq: 0,
    rates: [{ from: "2026-04", health: 4.5, care: 0.9, childSupport: 0.115, company: { health: 5.5, care: 0.9, childSupport: 0.115 } }] };
  const staff = [{ id: "U", name: "組合　加入", birthday: "1990-04-01", branch_id: 1, payroll_group_id: 1, social_insurance_group_id: 2, join_date: "2020-04-01", standard_remuneration_history: history(300000) }];
  const base = {
    year: 2026, month: 11, staffList: staff, bonuses: [], insurers: new Map([[2, union]]),
    prefectureOf: () => "東京", collectionOf: () => "current", rousaiRateOf: () => 3,
  };
  test("会社負担の料率を入れた組合は、本人負担と会社負担を足した率で見込みを出す（30万円 × （4.5% ＋ 5.5% ＋ 0.115% ＋ 0.115%）＝ 30,690円）", () => {
    const r = premiumSummary({ ...base, salaries: [sal({ staff_id: "U", target_year: 2026, target_month: 11, health_insurance: 13500, child_support: 345 })] });
    const u = r.social.find((l) => l.label.includes("健康保険組合"))!;
    expect([u.total, u.employee, u.company]).toEqual([30690, 13845, 16845]);
  });
  test("会社負担の料率がなければ、本人負担だけ（会社負担は出さない）", () => {
    const noCompany = { ...union, rates: [{ ...union.rates[0], company: null }] };
    const r = premiumSummary({ ...base, insurers: new Map([[2, noCompany]]), salaries: [sal({ staff_id: "U", target_year: 2026, target_month: 11, health_insurance: 13500, child_support: 345 })] });
    const u = r.social.find((l) => l.label.includes("健康保険組合"))!;
    expect([u.total, u.company]).toEqual([null, null]);
  });
  test("法定福利費の仕訳：借方 法定福利費（補助科目に保険の名前）・貸方 未払費用（合計）", () => {
    const st = parseJournalSettings(null);
    const lines = buildWelfareJournal("2026-11-30", "2026年11月分", [{ sub: "健康保険料", amount: 27055 }, { sub: "厚生年金保険料", amount: 45750 }, { sub: "労災保険料", amount: 0 }], st);
    expect(lines.map((l) => [l.side, l.account, l.sub, l.amount])).toEqual([
      ["debit", "法定福利費", "健康保険料", 27055], ["debit", "法定福利費", "厚生年金保険料", 45750], ["credit", "未払費用", "", 72805],
    ]);
    // CSV の形：列の並びと見出し・見出しの行なし・日付の書き方
    const csv = journalCsv(lines, { ...st, columns: ["date", "debitAccount", "debitAmount", "creditAccount", "creditAmount"], headers: { date: "取引日" }, header: false, dateStyle: "compact" });
    expect(csv.split("\r\n")[0]).toBe("20261130,法定福利費,27055,,");
    expect(journalCsv(lines, { ...st, header: true, columns: ["date", "memo"], headers: { date: "取引日" }, dateStyle: "hyphen" }).split("\r\n")[0]).toBe("取引日,摘要");
    // シフトJIS
    const sj = journalBytes(lines, { ...st, encoding: "sjis" });
    expect(sj.unknown).toEqual([]);
    expect(new TextDecoder("shift_jis").decode(sj.bytes).startsWith("日付,伝票番号")).toBe(true);
    expect([...journalBytes(lines, st).bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });
});
