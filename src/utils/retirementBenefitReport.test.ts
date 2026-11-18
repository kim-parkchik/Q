import { describe, expect, test } from "bun:test";
import { benefitReportDueDate, benefitReportProblems, benefitSummaryOf, heirOmitted, heirsOf, submittedHeirs } from "./retirementBenefitReport";
import { emptyRetirementInput, type RetirementHeir, type RetirementRecord } from "./retirementIncome";

const rec = (id: number, payDate: string, amount: number, heirs: RetirementHeir[], death = true): RetirementRecord => ({
  id, staffId: String(id), payDate, fixedDate: payDate, amount, incomeTax: 0, cityTax: 0, prefTax: 0, municipality: "",
  input: { ...emptyRetirementInput(), death, heirs },
});
const heir = (name: string, amount: number, omit: boolean | null = null): RetirementHeir => ({ name, address: "東京都千代田区1-1", relation: "妻", amount, omit, abroad: false });

describe("退職手当金等受給者別支払調書", () => {
  test("受給者を入れていなければ、支払金額の全部を受ける1人。額の合計・氏名・住所・続柄・種類を確かめる", () => {
    const r = rec(1, "2026-07-10", 5_000_000, []);
    expect(heirsOf(r)).toEqual([{ name: "", address: "", relation: "", amount: 5_000_000, omit: null, abroad: false }]);
    expect(benefitReportProblems(r)).toEqual(["1人目の受給者の氏名を入れてください。", "1人目の受給者の住所を入れてください。", "1人目の受給者の、退職者との続柄を入れてください。"]);
    const ok = rec(2, "2026-07-10", 5_000_000, [heir("退職 花子", 3_000_000), heir("退職 一郎", 2_000_000)]);
    expect(benefitReportProblems(ok)).toEqual([]);
    expect(benefitReportProblems({ ...ok, amount: 6_000_000 })[0]).toContain("合いません");
  });
  test("合計表：支払った月ごと。支払総額には出さないものも入れ、受給者数は人で数える", () => {
    const list = [
      rec(1, "2026-07-10", 5_000_000, [heir("退職 花子", 4_500_000), heir("退職 一郎", 500_000, true)]),
      rec(2, "2026-07-25", 1_000_000, [heir("退職 花子", 1_000_000)]),
      rec(3, "2026-09-30", 2_000_000, []),
      rec(4, "2026-09-30", 9_000_000, [], false),
      rec(5, "2025-12-25", 1_000_000, []),
    ];
    expect(benefitSummaryOf(list, 2026)).toEqual([
      { month: "2026-07", total: { persons: 2, amount: 6_000_000 }, submit: { persons: 1, amount: 5_500_000 } },
      { month: "2026-09", total: { persons: 1, amount: 2_000_000 }, submit: { persons: 1, amount: 2_000_000 } },
    ]);
  });
  test("受給者ごとの額が100万円以下なら出さない（相続税法施行規則30条3項）。同じ月の合計で見て、手で決めたものはそのとおり", () => {
    expect([heirOmitted(heir("A", 1_000_000)), heirOmitted(heir("A", 1_000_001)), heirOmitted(heir("A", 300_000, false))]).toEqual([true, false, false]);
    const list = [
      rec(1, "2026-07-10", 800_000, [heir("退職 花子", 600_000), heir("退職 一郎", 200_000), heir("退職 次郎", 0, false)]),
      rec(2, "2026-07-25", 500_000, [heir("退職 花子", 500_000)]),
      rec(3, "2026-08-25", 500_000, [heir("退職 花子", 500_000)]),
    ];
    // 花子は7月に合わせて 110万円なので出す。一郎（20万円）は出さない。次郎は「出す」にした
    expect([...submittedHeirs(list, "2026-07")].sort()).toEqual(["退職 次郎|東京都千代田区1-1", "退職 花子|東京都千代田区1-1"]);
    expect(submittedHeirs(list, "2026-08").size).toBe(0);
    expect(benefitSummaryOf(list, 2026).map((g) => [g.month, g.total.persons, g.submit.persons, g.submit.amount])).toEqual([
      ["2026-07", 3, 2, 1_100_000], ["2026-08", 1, 0, 0],
    ]);
  });
  test("提出期限は支給した月の翌月15日（相続税法59条1項）。土日・祝日なら次の日", () => {
    expect(benefitReportDueDate("2026-09-20")).toBe("2026-10-15");
    // 令和8年11月15日は日曜日 → 16日
    expect(benefitReportDueDate("2026-10-01")).toBe("2026-11-16");
    expect(benefitReportDueDate("2026-12-31", (d) => d === "2027-01-15")).toBe("2027-01-18");
  });
});
