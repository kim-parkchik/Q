/**
 * マイナンバー（my_numbers の表）を読み書きする小さな道具と、扱える人かどうかの確かめ
 * 番号の確かめ方・扱いのきまりは utils/myNumber.ts
 */
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { writeLog } from "../../utils/logUtils";
import { decryptNumber, type OpenKeys } from "../../utils/myNumberCrypto";

/** 画面に渡すログインしている人（users の1行） */
export interface MyNumberUser {
  id: number;
  login_id: string;
  display_name: string;
}

/** 事務取扱担当者の印があるか（画面を開くたびに表から確かめる。印を付け外ししたらすぐ効くように） */
export const hasMyNumberAccess = async (db: Database, user: MyNumberUser | null | undefined): Promise<boolean> => {
  if (!user?.id) return false;
  const rows = await db.select<any[]>("SELECT my_number_access FROM users WHERE id = ? AND status = 'active'", [user.id]);
  return Number(rows?.[0]?.my_number_access) === 1;
};

/** 登録した番号（従業員ID → 印（self・family:…）→ 番号）。開けた鍵で暗号を解く（鍵の開け閉めは myNumberVault.ts） */
export const loadMyNumbers = async (db: Database, keys: OpenKeys, staffIds?: string[]): Promise<Record<string, Record<string, string>>> => {
  const rows = await db.select<any[]>("SELECT staff_id, person, number FROM my_numbers");
  const ids = staffIds ? new Set(staffIds) : null;
  const out: Record<string, Record<string, string>> = {};
  for (const r of rows) {
    const id = String(r.staff_id);
    if (ids && !ids.has(id)) continue;
    const person = String(r.person);
    (out[id] ??= {})[person] = await decryptNumber(keys, String(r.number), id, person);
  }
  return out;
};

/** 登録した番号の件数（暗号を解かずに数える） */
export const countMyNumbers = async (db: Database): Promise<number> => {
  const rows = await db.select<any[]>("SELECT COUNT(*) AS n FROM my_numbers");
  return Number(rows?.[0]?.n ?? 0);
};

/** 取扱いの記録（番号は書かない。ガイドライン（別添1）組織的安全管理措置 c） */
export const logMyNumber = (db: Database, user: MyNumberUser | null | undefined, message: string) =>
  writeLog(db, "INFO", "mynumber", message, user ? `${user.display_name}（${user.login_id}）` : undefined);
