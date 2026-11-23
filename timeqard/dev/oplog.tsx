/**
 * Q のシステム設定の「操作の記録」（src/features/settings/OperationLogTab.tsx・src/utils/appLogs.ts）を、見本の記録で確かめる
 * （開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/oplog.html を開く
 * ・管理者でログインしているつもり。「操作の記録」のタブに、2026年11月1日〜23日の見本の記録 460件が新しい順に出る（200件ずつ。「もっと見る」で足す）
 *   - 日付・種類・使った人で絞れる（使った人が残っていない記録は「（残っていない記録）」）
 *   - 注意（WARN）・エラー（ERROR）の記録には印が付く
 * ・http://localhost:1432/dev/oplog.html?staff なら一般のユーザー（「操作の記録」のタブは出ない）
 * ・会社ファイルの代わりの db は、記録を読む SQL（appLogs.ts の appLogQuery）の条件を、同じ順で読んで絞る。
 *   SQL そのものは src/utils/appLogs.test.ts で、本物の SQLite で確かめている
 */
import React from "react";
import ReactDOM from "react-dom/client";
import { ToastProvider } from "../../src/components/Toast";
import { MessageDialogProvider } from "../../src/components/MessageDialog";
import SystemSettings from "../../src/features/settings/SystemSettings";

interface Log { id: number; created_at: string; level: string; category: string; message: string; user_name: string | null }

const ADMIN = "管理者（admin）";
const HANAKO = "事務 花子（hanako）";
const MESSAGES: [string, string, string | null][] = [
  ["system", "会社ファイルを開きました: /Users/sample/Documents/Q/見本商店.qp", null],
  ["attendance", "見本 太郎（1001）に、年次有給休暇 10日（付与日 2026-11-01・有効期限 2028-10-31）を付与しました", ADMIN],
  ["salary", "振込データ（給与・2026年11月分・振込日 2026-11-25・12件・合計 3,456,789円）を保存しました", ADMIN],
  ["staff", "TimeQard の打刻カードを作りました（3人）", HANAKO],
  ["mynumber", "マイナンバーを表示しました：見本 花子（本人）", HANAKO],
];
const logs: Log[] = [];
for (let i = 0; i < 460; i++) {
  const day = 1 + Math.floor((i * 23) / 460);
  const minutes = (i * 37) % (24 * 60);
  const [category, message, user] = MESSAGES[i % MESSAGES.length];
  logs.push({
    id: i + 1,
    created_at: new Date(2026, 10, day, Math.floor(minutes / 60), minutes % 60, i % 60).toISOString(),
    level: i === 455 ? "ERROR" : i === 450 ? "WARN" : "INFO",
    category,
    message: `${message}（${i + 1}番め）`,
    user_name: user,
  });
}
(window as any).__logs = logs;

const users = [
  { id: 1, login_id: "admin", display_name: "管理者", role: "admin", last_login: "2026-11-23 09:00:00", my_number_access: 1 },
  { id: 2, login_id: "hanako", display_name: "事務 花子", role: "staff", last_login: "2026-11-22 18:00:00", my_number_access: 1 },
];

/** 会社ファイルの代わり（記録を読む SQL の条件を、appLogQuery と同じ順で読む） */
const db = {
  select: async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM users")) return users;
    if (sql.includes("FROM company")) return [{ holiday_csv_url: "", holiday_source: "csv", corporate_search_mode: "page", gbiz_api_key: "", backup_generations: 10 }];
    if (sql.includes("DISTINCT category")) return [...new Set(logs.map((l) => l.category))].sort().map((category) => ({ category }));
    if (sql.includes("DISTINCT user_name")) return [...new Set(logs.map((l) => l.user_name))].map((user_name) => ({ user_name }));
    if (sql.includes("FROM app_logs")) {
      const rest = [...params];
      let rows = [...logs];
      if (sql.includes("created_at >= ?")) { const v = String(rest.shift()); rows = rows.filter((r) => r.created_at >= v); }
      if (sql.includes("created_at < ?")) { const v = String(rest.shift()); rows = rows.filter((r) => r.created_at < v); }
      if (sql.includes("category = ?")) { const v = rest.shift(); rows = rows.filter((r) => r.category === v); }
      if (sql.includes("user_name IS NULL")) rows = rows.filter((r) => !r.user_name);
      else if (sql.includes("user_name = ?")) { const v = rest.shift(); rows = rows.filter((r) => r.user_name === v); }
      const limit = Number(rest.shift());
      return rows.sort((a, b) => b.id - a.id).slice(0, limit);
    }
    return [];
  },
  execute: async () => ({ rowsAffected: 0, lastInsertId: 0 }),
};

const staffView = new URLSearchParams(location.search).has("staff");
const currentUser = staffView
  ? { id: 2, login_id: "hanako", display_name: "事務 花子", role: "staff" }
  : { id: 1, login_id: "admin", display_name: "管理者", role: "admin" };

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ToastProvider>
      <MessageDialogProvider>
        <SystemSettings db={db} currentUser={currentUser} />
      </MessageDialogProvider>
    </ToastProvider>
  </React.StrictMode>,
);
