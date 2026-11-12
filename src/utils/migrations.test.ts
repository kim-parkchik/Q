/**
 * 会社ファイルの形式とマイグレーション（migrations.ts）のテスト
 * 実行方法: bun test
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addColumnIfMissing, prepareCompanyFile, BASE_DB_VERSION, LATEST_DB_VERSION, Q_FILE_ID, type MigrationDb } from "./migrations";
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

describe("会社ファイルの形式（2026-11-03 の形を v1 とする）", () => {
    test("v1 から始めて、今の最新は v13", () => {
        expect(BASE_DB_VERSION).toBe(1);
        expect(LATEST_DB_VERSION).toBe(13);
    });
    test("新しいファイル：表を作り、Q の印と最新の番号を付ける（更新は実行しない）", async () => {
        const db = new Database(":memory:");
        expect(await prepareCompanyFile(wrap(db), DB_SCHEMAS)).toEqual([]);
        expect(header(db)).toEqual({ id: Q_FILE_ID, version: LATEST_DB_VERSION });
        expect(columns(db, "salary_results")).toContain("non_fixed_earnings");
        expect(columns(db, "staff")).toContain("youiku_tokurei");
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

describe("更新（マイグレーション）", () => {
    /** v1 の会社ファイル（v2 で足した列がない） */
    const v1File = () => {
        const db = new Database(":memory:");
        db.exec("CREATE TABLE staff (id TEXT PRIMARY KEY, name TEXT, resident_tax INTEGER DEFAULT 0)");
        db.exec("INSERT INTO staff VALUES ('S001', '山田', 7000)");
        db.exec(`PRAGMA application_id = ${Q_FILE_ID}`);
        db.exec("PRAGMA user_version = 1");
        return db;
    };
    test("v2: 従業員に住民税の年度ごとの額の列を足す（初めは空。今までの月額はそのまま）", async () => {
        const db = v1File();
        const applied = await prepareCompanyFile(wrap(db), DB_SCHEMAS);
        expect(applied).toHaveLength(12);
        expect(applied[0]).toStartWith("v2:");
        expect(db.query("SELECT resident_tax AS t, resident_tax_schedule AS s FROM staff").get()).toEqual({ t: 7000, s: null });
        expect(header(db)).toEqual({ id: Q_FILE_ID, version: LATEST_DB_VERSION });
        expect(await prepareCompanyFile(wrap(db), DB_SCHEMAS)).toEqual([]); // 2回目は何もしない
    });
    test("v3: v2 の会社ファイルの従業員に、住民税の市区町村の列を足す（初めは空）", async () => {
        const db = v1File();
        db.exec("ALTER TABLE staff ADD COLUMN resident_tax_schedule TEXT");
        db.exec("PRAGMA user_version = 2");
        const applied = await prepareCompanyFile(wrap(db), DB_SCHEMAS);
        expect(applied).toHaveLength(11);
        expect(applied[0]).toStartWith("v3:");
        expect(db.query("SELECT resident_tax_municipality AS m FROM staff").get()).toEqual({ m: null });
    });
    test("v4: v3 の会社ファイルのユーザーに、マイナンバーを扱える印の列を足す（初めは誰にも付けない）", async () => {
        const db = v1File();
        db.exec("ALTER TABLE staff ADD COLUMN resident_tax_schedule TEXT");
        db.exec("ALTER TABLE staff ADD COLUMN resident_tax_municipality TEXT");
        db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, login_id TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT DEFAULT 'staff')");
        db.exec("INSERT INTO users (login_id, display_name, password_hash, role) VALUES ('admin', '管理者', 'x', 'admin')");
        db.exec("PRAGMA user_version = 3");
        const applied = await prepareCompanyFile(wrap(db), DB_SCHEMAS);
        expect(applied).toHaveLength(10);
        expect(applied[0]).toStartWith("v4:");
        expect(db.query("SELECT my_number_access AS a FROM users").get()).toEqual({ a: 0 });
        // マイナンバーの表は、開くときに作られる
        expect(db.query("SELECT COUNT(*) AS n FROM my_numbers").get()).toEqual({ n: 0 });
    });
    test("v5: v4 の会社ファイルの住民税の市区町村ごとの設定に、宛名番号と納期の特例の列を足す（指定番号はそのまま）", async () => {
        const db = v1File();
        db.exec("ALTER TABLE staff ADD COLUMN resident_tax_schedule TEXT");
        db.exec("ALTER TABLE staff ADD COLUMN resident_tax_municipality TEXT");
        db.exec("CREATE TABLE resident_tax_municipalities (code TEXT PRIMARY KEY, designation_number TEXT, updated_at TEXT)");
        db.exec("INSERT INTO resident_tax_municipalities (code, designation_number) VALUES ('131016', 'AB-12345')");
        db.exec("PRAGMA user_version = 4");
        const applied = await prepareCompanyFile(wrap(db), DB_SCHEMAS);
        expect(applied).toHaveLength(9);
        expect(applied[0]).toStartWith("v5:");
        expect(db.query("SELECT designation_number AS d, atena_number AS a, special_due AS s FROM resident_tax_municipalities").get())
            .toEqual({ d: "AB-12345", a: null, s: 0 });
    });
    test("v6: v5 の会社ファイルのマイナンバーに、同じ番号かどうかを確かめる値の列を足す（番号はそのまま。暗号化は始めるときにする）", async () => {
        const db = v1File();
        db.exec("ALTER TABLE staff ADD COLUMN resident_tax_schedule TEXT");
        db.exec("ALTER TABLE staff ADD COLUMN resident_tax_municipality TEXT");
        db.exec("CREATE TABLE my_numbers (staff_id TEXT NOT NULL, person TEXT NOT NULL, name TEXT, relation TEXT, number TEXT NOT NULL, updated_at TEXT, PRIMARY KEY (staff_id, person))");
        db.exec("INSERT INTO my_numbers (staff_id, person, number) VALUES ('S001', 'self', '123456789018')");
        db.exec("PRAGMA user_version = 5");
        const applied = await prepareCompanyFile(wrap(db), DB_SCHEMAS);
        expect(applied).toHaveLength(8);
        expect(applied[0]).toStartWith("v6:");
        expect(db.query("SELECT number, number_hash AS h FROM my_numbers").get()).toEqual({ number: "123456789018", h: null });
        // 鍵の表は、開くときに作られる
        expect(db.query("SELECT COUNT(*) AS n FROM my_number_keys").get()).toEqual({ n: 0 });
    });
    test("v7: v6 の会社ファイルの従業員に、通勤の方法などの列を足す（初めは空。電車・バスなどとして計算する）", async () => {
        const db = v1File();
        db.exec("ALTER TABLE staff ADD COLUMN resident_tax_schedule TEXT");
        db.exec("ALTER TABLE staff ADD COLUMN resident_tax_municipality TEXT");
        db.exec("ALTER TABLE staff ADD COLUMN commute_type TEXT DEFAULT 'monthly'");
        db.exec("ALTER TABLE staff ADD COLUMN commute_amount INTEGER DEFAULT 20000");
        db.exec("PRAGMA user_version = 6");
        const applied = await prepareCompanyFile(wrap(db), DB_SCHEMAS);
        expect(applied).toHaveLength(7);
        expect(applied[0]).toStartWith("v7:");
        expect(db.query("SELECT commute_type AS t, commute_amount AS a, commute_setting AS s FROM staff").get())
            .toEqual({ t: "monthly", a: 20000, s: null });
        expect(header(db)).toEqual({ id: Q_FILE_ID, version: LATEST_DB_VERSION });
    });
    test("v8: v7 の会社ファイルの給与規定グループに欠勤控除のしかた（初めは計算期間の所定労働日数）、確定した給与に欠勤控除の額と所定労働日数の列を足す", async () => {
        const db = v1File();
        db.exec("ALTER TABLE staff ADD COLUMN resident_tax_schedule TEXT");
        db.exec("ALTER TABLE staff ADD COLUMN resident_tax_municipality TEXT");
        db.exec("ALTER TABLE staff ADD COLUMN commute_setting TEXT");
        db.exec("CREATE TABLE payroll_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, closing_day INTEGER NOT NULL, is_next_month INTEGER NOT NULL, payment_day INTEGER NOT NULL)");
        db.exec("INSERT INTO payroll_groups (name, closing_day, is_next_month, payment_day) VALUES ('基本', 99, 0, 25)");
        db.exec("CREATE TABLE salary_results (id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id TEXT NOT NULL, target_year INTEGER NOT NULL, target_month INTEGER NOT NULL, total_earnings INTEGER DEFAULT 0)");
        db.exec("INSERT INTO salary_results (staff_id, target_year, target_month, total_earnings) VALUES ('S001', 2026, 10, 300000)");
        db.exec("PRAGMA user_version = 7");
        const applied = await prepareCompanyFile(wrap(db), DB_SCHEMAS);
        expect(applied).toHaveLength(6);
        expect(applied[0]).toStartWith("v8:");
        expect(db.query("SELECT absence_deduction_method AS m FROM payroll_groups").get()).toEqual({ m: "workdays" });
        // 前に確定した給与は、欠勤控除の額・所定労働日数がわからない（NULL）
        expect(db.query("SELECT total_earnings AS t, absence_deduction AS a, prescribed_work_days AS p FROM salary_results").get())
            .toEqual({ t: 300000, a: null, p: null });
        expect(header(db)).toEqual({ id: Q_FILE_ID, version: LATEST_DB_VERSION });
    });
    test("v9: v8 の会社ファイルに、決まった休憩（給与規定グループ：初めは使わない、従業員：初めは使う）と、勤怠の「休憩なし」・引いた決まった休憩の列を足す", async () => {
        const db = v1File();
        db.exec("ALTER TABLE staff ADD COLUMN resident_tax_schedule TEXT");
        db.exec("ALTER TABLE staff ADD COLUMN resident_tax_municipality TEXT");
        db.exec("ALTER TABLE staff ADD COLUMN commute_setting TEXT");
        db.exec("CREATE TABLE payroll_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, closing_day INTEGER NOT NULL, is_next_month INTEGER NOT NULL, payment_day INTEGER NOT NULL, absence_deduction_method TEXT DEFAULT 'workdays')");
        db.exec("INSERT INTO payroll_groups (name, closing_day, is_next_month, payment_day) VALUES ('基本', 99, 0, 25)");
        db.exec("CREATE TABLE attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id TEXT NOT NULL, work_date TEXT NOT NULL, entry_time TEXT, exit_time TEXT, work_hours REAL DEFAULT 0, is_finalized INTEGER DEFAULT 0, UNIQUE(staff_id, work_date))");
        db.exec("INSERT INTO attendance (staff_id, work_date, entry_time, exit_time, work_hours, is_finalized) VALUES ('S001', '2026-11-02', '09:00', '18:00', 9, 1)");
        db.exec("PRAGMA user_version = 8");
        const applied = await prepareCompanyFile(wrap(db), DB_SCHEMAS);
        expect(applied).toHaveLength(5);
        expect(applied[0]).toStartWith("v9:");
        expect(db.query("SELECT fixed_break AS f FROM payroll_groups").get()).toEqual({ f: null });
        expect(db.query("SELECT fixed_break_apply AS a FROM staff").get()).toEqual({ a: 1 });
        // 前に確定した勤怠はそのまま（決まった休憩は引いていない）
        expect(db.query("SELECT work_hours AS h, break_none AS n, auto_break AS b FROM attendance").get()).toEqual({ h: 9, n: 0, b: null });
        expect(header(db)).toEqual({ id: Q_FILE_ID, version: LATEST_DB_VERSION });
    });
    test("v10: 勤怠の休憩1組・外出1組を休憩の一覧に移し（手入力があれば手入力の一覧）、前の列を消す。時間有給を入れていた会社は時間単位の有給を使う", async () => {
        const db = v1File();
        db.exec("CREATE TABLE payroll_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, closing_day INTEGER NOT NULL, is_next_month INTEGER NOT NULL, payment_day INTEGER NOT NULL)");
        db.exec("INSERT INTO payroll_groups (name, closing_day, is_next_month, payment_day) VALUES ('基本', 99, 0, 25)");
        db.exec("CREATE TABLE company (id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT NOT NULL)");
        db.exec("INSERT INTO company (id, name) VALUES (1, '確かめ株式会社')");
        db.exec(`CREATE TABLE attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id TEXT NOT NULL, work_date TEXT NOT NULL,
            entry_time TEXT, exit_time TEXT, break_start TEXT, break_end TEXT, out_time TEXT, return_time TEXT,
            csv_entry_time TEXT, csv_exit_time TEXT, csv_break_start TEXT, csv_break_end TEXT, csv_out_time TEXT, csv_return_time TEXT,
            paid_leave_hours REAL DEFAULT 0, work_hours REAL DEFAULT 0, UNIQUE(staff_id, work_date))`);
        const add = db.prepare(`INSERT INTO attendance (staff_id, work_date, break_start, break_end, out_time, return_time,
            csv_break_start, csv_break_end, csv_out_time, csv_return_time, paid_leave_hours) VALUES ('S001', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        add.run("2026-11-02", "", "", "", "", "12:00", "13:00", "15:00", "15:10", 0); // 打刻だけ
        add.run("2026-11-03", "12:30", "", ":", "", "12:00", "13:00", "", "", 0); // 休憩始だけ手で直した（休憩終は打刻）
        add.run("2026-11-04", "", "", "16:00", "17:00", "", "", "", "", 2); // 手入力の外出（中抜け）。時間有給 2時間
        add.run("2026-11-05", "", "", "", "", "", "", "", "", 0);
        db.exec("PRAGMA user_version = 9");
        const applied = await prepareCompanyFile(wrap(db), DB_SCHEMAS);
        expect(applied.map((a) => a.slice(0, 4))).toEqual(["v10:", "v11:", "v12:", "v13:"]);
        const rows = db.query("SELECT work_date AS d, breaks AS m, csv_breaks AS c FROM attendance ORDER BY work_date").all();
        expect(rows).toEqual([
            { d: "2026-11-02", m: null, c: JSON.stringify([{ start: "12:00", end: "13:00" }, { start: "15:00", end: "15:10" }]) },
            { d: "2026-11-03", m: JSON.stringify([{ start: "12:30", end: "13:00" }]), c: JSON.stringify([{ start: "12:00", end: "13:00" }]) },
            { d: "2026-11-04", m: JSON.stringify([{ start: "16:00", end: "17:00" }]), c: null },
            { d: "2026-11-05", m: null, c: null },
        ]);
        expect(columns(db, "attendance")).not.toContain("break_start");
        expect(columns(db, "attendance")).not.toContain("csv_return_time");
        expect(db.query("SELECT hourly_leave AS h FROM company").get()).toEqual({ h: 1 });
        expect(db.query("SELECT tardy_deduction_method AS m FROM payroll_groups").get()).toEqual({ m: "none" });
        expect(header(db)).toEqual({ id: Q_FILE_ID, version: 13 });
    });
    test("v11: 勤怠に特別休暇の種類と有給かの列を足す。有給の付与のうち夏季休暇などの名前の付与は、その名前の休暇の種類の付与に移す", async () => {
        const db = v1File();
        db.exec(`CREATE TABLE paid_leave_grants (id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id TEXT NOT NULL, name TEXT DEFAULT '法定有給',
            grant_date TEXT NOT NULL, expiry_date TEXT NOT NULL, days_granted REAL NOT NULL, days_used REAL DEFAULT 0)`);
        const add = db.prepare("INSERT INTO paid_leave_grants (staff_id, name, grant_date, expiry_date, days_granted) VALUES ('S001', ?, ?, ?, ?)");
        add.run("法定有給", "2026-04-01", "2028-03-31", 10);
        add.run("夏季休暇", "2026-07-01", "2026-09-30", 3);
        add.run(" 夏季休暇 ", "2025-07-01", "2025-09-30", 3);
        add.run("", "2025-04-01", "2027-03-31", 10);
        add.run("リフレッシュ休暇", "2026-04-01", "2027-03-31", 5);
        db.exec(`CREATE TABLE attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id TEXT NOT NULL, work_date TEXT NOT NULL,
            work_type TEXT DEFAULT '', UNIQUE(staff_id, work_date))`);
        // 前の、従業員の削除を止める TRIGGER（特別休暇の付与を見ない）
        db.exec("CREATE TRIGGER keep_staff_with_records BEFORE DELETE ON staff BEGIN SELECT RAISE(ABORT, 'old'); END;");
        db.exec("PRAGMA user_version = 10");
        const applied = await prepareCompanyFile(wrap(db), DB_SCHEMAS);
        expect(applied.map((a) => a.slice(0, 4))).toEqual(["v11:", "v12:", "v13:"]);
        expect(columns(db, "attendance")).toContain("leave_type_id");
        expect(columns(db, "attendance")).toContain("leave_paid");
        expect(columns(db, "salary_results")).toContain("unpaid_leave_deduction");
        // 年次有給休暇の付与（名前が「法定有給」か空）は、そのまま残す
        expect(db.query("SELECT name, grant_date FROM paid_leave_grants ORDER BY grant_date").all()).toEqual([
            { name: "", grant_date: "2025-04-01" },
            { name: "法定有給", grant_date: "2026-04-01" },
        ]);
        expect(db.query("SELECT id, name, is_paid, track_balance, allow_half, grant_rule, expiry_rule FROM leave_types ORDER BY id").all()).toEqual([
            { id: 1, name: "夏季休暇", is_paid: 1, track_balance: 1, allow_half: 0, grant_rule: null, expiry_rule: '{"mode":"months","months":12}' },
            { id: 2, name: "リフレッシュ休暇", is_paid: 1, track_balance: 1, allow_half: 0, grant_rule: null, expiry_rule: '{"mode":"months","months":12}' },
        ]);
        expect(db.query("SELECT staff_id, leave_type_id, grant_date, expiry_date, days_granted FROM special_leave_grants ORDER BY grant_date").all()).toEqual([
            { staff_id: "S001", leave_type_id: 1, grant_date: "2025-07-01", expiry_date: "2025-09-30", days_granted: 3 },
            { staff_id: "S001", leave_type_id: 2, grant_date: "2026-04-01", expiry_date: "2027-03-31", days_granted: 5 },
            { staff_id: "S001", leave_type_id: 1, grant_date: "2026-07-01", expiry_date: "2026-09-30", days_granted: 3 },
        ]);
        // 従業員の削除を止める TRIGGER は、特別休暇の付与も見る新しいものだけにする
        expect(db.query("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all()).toEqual([{ name: "keep_staff_with_records_v2" }]);
        expect(() => db.prepare("DELETE FROM staff WHERE id = ?").run("S001")).toThrow("削除できません");
        expect(header(db)).toEqual({ id: Q_FILE_ID, version: 13 });
    });
    test("v12: 休暇の種類に時間単位でも取れるか（初めは取れない）、勤怠に時間単位の特別休暇の時間（初めは0）の列を足す", async () => {
        const db = v1File();
        db.exec("CREATE TABLE leave_types (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, allow_half INTEGER DEFAULT 0)");
        db.exec("INSERT INTO leave_types (name) VALUES ('夏季休暇')");
        db.exec(`CREATE TABLE attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id TEXT NOT NULL, work_date TEXT NOT NULL,
            work_type TEXT DEFAULT '', leave_type_id INTEGER, leave_paid INTEGER, UNIQUE(staff_id, work_date))`);
        db.exec("INSERT INTO attendance (staff_id, work_date) VALUES ('S001', '2026-11-02')");
        db.exec("PRAGMA user_version = 11");
        const applied = await prepareCompanyFile(wrap(db), DB_SCHEMAS);
        expect(applied.map((a) => a.slice(0, 4))).toEqual(["v12:", "v13:"]);
        expect(db.query("SELECT name, allow_hourly AS h FROM leave_types").get()).toEqual({ name: "夏季休暇", h: 0 });
        expect(db.query("SELECT special_leave_hours AS h FROM attendance").get()).toEqual({ h: 0 });
        expect(header(db)).toEqual({ id: Q_FILE_ID, version: 13 });
    });
    test("v13: 会社に、半日単位の有給（半休）を使うかの列を足す（初めは使う。いままでどおり半休を入れられる）", async () => {
        const db = v1File();
        db.exec("CREATE TABLE company (id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT NOT NULL, hourly_leave INTEGER DEFAULT 0)");
        db.exec("INSERT INTO company (id, name) VALUES (1, '確かめ株式会社')");
        db.exec("PRAGMA user_version = 12");
        const applied = await prepareCompanyFile(wrap(db), DB_SCHEMAS);
        expect(applied.map((a) => a.slice(0, 4))).toEqual(["v13:"]);
        expect(db.query("SELECT half_day_leave AS h FROM company").get()).toEqual({ h: 1 });
        expect(header(db)).toEqual({ id: Q_FILE_ID, version: 13 });
    });
});

describe("開けないファイル（壊さないように触らない）", () => {
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
