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
 *
 * ■ 開発中の方針（まだ一般に配布していない間）
 *   ・表の定義の正は dbSchema.ts。MIGRATIONS は、変更がたまったら空に戻してよい。
 *   ・空に戻すと、以前のアプリで開いたテスト用の会社ファイルは開けなくなるので、作り直す。
 *   ・最初のリリース以降は空に戻さず、番号を積み重ねていく（利用者のファイルを守るため）。
 *   ・2026-10: 開発中の変更（v1〜v4）を dbSchema.ts に反映済みとして、空に戻した。
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
  {
    version: 1,
    description: "令和6年分の定額減税（従業員の対象人数・給与ごとの減税額）を追加",
    up: async (db) => {
      await addColumnIfMissing(db, "staff", "flat_tax_reduction_persons", "INTEGER DEFAULT 0");
      await addColumnIfMissing(db, "salary_results", "flat_tax_reduction", "INTEGER DEFAULT 0");
    },
  },
  {
    version: 2,
    description: "会社設定に「中小企業」（2023年3月までの月60時間超の割増率の猶予）を追加",
    up: async (db) => {
      await addColumnIfMissing(db, "company", "is_small_business", "INTEGER DEFAULT 0");
    },
  },
  {
    version: 3,
    description: "従業員に産休・育休の期間（社会保険料の免除）を追加",
    up: async (db) => {
      await addColumnIfMissing(db, "staff", "leave_periods", "TEXT");
    },
  },
  {
    version: 4,
    description: "従業員に源泉所得税の欄（甲欄・乙欄）を追加（今までの人は甲欄）",
    up: async (db) => {
      await addColumnIfMissing(db, "staff", "tax_column", "TEXT DEFAULT 'kou'");
    },
  },
  {
    version: 5,
    description: "従業員に標準報酬月額の履歴（何年何月分から・いくら）を追加（今までの値は入社したときからの1件として扱う）",
    up: async (db) => {
      await addColumnIfMissing(db, "staff", "standard_remuneration_history", "TEXT");
    },
  },
  {
    version: 6,
    description: "年末調整の過不足額の精算（精算する給与の年月と、給与の確定結果の精算額）を追加",
    up: async (db) => {
      await addColumnIfMissing(db, "year_end_adjustments", "settle_year", "INTEGER");
      await addColumnIfMissing(db, "year_end_adjustments", "settle_month", "INTEGER");
      await addColumnIfMissing(db, "salary_results", "year_end_adjustment", "INTEGER DEFAULT 0");
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
      `この会社ファイルは、今のQとは違う形式で保存されています（ファイル: v${current} / アプリ: v${LATEST_DB_VERSION}）。\n` +
      `新しいバージョンのQで保存したファイルなら、Qを更新してから開いてください。\n` +
      `開発中に作ったテスト用のファイルなら、新しく作り直してください。`
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
