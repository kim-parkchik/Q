/**
 * 定額減税（令和6年分・給与の月次減税）のテスト
 * 実行方法: bun test
 *
 * きまり（国税庁「定額減税について」）:
 *   本人＋同一生計配偶者・扶養親族 1人につき 30,000円を、令和6年6月1日以後最初に支払う給与の
 *   源泉所得税から差し引き、引ききれない分は令和6年中の給与から順に差し引く。
 *   賞与からも引くので、給与・賞与のそれぞれで引ける額は、払う日の順に数える（utils/flatTaxReduction.ts。下の「払う日の順に引く」）。
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { flatTaxReductionTotal, calcWithholdingTax } from "./incomeTax";
import { calculateSalary, saveSalaryResult, type SalaryExtras } from "./calcSalary";
import { DB_SCHEMAS } from "../types/dbSchema";
import { describeFlatTaxPayment, flatTaxRemainingFor, loadFlatTaxPayments, salaryPayDate, type FlatTaxPayment } from "./flatTaxReduction";

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

// ── 給与と賞与の、払う日の順の数え方（utils/flatTaxReduction.ts） ──

const salary = (date: string, reduction: number): FlatTaxPayment => ({ date, kind: "salary", order: 0, reduction });
const bonus = (date: string, order: number, reduction: number): FlatTaxPayment => ({ date, kind: "bonus", order, reduction });
const TOTAL = 90000; // 本人と扶養親族2人

describe("給与を払う日", () => {
  test("支給年月と給与規定グループの支払日。99・空は末日、その月にない日は末日", () => {
    expect(salaryPayDate(2024, 6, 25)).toBe("2024-06-25");
    expect(salaryPayDate(2024, 6, 99)).toBe("2024-06-30");
    expect(salaryPayDate(2024, 2, 31)).toBe("2024-02-29");
    expect(salaryPayDate(2024, 9, null)).toBe("2024-09-30");
  });
});

describe("その給与・賞与で引ける月次減税額（払う日の順に引く）", () => {
  test("月次減税の対象でなければ 0。まだ何も引いていなければ合計", () => {
    expect(flatTaxRemainingFor(0, [salary("2024-06-25", 0)], { date: "2024-07-25", kind: "salary", order: 0 })).toEqual({ remaining: 0, laterUsed: [] });
    expect(flatTaxRemainingFor(TOTAL, [], { date: "2024-06-10", kind: "bonus", order: 3 }).remaining).toBe(TOTAL);
  });
  test("6月10日の賞与で引いた額は、6月25日の給与の残りから引く（賞与から先に引く）", () => {
    const payments = [bonus("2024-06-10", 3, 50000)];
    expect(flatTaxRemainingFor(TOTAL, payments, { date: "2024-06-25", kind: "salary", order: 0 }).remaining).toBe(40000);
    // 7月10日の賞与は、6月の賞与と6月の給与の両方を引いた残り
    const more = [...payments, salary("2024-06-25", 25000)];
    expect(flatTaxRemainingFor(TOTAL, more, { date: "2024-07-10", kind: "bonus", order: 4 }).remaining).toBe(15000);
  });
  test("同じ日に払う給与と賞与は、給与から先に引く。同じ日の賞与どうしは、先に作った賞与から", () => {
    expect(flatTaxRemainingFor(TOTAL, [salary("2024-12-10", 30000)], { date: "2024-12-10", kind: "bonus", order: 5 }).remaining).toBe(60000);
    expect(flatTaxRemainingFor(TOTAL, [bonus("2024-12-10", 3, 10000)], { date: "2024-12-10", kind: "bonus", order: 5 }).remaining).toBe(80000);
  });
  test("確定し直すときは、前の自分の確定結果を数えない", () => {
    const payments = [salary("2024-06-25", 25000), bonus("2024-07-10", 4, 20000)];
    expect(flatTaxRemainingFor(TOTAL, payments, { date: "2024-07-10", kind: "bonus", order: 4 })).toEqual({ remaining: 65000, laterUsed: [] });
    expect(flatTaxRemainingFor(TOTAL, payments, { date: "2024-06-25", kind: "salary", order: 0 }).laterUsed).toEqual([bonus("2024-07-10", 4, 20000)]);
  });
  test("後に払う給与・賞与を先に確定していたら知らせ、合わせて合計を超えて引かないように減らす", () => {
    // 6月25日の給与で先に全部引いてから、6月10日の賞与を計算した
    const r = flatTaxRemainingFor(TOTAL, [salary("2024-06-25", 90000)], { date: "2024-06-10", kind: "bonus", order: 3 });
    expect(r.remaining).toBe(0);
    expect(r.laterUsed.map(describeFlatTaxPayment)).toEqual(["2024年6月25日の給与"]);
    // 一部だけ引いていたら、残りまで
    expect(flatTaxRemainingFor(TOTAL, [salary("2024-06-25", 30000)], { date: "2024-06-10", kind: "bonus", order: 3 }).remaining).toBe(60000);
  });
});

describe("会社ファイルから読む", () => {
  test("その年の確定した給与・賞与で引いた額を、人ごとに払う日と一緒に読む（給与の日は給与規定グループの支払日）", async () => {
    const db = new Database(":memory:");
    for (const s of DB_SCHEMAS) db.exec(s);
    db.exec("INSERT INTO payroll_groups (id, name, closing_day, is_next_month, payment_day) VALUES (1, '全社', 99, 0, 25), (2, '末日払い', 15, 0, 99)");
    db.exec("INSERT INTO staff (id, name, base_wage, payroll_group_id) VALUES ('S001', '山田', 300000, 1), ('S002', '佐藤', 250000, 2)");
    db.exec(`INSERT INTO salary_results (staff_id, target_year, target_month, flat_tax_reduction) VALUES
             ('S001', 2024, 6, 25000), ('S001', 2024, 7, 0), ('S002', 2024, 6, 12000), ('S001', 2025, 6, 9999)`);
    db.exec("INSERT INTO bonus_settings (id, name, target_year, target_month, payment_date) VALUES (3, '夏季賞与', 2024, 7, '2024-07-10')");
    db.exec("INSERT INTO bonus_results (bonus_setting_id, staff_id, flat_tax_reduction) VALUES (3, 'S001', 20000), (3, 'S002', 0)");
    const select = async <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as any[])) as T;
    const map = await loadFlatTaxPayments({ select }, 2024);
    expect(map.get("S001")).toEqual([salary("2024-06-25", 25000), bonus("2024-07-10", 3, 20000)]);
    expect(map.get("S002")).toEqual([salary("2024-06-30", 12000)]);
  });
});
