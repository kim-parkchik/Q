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
import { runMigrations, LATEST_DB_VERSION, MIGRATIONS, type MigrationDb } from "./migrations";
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

describe("会社ファイルの更新（マイグレーション）", () => {
    /** bun:sqlite を、アプリの Database と同じ使い方（Promise を返す）に合わせる */
    const wrap = (db: Database): MigrationDb => ({
        execute: async (sql, params = []) => db.prepare(sql).run(...(params as any[])),
        select: async <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as any[])) as T,
    });
    const columns = (db: Database, table: string) =>
        (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

    test("定額減税の列がない古い会社ファイルに、列を追加する", async () => {
        const db = new Database(":memory:");
        db.exec("CREATE TABLE staff (id TEXT PRIMARY KEY, name TEXT, base_wage INTEGER)");
        db.exec("CREATE TABLE salary_results (id INTEGER PRIMARY KEY, staff_id TEXT, income_tax INTEGER)");
        db.exec("CREATE TABLE company (id INTEGER PRIMARY KEY, name TEXT)");
        db.exec("INSERT INTO staff VALUES ('S001', '山田', 300000)");

        const applied = await runMigrations(wrap(db));
        expect(applied).toHaveLength(MIGRATIONS.length);
        expect(applied[0]).toStartWith("v1:");
        expect(columns(db, "staff")).toContain("flat_tax_reduction_persons");
        expect(columns(db, "salary_results")).toContain("flat_tax_reduction");
        expect(db.query("SELECT flat_tax_reduction_persons AS n FROM staff").get()).toEqual({ n: 0 });
        expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: LATEST_DB_VERSION });

        expect(await runMigrations(wrap(db))).toEqual([]); // 2回目は何もしない
    });
    test("新しい会社ファイル（列がすでにある）でもエラーにならない", async () => {
        const db = new Database(":memory:");
        for (const s of DB_SCHEMAS) db.exec(s);
        expect(await runMigrations(wrap(db))).toHaveLength(MIGRATIONS.length);
        expect(columns(db, "staff").filter((c) => c === "flat_tax_reduction_persons")).toHaveLength(1);
        expect(columns(db, "company").filter((c) => c === "is_small_business")).toHaveLength(1);
        expect(columns(db, "staff").filter((c) => c === "leave_periods")).toHaveLength(1);
        expect(columns(db, "staff").filter((c) => c === "tax_column")).toHaveLength(1);
        expect(columns(db, "staff").filter((c) => c === "standard_remuneration_history")).toHaveLength(1);
    });
    test("v2: v1 まで更新済みの会社ファイルに「中小企業」の列を追加する（初めはチェックなし）", async () => {
        const db = new Database(":memory:");
        db.exec("CREATE TABLE company (id INTEGER PRIMARY KEY, name TEXT)");
        db.exec("INSERT INTO company VALUES (1, 'テスト株式会社')");
        db.exec("CREATE TABLE staff (id TEXT PRIMARY KEY, name TEXT, base_wage INTEGER)"); // v3 以降で使う
        db.exec("PRAGMA user_version = 1");

        const applied = await runMigrations(wrap(db));
        expect(applied).toHaveLength(MIGRATIONS.length - 1);
        expect(applied[0]).toStartWith("v2:");
        expect(db.query("SELECT is_small_business AS v FROM company").get()).toEqual({ v: 0 });
    });
    test("v3: v2 まで更新済みの会社ファイルに、従業員の産休・育休の期間の列を追加する（初めは空）", async () => {
        const db = new Database(":memory:");
        db.exec("CREATE TABLE staff (id TEXT PRIMARY KEY, name TEXT, base_wage INTEGER)");
        db.exec("INSERT INTO staff VALUES ('S001', '山田', 300000)");
        db.exec("PRAGMA user_version = 2");

        const applied = await runMigrations(wrap(db));
        expect(applied).toHaveLength(MIGRATIONS.length - 2);
        expect(applied[0]).toStartWith("v3:");
        expect(db.query("SELECT leave_periods AS v FROM staff").get()).toEqual({ v: null });
    });
    test("v4: v3 まで更新済みの会社ファイルに、源泉所得税の欄の列を追加する（今までの人は甲欄）", async () => {
        const db = new Database(":memory:");
        db.exec("CREATE TABLE staff (id TEXT PRIMARY KEY, name TEXT, base_wage INTEGER)");
        db.exec("INSERT INTO staff VALUES ('S001', '山田', 300000)");
        db.exec("PRAGMA user_version = 3");

        const applied = await runMigrations(wrap(db));
        expect(applied).toHaveLength(MIGRATIONS.length - 3);
        expect(applied[0]).toStartWith("v4:");
        expect(db.query("SELECT tax_column AS v FROM staff").get()).toEqual({ v: "kou" });
    });
    test("v5: v4 まで更新済みの会社ファイルに、標準報酬月額の履歴の列を追加する（初めは空）", async () => {
        const db = new Database(":memory:");
        db.exec("CREATE TABLE staff (id TEXT PRIMARY KEY, name TEXT, base_wage INTEGER, standard_remuneration INTEGER)");
        db.exec("INSERT INTO staff VALUES ('S001', '山田', 300000, 300000)");
        db.exec("PRAGMA user_version = 4");

        const applied = await runMigrations(wrap(db));
        expect(applied).toHaveLength(MIGRATIONS.length - 4);
        expect(applied[0]).toStartWith("v5:");
        expect(db.query("SELECT standard_remuneration_history AS h, standard_remuneration AS s FROM staff").get())
            .toEqual({ h: null, s: 300000 });
    });
    test("v6: v5 まで更新済みの会社ファイルに、年末調整の精算の列を追加する（表がまだなければ何もしない）", async () => {
        const db = new Database(":memory:");
        db.exec("CREATE TABLE salary_results (id INTEGER PRIMARY KEY, staff_id TEXT, net_pay INTEGER)");
        db.exec("CREATE TABLE year_end_adjustments (staff_id TEXT, year INTEGER, declaration TEXT, result TEXT)");
        db.exec("INSERT INTO salary_results VALUES (1, 'S001', 250000)");
        db.exec("PRAGMA user_version = 5");

        const applied = await runMigrations(wrap(db));
        expect(applied[0]).toStartWith("v6:");
        expect(columns(db, "salary_results")).toContain("year_end_adjustment");
        expect(columns(db, "year_end_adjustments")).toEqual(expect.arrayContaining(["settle_year", "settle_month"]));
        expect(db.query("SELECT year_end_adjustment AS v FROM salary_results").get()).toEqual({ v: 0 });

        // 年末調整の表がまだない古いファイル（アプリは先に表を作るので、実際には起きない）でも止まらない
        const old = new Database(":memory:");
        old.exec("CREATE TABLE salary_results (id INTEGER PRIMARY KEY)");
        old.exec("PRAGMA user_version = 5");
        expect(await runMigrations(wrap(old))).toHaveLength(MIGRATIONS.length - 5);
    });
    test("v7: v6 まで更新済みの会社ファイルに、給与の確定結果の固定残業代・超過分の列を追加する（今までの確定結果の固定残業代は、わからないので空）", async () => {
        const db = new Database(":memory:");
        db.exec("CREATE TABLE salary_results (id INTEGER PRIMARY KEY, staff_id TEXT, net_pay INTEGER)");
        db.exec("INSERT INTO salary_results VALUES (1, 'S001', 250000)");
        db.exec("PRAGMA user_version = 6");

        const applied = await runMigrations(wrap(db));
        expect(applied[0]).toStartWith("v7:");
        expect(db.query("SELECT fixed_overtime_allowance AS a, fixed_overtime_excess AS e FROM salary_results").get()).toEqual({ a: null, e: 0 });
    });
    test("v8: v7 まで更新済みの会社ファイルに、給与項目を残業代の時給に入れるかの列を追加する（今までの項目は入れる）", async () => {
        const db = new Database(":memory:");
        db.exec("CREATE TABLE salary_item_master (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, type TEXT, category TEXT, display_order INTEGER)");
        db.exec("INSERT INTO salary_item_master (name, type, category, display_order) VALUES ('役職手当', 'earning', 'fixed', 10)");
        db.exec("PRAGMA user_version = 7");

        const applied = await runMigrations(wrap(db));
        expect(applied).toHaveLength(MIGRATIONS.length - 7);
        expect(applied[0]).toStartWith("v8:");
        expect(db.query("SELECT in_overtime_base AS v FROM salary_item_master").get()).toEqual({ v: 1 });
    });
    test("v9: v8 まで更新済みの会社ファイルに、従業員の基本給・扶養人数の履歴の列を追加する（初めは空）", async () => {
        const db = new Database(":memory:");
        db.exec("CREATE TABLE staff (id TEXT PRIMARY KEY, name TEXT, base_wage INTEGER, dependents INTEGER)");
        db.exec("INSERT INTO staff VALUES ('S001', '山田', 300000, 2)");
        db.exec("PRAGMA user_version = 8");

        const applied = await runMigrations(wrap(db));
        expect(applied).toHaveLength(MIGRATIONS.length - 8);
        expect(applied[0]).toStartWith("v9:");
        expect(db.query("SELECT wage_history AS w, dependents_history AS d, base_wage AS b FROM staff").get()).toEqual({ w: null, d: null, b: 300000 });
    });
    test("v10: v9 まで更新済みの会社ファイルに、給与規定グループの社会保険料の徴収月の列を追加する（今までのグループは当月徴収）", async () => {
        const db = new Database(":memory:");
        db.exec("CREATE TABLE payroll_groups (id INTEGER PRIMARY KEY, name TEXT, closing_day INTEGER, is_next_month INTEGER, payment_day INTEGER)");
        db.exec("INSERT INTO payroll_groups VALUES (1, '全社', 99, 0, 25)");
        db.exec("PRAGMA user_version = 9");

        const applied = await runMigrations(wrap(db));
        expect(applied).toHaveLength(MIGRATIONS.length - 9);
        expect(applied[0]).toStartWith("v10:");
        expect(db.query("SELECT social_ins_collection AS c FROM payroll_groups").get()).toEqual({ c: "current" });
    });
});
