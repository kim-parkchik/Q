/**
 * 会社ファイルの表の定義（DB_SCHEMAS）のテスト
 * 実行方法: bun test
 *
 * アプリと同じく外部キーを有効にした SQLite（メモリ上）に表を作って確認する。
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { DB_SCHEMAS, STAFF_RECORD_TABLES } from "./dbSchema";

const openCompanyFile = () => {
    const db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    for (const schema of DB_SCHEMAS) db.exec(schema);
    // アプリが会社ファイルを開いたときに入れる初期データ（従業員の外部キーの参照先）
    db.exec("INSERT INTO calendar_patterns (id, name) VALUES (1, '標準')");
    db.exec("INSERT INTO payroll_groups (id, name, closing_day, is_next_month, payment_day) VALUES (1, '全社共通規定', 99, 0, 25)");
    db.exec("INSERT INTO social_insurance_groups (id, name) VALUES (1, '協会けんぽ')");
    db.exec("INSERT INTO bonus_settings (id, name, target_year, target_month) VALUES (1, '夏季賞与', 2026, 7)");
    db.exec("INSERT INTO bonus_item_master (id, name, type) VALUES (1, '基本賞与', 'earning')");
    return db;
};

const addStaff = (db: Database, id: string) =>
    db.prepare("INSERT INTO staff (id, name, base_wage) VALUES (?, ?, 1200)").run(id, `従業員${id}`);

/** 記録の表ごとに、1件入れる SQL */
const ADD_RECORD: Record<string, string> = {
    attendance: "INSERT INTO attendance (staff_id, work_date) VALUES (?, '2026-06-01')",
    salary_results: "INSERT INTO salary_results (staff_id, target_year, target_month) VALUES (?, 2026, 6)",
    bonus_staff_values: "INSERT INTO bonus_staff_values (bonus_setting_id, staff_id, item_id, amount) VALUES (1, ?, 1, 300000)",
    bonus_results: "INSERT INTO bonus_results (bonus_setting_id, staff_id) VALUES (1, ?)",
    paid_leave_grants: "INSERT INTO paid_leave_grants (staff_id, grant_date, expiry_date, days_granted) VALUES (?, '2026-04-01', '2028-03-31', 10)",
    paid_leave_usage: "INSERT INTO paid_leave_usage (staff_id, usage_date, days_used) VALUES (?, '2026-06-01', 1)",
};

describe("記録がある従業員は削除できない（記録が一緒に消えないように）", () => {
    for (const { table, label } of STAFF_RECORD_TABLES) {
        test(`${label}（${table}）があると削除が止まり、記録も残る`, () => {
            const db = openCompanyFile();
            addStaff(db, "S001");
            db.prepare(ADD_RECORD[table]).run("S001");

            expect(() => db.prepare("DELETE FROM staff WHERE id = ?").run("S001")).toThrow("削除できません");
            expect(db.query("SELECT COUNT(*) AS n FROM staff").get()).toEqual({ n: 1 });
            expect(db.query(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 1 });
        });
    }

    test("記録が何もない従業員（登録の間違いなど）は削除できる", () => {
        const db = openCompanyFile();
        addStaff(db, "S001");
        addStaff(db, "S002");
        db.prepare(ADD_RECORD.attendance).run("S002"); // 別の人の記録は関係ない

        db.prepare("DELETE FROM staff WHERE id = ?").run("S001");
        expect(db.query("SELECT id FROM staff").all()).toEqual([{ id: "S002" }]);
    });

    test("会社ファイルを開き直しても（表の作成をもう一度流しても）エラーにならない", () => {
        const db = openCompanyFile();
        expect(() => { for (const schema of DB_SCHEMAS) db.exec(schema); }).not.toThrow();
    });
});
