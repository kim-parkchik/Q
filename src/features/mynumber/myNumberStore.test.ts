/**
 * マイナンバーの表（my_numbers）と、扱える人の確かめ（myNumberStore.ts）のテスト
 * 実行方法: bun test
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { DB_SCHEMAS } from "../../types/dbSchema";
import { familyKey, SELF_KEY } from "../../utils/myNumber";
import { createKeys, encryptNumber, type DeriveKey } from "../../utils/myNumberCrypto";
import { countExpiredMyNumbers, countMyNumbers, hasMyNumberAccess, loadLastPayYears, loadMyNumbers, logMyNumber } from "./myNumberStore";

/** テストでは Argon2id（Rust）の代わりに、軽い PBKDF2 で鍵を作る */
const testDerive: DeriveKey = async (password, salt) => {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 1000 }, base, 256));
};

/** bun:sqlite を、アプリの Database と同じ使い方（Promise を返す）に合わせる */
const wrap = (db: Database) => ({
  execute: async (sql: string, params: unknown[] = []) => db.prepare(sql).run(...(params as any[])),
  select: async <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as any[])) as T,
});

const open = () => {
  const db = new Database(":memory:");
  for (const s of DB_SCHEMAS) db.exec(s);
  db.exec("INSERT INTO users (id, login_id, display_name, password_hash, role, my_number_access) VALUES (1, 'admin', '管理者', 'x', 'admin', 1), (2, 'staff', '一般', 'x', 'staff', 0)");
  // 拠点・グループの行は作らないので、従業員を入れてから外部キーを効かせる（消したときの連鎖を確かめるため）
  db.exec("INSERT INTO staff (id, name, base_wage) VALUES ('1001', '国税 太郎', 300000), ('1002', '国税 次郎', 280000)");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
};
const admin = { id: 1, login_id: "admin", display_name: "管理者" };
const staffUser = { id: 2, login_id: "staff", display_name: "一般" };

describe("扱える人", () => {
  test("印がある人だけ（印は表から確かめる）", async () => {
    const db = open();
    expect(await hasMyNumberAccess(wrap(db), admin)).toBe(true);
    expect(await hasMyNumberAccess(wrap(db), staffUser)).toBe(false);
    expect(await hasMyNumberAccess(wrap(db), null)).toBe(false);
    db.exec("UPDATE users SET my_number_access = 0 WHERE id = 1");
    expect(await hasMyNumberAccess(wrap(db), admin)).toBe(false);
  });
});

