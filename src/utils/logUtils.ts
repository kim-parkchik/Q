import Database from "@tauri-apps/plugin-sql";
import {
  BaseDirectory,
  mkdir,
  writeTextFile
} from "@tauri-apps/plugin-fs";
import {
  APP_DIR_NAME,
  LOG_DIR_NAME,
  EXT_LOG
} from "../constants/appConfig";

// ログの種類（今後 writeLog の引数の型として使う予定）
export type LogLevel =
  | "INFO"
  | "WARN"
  | "ERROR";

export type LogCategory =
  | "system"
  | "auth"
  | "staff"
  | "attendance"
  | "salary"
  | "backup";

const logDir = `${APP_DIR_NAME}/${LOG_DIR_NAME}`;

export const writeLog = async (
  db: Database | null,
  level: string,
  category: string,
  message: string,
  userName?: string
) => {
  const now = new Date().toISOString();

  // 🆕 毎回現在日時から生成
  const nowDate = new Date();

  const yyyy = nowDate.getFullYear();
  const mm = String(nowDate.getMonth() + 1).padStart(2, "0");

  const logPath =
    `${logDir}/${yyyy}-${mm}.${EXT_LOG}`;

  // SQLite
  if (db) {
    try {
      await db.execute(
        `INSERT INTO app_logs
        (created_at, level, category, message, user_name)
        VALUES (?, ?, ?, ?, ?)`,
        [
          now,
          level,
          category,
          message,
          userName || null
        ]
      );
    } catch (err) {
      console.error("DBログ書き込み失敗:", err);
    }
  }

  // ファイル（書類/Q/Logs の「年-月.qlog」）
  // 1行を、ファイルの終わりに書き足す（append）。読み込んでから全部を書き戻すと、2つの記録を同時に書いたときに、
  // あとから書き戻したほうが先に書いた行を消してしまう。書き足すなら、どちらの行も残る（ファイルがなければ作る）
  try {
    await mkdir(logDir, {
      baseDir: BaseDirectory.Document,
      recursive: true
    });

    const line =
      `[${now}] [${level}] [${category}] ${message}` +
      (userName ? ` (${userName})` : "") +
      "\n";

    await writeTextFile(logPath, line, {
      baseDir: BaseDirectory.Document,
      append: true
    });

  } catch (err) {
    console.error("ファイルログ書き込み失敗:", err);
  }
};