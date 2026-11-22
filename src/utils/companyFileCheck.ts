/**
 * 会社ファイルを開く前に、となりにある作業中のファイル（会社ファイルの名前の後ろに「-wal」が付いたファイル）を確かめる
 * （Rust の側の check_company_file。src-tauri/src/wal_check.rs）
 *
 * Q が使う SQLite 3.46.0 には、会社ファイルと、ページの大きさが違う -wal の組を開くと、Q のメモリにある別のデータが
 * その会社ファイルの中身として出てしまう弱いところがある（CVE-2026-119375。SQLite 3.54.0 で直った）。
 * tauri-plugin-sql が直った SQLite を使うようになるまで、開く前に確かめて、合っていなければ開かない。
 * ※ 会社ファイルは、かならず companyFileProblem で確かめてから開くこと（開くのは useApp.ts の1か所だけ。companyFileCheck.test.ts で確かめている）
 */
import { invoke } from "@tauri-apps/api/core";

/** Database.load に渡す "sqlite:…"。確かめるときも同じものを渡し、Rust の側で、プラグインと同じ読み方でファイルの名前にする */
export const sqliteUrl = (path: string): string => `sqlite:${path}`;

type Invoke = (cmd: string, args: Record<string, unknown>) => Promise<unknown>;

/** 開いてよければ null。開かないなら知らせる文（確かめられなかったときも開かない） */
export const companyFileProblem = async (url: string, run: Invoke = invoke): Promise<string | null> => {
  try {
    await run("check_company_file", { db: url });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};
