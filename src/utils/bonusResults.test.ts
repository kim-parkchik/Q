/**
 * 賞与の追加・確定・確定の取り消しを、1つのトランザクションでまとめて行う文のテスト
 * アプリでは Rust の execute_batch（src-tauri/src/lib.rs。そのテストも lib.rs にある）で実行する。
 * ここでは bun:sqlite で同じく1つのトランザクションにして実行する
 * 実行方法: bun test
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { DB_SCHEMAS } from "../types/dbSchema";
import { executeBatch, type SqlStatement } from "./dbBatch";
import { buildAddBonusSettingStatements, buildFinalizeBonusStatements, buildUnfinalizeBonusStatements, type BonusResultCalc } from "./bonusResults";

/** Rust の execute_batch と同じく、文をまとめて1つのトランザクションで実行する（1つでも失敗したら全部取り消す） */
const batchDb = (db: Database) => ({
    executeBatch: async (statements: SqlStatement[]) =>
        db.transaction(() => statements.map((s) => {
            const r = db.prepare(s.sql).run(...((s.values ?? []) as any[]));
            return { rowsAffected: r.changes, lastInsertId: Number(r.lastInsertRowid) };
        }))(),
});

const setup = () => {
    const db = new Database(":memory:");
    for (const s of DB_SCHEMAS) db.exec(s);
    db.exec("INSERT INTO staff (id, name, base_wage) VALUES ('S001', '山田', 300000), ('S002', '佐藤', 250000)");
    db.exec("INSERT INTO bonus_item_master (id, name, type, is_default_active) VALUES (1, '基本賞与', 'earning', 1), (2, '寸志', 'earning', 0), (3, '社内預金', 'deduction', 1)");
    // アプリと同じく外部キーを確かめる（従業員の拠点などの初めの行はないので、従業員を入れた後で有効にする）
    db.exec("PRAGMA foreign_keys = ON");
    return db;
};

const calc = (total: number): BonusResultCalc => ({
    totalEarnings: total, hyojunBonus: Math.floor(total / 1000) * 1000, healthInsurance: 10000, nursingInsurance: 0, childSupport: 200,
    welfarePension: 18300, empInsurance: 1000, incomeTax: 20000, flatTaxReduction: 0, customDeductions: 0, netPay: total - 49500, isNursing: false,
    ledger: {
        periodStart: null, periodEnd: null, workDays: 0, workHours: 0, overtimeHours: 0, holidayHours: 0, nightHours: 0,
        earnings: [{ name: "基本賞与", amount: total }], deductions: [], totalEarnings: total, totalDeductions: 49500, netPay: total - 49500, yearEndSettlement: 0,
    },
});

describe("賞与を追加する", () => {
    test("賞与設定と、初めから有効にする項目の紐付けを、まとめて保存する（足した賞与の id を返す）", async () => {
        const db = setup();
        db.exec("INSERT INTO bonus_settings (name, target_year, target_month, payment_date) VALUES ('前の賞与', 2025, 12, '2025-12-10')");
        const results = await executeBatch(batchDb(db), buildAddBonusSettingStatements("夏季賞与", "2026-07-10"));
        const id = results[0].lastInsertId;
        expect(db.query("SELECT name, target_year, target_month FROM bonus_settings WHERE id = ?").get(id))
            .toEqual({ name: "夏季賞与", target_year: 2026, target_month: 7 });
        expect(db.query("SELECT item_id FROM bonus_setting_items WHERE bonus_setting_id = ? ORDER BY item_id").all(id))
            .toEqual([{ item_id: 1 }, { item_id: 3 }]);
    });
});

