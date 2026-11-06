/**
 * いくつかの書き込みを、1つのトランザクションでまとめて行う（全部できたら保存し、1つでも失敗したら全部取り消す）
 *
 * tauri-plugin-sql の db.execute は、呼ぶたびに接続プール（1つの会社ファイルに最大10本の接続）の空いた接続を使う。
 * そのため db.execute("BEGIN") 〜 db.execute("COMMIT") と別々に送っても、別々の接続で動いて1つのトランザクションにならない。
 * 途中の文がその場で保存されたり、COMMIT が失敗したり、BEGIN だけが残った接続での後の書き込みが保存されなかったりする。
 * ここでは Rust 側の execute_batch（src-tauri/src/lib.rs）で、1本の接続でトランザクションを始めて、まとめて実行する。
 * ※ BEGIN・COMMIT・ROLLBACK を db.execute で送らないこと。
 */
import { invoke } from "@tauri-apps/api/core";

/** 実行する文（値は ? の順に入れる） */
export interface SqlStatement {
  sql: string;
  values?: unknown[];
}

/** 文ごとの結果（変わった行の数・最後に足した行の rowid） */
export interface SqlStatementResult {
  rowsAffected: number;
  lastInsertId: number;
}

/**
 * まとめて実行する相手。アプリでは tauri-plugin-sql の Database（path は Database.load に渡した "sqlite:…"）。
 * テストでは executeBatch を持つものを渡す
 */
export interface BatchDb {
  path?: string;
  executeBatch?: (statements: SqlStatement[]) => Promise<SqlStatementResult[]>;
}

export const executeBatch = async (db: BatchDb, statements: SqlStatement[]): Promise<SqlStatementResult[]> => {
  if (statements.length === 0) return [];
  if (typeof db.executeBatch === "function") return db.executeBatch(statements);
  if (!db.path) throw new Error("会社ファイルが開かれていません");
  return invoke<SqlStatementResult[]>("execute_batch", {
    db: db.path,
    statements: statements.map((s) => ({ sql: s.sql, values: s.values ?? [] })),
  });
};
