/**
 * Q のフォルダ（バックアップ・書き出しの置き場所。src/utils/qFolder.ts・src/components/QFolderPanel.tsx・src-tauri/src/q_folder.rs）と、
 * クラウドと同期する場所の知らせを、Q の最初の画面（src/App.tsx・src/useApp.ts）で確かめる（開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/qfolder.html を開く
 * ・初めは、書類フォルダ（/Users/sample/Documents）が iCloud Drive と同期している Mac のつもり → Q のフォルダの知らせが出る
 *   - 「ホームフォルダの Q（/Users/sample/Q）にする」：Q のフォルダが /Users/sample/Q になり、知らせが消える
 *   - 「ほかの場所を選ぶ…」：窓の代わりに window.__nextPick を選ぶ（初めはクラウドのフォルダの中 → 確かめが出る）。
 *     window.__pickError に知らせを入れると、Q のフォルダにできないフォルダを選んだときの知らせが出る
 * ・「既存のファイルを開く (.qp)」：ファイルを選ぶ窓の代わりに window.__nextOpen を選ぶ（初めは書類フォルダの Q の中 → iCloud Drive の知らせ）
 *   - 「開かない」なら、確かめ（check_company_file）も開く命令（plugin:sql|load）も呼ばない
 *   - 「このまま開く」なら、確かめのあとで plugin:sql|load を呼ぶ（ここでは開かずに、開けなかったと答える）
 * ・Tauri の命令は window.__calls に残す
 */
import React from "react";
import ReactDOM from "react-dom/client";
import App from "../../src/App";
import { ToastProvider } from "../../src/components/Toast";
import { MessageDialogProvider } from "../../src/components/MessageDialog";
import { MyNumberUnlockProvider } from "../../src/features/mynumber/MyNumberUnlock";

const HOME = "/Users/sample";
const DOCUMENTS = `${HOME}/Documents`;
const w = window as any;

w.__calls = [];
w.__folder = {
  path: `${DOCUMENTS}/Q`, isDefault: true, exists: true, cloud: "iCloud Drive",
  defaultPath: `${DOCUMENTS}/Q`, homePath: `${HOME}/Q`, homeCloud: null,
};
w.__nextPick = { path: `${HOME}/Library/CloudStorage/Example-Drive/給与`, cloud: "クラウドのフォルダ" };
w.__pickError = null;
w.__nextOpen = `${DOCUMENTS}/Q/山田商店.qp`;
let picked: { path: string; cloud: string | null } | null = null;

/** Rust の側の cloud_place（書類フォルダは iCloud Drive へのリンクのつもり） */
const cloudOf = (path: string) =>
  path.startsWith(`${DOCUMENTS}/`) ? "iCloud Drive" : path.includes("/Library/CloudStorage/") ? "クラウドのフォルダ" : null;

// ── Tauri の代わり ──
w.__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
  invoke: async (cmd: string, args: any) => {
    w.__calls.push({ cmd, args });
    switch (cmd) {
      case "q_folder":
        return { ...w.__folder };
      case "pick_q_folder":
        if (w.__pickError) throw w.__pickError;
        picked = w.__nextPick;
        return picked;
      case "apply_q_folder": {
        const f = w.__folder;
        if (args.choice === "home") w.__folder = { ...f, path: f.homePath, isDefault: false, cloud: cloudOf(f.homePath) };
        else if (args.choice === "default") w.__folder = { ...f, path: f.defaultPath, isDefault: true, cloud: cloudOf(f.defaultPath) };
        else if (args.choice === "picked" && picked) w.__folder = { ...f, path: picked.path, isDefault: false, cloud: picked.cloud };
        else throw "フォルダが選ばれていません";
        return { ...w.__folder };
      }
      case "cloud_place_of":
        return cloudOf(String(args.path));
      case "plugin:path|join":
        return (args.paths as string[]).join("/");
      case "plugin:dialog|open":
        return w.__nextOpen;
      case "plugin:event|listen":
        return 1;
      case "check_company_file":
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
w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };

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
