/**
 * Q の会社ファイルを開く前の確かめ（となりにある作業中のファイル -wal。src/utils/companyFileCheck.ts・src-tauri/src/wal_check.rs）を、
 * Q の最初の画面（src/App.tsx・src/useApp.ts）で確かめる（開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/walcheck.html を開く
 * ・「既存のファイルを開く (.qp)」を押すと、ファイルを選ぶ窓の代わりに window.__nextOpen の会社ファイルを選ぶ
 *   - 「受け取った会社.qp」（初め）：Rust の check_company_file の代わりが、作業中のファイルと合わないと答える
 *     → 知らせが出て、会社ファイルは開かない（window.__calls に plugin:sql|load がない）
 *   - 「いつもの会社.qp」：確かめのあとで plugin:sql|load を呼ぶ（ここでは開かずに、開けなかったと答える）
 * ・Tauri の命令は window.__calls に残す
 */
import React from "react";
import ReactDOM from "react-dom/client";
import App from "../../src/App";
import { ToastProvider } from "../../src/components/Toast";
import { MessageDialogProvider } from "../../src/components/MessageDialog";
import { MyNumberUnlockProvider } from "../../src/features/mynumber/MyNumberUnlock";

const DOCUMENTS = "/Users/sample/Documents";
// Rust の側（wal_check.rs の WalProblem::message）が返す知らせの見本
const REFUSAL =
  "この会社ファイルは開きません。\n" +
  "となりにある作業中のファイル「受け取った会社.qp-wal」と会社ファイルとで、ページの大きさが合っていません（会社ファイルは 4096バイト、作業中のファイルは 1024バイト）。\n" +
  "（確かめ用の画面：Rust の check_company_file の代わりの知らせ）";

(window as any).__calls = [];
(window as any).__nextOpen = `${DOCUMENTS}/Q/受け取った会社.qp`;

// ── Tauri の代わり ──
(window as any).__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
  invoke: async (cmd: string, args: any) => {
    (window as any).__calls.push({ cmd, args });
    switch (cmd) {
      case "q_folder":
        return {
          path: `${DOCUMENTS}/Q`, isDefault: true, exists: true, cloud: null,
          defaultPath: `${DOCUMENTS}/Q`, homePath: "/Users/sample/Q", homeCloud: null,
        };
      case "plugin:path|join":
        return (args.paths as string[]).join("/");
      case "plugin:dialog|open":
        return (window as any).__nextOpen;
      case "plugin:event|listen":
        return 1;
      case "check_company_file":
        if (String(args.db).includes("受け取った")) throw REFUSAL;
        return null;
      case "plugin:sql|load":
        throw "（確かめ用の画面なので、会社ファイルは開きません）";
    }
    return null;
  },
  transformCallback: () => 0,
  unregisterCallback: () => {},
};
// 窓を閉じるときの知らせ（useApp.ts の tauri://close-requested）を外すところ
(window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ToastProvider>
      <MessageDialogProvider>
        <MyNumberUnlockProvider>
          <App />
        </MyNumberUnlockProvider>
      </MessageDialogProvider>
    </ToastProvider>
  </React.StrictMode>,
);
