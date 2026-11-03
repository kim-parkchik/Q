/**
 * 会社ファイル（.qp）の形式とマイグレーション
 *
 * アプリ起動時の「CREATE TABLE IF NOT EXISTS」は、表が無いときに作るだけで、
 * 既にある表に列を足すことはしない。そのため、古い会社ファイルを新しいアプリで開くと
 * 「存在しない列」に保存しようとしてエラーになる。
 *
 * そこで、会社ファイルごとに「どこまで更新済みか」を SQLite の user_version に記録し、
 * まだ適用していない更新（マイグレーション）だけを順番に実行する。
 * また、Q の会社ファイルであることを SQLite の application_id に印（Q_FILE_ID）として記録し、
 * 印が違うファイルは開かない（v1 より前の開発中の形式のファイルには、この印がない）。
 * user_version と application_id は、バックアップ（VACUUM INTO で作る .qb）にもそのまま写る。
 *
 * ■ 形式の番号
 *   ・v1: 2026-11-03 の dbSchema.ts の形。開発中に積み重ねた更新（v1〜v13）をまとめて、ここを v1 とした。
 *     それより前の開発中のQで作った会社ファイルは開けないので、作り直す。
 *
 * ■ 新しく列を足すときの手順
 *   1. dbSchema.ts の CREATE TABLE に列を追加する（新規ファイル用）
 *   2. 下の MIGRATIONS の末尾に、次の番号（v2 から）で addColumnIfMissing を追加する（既存ファイル用）
 *   ※ 既にある番号の中身は、後から書き換えないこと（どこまで適用したかがずれるため）
 *
 * ■ 開発中の方針（まだ一般に配布していない間）
 *   ・表の定義の正は dbSchema.ts。変更がたまったら、MIGRATIONS を空にし、Q_FILE_ID を次の値（"QP02" など）に変えて、
 *     今の形を v1 に戻してよい。（Q_FILE_ID を変えないと、前の形式の v2 以後のファイルを、新しい v2 以後と取り違える）
 *   ・戻すと、前のQで作った会社ファイルは開けなくなるので、作り直す。
 *   ・最初のリリース以降は戻さず、番号を積み重ねていく（利用者のファイルを守るため）。
 */

/** マイグレーションに必要な最小限のDB操作（tauri-plugin-sql の Database と互換） */
export interface MigrationDb {
  execute(query: string, bindValues?: unknown[]): Promise<unknown>;
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
}

interface Migration {
  version: number;
  description: string;
  up: (db: MigrationDb) => Promise<void>;
}

/**
 * 列が無い場合だけ追加する（新規ファイルでは CREATE TABLE 時点で列があるので何もしない）
 * 表そのものが無いときも何もしない（アプリは先に表を作るので、そのときに列も作られる）
 */
export const addColumnIfMissing = async (
  db: MigrationDb,
  table: string,
  column: string,
  definition: string
) => {
  const cols = await db.select<{ name: string }[]>(`PRAGMA table_info(${table})`);
  if (cols.length === 0 || cols.some((c) => c.name === column)) return;
  await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
};

export const MIGRATIONS: Migration[] = [
  // v1 は 2026-11-03 の dbSchema.ts の形（上の「形式の番号」を参照）。列を足す更新は version: 2 から。
  {
    version: 2,
    description: "従業員に、住民税の特別徴収の額（年度ごとの6月分〜翌年5月分）を追加（初めは空。今までの月額は、年度の額を入れていない月に使う）",
    up: async (db) => {
      await addColumnIfMissing(db, "staff", "resident_tax_schedule", "TEXT");
    },
  },
];

/** v1（2026-11-03 の dbSchema.ts の形）の番号 */
export const BASE_DB_VERSION = 1;

/** 最新のバージョン番号 */
export const LATEST_DB_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? BASE_DB_VERSION;

/** Q の会社ファイルの印（SQLite の application_id）。"QP01" の文字コード（v1 の形式。形式を戻したら "QP02" などに変える） */
export const Q_FILE_ID = 0x51503031;

const readPragma = async (db: MigrationDb, name: "user_version" | "application_id") => {
  const rows = await db.select<Record<string, number>[]>(`PRAGMA ${name}`);
  return Number(rows?.[0]?.[name] ?? 0);
};

/**
 * 会社ファイルを開くときに、形式を確かめてから表を作り、まだ適用していない更新を実行する。
 *   ・表が1つもないファイル（新しく作ったもの）：表を作り、Q の印と最新の番号を付ける
 *   ・Q の印があり、番号が最新以下のファイル：足りない表を作り、まだ適用していない更新を実行する
 *   ・それ以外（v1 より前の開発中の形式・新しいQで保存したもの）：壊さないように触らず、エラーにする
 * @param schemas 表を作る SQL（dbSchema.ts の DB_SCHEMAS）
 * 戻り値: 実行したマイグレーションの説明一覧（ログ用）
 */
export const prepareCompanyFile = async (db: MigrationDb, schemas: string[]): Promise<string[]> => {
  const tables = await db.select<{ n: number }[]>("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'");
  // PRAGMA はプレースホルダが使えないため数値を直接埋め込む（どれも数値定数のみ）
  if (Number(tables?.[0]?.n ?? 0) === 0) {
    for (const schema of schemas) await db.execute(schema);
    await db.execute(`PRAGMA application_id = ${Number(Q_FILE_ID)}`);
    await db.execute(`PRAGMA user_version = ${Number(LATEST_DB_VERSION)}`);
    return [];
  }

  const fileId = await readPragma(db, "application_id");
  const current = await readPragma(db, "user_version");
  if (fileId !== Q_FILE_ID) {
    throw new Error(
      `この会社ファイルは、今のQの形式ではありません（開発中の古いQで作ったファイルなど）。\n` +
      `今のQでは開けないので、新しく会社ファイルを作り直してください。`
    );
  }
  if (current > LATEST_DB_VERSION) {
    throw new Error(
      `この会社ファイルは、新しいバージョンのQで保存されています（ファイル: v${current} / アプリ: v${LATEST_DB_VERSION}）。\n` +
      `Qを更新してから開いてください。`
    );
  }

  for (const schema of schemas) await db.execute(schema);
  const applied: string[] = [];
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    await m.up(db);
    await db.execute(`PRAGMA user_version = ${Number(m.version)}`);
    applied.push(`v${m.version}: ${m.description}`);
  }
  return applied;
};
