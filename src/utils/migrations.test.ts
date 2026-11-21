/**
 * 会社ファイルの形式とマイグレーション（migrations.ts）のテスト
 * 実行方法: bun test
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addColumnIfMissing, prepareCompanyFile, BASE_DB_VERSION, LATEST_DB_VERSION, MIGRATIONS, Q_FILE_ID, type MigrationDb } from "./migrations";
import { DB_SCHEMAS } from "../types/dbSchema";

/** bun:sqlite を、アプリの Database と同じ使い方（Promise を返す）に合わせる */
const wrap = (db: Database): MigrationDb => ({
    execute: async (sql, params = []) => db.prepare(sql).run(...(params as any[])),
    select: async <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as any[])) as T,
});
const columns = (db: Database, table: string) =>
    (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
const tableCount = (db: Database) =>
    (db.query("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number }).n;
const header = (db: Database) => ({
    id: (db.query("PRAGMA application_id").get() as { application_id: number }).application_id,
    version: (db.query("PRAGMA user_version").get() as { user_version: number }).user_version,
});

describe("会社ファイルの形式（2026-11-14 の形を v1 とする。印は \"QP02\"）", () => {
    test("v1 から始めて、v2 から積み重ねる（前に積み重ねた更新 v2〜v21 は、v1 の表の定義にまとめた）", () => {
        expect(BASE_DB_VERSION).toBe(1);
        expect(LATEST_DB_VERSION).toBe(14);
        expect(MIGRATIONS.map((m) => m.version)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
        expect(String.fromCharCode(Q_FILE_ID >>> 24, (Q_FILE_ID >>> 16) & 0xff, (Q_FILE_ID >>> 8) & 0xff, Q_FILE_ID & 0xff)).toBe("QP02");
    });
    test("新しいファイル：表を作り、Q の印と最新の番号を付ける（更新は実行しない）。前の更新で足した列も、はじめからある", async () => {
        const db = new Database(":memory:");
        expect(await prepareCompanyFile(wrap(db), DB_SCHEMAS)).toEqual([]);
        expect(header(db)).toEqual({ id: Q_FILE_ID, version: LATEST_DB_VERSION });
        expect(columns(db, "salary_results")).toEqual(expect.arrayContaining(["non_fixed_earnings", "ledger", "leave_paid_days", "non_remuneration", "flex_carry_hours", "flex_month"]));
        expect(columns(db, "staff")).toEqual(expect.arrayContaining(["youiku_tokurei", "resident_tax_schedule", "probation_end", "death_cause"]));
        expect(columns(db, "payroll_groups")).toEqual(expect.arrayContaining(["flex_rule", "leave_proration_method", "shutdown_allowance_rate"]));
        expect(db.query("SELECT dflt_value AS d FROM pragma_table_info('payroll_groups') WHERE name = 'shutdown_allowance_rate'").get()).toEqual({ d: "60" });
    });
    test("2回目に開いても何もしない（入れたデータはそのまま）", async () => {
        const db = new Database(":memory:");
        await prepareCompanyFile(wrap(db), DB_SCHEMAS);
        db.exec("INSERT INTO company (id, name) VALUES (1, 'テスト株式会社')");
        expect(await prepareCompanyFile(wrap(db), DB_SCHEMAS)).toEqual([]);
        expect(header(db)).toEqual({ id: Q_FILE_ID, version: LATEST_DB_VERSION });
        expect(db.query("SELECT name FROM company").get()).toEqual({ name: "テスト株式会社" });
    });
    test("あとで足した表がないファイルには、その表を作る", async () => {
        const db = new Database(":memory:");
        db.exec("CREATE TABLE company (id INTEGER PRIMARY KEY, name TEXT)");
        db.exec(`PRAGMA application_id = ${Q_FILE_ID}`);
        db.exec(`PRAGMA user_version = ${LATEST_DB_VERSION}`);
        await prepareCompanyFile(wrap(db), DB_SCHEMAS);
        expect(columns(db, "salary_results")).toContain("non_fixed_earnings");
    });
    test("バックアップ（VACUUM INTO で作る .qb）にも印と番号が写るので、開ける", async () => {
        const db = new Database(":memory:");
        await prepareCompanyFile(wrap(db), DB_SCHEMAS);
        const path = join(tmpdir(), `q-migrations-test-${process.pid}.qb`);
        db.exec(`VACUUM INTO '${path}'`);
        const backup = new Database(path);
        try {
            expect(header(backup)).toEqual({ id: Q_FILE_ID, version: LATEST_DB_VERSION });
            expect(await prepareCompanyFile(wrap(backup), DB_SCHEMAS)).toEqual([]);
        } finally {
            backup.close();
            await Bun.file(path).delete();
        }
    });
});

const V4 = "v4: 現物で払う報酬（食事・住宅など）の列を、従業員・確定した給与・賞与の支給項目・確定した賞与に足す";
const V5 = "v5: 後期高齢者医療の障害認定の日と、健康保険の被扶養者の列を、従業員に足す";
const V6 = "v6: 雇用保険の届書（雇用保険適用事業所番号・ハローワーク・ＦＤ通番・従業員の雇用保険の情報）と、年度更新（労災保険の事業の種類と率・入れたもの）の列を足す";
const V7 = "v7: 源泉所得税の納付書（納期の特例・手で入れた額）と、住民税の給与所得者異動届出書に書くことの列を足す";
const V8 = "v8: 従業員の部門、仕訳データの設定、住民税の市区町村の送付先の列を足す";
const V9 = "v9: 労働条件通知書・36協定・雇用状況報告の設定、従業員の介護保険の適用除外・障害者雇用・在留資格の情報の列を足す（在留資格の情報は雇用保険の欄から移す）";
const V10 = "v10: 従業員に、在職中に退職以外で社会保険の資格を失う日と原因（社会保障協定・特定減額特例対象者の任意喪失）の列を、健康保険組合の料率に会社負担の料率の列を足す";
const V11 = "v11: 給与規定グループに、残業代の割増率（就業規則・36協定で決めた率）の列を足す";
const V12 = "v12: 年4回以上払う賞与（社会保険の報酬になる賞与）の印を賞与に、報酬として扱ったかを確定した賞与に、定時決定の年ごとの扱いを会社に足す";
const V13 = "v13: 従業員に曜日ごとの所定労働時間の列を、勤怠にその日だけ直した所定労働時間（シフト）の列を足す";
const V14 = "v14: 拠点に、週44時間の特例（特例措置対象事業場）の事業の列を足す";

describe("更新（v2〜v14）", () => {
    test("v1 のファイルに、v2 の列（会社の賞与支払予定月）を足して v2 にする（入れたデータはそのまま）", async () => {
        const db = new Database(":memory:");
        db.exec("CREATE TABLE company (id INTEGER PRIMARY KEY, name TEXT)");
        db.exec("INSERT INTO company (id, name) VALUES (1, 'テスト株式会社')");
        db.exec(`PRAGMA application_id = ${Q_FILE_ID}`);
        db.exec("PRAGMA user_version = 1");
        expect(await prepareCompanyFile(wrap(db), DB_SCHEMAS)).toEqual([
            "v2: 会社に、年金機構に登録している賞与支払予定月（賞与不支給報告書に使う）の列を足す",
            "v3: 従業員に住所のフリガナ（資格取得届に使う）、社会保険規定に健康保険組合の事業所番号と、組合に出すファイルの媒体通番の列を足す",
            "v4: 現物で払う報酬（食事・住宅など）の列を、従業員・確定した給与・賞与の支給項目・確定した賞与に足す",
            V5,
            V6,
            V7,
            V8,
            V9,
            V10,
            V11,
            V12,
            V13,
            V14,
        ]);
        expect(columns(db, "company")).toContain("bonus_plan_months");
        expect(header(db)).toEqual({ id: Q_FILE_ID, version: 14 });
        expect(db.query("SELECT name, bonus_plan_months FROM company").get()).toEqual({ name: "テスト株式会社", bonus_plan_months: null });
    });
    test("v2 のファイルに、v3 の列（従業員の住所のフリガナ・健康保険組合の事業所番号と媒体通番）を足して v3 にする（入れたデータはそのまま）", async () => {
        const db = new Database(":memory:");
        db.exec("CREATE TABLE staff (id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT)");
        db.exec("CREATE TABLE social_insurance_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, type TEXT DEFAULT 'kyokai')");
        db.exec("INSERT INTO staff (id, name, address) VALUES ('1001', '山田　太郎', '東京都千代田区')");
        db.exec("INSERT INTO social_insurance_groups (name, type) VALUES ('〇〇健康保険組合', 'union')");
        db.exec(`PRAGMA application_id = ${Q_FILE_ID}`);
        db.exec("PRAGMA user_version = 2");
        expect(await prepareCompanyFile(wrap(db), DB_SCHEMAS)).toEqual([
            "v3: 従業員に住所のフリガナ（資格取得届に使う）、社会保険規定に健康保険組合の事業所番号と、組合に出すファイルの媒体通番の列を足す",
            "v4: 現物で払う報酬（食事・住宅など）の列を、従業員・確定した給与・賞与の支給項目・確定した賞与に足す",
            V5,
            V6,
            V7,
            V8,
            V9,
            V10,
            V11,
            V12,
            V13,
            V14,
        ]);
        expect(columns(db, "staff")).toContain("address_kana");
        expect(columns(db, "social_insurance_groups")).toEqual(expect.arrayContaining(["union_office_number", "union_media_seq"]));
        expect(header(db)).toEqual({ id: Q_FILE_ID, version: 14 });
        expect(db.query("SELECT name, address, address_kana FROM staff").get()).toEqual({ name: "山田　太郎", address: "東京都千代田区", address_kana: null });
        expect(db.query("SELECT name, type, union_office_number, union_media_seq FROM social_insurance_groups").get())
            .toEqual({ name: "〇〇健康保険組合", type: "union", union_office_number: null, union_media_seq: 0 });
    });
    test("v3 のファイルに、v4 の列（現物で払う報酬）を足して v4 にする（入れたデータはそのまま。確定した給与・賞与の現物は 0）", async () => {
        const db = new Database(":memory:");
        db.exec("CREATE TABLE staff (id TEXT PRIMARY KEY, name TEXT NOT NULL)");
        db.exec("CREATE TABLE salary_results (id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id TEXT NOT NULL, target_year INTEGER, target_month INTEGER, total_earnings INTEGER)");
        db.exec("CREATE TABLE bonus_item_master (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, type TEXT NOT NULL)");
        db.exec("CREATE TABLE bonus_results (bonus_setting_id INTEGER NOT NULL, staff_id TEXT NOT NULL, total_earnings INTEGER)");
        db.exec("INSERT INTO staff (id, name) VALUES ('1001', '山田　太郎')");
        db.exec("INSERT INTO salary_results (staff_id, target_year, target_month, total_earnings) VALUES ('1001', 2026, 10, 300000)");
        db.exec("INSERT INTO bonus_item_master (name, type) VALUES ('賞与', 'earning')");
        db.exec("INSERT INTO bonus_results (bonus_setting_id, staff_id, total_earnings) VALUES (1, '1001', 500000)");
        db.exec(`PRAGMA application_id = ${Q_FILE_ID}`);
        db.exec("PRAGMA user_version = 3");
        expect(await prepareCompanyFile(wrap(db), DB_SCHEMAS)).toEqual([V4, V5, V6, V7, V8, V9, V10, V11, V12, V13, V14]);
        expect(header(db)).toEqual({ id: Q_FILE_ID, version: 14 });
        expect(db.query("SELECT name, in_kind FROM staff").get()).toEqual({ name: "山田　太郎", in_kind: null });
        expect(db.query("SELECT total_earnings, in_kind, in_kind_taxable, in_kind_emp, in_kind_detail FROM salary_results").get())
            .toEqual({ total_earnings: 300000, in_kind: 0, in_kind_taxable: 0, in_kind_emp: 0, in_kind_detail: null });
        expect(db.query("SELECT name, in_kind FROM bonus_item_master").get()).toEqual({ name: "賞与", in_kind: 0 });
        expect(db.query("SELECT total_earnings, in_kind FROM bonus_results").get()).toEqual({ total_earnings: 500000, in_kind: 0 });
    });
    test("v4 のファイルに、v5 の列（後期高齢者医療の障害認定の日・健康保険の被扶養者）を足して v5 にする（入れたデータはそのまま）", async () => {
        const db = new Database(":memory:");
        db.exec("CREATE TABLE staff (id TEXT PRIMARY KEY, name TEXT NOT NULL, in_kind TEXT)");
        db.exec("INSERT INTO staff (id, name, in_kind) VALUES ('1001', '山田　太郎', '[]')");
        db.exec(`PRAGMA application_id = ${Q_FILE_ID}`);
        db.exec("PRAGMA user_version = 4");
        expect(await prepareCompanyFile(wrap(db), DB_SCHEMAS)).toEqual([V5, V6, V7, V8, V9, V10, V11, V12, V13, V14]);
        expect(header(db)).toEqual({ id: Q_FILE_ID, version: 14 });
        expect(db.query("SELECT name, in_kind, kouki_date, health_dependents FROM staff").get())
            .toEqual({ name: "山田　太郎", in_kind: "[]", kouki_date: null, health_dependents: null });
    });
    test("v5 のファイルに、v6 の列（雇用保険の届書・年度更新）を足して v6 にする（入れたデータはそのまま）", async () => {
        const db = new Database(":memory:");
        db.exec("CREATE TABLE company (id INTEGER PRIMARY KEY, name TEXT, labor_ins_num TEXT)");
        db.exec("CREATE TABLE branches (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, prefecture TEXT NOT NULL)");
        db.exec("CREATE TABLE staff (id TEXT PRIMARY KEY, name TEXT NOT NULL, health_dependents TEXT)");
        db.exec("INSERT INTO company (id, name, labor_ins_num) VALUES (1, 'テスト株式会社', '13101123456000')");
        db.exec("INSERT INTO branches (name, prefecture) VALUES ('本店', '東京都')");
        db.exec("INSERT INTO staff (id, name, health_dependents) VALUES ('1001', '山田　太郎', '[]')");
        db.exec(`PRAGMA application_id = ${Q_FILE_ID}`);
        db.exec("PRAGMA user_version = 5");
        expect(await prepareCompanyFile(wrap(db), DB_SCHEMAS)).toEqual([V6, V7, V8, V9, V10, V11, V12, V13, V14]);
        expect(header(db)).toEqual({ id: Q_FILE_ID, version: 14 });
        expect(db.query("SELECT name, labor_ins_num, koyo_office_number, koyo_hello_work, koyo_media_seq, rousai_business, rousai_rate, nendo_koshin FROM company").get())
            .toEqual({ name: "テスト株式会社", labor_ins_num: "13101123456000", koyo_office_number: null, koyo_hello_work: null, koyo_media_seq: 0, rousai_business: null, rousai_rate: null, nendo_koshin: null });
        expect(db.query("SELECT name, koyo_office_number, koyo_hello_work, rousai_business, rousai_rate FROM branches").get())
            .toEqual({ name: "本店", koyo_office_number: null, koyo_hello_work: null, rousai_business: null, rousai_rate: null });
        expect(db.query("SELECT name, health_dependents, koyo_info FROM staff").get()).toEqual({ name: "山田　太郎", health_dependents: "[]", koyo_info: null });
    });
    test("v6 のファイルに、v7 の列（源泉所得税の納付書・住民税の異動届出書）を足して v7 にする（入れたデータはそのまま）", async () => {
        const db = new Database(":memory:");
        db.exec("CREATE TABLE company (id INTEGER PRIMARY KEY, name TEXT, nendo_koshin TEXT)");
        db.exec("CREATE TABLE staff (id TEXT PRIMARY KEY, name TEXT NOT NULL, koyo_info TEXT)");
        db.exec("INSERT INTO company (id, name, nendo_koshin) VALUES (1, 'テスト株式会社', '{}')");
        db.exec("INSERT INTO staff (id, name, koyo_info) VALUES ('1001', '山田　太郎', '{}')");
        db.exec(`PRAGMA application_id = ${Q_FILE_ID}`);
        db.exec("PRAGMA user_version = 6");
        expect(await prepareCompanyFile(wrap(db), DB_SCHEMAS)).toEqual([V7, V8, V9, V10, V11, V12, V13, V14]);
        expect(header(db)).toEqual({ id: Q_FILE_ID, version: 14 });
        expect(db.query("SELECT name, nendo_koshin, gensen_nofu FROM company").get()).toEqual({ name: "テスト株式会社", nendo_koshin: "{}", gensen_nofu: null });
        expect(db.query("SELECT name, koyo_info, resident_tax_idou FROM staff").get()).toEqual({ name: "山田　太郎", koyo_info: "{}", resident_tax_idou: null });
    });
    test("v7 のファイルに、v8 の列（部門・仕訳データの設定・住民税の送付先）を足して v8 にする（入れたデータはそのまま）", async () => {
        const db = new Database(":memory:");
        db.exec("CREATE TABLE company (id INTEGER PRIMARY KEY, name TEXT, gensen_nofu TEXT)");
        db.exec("CREATE TABLE staff (id TEXT PRIMARY KEY, name TEXT NOT NULL, resident_tax_idou TEXT)");
        db.exec("CREATE TABLE resident_tax_municipalities (code TEXT PRIMARY KEY, designation_number TEXT)");
        db.exec("INSERT INTO company (id, name, gensen_nofu) VALUES (1, 'テスト株式会社', '{}')");
        db.exec("INSERT INTO staff (id, name, resident_tax_idou) VALUES ('1001', '山田　太郎', '{}')");
        db.exec("INSERT INTO resident_tax_municipalities (code, designation_number) VALUES ('131016', '1234567890')");
        db.exec(`PRAGMA application_id = ${Q_FILE_ID}`);
        db.exec("PRAGMA user_version = 7");
        expect(await prepareCompanyFile(wrap(db), DB_SCHEMAS)).toEqual([V8, V9, V10, V11, V12, V13, V14]);
        expect(header(db)).toEqual({ id: Q_FILE_ID, version: 14 });
        expect(db.query("SELECT name, gensen_nofu, journal_settings FROM company").get()).toEqual({ name: "テスト株式会社", gensen_nofu: "{}", journal_settings: null });
        expect(db.query("SELECT name, resident_tax_idou, department FROM staff").get()).toEqual({ name: "山田　太郎", resident_tax_idou: "{}", department: null });
        expect(db.query("SELECT code, designation_number, mail_zip, mail_address, mail_name FROM resident_tax_municipalities").get())
            .toEqual({ code: "131016", designation_number: "1234567890", mail_zip: null, mail_address: null, mail_name: null });
    });
    test("v9 のファイルに、v10 の列（社会保険の資格を失う日・組合の会社負担の料率）を足して v10 にする（入れたデータはそのまま）", async () => {
        const db = new Database(":memory:");
        db.exec("CREATE TABLE staff (id TEXT PRIMARY KEY, name TEXT NOT NULL, foreign_info TEXT)");
        db.exec("CREATE TABLE social_insurance_group_rates (id INTEGER PRIMARY KEY, group_id INTEGER, from_month TEXT, health_rate REAL, care_rate REAL, child_support_rate REAL)");
        db.exec("INSERT INTO staff (id, name, foreign_info) VALUES ('1001', '山田　太郎', NULL)");
        db.exec("INSERT INTO social_insurance_group_rates (group_id, from_month, health_rate, care_rate, child_support_rate) VALUES (2, '2026-04', 4.5, 0.9, 0.115)");
        db.exec(`PRAGMA application_id = ${Q_FILE_ID}`);
        db.exec("PRAGMA user_version = 9");
        expect(await prepareCompanyFile(wrap(db), DB_SCHEMAS)).toEqual([V10, V11, V12, V13, V14]);
        expect(header(db)).toEqual({ id: Q_FILE_ID, version: 14 });
        expect(db.query("SELECT name, shaho_loss FROM staff").get()).toEqual({ name: "山田　太郎", shaho_loss: null });
        expect(db.query("SELECT health_rate, company_health_rate, company_care_rate, company_child_support_rate FROM social_insurance_group_rates").get())
            .toEqual({ health_rate: 4.5, company_health_rate: null, company_care_rate: null, company_child_support_rate: null });
    });
    test("新しいファイルには、はじめから v2〜v14 の列がある", async () => {
        const db = new Database(":memory:");
        await prepareCompanyFile(wrap(db), DB_SCHEMAS);
        expect(columns(db, "company")).toContain("bonus_plan_months");
        expect(columns(db, "staff")).toEqual(expect.arrayContaining(["address_kana", "in_kind", "kouki_date", "health_dependents", "koyo_info", "resident_tax_idou", "department"]));
        expect(columns(db, "company")).toEqual(expect.arrayContaining(["koyo_office_number", "koyo_hello_work", "koyo_media_seq", "rousai_business", "rousai_rate", "nendo_koshin", "gensen_nofu", "journal_settings"]));
        expect(columns(db, "branches")).toEqual(expect.arrayContaining(["koyo_office_number", "koyo_hello_work", "rousai_business", "rousai_rate"]));
        expect(columns(db, "social_insurance_groups")).toEqual(expect.arrayContaining(["union_office_number", "union_media_seq"]));
        expect(columns(db, "salary_results")).toEqual(expect.arrayContaining(["in_kind", "in_kind_taxable", "in_kind_emp", "in_kind_detail"]));
        expect(columns(db, "bonus_item_master")).toContain("in_kind");
        expect(columns(db, "bonus_results")).toContain("in_kind");
        expect(columns(db, "company")).toEqual(expect.arrayContaining(["labor_conditions", "kyotei36", "employment_report"]));
        expect(columns(db, "staff")).toEqual(expect.arrayContaining(["labor_conditions", "kaigo_exempt", "disability_employment", "foreign_info"]));
        expect(columns(db, "payroll_groups")).toContain("premium_rates");
        expect(columns(db, "bonus_settings")).toContain("shaho_houshu");
        expect(columns(db, "bonus_results")).toContain("shaho_houshu");
        expect(columns(db, "company")).toContain("shoyo_houshu");
        expect(columns(db, "staff")).toContain("weekday_hours");
        expect(columns(db, "attendance")).toContain("scheduled_hours");
        expect(columns(db, "branches")).toContain("weekly44_business");
    });
    test("v13 のファイルに、v14 の列（拠点の週44時間の特例の事業）を足して v14 にする（入れたデータはそのまま）", async () => {
        const db = new Database(":memory:");
        db.exec("CREATE TABLE branches (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, prefecture TEXT NOT NULL, health_ins_num TEXT)");
        db.exec("INSERT INTO branches (name, prefecture) VALUES ('本店', '東京都')");
        db.exec(`PRAGMA application_id = ${Q_FILE_ID}`);
        db.exec("PRAGMA user_version = 13");
        expect(await prepareCompanyFile(wrap(db), DB_SCHEMAS)).toEqual([V14]);
        expect(header(db)).toEqual({ id: Q_FILE_ID, version: 14 });
        // いままでの拠点は、特例を使わない（週40時間）
        expect(db.query("SELECT name, prefecture, weekly44_business FROM branches").get()).toEqual({ name: "本店", prefecture: "東京都", weekly44_business: null });
    });
    test("v12 のファイルに、v13 の列（曜日ごとの所定労働時間・その日だけ直した所定労働時間）を足して v13 にする（入れたデータはそのまま）", async () => {
        const db = new Database(":memory:");
        db.exec("CREATE TABLE staff (id TEXT PRIMARY KEY, name TEXT NOT NULL, scheduled_work_hours REAL DEFAULT 8.0)");
        db.exec("CREATE TABLE attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id TEXT NOT NULL, work_date TEXT NOT NULL, work_type TEXT DEFAULT '', paid_leave_hours REAL DEFAULT 0)");
        db.exec("INSERT INTO staff (id, name, scheduled_work_hours) VALUES ('1001', '山田　太郎', 4)");
        db.exec("INSERT INTO attendance (staff_id, work_date, work_type) VALUES ('1001', '2026-11-18', 'paid_full')");
        db.exec(`PRAGMA application_id = ${Q_FILE_ID}`);
        db.exec("PRAGMA user_version = 12");
        expect(await prepareCompanyFile(wrap(db), DB_SCHEMAS)).toEqual([V13, V14]);
        expect(header(db)).toEqual({ id: Q_FILE_ID, version: 14 });
        // いままでの人は、曜日ごとの時間なし（1日の所定労働時間だけ）・その日だけ直した時間なし
        expect(db.query("SELECT name, scheduled_work_hours, weekday_hours FROM staff").get()).toEqual({ name: "山田　太郎", scheduled_work_hours: 4, weekday_hours: null });
        expect(db.query("SELECT work_date, work_type, scheduled_hours FROM attendance").get()).toEqual({ work_date: "2026-11-18", work_type: "paid_full", scheduled_hours: null });
    });
    test("v11 のファイルに、v12 の列（年4回以上払う賞与の印・報酬として扱ったか・年ごとの扱い）を足して v12 にする（入れたデータはそのまま）", async () => {
        const db = new Database(":memory:");
        db.exec("CREATE TABLE company (id INTEGER PRIMARY KEY, name TEXT)");
        db.exec("CREATE TABLE bonus_settings (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, target_year INTEGER NOT NULL, target_month INTEGER NOT NULL, payment_date TEXT, is_closed INTEGER DEFAULT 0)");
        db.exec("CREATE TABLE bonus_results (bonus_setting_id INTEGER NOT NULL, staff_id TEXT NOT NULL, total_earnings INTEGER, hyojun_bonus INTEGER, PRIMARY KEY (bonus_setting_id, staff_id))");
        db.exec("INSERT INTO company (id, name) VALUES (1, 'テスト株式会社')");
        db.exec("INSERT INTO bonus_settings (name, target_year, target_month, payment_date, is_closed) VALUES ('夏季賞与', 2026, 7, '2026-07-10', 1)");
        db.exec("INSERT INTO bonus_results (bonus_setting_id, staff_id, total_earnings, hyojun_bonus) VALUES (1, '1001', 300500, 300000)");
        db.exec(`PRAGMA application_id = ${Q_FILE_ID}`);
        db.exec("PRAGMA user_version = 11");
        expect(await prepareCompanyFile(wrap(db), DB_SCHEMAS)).toEqual([V12, V13, V14]);
        expect(header(db)).toEqual({ id: Q_FILE_ID, version: 14 });
        expect(db.query("SELECT name, shoyo_houshu FROM company").get()).toEqual({ name: "テスト株式会社", shoyo_houshu: null });
        // いままでの賞与は、印なし（年3回以下の賞与）・賞与として確定したもの
        expect(db.query("SELECT name, is_closed, shaho_houshu FROM bonus_settings").get()).toEqual({ name: "夏季賞与", is_closed: 1, shaho_houshu: 0 });
        expect(db.query("SELECT total_earnings, hyojun_bonus, shaho_houshu FROM bonus_results").get()).toEqual({ total_earnings: 300500, hyojun_bonus: 300000, shaho_houshu: 0 });
    });
    test("v10 のファイルに、v11 の列（給与規定グループの残業代の割増率）を足して v11 にする（入れたデータはそのまま）", async () => {
        const db = new Database(":memory:");
        db.exec("CREATE TABLE payroll_groups (id INTEGER PRIMARY KEY, name TEXT NOT NULL, closing_day INTEGER, is_next_month INTEGER, payment_day INTEGER)");
        db.exec("INSERT INTO payroll_groups (id, name, closing_day, is_next_month, payment_day) VALUES (1, '全社', 99, 1, 25)");
        db.exec(`PRAGMA application_id = ${Q_FILE_ID}`);
        db.exec("PRAGMA user_version = 10");
        expect(await prepareCompanyFile(wrap(db), DB_SCHEMAS)).toEqual([V11, V12, V13, V14]);
        expect(header(db)).toEqual({ id: Q_FILE_ID, version: 14 });
        expect(db.query("SELECT name, closing_day, premium_rates FROM payroll_groups").get()).toEqual({ name: "全社", closing_day: 99, premium_rates: null });
    });
    test("v8 のファイルに、v9 の列（労働条件通知書・36協定・雇用状況報告・介護保険の適用除外・障害者雇用）を足して v9 にする（入れたデータはそのまま）", async () => {
        const db = new Database(":memory:");
        db.exec("CREATE TABLE company (id INTEGER PRIMARY KEY, name TEXT, journal_settings TEXT)");
        db.exec("CREATE TABLE staff (id TEXT PRIMARY KEY, name TEXT NOT NULL, department TEXT, koyo_info TEXT)");
        db.exec("INSERT INTO company (id, name, journal_settings) VALUES (1, 'テスト株式会社', '{}')");
        db.exec("INSERT INTO staff (id, name, department, koyo_info) VALUES ('1001', '山田　太郎', '営業部', NULL)");
        const foreign = { romaji: "NGUYEN VAN AN", nationality: "ベトナム", status: "35", statusText: "", periodEnd: "2029-03-31", permission: "無", card: "AB12345678CD", dispatch: "非該当" };
        db.exec(`INSERT INTO staff (id, name, department, koyo_info) VALUES ('1002', 'グエン', NULL, '${JSON.stringify({ occupation: "02", foreign })}')`);
        db.exec("INSERT INTO staff (id, name, department, koyo_info) VALUES ('1003', '日本　花子', NULL, '{\"occupation\":\"01\",\"foreign\":null}')");
        db.exec("INSERT INTO staff (id, name, department, koyo_info) VALUES ('1004', '壊れた', NULL, '{こわれた')");
        db.exec(`PRAGMA application_id = ${Q_FILE_ID}`);
        db.exec("PRAGMA user_version = 8");
        expect(await prepareCompanyFile(wrap(db), DB_SCHEMAS)).toEqual([V9, V10, V11, V12, V13, V14]);
        expect(header(db)).toEqual({ id: Q_FILE_ID, version: 14 });
        expect(db.query("SELECT name, journal_settings, labor_conditions, kyotei36, employment_report FROM company").get())
            .toEqual({ name: "テスト株式会社", journal_settings: "{}", labor_conditions: null, kyotei36: null, employment_report: null });
        expect(db.query("SELECT name, department, labor_conditions, kaigo_exempt, disability_employment, foreign_info FROM staff WHERE id = '1001'").get())
            .toEqual({ name: "山田　太郎", department: "営業部", labor_conditions: null, kaigo_exempt: null, disability_employment: null, foreign_info: null });
        // 在留資格の情報は、雇用保険の欄（koyo_info の foreign）から foreign_info に移す（確かめた日は空）
        const moved = db.query("SELECT koyo_info, foreign_info FROM staff WHERE id = '1002'").get() as { koyo_info: string; foreign_info: string };
        expect(JSON.parse(moved.foreign_info)).toEqual({ ...foreign, checkedOn: "" });
        expect(JSON.parse(moved.koyo_info)).toEqual({ occupation: "02" });
        expect(db.query("SELECT koyo_info, foreign_info FROM staff WHERE id = '1003'").get()).toEqual({ koyo_info: JSON.stringify({ occupation: "01" }), foreign_info: null });
        expect(db.query("SELECT koyo_info, foreign_info FROM staff WHERE id = '1004'").get()).toEqual({ koyo_info: "{こわれた", foreign_info: null });
    });
});

describe("開けないファイル（壊さないように触らない）", () => {
    test("2026-11-03〜11-14 の形式（印 \"QP01\"。v21 まで更新したものも、v1 のままのものも）", async () => {
        for (const version of [21, 1]) {
            const db = new Database(":memory:");
            db.exec("CREATE TABLE staff (id TEXT PRIMARY KEY, name TEXT)");
            db.exec(`PRAGMA application_id = ${0x51503031}`);
            db.exec(`PRAGMA user_version = ${version}`);
            await expect(prepareCompanyFile(wrap(db), DB_SCHEMAS)).rejects.toThrow("今のQの形式ではありません");
            expect(header(db)).toEqual({ id: 0x51503031, version });
            expect(tableCount(db)).toBe(1);
        }
    });
    test("開発中の古い形式（印がない。v13 まで更新したもの）", async () => {
        const db = new Database(":memory:");
        db.exec("CREATE TABLE staff (id TEXT PRIMARY KEY, name TEXT)");
        db.exec("PRAGMA user_version = 13");
        await expect(prepareCompanyFile(wrap(db), DB_SCHEMAS)).rejects.toThrow("今のQの形式ではありません");
        expect(header(db)).toEqual({ id: 0, version: 13 });
        expect(tableCount(db)).toBe(1);
    });
    test("開発中の古い形式（印がなく、番号もない）", async () => {
        const db = new Database(":memory:");
        db.exec("CREATE TABLE staff (id TEXT PRIMARY KEY, name TEXT)");
        await expect(prepareCompanyFile(wrap(db), DB_SCHEMAS)).rejects.toThrow("今のQの形式ではありません");
        expect(tableCount(db)).toBe(1);
    });
    test("新しいバージョンのQで保存したファイル", async () => {
        const db = new Database(":memory:");
        db.exec("CREATE TABLE staff (id TEXT PRIMARY KEY, name TEXT)");
        db.exec(`PRAGMA application_id = ${Q_FILE_ID}`);
        db.exec(`PRAGMA user_version = ${LATEST_DB_VERSION + 1}`);
        await expect(prepareCompanyFile(wrap(db), DB_SCHEMAS)).rejects.toThrow("新しいバージョンのQで保存されています");
        expect(tableCount(db)).toBe(1);
    });
});

describe("列を足す（v2 からの更新で使う）", () => {
    test("列がないときだけ足す。表がないときは何もしない", async () => {
        const db = new Database(":memory:");
        db.exec("CREATE TABLE staff (id TEXT PRIMARY KEY, name TEXT)");
        db.exec("INSERT INTO staff VALUES ('S001', '山田')");
        await addColumnIfMissing(wrap(db), "staff", "memo", "TEXT DEFAULT 'なし'");
        await addColumnIfMissing(wrap(db), "staff", "memo", "TEXT DEFAULT 'なし'");
        expect(columns(db, "staff").filter((c) => c === "memo")).toHaveLength(1);
        expect(db.query("SELECT memo FROM staff").get()).toEqual({ memo: "なし" });
        await addColumnIfMissing(wrap(db), "no_such_table", "memo", "TEXT");
        expect(tableCount(db)).toBe(1);
    });
});
