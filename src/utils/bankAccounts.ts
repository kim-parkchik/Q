/**
 * 振込元の口座（会社）と振込先の口座（従業員）を、会社ファイルから読む・保存する（振込データは utils/zengin.ts）
 * 一般的な給与ソフトと同じ形（マネーフォワード クラウド給与：支払口座は会社にいくつでも登録でき、従業員の振込先は
 * 「固定額1・固定額2・残額」で口座を分けられる）。Q の振込先は、従業員ごとに3つまで（固定額の口座2つと、残りの口座1つ）
 */
import type { SqlStatement } from "./dbBatch";
import { toAccountType, toZenginText, type AccountType, type SourceAccount, type StaffAccount } from "./zengin";

interface SelectDb {
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
}

/** 振込先の口座は、従業員ごとに3つまで */
export const MAX_STAFF_ACCOUNTS = 3;

export interface SourceAccountRow extends SourceAccount {
  id: number;
  label: string;
  active: boolean;
}

/** 振込元の口座（並び順。やめた口座も入れる） */
export const loadSourceAccounts = async (db: SelectDb): Promise<SourceAccountRow[]> => {
  const rows = (await db.select<any[]>("SELECT * FROM transfer_source_accounts ORDER BY sort_order, id")) ?? [];
  return rows.map((r) => ({
    id: Number(r.id), label: String(r.label ?? ""), active: Number(r.is_active ?? 1) !== 0,
    clientCode: String(r.client_code ?? ""), clientName: String(r.client_name ?? ""),
    bankCode: String(r.bank_code ?? ""), bankName: String(r.bank_name ?? ""), branchCode: String(r.branch_code ?? ""), branchName: String(r.branch_name ?? ""),
    accountType: toAccountType(r.account_type), accountNumber: String(r.account_number ?? ""),
  }));
};

const rowToStaffAccount = (r: any): StaffAccount => ({
  bankCode: String(r.bank_code ?? ""), bankName: String(r.bank_name ?? ""), branchCode: String(r.branch_code ?? ""), branchName: String(r.branch_name ?? ""),
  accountType: toAccountType(r.account_type), accountNumber: String(r.account_number ?? ""), holderName: String(r.holder_name ?? ""),
  fixedAmount: r.fixed_amount === null || r.fixed_amount === undefined ? null : Number(r.fixed_amount),
});

/** 振込先の口座を、従業員ごとに読む（並び順） */
export const loadStaffBankAccounts = async (db: SelectDb, staffId?: string | number): Promise<Map<string, StaffAccount[]>> => {
  const rows = (await (staffId === undefined
    ? db.select<any[]>("SELECT * FROM staff_bank_accounts ORDER BY staff_id, seq")
    : db.select<any[]>("SELECT * FROM staff_bank_accounts WHERE staff_id = ? ORDER BY seq", [String(staffId)]))) ?? [];
  const map = new Map<string, StaffAccount[]>();
  for (const r of rows) {
    const key = String(r.staff_id);
    map.set(key, [...(map.get(key) ?? []), rowToStaffAccount(r)]);
  }
  return map;
};

/** 名前を、振込データに書く半角の字にして保存する（画面で見えるとおりに書くため） */
const zenginName = (s: string) => toZenginText(s).text.trim();

/** 振込先の口座を保存する文（前の口座を消して入れ直す） */
export const staffBankAccountStatements = (staffId: string, accounts: StaffAccount[]): SqlStatement[] => [
  { sql: "DELETE FROM staff_bank_accounts WHERE staff_id = ?", values: [staffId] },
  ...accounts.slice(0, MAX_STAFF_ACCOUNTS).map((a, i): SqlStatement => ({
    sql: `INSERT INTO staff_bank_accounts (staff_id, seq, bank_code, bank_name, branch_code, branch_name, account_type, account_number, holder_name, fixed_amount)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    values: [
      staffId, i + 1, a.bankCode.trim(), zenginName(a.bankName), a.branchCode.trim(), zenginName(a.branchName), a.accountType,
      a.accountNumber.trim(), zenginName(a.holderName), a.fixedAmount === null ? null : Math.max(0, Math.floor(a.fixedAmount)),
    ],
  })),
];

/** 振込元の口座を保存する値（名前は半角にする） */
export const sourceAccountValues = (a: SourceAccount & { label: string }): unknown[] => [
  a.label.trim(), a.clientCode.trim(), zenginName(a.clientName), a.bankCode.trim(), zenginName(a.bankName),
  a.branchCode.trim(), zenginName(a.branchName), a.accountType, a.accountNumber.trim(),
];

/** 画面で入れる振込先の口座（数字は文字のまま持つ） */
export interface StaffAccountForm {
  bankCode: string;
  bankName: string;
  branchCode: string;
  branchName: string;
  accountType: AccountType;
  accountNumber: string;
  holderName: string;
  /** 残りを振り込む口座か（false なら fixedAmount の固定額） */
  rest: boolean;
  fixedAmount: string;
}

export const emptyStaffAccountForm = (holderName = "", rest = true): StaffAccountForm => ({
  bankCode: "", bankName: "", branchCode: "", branchName: "", accountType: "ordinary", accountNumber: "", holderName, rest, fixedAmount: "",
});

export const toStaffAccountForm = (a: StaffAccount): StaffAccountForm => ({
  bankCode: a.bankCode, bankName: a.bankName, branchCode: a.branchCode, branchName: a.branchName, accountType: a.accountType,
  accountNumber: a.accountNumber, holderName: a.holderName, rest: a.fixedAmount === null, fixedAmount: a.fixedAmount === null ? "" : String(a.fixedAmount),
});

export const fromStaffAccountForm = (f: StaffAccountForm): StaffAccount => ({
  bankCode: f.bankCode.trim(), bankName: f.bankName, branchCode: f.branchCode.trim(), branchName: f.branchName, accountType: f.accountType,
  accountNumber: f.accountNumber.trim(), holderName: f.holderName, fixedAmount: f.rest ? null : Math.max(0, Math.floor(Number(f.fixedAmount) || 0)),
});
