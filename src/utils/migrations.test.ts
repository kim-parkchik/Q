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
    test("v1 から始めて、今の最新は v3", () => {
        expect(BASE_DB_VERSION).toBe(1);
        expect(LATEST_DB_VERSION).toBe(4);
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
        expect(applied).toHaveLength(3);
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
        expect(applied).toHaveLength(2);
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
        expect(applied).toHaveLength(1);
        expect(applied[0]).toStartWith("v4:");
        expect(db.query("SELECT my_number_access AS a FROM users").get()).toEqual({ a: 0 });
        // マイナンバーの表は、開くときに作られる
        expect(db.query("SELECT COUNT(*) AS n FROM my_numbers").get()).toEqual({ n: 0 });
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
