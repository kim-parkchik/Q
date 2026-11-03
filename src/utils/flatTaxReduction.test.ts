/**
 * 定額減税（令和6年分・給与の月次減税）のテスト
 * 実行方法: bun test
 *
 * きまり（国税庁「定額減税について」）:
 *   本人＋同一生計配偶者・扶養親族 1人につき 30,000円を、令和6年6月1日以後最初に支払う給与の
 *   源泉所得税から差し引き、引ききれない分は令和6年中の給与から順に差し引く。
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { flatTaxReductionTotal, calcWithholdingTax } from "./incomeTax";
import { calculateSalary, saveSalaryResult, type SalaryExtras } from "./calcSalary";
import { DB_SCHEMAS } from "../types/dbSchema";

describe("減税額の合計", () => {
    test("1人3万円（本人＋配偶者＋子1人なら9万円）", () => {
        expect(flatTaxReductionTotal(3, "2020-04-01", 2024, 6)).toBe(90000);
        expect(flatTaxReductionTotal(1, "2020-04-01", 2024, 12)).toBe(30000);
    });
    test("2024年6月より前、2025年以後の給与では減税しない", () => {
        expect(flatTaxReductionTotal(3, "2020-04-01", 2024, 5)).toBe(0);
        expect(flatTaxReductionTotal(3, "2020-04-01", 2025, 6)).toBe(0);
    });
    test("6月1日に在籍していれば対象、6月2日以後の入社は月次減税しない（年末調整で精算）", () => {
        expect(flatTaxReductionTotal(2, "2024-06-01", 2024, 7)).toBe(60000);
        expect(flatTaxReductionTotal(2, "2024-06-02", 2024, 7)).toBe(0);
    });
    test("人数が0（未設定）なら減税しない", () => {
        expect(flatTaxReductionTotal(0, "2020-04-01", 2024, 6)).toBe(0);
    });
    test("乙欄の人（扶養控除等申告書を出していない人）は月次減税しない", () => {
        expect(flatTaxReductionTotal(3, "2020-04-01", 2024, 6, "otsu")).toBe(0);
        expect(flatTaxReductionTotal(3, "2020-04-01", 2024, 6, "kou")).toBe(90000);
    });
});

describe("給与の源泉所得税から差し引く", () => {
    const staff = {
        wage_type: "monthly", base_wage: 300000, scheduled_work_hours: 8,
        commute_type: "none", commute_amount: 0, standard_remuneration: 300000, birthday: "1990-06-15",
    };
    const company = { week_start_day: 0, round_overtime: "round", round_social_ins: "currency_law", round_emp_ins: "currency_law" };
    const calc = (month: number, remaining: number) => {
        const extras: SalaryExtras = {
            allowanceName: "", allowanceAmount: 0, residentTax: 0, prefecture: "東京", dependents: 0, customItems: [],
            flatTaxReductionRemaining: remaining,
        };
        return calculateSalary(staff, [], extras, 2024, month, company);
    };

    test("残りの減税額が所得税より多ければ、所得税は0円になり、差額を次に繰り越す", () => {
        const r = calc(6, 30000);
        const social = r.healthInsurance + r.nursingInsurance + r.childSupport + r.welfarePension + r.empInsurance;
        const tax = calcWithholdingTax(300000 - social, 0, 2024, "table");
        expect(tax).toBeGreaterThan(0);
        expect(r.incomeTaxBeforeReduction).toBe(tax);
        expect(r.flatTaxReduction).toBe(tax);
        expect(r.incomeTax).toBe(0);
        expect(r.flatTaxReductionRemaining).toBe(30000 - tax);
        expect(r.netPay).toBe(r.totalEarnings - social); // 所得税0円の分だけ手取りが増える
    });
    test("残りが所得税より少なければ、残りの分だけ引く", () => {
        const r = calc(9, 1000);
        expect(r.flatTaxReduction).toBe(1000);
        expect(r.incomeTax).toBe(r.incomeTaxBeforeReduction - 1000);
        expect(r.flatTaxReductionRemaining).toBe(0);
    });
    test("減税がなければ今までどおり", () => {
        const r = calc(6, 0);
        expect(r.flatTaxReduction).toBe(0);
        expect(r.incomeTax).toBe(r.incomeTaxBeforeReduction);
    });
    test("確定した給与の結果に、差し引いた減税額が保存される", async () => {
        const db = new Database(":memory:");
        for (const s of DB_SCHEMAS) db.exec(s);
        db.exec("INSERT INTO calendar_patterns (id, name) VALUES (1, '標準')");
        db.exec("INSERT INTO payroll_groups (id, name, closing_day, is_next_month, payment_day) VALUES (1, '全社', 99, 0, 25)");
        db.exec("INSERT INTO social_insurance_groups (id, name) VALUES (1, '協会けんぽ')");
        db.exec("INSERT INTO staff (id, name, base_wage) VALUES ('S001', '山田', 300000)");
        const asyncDb = { execute: async (sql: string, params: any[]) => db.prepare(sql).run(...params) };

        const r = calc(6, 30000);
        expect(await saveSalaryResult(asyncDb, "S001", 2024, 6, r, staff)).toEqual({ success: true });
        expect(db.query("SELECT income_tax, flat_tax_reduction FROM salary_results").get())
            .toEqual({ income_tax: 0, flat_tax_reduction: r.flatTaxReduction });
    });
});