describe("番号の表", () => {
  test("本人と家族を、従業員ごとに読む（暗号を解く）。従業員を消すと番号も消える", async () => {
    const db = open();
    const { keys } = await createKeys("テスト用の長いパスワードです", testDerive);
    const put = async (id: string, person: string, number: string, name: string | null = null, relation: string | null = null) =>
      db.prepare("INSERT INTO my_numbers (staff_id, person, name, relation, number) VALUES (?, ?, ?, ?, ?)")
        .run(id, person, name, relation, await encryptNumber(keys, number, id, person));
    const spouse = familyKey("国税 花子", "1972-01-01");
    await put("1001", SELF_KEY, "123456789018");
    await put("1001", spouse, "987654321093", "国税 花子", "配偶者");
    await put("1002", SELF_KEY, "000000000060");
    expect(await countMyNumbers(wrap(db))).toBe(3);
    expect(await loadMyNumbers(wrap(db), keys, ["1001"])).toEqual({ "1001": { [SELF_KEY]: "123456789018", [spouse]: "987654321093" } });
    expect(Object.keys(await loadMyNumbers(wrap(db), keys))).toEqual(["1001", "1002"]);
    // 同じ人に2つ目は入らない（直すときは ON CONFLICT で上書き）
    expect(() => db.prepare("INSERT INTO my_numbers (staff_id, person, number) VALUES (?, ?, ?)").run("1001", SELF_KEY, "x")).toThrow();
    db.exec("DELETE FROM staff WHERE id = '1001'");
    expect(await loadMyNumbers(wrap(db), keys)).toEqual({ "1002": { [SELF_KEY]: "000000000060" } });
  });
  test("ほかの人の行に写した番号・違う鍵では読めない", async () => {
    const db = open();
    const { keys } = await createKeys("テスト用の長いパスワードです", testDerive);
    const other = (await createKeys("テスト用の長いパスワードです", testDerive)).keys;
    db.prepare("INSERT INTO my_numbers (staff_id, person, number) VALUES (?, ?, ?)").run("1002", SELF_KEY, await encryptNumber(keys, "123456789018", "1001", SELF_KEY));
    await expect(loadMyNumbers(wrap(db), keys)).rejects.toThrow("戻せませんでした");
    db.exec("DELETE FROM my_numbers");
    db.prepare("INSERT INTO my_numbers (staff_id, person, number) VALUES (?, ?, ?)").run("1001", SELF_KEY, await encryptNumber(keys, "123456789018", "1001", SELF_KEY));
    await expect(loadMyNumbers(wrap(db), other)).rejects.toThrow("戻せませんでした");
  });
  test("記録には、した人と内容だけを残す（番号は書かない）", async () => {
    const db = open();
    await logMyNumber(wrap(db) as any, admin, "マイナンバーを登録しました：国税 太郎（本人）");
    expect(db.query("SELECT category, message, user_name FROM app_logs").all()).toEqual([
      { category: "mynumber", message: "マイナンバーを登録しました：国税 太郎（本人）", user_name: "管理者（admin）" },
    ]);
  });
});

describe("保存期間が過ぎた番号の数（メニューの知らせ。決まりは utils/myNumberRetention.ts）", () => {
  test("最後に給与か賞与を払った年（賞与は支給日の年、支給日がなければ支給年）", async () => {
    const db = open();
    db.exec("INSERT INTO salary_results (staff_id, target_year, target_month, net_pay) VALUES ('1001', 2017, 12, 1), ('1001', 2018, 1, 1), ('1002', 2025, 3, 1)");
    db.exec("INSERT INTO bonus_settings (id, name, target_year, target_month, payment_date) VALUES (1, '冬季賞与', 2025, 12, '2026-01-09'), (2, '夏季賞与', 2025, 7, '')");
    db.exec("INSERT INTO bonus_results (bonus_setting_id, staff_id, net_pay) VALUES (1, '1002', 1), (2, '1001', 1)");
    expect(await loadLastPayYears(wrap(db))).toEqual({ "1001": 2025, "1002": 2026 });
  });
  test("事務取扱担当者だけに数える（番号は読まない）。退職した人の番号は、最後の申告書の保存期間が過ぎたら数える", async () => {
    const db = open();
    const { keys } = await createKeys("テスト用の長いパスワードです", testDerive);
    db.exec("UPDATE staff SET status = 'retired', retirement_date = '2017-09-30' WHERE id = '1001'");
    db.exec("INSERT INTO salary_results (staff_id, target_year, target_month, net_pay) VALUES ('1001', 2017, 9, 1)");
    for (const [id, person] of [["1001", SELF_KEY], ["1001", familyKey("国税 花子", "1990-01-01")], ["1002", SELF_KEY]]) {
      db.prepare("INSERT INTO my_numbers (staff_id, person, number) VALUES (?, ?, ?)").run(id, person, await encryptNumber(keys, "123456789018", id, person));
    }
    const staffList = db.query("SELECT * FROM staff").all() as any[];
    // 2017年分の申告書の保存期間は2025年1月10日まで：本人と、申告書に見当たらない家族（本人と同じ日）の2件
    expect(await countExpiredMyNumbers(wrap(db), admin, staffList, "2026-11-14")).toBe(2);
    expect(await countExpiredMyNumbers(wrap(db), admin, staffList, "2025-01-10")).toBe(0);
    expect(await countExpiredMyNumbers(wrap(db), staffUser, staffList, "2026-11-14")).toBeNull();
  });
});
