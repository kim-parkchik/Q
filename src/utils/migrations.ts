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
 *   ※ 新しい表を足すだけなら、番号は要らない（開くたびに CREATE TABLE IF NOT EXISTS で作られる）
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
  {
    version: 3,
    description: "従業員に、住民税の市区町村（1月1日の住所の市区町村。給与支払報告書の提出先）を追加（初めは空）",
    up: async (db) => {
      await addColumnIfMissing(db, "staff", "resident_tax_municipality", "TEXT");
    },
  },
  {
    version: 4,
    description: "ユーザーに、マイナンバーを扱える（事務取扱担当者）の印を追加（初めは誰にも付けない。管理者がシステム設定で付ける）",
    up: async (db) => {
      await addColumnIfMissing(db, "users", "my_number_access", "INTEGER DEFAULT 0");
    },
  },
  {
    version: 5,
    description: "住民税の市区町村ごとの設定に、宛名番号と納期の特例を追加（初めは空・特例なし）",
    up: async (db) => {
      await addColumnIfMissing(db, "resident_tax_municipalities", "atena_number", "TEXT");
      await addColumnIfMissing(db, "resident_tax_municipalities", "special_due", "INTEGER DEFAULT 0");
    },
  },
  {
    version: 6,
    description: "マイナンバーに、同じ番号かどうかを確かめる値を追加（暗号化を始めるときに入れる）",
    up: async (db) => {
      await addColumnIfMissing(db, "my_numbers", "number_hash", "TEXT");
    },
  },
  {
    version: 7,
    description: "従業員に、通勤の方法・片道の距離・定期代・有料道路・駐車場等を追加（通勤手当の非課税限度額に使う。初めは空で、電車・バスなどとして計算する）",
    up: async (db) => {
      await addColumnIfMissing(db, "staff", "commute_setting", "TEXT");
    },
  },
  {
    version: 8,
    description: "給与規定グループに欠勤控除のしかた（初めは計算期間の所定労働日数で割る）を、確定した給与に欠勤控除の額と計算期間の所定労働日数（算定・月変の支払基礎日数に使う）を追加",
    up: async (db) => {
      await addColumnIfMissing(db, "payroll_groups", "absence_deduction_method", "TEXT DEFAULT 'workdays'");
      await addColumnIfMissing(db, "salary_results", "absence_deduction", "INTEGER");
      await addColumnIfMissing(db, "salary_results", "prescribed_work_days", "INTEGER");
    },
  },
  {
    version: 9,
    description: "給与規定グループに決まった休憩（初めは使わない）を、従業員に決まった休憩を使うか（初めは使う）を、勤怠にその日の「休憩なし」と確定したときに引いた決まった休憩を追加",
    up: async (db) => {
      await addColumnIfMissing(db, "payroll_groups", "fixed_break", "TEXT");
      await addColumnIfMissing(db, "staff", "fixed_break_apply", "INTEGER DEFAULT 1");
      await addColumnIfMissing(db, "attendance", "break_none", "INTEGER DEFAULT 0");
      await addColumnIfMissing(db, "attendance", "auto_break", "TEXT");
    },
  },
  {
    version: 10,
    description:
      "勤怠の休憩を一覧にする（休憩を1日に何回でも入れる。外出は休憩にまとめ、前の休憩・外出は一覧に移す）。" +
      "会社に時間単位の有給を使うか（いままで時間有給を入れていれば使う）、給与規定グループに遅刻・早退・中抜けの控除のしかた（初めはしない）、確定した給与にその額を追加",
    up: async (db) => {
      await addColumnIfMissing(db, "attendance", "breaks", "TEXT");
      await addColumnIfMissing(db, "attendance", "csv_breaks", "TEXT");
      const cols = (await db.select<{ name: string }[]>("PRAGMA table_info(attendance)")).map((c) => c.name);
      const old = ["break_start", "break_end", "out_time", "return_time", "csv_break_start", "csv_break_end", "csv_out_time", "csv_return_time"];
      if (old.every((c) => cols.includes(c))) {
        const isTime = (v: unknown) => typeof v === "string" && /^\d{1,2}:\d{2}$/.test(v.trim());
        const time = (v: unknown) => (isTime(v) ? String(v).trim().padStart(5, "0") : "");
        // 手入力があればそれを使い、なければ打刻を使う（いままでの勤怠の画面と同じ見方）
        const pick = (manual: unknown, punched: unknown) => (isTime(manual) ? time(manual) : time(punched));
        const pairs = (...ps: [string, string][]) => ps.filter(([s, e]) => s || e).map(([start, end]) => ({ start, end }));
        const rows = await db.select<Record<string, unknown>[]>(`SELECT id, ${old.join(", ")} FROM attendance`);
        for (const r of rows) {
          const punched = pairs([time(r.csv_break_start), time(r.csv_break_end)], [time(r.csv_out_time), time(r.csv_return_time)]);
          const edited = [r.break_start, r.break_end, r.out_time, r.return_time].some(isTime);
          const manual = edited
            ? pairs(
              [pick(r.break_start, r.csv_break_start), pick(r.break_end, r.csv_break_end)],
              [pick(r.out_time, r.csv_out_time), pick(r.return_time, r.csv_return_time)],
            )
            : null;
          await db.execute("UPDATE attendance SET breaks = ?, csv_breaks = ? WHERE id = ?", [
            manual ? JSON.stringify(manual) : null,
            punched.length > 0 ? JSON.stringify(punched) : null,
            r.id,
          ]);
        }
        for (const c of old) {
          try {
            await db.execute(`ALTER TABLE attendance DROP COLUMN ${c}`);
          } catch {
            // 列を消せない古い SQLite では残す（使わない）
          }
        }
      }
      await addColumnIfMissing(db, "company", "hourly_leave", "INTEGER DEFAULT 0");
      if (cols.includes("paid_leave_hours")) {
        await db.execute("UPDATE company SET hourly_leave = 1 WHERE EXISTS (SELECT 1 FROM attendance WHERE paid_leave_hours > 0)");
      }
      await addColumnIfMissing(db, "payroll_groups", "tardy_deduction_method", "TEXT DEFAULT 'none'");
      await addColumnIfMissing(db, "salary_results", "tardy_deduction", "INTEGER");
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
