/**
 * 基本給・扶養人数の履歴（staffHistory.ts）のテスト
 * 実行方法: bun test
 */
import { describe, expect, test } from "bun:test";
import { calculateSalary } from "./calcSalary";
import {
    dependentsHistoryOf, entryAsOf, hasWageChanges, parseDependentsHistory, parseWageHistory, staffAsOf,
    stringifyDependentsHistory, stringifyWageHistory, validateHistory, wageHistoryOf, type WageEntry,
} from "./staffHistory";

/** 入社時 時給1,100円 → 2026年4月分から 1,200円 → 2026年10月分から 月給 250,000円 */
const wages: WageEntry[] = [
    { from: "", wageType: "hourly", amount: 1100 },
    { from: "2026-04", wageType: "hourly", amount: 1200 },
    { from: "2026-10", wageType: "monthly", amount: 250000 },
];
const staff = {
    id: "S001", wage_type: "monthly", base_wage: 250000, dependents: 1,
    wage_history: stringifyWageHistory(wages),
    dependents_history: stringifyDependentsHistory([{ from: "", count: 0 }, { from: "2026-07", count: 1 }]),
};

describe("履歴の読み書き", () => {
    test("保存した JSON を読むと同じ履歴になる（適用開始月の順に並べる）", () => {
        expect(parseWageHistory(stringifyWageHistory([wages[2], wages[0], wages[1]]))).toEqual(wages);
        expect(parseDependentsHistory(staff.dependents_history)).toEqual([{ from: "", count: 0 }, { from: "2026-07", count: 1 }]);
    });
    test("空・壊れた JSON は履歴なし。給与区分がわからない値は時給制にする", () => {
        expect(parseWageHistory("")).toEqual([]);
        expect(parseWageHistory("{")).toEqual([]);
        expect(parseWageHistory(JSON.stringify([{ from: "", wageType: "weekly", amount: 1000 }]))).toEqual([{ from: "", wageType: "hourly", amount: 1000 }]);
    });
    test("履歴がまだない人（以前の会社ファイル）は、今の給与区分・基本給・扶養人数を入社したときから使う", () => {
        const old = { wage_type: "daily", base_wage: 9600, dependents: 2 };
        expect(wageHistoryOf(old)).toEqual([{ from: "", wageType: "daily", amount: 9600 }]);
        expect(dependentsHistoryOf(old)).toEqual([{ from: "", count: 2 }]);
        expect(hasWageChanges(old)).toBe(false);
        expect(hasWageChanges(staff)).toBe(true);
    });
});

describe("その月の分の値", () => {
    test("その月までに始まった、いちばん新しい履歴を使う", () => {
        expect(staffAsOf(staff, 2026, 3)).toMatchObject({ wage_type: "hourly", base_wage: 1100, dependents: 0 });
        expect(staffAsOf(staff, 2026, 4)).toMatchObject({ wage_type: "hourly", base_wage: 1200, dependents: 0 });
        expect(staffAsOf(staff, 2026, 7)).toMatchObject({ wage_type: "hourly", base_wage: 1200, dependents: 1 });
        expect(staffAsOf(staff, 2026, 10)).toMatchObject({ wage_type: "monthly", base_wage: 250000, dependents: 1 });
        expect(staffAsOf(staff, 2027, 1)).toMatchObject({ wage_type: "monthly", base_wage: 250000 });
    });
    test("最初の履歴より前の月は、最初の履歴を使う", () => {
        expect(entryAsOf([{ from: "2026-04", count: 3 }, { from: "2026-08", count: 1 }], 2025, 12)).toEqual({ from: "2026-04", count: 3 });
    });
    test("ほかの項目はそのまま", () => {
        expect(staffAsOf(staff, 2026, 3).id).toBe("S001");
    });
    test("給与計算は、その月の分の履歴の給与区分・基本給で計算する", () => {
        const extras = { allowanceName: "", allowanceAmount: 0, residentTax: 0, prefecture: "東京", dependents: 0, customItems: [] };
        const company = { week_start_day: 0, round_overtime: "round" };
        const oct = calculateSalary(staffAsOf({ ...staff, standard_remuneration: 0 }, 2026, 10), [], extras, 2026, 10, company);
        expect(oct.basePay).toBe(250000);
        const day = { work_date: "2026-06-08", work_hours: 8, night_hours: 0, work_type: "normal" };
        const jun = calculateSalary(staffAsOf({ ...staff, standard_remuneration: 0 }, 2026, 6), [day], extras, 2026, 6, company);
        expect(jun.basePay).toBe(9600); // 1,200円 × 8時間
    });
});

describe("入力の誤り", () => {
    test("2件目からは「何年何月分から」が要る。上から古い順でないといけない", () => {
        expect(validateHistory(wages)).toBeNull();
        expect(validateHistory([{ from: "" }, { from: "" }])).toBe("2件目からは「何年何月分から」を入れてください");
        expect(validateHistory([{ from: "" }, { from: "2026-10" }, { from: "2026-04" }])).toBe("上から古い順に、前の行より後の月を入れてください");
        expect(validateHistory([{ from: "" }, { from: "2026-04" }, { from: "2026-04" }])).toBe("上から古い順に、前の行より後の月を入れてください");
        expect(validateHistory([{ from: "" }])).toBeNull();
    });
});
