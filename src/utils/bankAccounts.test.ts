/**
 * 振込元の口座・振込先の口座を、会社ファイルに保存する・読む（bankAccounts.ts）のテスト
 * 実行方法: bun test
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { DB_SCHEMAS } from "../types/dbSchema";
import { executeBatch, type SqlStatement } from "./dbBatch";
import {
  emptyStaffAccountForm, fromStaffAccountForm, loadSourceAccounts, loadStaffBankAccounts, sourceAccountValues, staffBankAccountStatements, toStaffAccountForm,
} from "./bankAccounts";
import type { StaffAccount } from "./zengin";

const open = () => {
  const db = new Database(":memory:");
  for (const s of DB_SCHEMAS) db.exec(s);
  db.exec("INSERT INTO staff (id, name, base_wage) VALUES ('S001', '山田', 300000), ('S002', '佐藤', 250000)");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
};
const batchDb = (db: Database) => ({
  executeBatch: async (statements: SqlStatement[]) =>
    db.transaction(() => statements.map((s) => {
      const r = db.prepare(s.sql).run(...((s.values ?? []) as any[]));
      return { rowsAffected: r.changes, lastInsertId: Number(r.lastInsertRowid) };
    }))(),
});
const select = (db: Database) => ({ select: async <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as any[])) as T });

const account = (o: Partial<StaffAccount> = {}): StaffAccount => ({
  bankCode: "0009", bankName: "ミツイスミトモ", branchCode: "123", branchName: "しぶや",
  accountType: "ordinary", accountNumber: "1234", holderName: "ヤマダ　タロウ", fixedAmount: null, ...o,
});

describe("振込先の口座", () => {
  test("名前は半角カナにして保存し、並び順に読む。保存し直すと入れ替わる", async () => {
    const db = open();
    await executeBatch(batchDb(db), staffBankAccountStatements("S001", [account({ bankCode: "9900", fixedAmount: 50000 }), account()]));
    const map = await loadStaffBankAccounts(select(db));
    expect(map.get("S001")).toEqual([
      { ...account({ bankCode: "9900", fixedAmount: 50000 }), bankName: "ﾐﾂｲｽﾐﾄﾓ", branchName: "ｼﾌﾞﾔ", holderName: "ﾔﾏﾀﾞ ﾀﾛｳ" },
      { ...account(), bankName: "ﾐﾂｲｽﾐﾄﾓ", branchName: "ｼﾌﾞﾔ", holderName: "ﾔﾏﾀﾞ ﾀﾛｳ" },
    ]);
    await executeBatch(batchDb(db), staffBankAccountStatements("S001", [account({ accountNumber: "7654321" })]));
    expect((await loadStaffBankAccounts(select(db), "S001")).get("S001")?.map((a) => a.accountNumber)).toEqual(["7654321"]);
    // 口座をなくす（現金で払う）
    await executeBatch(batchDb(db), staffBankAccountStatements("S001", []));
    expect((await loadStaffBankAccounts(select(db), "S001")).get("S001")).toBeUndefined();
  });
  test("従業員を消すと、口座も一緒に消える（口座は記録ではないので、消すのを止めない）", async () => {
    const db = open();
    await executeBatch(batchDb(db), staffBankAccountStatements("S002", [account()]));
    db.prepare("DELETE FROM staff WHERE id = ?").run("S002");
    expect(db.query("SELECT COUNT(*) AS n FROM staff_bank_accounts").get()).toEqual({ n: 0 });
  });
  test("画面の入れ方と行き来する（固定額は数、残りの口座は null）", () => {
    const form = { ...emptyStaffAccountForm("ﾔﾏﾀﾞ ﾀﾛｳ", false), bankCode: "0005", branchCode: "001", accountNumber: "123", fixedAmount: "30000" };
    expect(fromStaffAccountForm(form)).toMatchObject({ bankCode: "0005", fixedAmount: 30000 });
    expect(toStaffAccountForm(fromStaffAccountForm({ ...form, rest: true }))).toMatchObject({ rest: true, fixedAmount: "" });
  });
});

describe("振込元の口座", () => {
  test("名前を半角カナにして保存し、並び順に読む", async () => {
    const db = open();
    const values = sourceAccountValues({
      label: "給与用", clientCode: "1234567890", clientName: "かぶしきがいしゃやまだ", bankCode: "0005", bankName: "ミツビシユーエフジェイ",
      branchCode: "001", branchName: "ホンテン", accountType: "current", accountNumber: "7654321",
    });
    db.prepare(`INSERT INTO transfer_source_accounts (label, client_code, client_name, bank_code, bank_name, branch_code, branch_name, account_type, account_number)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...(values as any[]));
    expect(await loadSourceAccounts(select(db))).toEqual([{
      id: 1, label: "給与用", active: true, clientCode: "1234567890", clientName: "ｶﾌﾞｼｷｶﾞｲｼﾔﾔﾏﾀﾞ", bankCode: "0005", bankName: "ﾐﾂﾋﾞｼﾕ-ｴﾌｼﾞｴｲ",
      branchCode: "001", branchName: "ﾎﾝﾃﾝ", accountType: "current", accountNumber: "7654321",
    }]);
  });
});
