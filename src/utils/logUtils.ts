import Database from "@tauri-apps/plugin-sql";

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
  | "backup"
  | "mynumber";

/** いまログインしている人（「表示名（ログインID）」。useApp.ts が、ログインしたとき・閉じたときに入れ替える） */
let loggedInUser: string | null = null;

/** 操作の記録に残す「使った人」を入れ替える（ログインしていなければ null） */
export const setLogUser = (user: string | null) => {
  loggedInUser = user;
};

/** 操作の記録に残す「使った人」の書き方（マイナンバーの記録と同じ） */
export const logUserName = (user: { display_name: string; login_id: string }) => `${user.display_name}（${user.login_id}）`;

/**
 * 操作の記録を、会社ファイルの中（app_logs）に残す（システム設定の「操作の記録」で見る。features/settings/OperationLogTab.tsx・utils/appLogs.ts）
 * 記録は会社ファイルの中にだけ残し、ほかのファイルには書かない（従業員の名前などが入るので、会社ファイルの外に置かない）。
 * 使った人を渡さなければ、いまログインしている人を残す
 */
export const writeLog = async (
  db: Database | null,
  level: string,
  category: string,
  message: string,
  userName?: string
) => {
  if (!db) return;
  try {
    await db.execute(
      `INSERT INTO app_logs
      (created_at, level, category, message, user_name)
      VALUES (?, ?, ?, ?, ?)`,
      [
        new Date().toISOString(),
        level,
        category,
        message,
        userName || loggedInUser || null
      ]
    );
  } catch (err) {
    console.error("操作の記録を残せませんでした:", err);
  }
};
