/**
 * Q の側の TimeQard（会社の印・打刻カード・従業員ファイル）
 * くわしくは timeqard/DESIGN.md の 5.2〜5.4
 *
 * ・会社の印は、会社ファイルごとに1つ。最初に使うときに作り、timeqard_settings に残す。
 * ・打刻カードの番号は timeqard_cards に残す（同じカードを刷り直せるように）。作り直すと、前のカードに revoked_at を入れる。
 * ・従業員ファイルには、カードの番号そのものではなく、確かめ用の値（SHA-256）だけを入れる。
 * ・書き出したときの中身の確かめ用の値を残し、そのあとに従業員（入社・退職・名前）・カード・会社名が変わったら、
 *   書き出し直すよう画面で知らせる。
 */
import { executeBatch, type BatchDb } from "../../utils/dbBatch";
import {
  buildStaffFile,
  cardHash,
  isInStaffFile,
  newCardNumber,
  newCompanyMark,
  staffFileFingerprint,
  type RandomBytes,
  type StaffFile,
  type StaffForExport,
} from "../../../shared/timeqard";

/** ここで使う DB の操作（tauri-plugin-sql の Database と同じ使い方） */
export interface TimeQardDb extends BatchDb {
  execute(query: string, bindValues?: unknown[]): Promise<unknown>;
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
}

export interface TimeQardSettings {
  companyMark: string;
  /** 最後に従業員ファイルを書き出した日時（まだなら null） */
  lastExportAt: string | null;
  lastExportFingerprint: string | null;
}

export const loadTimeQardSettings = async (db: TimeQardDb): Promise<TimeQardSettings | null> => {
  const rows = await db.select<{ company_mark: string; last_export_at: string | null; last_export_fingerprint: string | null }[]>(
    "SELECT company_mark, last_export_at, last_export_fingerprint FROM timeqard_settings WHERE id = 1"
  );
  const r = rows?.[0];
  return r
    ? { companyMark: r.company_mark, lastExportAt: r.last_export_at ?? null, lastExportFingerprint: r.last_export_fingerprint ?? null }
    : null;
};

/** 会社の印を返す（まだなければ作る） */
export const ensureCompanyMark = async (db: TimeQardDb, random?: RandomBytes) => {
  await db.execute("INSERT OR IGNORE INTO timeqard_settings (id, company_mark) VALUES (1, ?)", [newCompanyMark(random)]);
  const settings = await loadTimeQardSettings(db);
  if (!settings) throw new Error("会社の印を作れませんでした");
  return settings.companyMark;
};

export interface TimeQardCard {
  id: number;
  staffId: string;
  cardNumber: string;
  issuedAt: string;
}

/** いま使えるカード（スタッフID → カード） */
export const loadActiveCards = async (db: TimeQardDb): Promise<Map<string, TimeQardCard>> => {
  const rows = await db.select<{ id: number; staff_id: string; card_number: string; issued_at: string }[]>(
    "SELECT id, staff_id, card_number, issued_at FROM timeqard_cards WHERE revoked_at IS NULL ORDER BY id"
  );
  return new Map(
    (rows ?? []).map((r) => [String(r.staff_id), { id: r.id, staffId: String(r.staff_id), cardNumber: r.card_number, issuedAt: r.issued_at }])
  );
};

/** カードのない人に、カードを作る（まとめて1つのトランザクションで）。作った人数を返す */
export const issueCards = async (db: TimeQardDb, staffIds: string[], issuedAt: string, random?: RandomBytes) => {
  const active = await loadActiveCards(db);
  const targets = [...new Set(staffIds)].filter((id) => !active.has(id));
  await executeBatch(
    db,
    targets.map((id) => ({
      sql: "INSERT INTO timeqard_cards (staff_id, card_number, issued_at) VALUES (?, ?, ?)",
      values: [id, newCardNumber(random), issuedAt],
    }))
  );
  return targets.length;
};

/** カードを作り直す（前のカードは、新しい従業員ファイルを TimeQard に読み込むと使えなくなる） */
export const reissueCard = async (db: TimeQardDb, staffId: string, issuedAt: string, random?: RandomBytes) => {
  await executeBatch(db, [
    { sql: "UPDATE timeqard_cards SET revoked_at = ? WHERE staff_id = ? AND revoked_at IS NULL", values: [issuedAt, staffId] },
    { sql: "INSERT INTO timeqard_cards (staff_id, card_number, issued_at) VALUES (?, ?, ?)", values: [staffId, newCardNumber(random), issuedAt] },
  ]);
};

/** 従業員ファイルに使う項目だけを読む（給与・マイナンバー・住所などは読まない） */
export const loadStaffForExport = async (db: TimeQardDb) =>
  (await db.select<StaffForExport[]>("SELECT id, name, status, join_date, retirement_date FROM staff")) ?? [];

/** 従業員ファイルに入る人（その日に在籍している人と、これから入社する人） */
export const staffInFile = (staff: StaffForExport[], asOfDate: string) => staff.filter((s) => isInStaffFile(s, asOfDate));

/** 従業員ファイルの中身を作る（会社の印がまだなければ作る） */
export const makeStaffFile = async (db: TimeQardDb, companyName: string, exportedAt: string): Promise<StaffFile> => {
  const companyMark = await ensureCompanyMark(db);
  const staff = await loadStaffForExport(db);
  const cards = await loadActiveCards(db);
  const cardHashesByStaff = new Map<string, string[]>();
  for (const [staffId, card] of cards) cardHashesByStaff.set(staffId, [await cardHash(card.cardNumber)]);
  return buildStaffFile({ companyName, companyMark, exportedAt, staff, cardHashesByStaff });
};

/** 書き出したことを残す（そのときの中身の確かめ用の値も） */
export const recordStaffFileExport = async (db: TimeQardDb, file: StaffFile) => {
  const fingerprint = await staffFileFingerprint(file);
  await db.execute("UPDATE timeqard_settings SET last_export_at = ?, last_export_fingerprint = ? WHERE id = 1", [file.exportedAt, fingerprint]);
};

/**
 * 前に書き出したあとに、従業員ファイルの中身が変わったか（変わっていたら、書き出し直して TimeQard に読み込む）。
 * 前に書き出した日を基準に作り直して比べる（退職日が過ぎただけなら、TimeQard が押させないので、変わったとはしない）。
 * まだ書き出していなければ null。
 */
export const staffFileChangedSinceExport = async (db: TimeQardDb, companyName: string): Promise<boolean | null> => {
  const settings = await loadTimeQardSettings(db);
  if (!settings?.lastExportAt || !settings.lastExportFingerprint) return null;
  const file = await makeStaffFile(db, companyName, settings.lastExportAt);
  return (await staffFileFingerprint(file)) !== settings.lastExportFingerprint;
};
