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
 *   ・v1: 2026-11-14 の dbSchema.ts の形（印 "QP02"）。開発中に積み重ねた更新（2026-11-03 の v1 から v21 まで）をまとめて、ここを v1 とした。
 *     それより前の開発中のQで作った会社ファイル（印 "QP01" のもの・印のないもの）は開けないので、作り直す。
 *     （2026-11-03 にも、それまでの更新 v1〜v13 をまとめて v1（印 "QP01"）にしている）
 *   ・v2: 会社に賞与支払予定月（bonus_plan_months）を足す
 *   ・v3: 従業員に住所のフリガナ（address_kana）、社会保険規定に健康保険組合の事業所番号（union_office_number）と
 *     組合に出すファイルの媒体通番（union_media_seq）を足す
 *   ・v4: 従業員に現物で払う報酬（in_kind）、確定した給与に現物の額（in_kind・in_kind_taxable・in_kind_emp）と内訳（in_kind_detail）、
 *     賞与の支給項目に現物で渡す印（bonus_item_master.in_kind）、確定した賞与に現物で渡した額（bonus_results.in_kind）を足す
 *   ・v5: 従業員に後期高齢者医療の障害認定の日（kouki_date）と、健康保険の被扶養者（health_dependents）を足す
 *   ・v6: 会社に雇用保険の届書・年度更新の列（koyo_office_number・koyo_hello_work・koyo_media_seq・rousai_business・rousai_rate・nendo_koshin）、
 *     拠点に koyo_office_number・koyo_hello_work・rousai_business・rousai_rate、従業員に雇用保険の届書に書くこと（koyo_info）を足す
 *   ・v7: 会社に源泉所得税の納付書の設定と手で入れた額（gensen_nofu）、従業員に住民税の給与所得者異動届出書に書くこと（resident_tax_idou）を足す
 *   ・v8: 従業員に部門（department）、会社に仕訳データの設定（journal_settings）、住民税の市区町村に送付先（mail_zip・mail_address・mail_name）を足す
 *
 * ■ 新しく列を足すときの手順
 *   1. dbSchema.ts の CREATE TABLE に列を追加する（新規ファイル用）
 *   2. 下の MIGRATIONS の末尾に、次の番号（v2 から）で addColumnIfMissing を追加する（既存ファイル用）
 *   ※ 既にある番号の中身は、後から書き換えないこと（どこまで適用したかがずれるため）
 *   ※ 新しい表を足すだけなら、番号は要らない（開くたびに CREATE TABLE IF NOT EXISTS で作られる）
 *
 * ■ 開発中の方針（まだ一般に配布していない間）
 *   ・表の定義の正は dbSchema.ts。変更がたまったら、MIGRATIONS を空にし、Q_FILE_ID を次の値（"QP03" など）に変えて、
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
  // v1 は 2026-11-14 の dbSchema.ts の形（上の「形式の番号」を参照）。列を足す更新は version: 2 から。
  {
    version: 2,
    description: "会社に、年金機構に登録している賞与支払予定月（賞与不支給報告書に使う）の列を足す",
    up: async (db) => {
      await addColumnIfMissing(db, "company", "bonus_plan_months", "TEXT");
    },
  },
  {
    version: 3,
    description: "従業員に住所のフリガナ（資格取得届に使う）、社会保険規定に健康保険組合の事業所番号と、組合に出すファイルの媒体通番の列を足す",
    up: async (db) => {
      await addColumnIfMissing(db, "staff", "address_kana", "TEXT");
      await addColumnIfMissing(db, "social_insurance_groups", "union_office_number", "TEXT");
      await addColumnIfMissing(db, "social_insurance_groups", "union_media_seq", "INTEGER DEFAULT 0");
    },
  },
  {
    version: 4,
    description: "現物で払う報酬（食事・住宅など）の列を、従業員・確定した給与・賞与の支給項目・確定した賞与に足す",
    up: async (db) => {
      await addColumnIfMissing(db, "staff", "in_kind", "TEXT");
      await addColumnIfMissing(db, "salary_results", "in_kind", "INTEGER DEFAULT 0");
      await addColumnIfMissing(db, "salary_results", "in_kind_taxable", "INTEGER DEFAULT 0");
      await addColumnIfMissing(db, "salary_results", "in_kind_emp", "INTEGER DEFAULT 0");
      await addColumnIfMissing(db, "salary_results", "in_kind_detail", "TEXT");
      await addColumnIfMissing(db, "bonus_item_master", "in_kind", "INTEGER DEFAULT 0");
      await addColumnIfMissing(db, "bonus_results", "in_kind", "INTEGER DEFAULT 0");
    },
  },
  {
    version: 5,
    description: "後期高齢者医療の障害認定の日と、健康保険の被扶養者の列を、従業員に足す",
    up: async (db) => {
      await addColumnIfMissing(db, "staff", "kouki_date", "TEXT");
      await addColumnIfMissing(db, "staff", "health_dependents", "TEXT");
    },
  },
  {
    version: 6,
    description: "雇用保険の届書（雇用保険適用事業所番号・ハローワーク・ＦＤ通番・従業員の雇用保険の情報）と、年度更新（労災保険の事業の種類と率・入れたもの）の列を足す",
    up: async (db) => {
      for (const [column, definition] of [
        ["koyo_office_number", "TEXT"], ["koyo_hello_work", "TEXT"], ["koyo_media_seq", "INTEGER DEFAULT 0"],
        ["rousai_business", "TEXT"], ["rousai_rate", "REAL"], ["nendo_koshin", "TEXT"],
      ]) await addColumnIfMissing(db, "company", column, definition);
      for (const [column, definition] of [
        ["koyo_office_number", "TEXT"], ["koyo_hello_work", "TEXT"], ["rousai_business", "TEXT"], ["rousai_rate", "REAL"],
      ]) await addColumnIfMissing(db, "branches", column, definition);
      await addColumnIfMissing(db, "staff", "koyo_info", "TEXT");
    },
  },
  {
    version: 7,
    description: "源泉所得税の納付書（納期の特例・手で入れた額）と、住民税の給与所得者異動届出書に書くことの列を足す",
    up: async (db) => {
      await addColumnIfMissing(db, "company", "gensen_nofu", "TEXT");
      await addColumnIfMissing(db, "staff", "resident_tax_idou", "TEXT");
    },
  },
  {
    version: 8,
    description: "従業員の部門、仕訳データの設定、住民税の市区町村の送付先の列を足す",
    up: async (db) => {
      await addColumnIfMissing(db, "staff", "department", "TEXT");
      await addColumnIfMissing(db, "company", "journal_settings", "TEXT");
      for (const column of ["mail_zip", "mail_address", "mail_name"]) await addColumnIfMissing(db, "resident_tax_municipalities", column, "TEXT");
    },
  },
];

/** v1（2026-11-14 の dbSchema.ts の形）の番号 */
export const BASE_DB_VERSION = 1;

/** 最新のバージョン番号 */
export const LATEST_DB_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? BASE_DB_VERSION;

/**
 * Q の会社ファイルの印（SQLite の application_id）。"QP02" の文字コード
 * （2026-11-14 に形式を v1 に戻したときに "QP01" から変えた。形式を戻したら "QP03" などに変える）
 */
export const Q_FILE_ID = 0x51503032;

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