describe("賞与を確定する・確定を取り消す", () => {
    test("確定すると1人ずつ保存して確定済みにし、確定し直すと前の結果を置き換える", async () => {
        const db = setup();
        const id = (await executeBatch(batchDb(db), buildAddBonusSettingStatements("夏季賞与", "2026-07-10")))[0].lastInsertId;
        await executeBatch(batchDb(db), buildFinalizeBonusStatements(id, [
            { staff: { id: "S001" }, calc: calc(500000) }, { staff: { id: "S002" }, calc: calc(300000) },
        ]));
        expect(db.query("SELECT staff_id, total_earnings FROM bonus_results ORDER BY staff_id").all())
            .toEqual([{ staff_id: "S001", total_earnings: 500000 }, { staff_id: "S002", total_earnings: 300000 }]);
        expect(db.query("SELECT is_closed FROM bonus_settings WHERE id = ?").get(id)).toEqual({ is_closed: 1 });
        // 佐藤さんの賞与をなくして確定し直す
        await executeBatch(batchDb(db), buildFinalizeBonusStatements(id, [{ staff: { id: "S001" }, calc: calc(520000) }]));
        expect(db.query("SELECT staff_id, total_earnings FROM bonus_results").all()).toEqual([{ staff_id: "S001", total_earnings: 520000 }]);
    });
    test("令和6年分の定額減税で引いた額も残す（所得税は引いた後の額）", async () => {
        const db = setup();
        const id = (await executeBatch(batchDb(db), buildAddBonusSettingStatements("夏季賞与", "2024-07-10")))[0].lastInsertId;
        await executeBatch(batchDb(db), buildFinalizeBonusStatements(id, [{ staff: { id: "S001" }, calc: { ...calc(500000), incomeTax: 0, flatTaxReduction: 20000 } }]));
        expect(db.query("SELECT income_tax AS t, flat_tax_reduction AS r FROM bonus_results").get()).toEqual({ t: 0, r: 20000 });
    });
    test("途中で失敗したら、前の確定結果のまま残る（前の結果を消したところで止まらない）", async () => {
        const db = setup();
        const id = (await executeBatch(batchDb(db), buildAddBonusSettingStatements("夏季賞与", "2026-07-10")))[0].lastInsertId;
        await executeBatch(batchDb(db), buildFinalizeBonusStatements(id, [{ staff: { id: "S001" }, calc: calc(500000) }]));
        // いない従業員（S999）の行で失敗させる（bonus_results の staff_id は staff を参照する）
        await expect(executeBatch(batchDb(db), buildFinalizeBonusStatements(id, [
            { staff: { id: "S002" }, calc: calc(300000) }, { staff: { id: "S999" }, calc: calc(100000) },
        ]))).rejects.toThrow();
        expect(db.query("SELECT staff_id, total_earnings FROM bonus_results").all()).toEqual([{ staff_id: "S001", total_earnings: 500000 }]);
        expect(db.query("SELECT is_closed FROM bonus_settings WHERE id = ?").get(id)).toEqual({ is_closed: 1 });
    });
    test("確定を取り消すと、確定結果を消して計算中に戻す（入れた金額は残す）", async () => {
        const db = setup();
        const id = (await executeBatch(batchDb(db), buildAddBonusSettingStatements("夏季賞与", "2026-07-10")))[0].lastInsertId;
        db.prepare("INSERT INTO bonus_staff_values (bonus_setting_id, staff_id, item_id, amount) VALUES (?, 'S001', 1, 500000)").run(id);
        await executeBatch(batchDb(db), buildFinalizeBonusStatements(id, [{ staff: { id: "S001" }, calc: calc(500000) }]));
        await executeBatch(batchDb(db), buildUnfinalizeBonusStatements(id));
        expect(db.query("SELECT COUNT(*) AS n FROM bonus_results").get()).toEqual({ n: 0 });
        expect(db.query("SELECT is_closed FROM bonus_settings WHERE id = ?").get(id)).toEqual({ is_closed: 0 });
        expect(db.query("SELECT amount FROM bonus_staff_values").get()).toEqual({ amount: 500000 });
    });
});

describe("まとめて実行する（utils/dbBatch.ts）", () => {
    test("文がなければ何もしない", async () => {
        expect(await executeBatch({}, [])).toEqual([]);
    });
    test("会社ファイルが開かれていなければ、エラーにする", async () => {
        await expect(executeBatch({}, [{ sql: "SELECT 1" }])).rejects.toThrow("会社ファイルが開かれていません");
    });
});
