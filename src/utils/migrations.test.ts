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
        expect(LATEST_DB_VERSION).toBe(7);
        expect(MIGRATIONS.map((m) => m.version)).toEqual([2, 3, 4, 5, 6, 7]);
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

describe("更新（v2・v3・v4・v5・v6・v7）", () => {
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
        ]);
        expect(columns(db, "company")).toContain("bonus_plan_months");
        expect(header(db)).toEqual({ id: Q_FILE_ID, version: 7 });
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
        ]);
        expect(columns(db, "staff")).toContain("address_kana");
        expect(columns(db, "social_insurance_groups")).toEqual(expect.arrayContaining(["union_office_number", "union_media_seq"]));
        expect(header(db)).toEqual({ id: Q_FILE_ID, version: 7 });
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
        expect(await prepareCompanyFile(wrap(db), DB_SCHEMAS)).toEqual([V4, V5, V6, V7]);
        expect(header(db)).toEqual({ id: Q_FILE_ID, version: 7 });
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
        expect(await prepareCompanyFile(wrap(db), DB_SCHEMAS)).toEqual([V5, V6, V7]);
        expect(header(db)).toEqual({ id: Q_FILE_ID, version: 7 });
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
        expect(await prepareCompanyFile(wrap(db), DB_SCHEMAS)).toEqual([V6, V7]);
        expect(header(db)).toEqual({ id: Q_FILE_ID, version: 7 });
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
        expect(await prepareCompanyFile(wrap(db), DB_SCHEMAS)).toEqual([V7]);
        expect(header(db)).toEqual({ id: Q_FILE_ID, version: 7 });
        expect(db.query("SELECT name, nendo_koshin, gensen_nofu FROM company").get()).toEqual({ name: "テスト株式会社", nendo_koshin: "{}", gensen_nofu: null });
        expect(db.query("SELECT name, koyo_info, resident_tax_idou FROM staff").get()).toEqual({ name: "山田　太郎", koyo_info: "{}", resident_tax_idou: null });
    });
    test("新しいファイルには、はじめから v2〜v7 の列がある", async () => {
        const db = new Database(":memory:");
        await prepareCompanyFile(wrap(db), DB_SCHEMAS);
        expect(columns(db, "company")).toContain("bonus_plan_months");
        expect(columns(db, "staff")).toEqual(expect.arrayContaining(["address_kana", "in_kind", "kouki_date", "health_dependents", "koyo_info", "resident_tax_idou"]));
        expect(columns(db, "company")).toEqual(expect.arrayContaining(["koyo_office_number", "koyo_hello_work", "koyo_media_seq", "rousai_business", "rousai_rate", "nendo_koshin", "gensen_nofu"]));
        expect(columns(db, "branches")).toEqual(expect.arrayContaining(["koyo_office_number", "koyo_hello_work", "rousai_business", "rousai_rate"]));
        expect(columns(db, "social_insurance_groups")).toEqual(expect.arrayContaining(["union_office_number", "union_media_seq"]));
        expect(columns(db, "salary_results")).toEqual(expect.arrayContaining(["in_kind", "in_kind_taxable", "in_kind_emp", "in_kind_detail"]));
        expect(columns(db, "bonus_item_master")).toContain("in_kind");
        expect(columns(db, "bonus_results")).toContain("in_kind");
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
