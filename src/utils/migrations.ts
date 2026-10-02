/**
 * 会社ファイル（.qp）のマイグレーション
 *
 * アプリ起動時の「CREATE TABLE IF NOT EXISTS」は、表が無いときに作るだけで、
 * 既にある表に列を足すことはしない。そのため、古い会社ファイルを新しいアプリで開くと
 * 「存在しない列」に保存しようとしてエラーになる。
 *
 * そこで、会社ファイルごとに「どこまで更新済みか」を SQLite の user_version に記録し、
 * まだ適用していない更新（マイグレーション）だけを順番に実行する。
 *
 * ■ 新しく列を足すときの手順
 *   1. dbSchema.ts の CREATE TABLE に列を追加する（新規ファイル用）
 *   2. 下の MIGRATIONS の末尾に、次の番号で addColumnIfMissing を追加する（既存ファイル用）
 *   ※ 既にある番号の中身は、後から書き換えないこと（どこまで適用したかがずれるため）
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

/** 列が無い場合だけ追加する（新規ファイルでは CREATE TABLE 時点で列があるので何もしない） */
export const addColumnIfMissing = async (
  db: MigrationDb,
  table: string,
  column: string,
  definition: string
) => {
  const cols = await db.select<{ name: string }[]>(`PRAGMA table_info(${table})`);
  if (cols.some((c) => c.name === column)) return;
  await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
};

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: "勤怠の確定機能に必要な列を追加（2026年5月以前に作成したファイル向け）",
    up: async (db) => {
      await addColumnIfMissing(db, "attendance", "is_finalized", "INTEGER DEFAULT 0");
      await addColumnIfMissing(db, "attendance", "finalized_at", "TEXT");
      await addColumnIfMissing(db, "attendance", "finalized_by", "TEXT");
    },
  },
  {
    version: 2,
    description: "社会保険規定に定額時の会社負担額（comp_fixed_amount）の列を追加",
    up: async (db) => {
      await addColumnIfMissing(db, "social_insurance_groups", "comp_fixed_amount", "INTEGER DEFAULT 0");
    },
  },
];

/** 最新のバージョン番号 */
export const LATEST_DB_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

/**
 * 未適用のマイグレーションを順番に実行する。
 * 戻り値: 実行したマイグレーションの説明一覧（ログ用）
 */
export const runMigrations = async (db: MigrationDb): Promise<string[]> => {
  const rows = await db.select<{ user_version: number }[]>("PRAGMA user_version");
  const current = rows?.[0]?.user_version ?? 0;

  // アプリより新しいバージョンで保存されたファイルは、壊さないように触らない
  if (current > LATEST_DB_VERSION) {
    throw new Error(
      `この会社ファイルは新しいバージョンのQで保存されています（ファイル: v${current} / アプリ: v${LATEST_DB_VERSION}）。Qを更新してから開いてください。`
    );
  }

  const applied: string[] = [];
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    await m.up(db);
    // PRAGMA はプレースホルダが使えないため数値を直接埋め込む（version は数値定数のみ）
    await db.execute(`PRAGMA user_version = ${Number(m.version)}`);
    applied.push(`v${m.version}: ${m.description}`);
  }
  return applied;
};
