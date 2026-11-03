/**
 * マイナンバーの表（my_numbers）と、扱える人の確かめ（myNumberStore.ts）のテスト
 * 実行方法: bun test
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { DB_SCHEMAS } from "../../types/dbSchema";
import { familyKey, SELF_KEY } from "../../utils/myNumber";
import { hasMyNumberAccess, loadMyNumbers, logMyNumber } from "./myNumberStore";

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
  test("本人と家族を、従業員ごとに読む。従業員を消すと番号も消える", async () => {
    const db = open();
    const spouse = familyKey("国税 花子", "1972-01-01");
    db.prepare("INSERT INTO my_numbers (staff_id, person, number) VALUES (?, ?, ?)").run("1001", SELF_KEY, "123456789018");
    db.prepare("INSERT INTO my_numbers (staff_id, person, name, relation, number) VALUES (?, ?, ?, ?, ?)").run("1001", spouse, "国税 花子", "配偶者", "987654321093");
    db.prepare("INSERT INTO my_numbers (staff_id, person, number) VALUES (?, ?, ?)").run("1002", SELF_KEY, "000000000060");
    expect(await loadMyNumbers(wrap(db), ["1001"])).toEqual({ "1001": { [SELF_KEY]: "123456789018", [spouse]: "987654321093" } });
    expect(Object.keys(await loadMyNumbers(wrap(db)))).toEqual(["1001", "1002"]);
    // 同じ人に2つ目は入らない（直すときは ON CONFLICT で上書き）
    expect(() => db.prepare("INSERT INTO my_numbers (staff_id, person, number) VALUES (?, ?, ?)").run("1001", SELF_KEY, "000000000060")).toThrow();
    db.exec("DELETE FROM staff WHERE id = '1001'");
    expect(await loadMyNumbers(wrap(db))).toEqual({ "1002": { [SELF_KEY]: "000000000060" } });
  });
  test("記録には、した人と内容だけを残す（番号は書かない）", async () => {
    const db = open();
    await logMyNumber(wrap(db) as any, admin, "マイナンバーを登録しました：国税 太郎（本人）");
    expect(db.query("SELECT category, message, user_name FROM app_logs").all()).toEqual([
      { category: "mynumber", message: "マイナンバーを登録しました：国税 太郎（本人）", user_name: "管理者（admin）" },
    ]);
  });
});
