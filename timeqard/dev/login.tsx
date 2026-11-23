/**
 * Q のログインのまちがいの回数（src/features/auth/loginGuard.ts）を、本物のログインの画面と、システム設定のユーザー管理・操作の記録で確かめる
 * （開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/login.html を開く
 * ・上がログインの画面（src/features/auth/LoginScreen.tsx）。見本のユーザーは admin（パスワード kanri-2026）と hanako（hanako-2026）。
 *   パスワードは確かめ用の簡単な形にする（本物は Rust の Argon2。verify_password の代わり）。
 *   - パスワードをまちがえるたびに「あと○回続けてまちがえると、15分ログインできなくなります」と出て、5回めで止める
 *   - 止めているあいだは、正しいパスワードでも入れない
 * ・下が、管理者で開いたシステム設定（src/features/settings/SystemSettings.tsx）。「一覧を読み直す」で読み直すと、
 *   止めている人に「○○までログインできません」と「止めたのを解く」が出る。「操作の記録」のタブに、ログインの記録が出る
 * ・会社ファイルの代わりの db は、ユーザーと操作の記録を、ブラウザの中に持つ（window.__login。本物の SQL は loginGuard.test.ts で確かめている）
 * ・この画面では、ログインしている人を決めていないので、「止めたのを解く」の記録の使った人は「—」になる（アプリでは、ログインしている管理者）
 */
import { useState } from "react";
import ReactDOM from "react-dom/client";
import { ToastProvider } from "../../src/components/Toast";
import { MessageDialogProvider } from "../../src/components/MessageDialog";
import LoginScreen from "../../src/features/auth/LoginScreen";
import SystemSettings from "../../src/features/settings/SystemSettings";

interface User {
  id: number; login_id: string; display_name: string; password_hash: string; role: string; status: string;
  my_number_access: number; last_login: string | null; failed_logins: number; locked_until: string | null;
}
const users: User[] = [
  { id: 1, login_id: "admin", display_name: "管理者", password_hash: "preview:kanri-2026", role: "admin", status: "active", my_number_access: 1, last_login: "2026-11-23 09:00:00", failed_logins: 0, locked_until: null },
  { id: 2, login_id: "hanako", display_name: "事務 花子", password_hash: "preview:hanako-2026", role: "staff", status: "active", my_number_access: 0, last_login: null, failed_logins: 0, locked_until: null },
];
const logs: { id: number; created_at: string; level: string; category: string; message: string; user_name: string | null }[] = [];
const w = window as any;
w.__login = { users, logs };

const now = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const byId = (id: unknown) => users.find((u) => u.id === Number(id));

/** 会社ファイルの代わり（ログイン・ユーザー管理・操作の記録で使う SQL だけを読む） */
const db = {
  select: async (sql: string, params: unknown[] = []) => {
    if (sql.startsWith("SELECT * FROM users WHERE login_id = ? AND status = 'active'")) return users.filter((u) => u.login_id === params[0] && u.status === "active").map((u) => ({ ...u }));
    if (sql.includes("FROM users ORDER BY id")) return users.map((u) => ({ ...u }));
    if (sql.includes("FROM company")) return [{ holiday_csv_url: "", holiday_source: "csv", corporate_search_mode: "page", gbiz_api_key: "", backup_generations: 10 }];
    if (sql.includes("DISTINCT category")) return [...new Set(logs.map((l) => l.category))].sort().map((category) => ({ category }));
    if (sql.includes("DISTINCT user_name")) return [...new Set(logs.map((l) => l.user_name))].map((user_name) => ({ user_name }));
    if (sql.includes("FROM app_logs")) return [...logs].sort((a, b) => b.id - a.id).slice(0, Number(params[params.length - 1]));
    return [];
  },
  execute: async (sql: string, params: unknown[] = []) => {
    if (sql.startsWith("INSERT INTO app_logs")) {
      const [created_at, level, category, message, user_name] = params as string[];
      logs.push({ id: logs.length + 1, created_at, level, category, message, user_name });
    } else if (sql.startsWith("UPDATE users SET failed_logins = 0, locked_until = ? WHERE id = ?")) {
      Object.assign(byId(params[1])!, { failed_logins: 0, locked_until: params[0] });
    } else if (sql.startsWith("UPDATE users SET failed_logins = ?, locked_until = NULL WHERE id = ?")) {
      Object.assign(byId(params[1])!, { failed_logins: params[0], locked_until: null });
    } else if (sql.startsWith("UPDATE users SET failed_logins = 0, locked_until = NULL, last_login")) {
      Object.assign(byId(params[0])!, { failed_logins: 0, locked_until: null, last_login: now() });
    } else if (sql.startsWith("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?")) {
      Object.assign(byId(params[0])!, { failed_logins: 0, locked_until: null });
    } else {
      console.info("[確かめ用] 読まない SQL", sql, params);
    }
    return { rowsAffected: 1, lastInsertId: 0 };
  },
};

// ── Tauri の代わり（パスワードの確かめ。本物は Rust の Argon2） ──
w.__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
  invoke: async (cmd: string, args: any) => {
    if (cmd === "verify_password") return args.hash === `preview:${args.password}`;
    if (cmd === "hash_password") return `preview:${args.password}`;
    return null;
  },
  transformCallback: () => 0,
  unregisterCallback: () => {},
};

const admin = { id: 1, login_id: "admin", display_name: "管理者", role: "admin" };

function Page() {
  const [loggedIn, setLoggedIn] = useState<string>("");
  const [version, setVersion] = useState(0);
  return (
    <div>
      <div style={{ position: "relative" }}>
        <LoginScreen db={db} onLoginSuccess={(u) => setLoggedIn(`${u.display_name}（${u.login_id}）でログインしました`)} />
        {loggedIn && (
          <div data-logged-in style={{ position: "absolute", top: 12, left: 12, background: "#27ae60", color: "white", padding: "6px 12px", borderRadius: 6 }}>
            {loggedIn}
          </div>
        )}
      </div>
      <div style={{ padding: 20 }}>
        <button data-reload onClick={() => setVersion((v) => v + 1)} style={{ marginBottom: 12 }}>一覧を読み直す</button>
        <SystemSettings key={version} db={db} currentUser={admin} />
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <ToastProvider>
    <MessageDialogProvider>
      <Page />
    </MessageDialogProvider>
  </ToastProvider>
);
