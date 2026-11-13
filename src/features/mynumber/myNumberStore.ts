/**
 * マイナンバー（my_numbers の表）を読み書きする小さな道具と、扱える人かどうかの確かめ
 * 番号の確かめ方・扱いのきまりは utils/myNumber.ts
 */
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { writeLog } from "../../utils/logUtils";
import { decryptNumber, type OpenKeys } from "../../utils/myNumberCrypto";
import { buildMyNumberList } from "../../utils/myNumber";
import { myNumberRetentions } from "../../utils/myNumberRetention";
import { parseDeclaration, type NenchoDeclaration } from "../../utils/nenchoDeclaration";

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

// ── 保存期間（utils/myNumberRetention.ts）に使う値 ─────────────────────────

/** 従業員IDごとの、最後に給与か賞与を払った年（給与は支給年、賞与は支給日の年（なければ支給年）） */
export const loadLastPayYears = async (db: Database): Promise<Record<string, number>> => {
  const salaries = await db.select<any[]>("SELECT staff_id, MAX(target_year) AS y FROM salary_results GROUP BY staff_id");
  const bonuses = await db.select<any[]>(
    `SELECT r.staff_id, MAX(COALESCE(NULLIF(CAST(substr(s.payment_date, 1, 4) AS INTEGER), 0), s.target_year)) AS y
     FROM bonus_results r JOIN bonus_settings s ON s.id = r.bonus_setting_id GROUP BY r.staff_id`,
  );
  const out: Record<string, number> = {};
  for (const r of [...(salaries ?? []), ...(bonuses ?? [])]) {
    const id = String(r.staff_id);
    const y = Number(r.y) || 0;
    if (y > (out[id] ?? 0)) out[id] = y;
  }
  return out;
};

/** 年末調整の申告書（家族の結び付けと、申告書を入れた年に使う） */
export const loadDeclarations = async (db: Database): Promise<{ staffId: string; year: number; declaration: NenchoDeclaration }[]> =>
  ((await db.select<any[]>("SELECT staff_id, year, declaration FROM year_end_adjustments")) ?? [])
    .map((x) => ({ staffId: String(x.staff_id), year: Number(x.year), declaration: parseDeclaration(x.declaration) }));

/** 登録してある番号の人（番号は読まない） */
export const loadRegisteredPeople = async (db: Database): Promise<{ staffId: string; person: string; name: string; relation: string }[]> =>
  ((await db.select<any[]>("SELECT staff_id, person, name, relation FROM my_numbers")) ?? [])
    .map((x) => ({ staffId: String(x.staff_id), person: String(x.person), name: String(x.name ?? ""), relation: String(x.relation ?? "") }));

/** 従業員IDごとの、年末調整の申告書を入れた年 */
export const declarationYearsOf = (declarations: { staffId: string; year: number }[]): Record<string, number[]> => {
  const out: Record<string, number[]> = {};
  for (const d of declarations) (out[d.staffId] ??= []).push(d.year);
  return out;
};

/**
 * 保存期間が過ぎた番号の数（メニューの知らせに使う）。事務取扱担当者でなければ null（数も見せない）。番号は読まない
 * @param today 今日（YYYY-MM-DD）
 */
export const countExpiredMyNumbers = async (
  db: Database, user: MyNumberUser | null | undefined, staffList: any[], today: string,
): Promise<number | null> => {
  if (!(await hasMyNumberAccess(db, user))) return null;
  const registered = await loadRegisteredPeople(db);
  if (registered.length === 0) return 0;
  const [declarations, lastPayYears] = await Promise.all([loadDeclarations(db), loadLastPayYears(db)]);
  const rows = buildMyNumberList(staffList, declarations, registered);
  return myNumberRetentions(rows, staffList, lastPayYears, declarationYearsOf(declarations), today).expired.length;
};
