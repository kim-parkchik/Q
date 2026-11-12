/**
 * TimeQard の画面を、ブラウザで確かめるためのもの（開発用。配るものには入らない）
 *
 * 使い方：bun run --bun vite --config timeqard/dev/vite.preview.config.ts を動かし、
 *         ブラウザで http://localhost:1432/dev/preview.html を開く
 *
 * ・記録のファイルの代わりに dev/fakeStore.ts（ブラウザの中の配列）を使う（vite.preview.config.ts で入れ替える）。
 * ・パソコンとのやりとり（Tauri）は、@tauri-apps/api/mocks で受ける。パスワードは確かめ用の簡単な形にする（本物は Rust の Argon2）。
 * ・「ファイルを選ぶ」窓では、ここで作った確かめ用の従業員ファイル（3人）を選んだことにする。
 *   カードの QR コードの中身は、開発者の道具の Console に出す（その文字を打って Enter を押すと、USB の読み取り機でかざしたのと同じ）。
 * ・書き出した CSV は window.__timeqardPreview.lastExport に入る。確かめの窓（ask）は、いつも「はい」を押したことにする。
 */
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { buildStaffFile, cardHash, cardPayload, jstIso, serializeStaffFile } from "../../shared/timeqard";

const MARK = "K7M3QP2X";
const CARDS: Record<string, string> = {
  "1001": "AAAAAAAAAAAAAAAAAAAAAAAAAA",
  "1002": "BBBBBBBBBBBBBBBBBBBBBBBBBB",
};

const staffFile = buildStaffFile({
  companyName: "確かめ用株式会社",
  companyMark: MARK,
  exportedAt: jstIso(Date.now() - 60 * 60 * 1000),
  staff: [
    { id: "1001", name: "山田 太郎", join_date: "2019-04-01" },
    { id: "1002", name: "佐藤 花子", join_date: "2020-04-01" },
    { id: "1003", name: "鈴木 一郎", join_date: "2099-04-01" },
  ],
  cardHashesByStaff: new Map(await Promise.all(Object.entries(CARDS).map(async ([id, n]) => [id, [await cardHash(n)]] as [string, string[]]))),
});
const staffBytes = [...new TextEncoder().encode(serializeStaffFile(staffFile))];

const preview: Record<string, unknown> = ((window as any).__timeqardPreview ??= {});
preview.cards = Object.fromEntries(Object.entries(CARDS).map(([id, n]) => [id, cardPayload(MARK, n)]));
preview.otherCompanyCard = cardPayload("ABCD2345", CARDS["1001"]);
console.info("[確かめ用] カード", preview.cards, "ほかの会社のカード", preview.otherCompanyCard);

let autostart = false;
let webRunning = false;
const webStatusOf = (port: number) => ({
  running: true,
  port,
  urls: [`https://192.168.0.10:${port}/`],
  caName: "TimeQard 会社専用の証明書（2026-11-12）",
  sha256: "12:34:56:78:9A:BC:DE:F0:12:34:56:78:9A:BC:DE:F0:12:34:56:78:9A:BC:DE:F0:12:34:56:78:9A:BC:DE:F0",
  sha1: "12:34:56:78:9A:BC:DE:F0:12:34:56:78:9A:BC:DE:F0:12:34:56:78",
});

mockWindows("main");
mockIPC(
  async (cmd, args: any) => {
    switch (cmd) {
      case "plugin:sql|load":
        return args.db;
      case "plugin:sql|execute":
        return [0, 0]; // 控え（VACUUM INTO）など。記録は fakeStore.ts が持つ
      case "plugin:sql|select":
        return [];
      case "hash_password":
        return `preview:${args.password}`;
      case "verify_password":
        return args.hash === `preview:${args.password}`;
      case "quit_app":
        document.body.innerHTML = "<h1 style='font-family:sans-serif'>TimeQard を閉じました（確かめ用）</h1>";
        return null;
      case "get_autostart":
        return autostart;
      case "set_autostart":
        autostart = args.enabled;
        return null;
      case "data_dir":
        return "（確かめ用）";
      case "prune_backups":
        return 0;
      case "plugin:path|join":
        return args.paths.join("/");
      case "plugin:dialog|open":
        return args.options?.directory ? "/確かめ用/控え" : "/確かめ用/確かめ用株式会社_TimeQard従業員.json";
      case "plugin:dialog|save":
        return `/確かめ用/${args.options?.defaultPath ?? "out.csv"}`;
      case "plugin:dialog|message": {
        console.info("[確かめ用] 確かめの窓", args.title, args.message);
        const custom = args.buttons?.OkCancelCustom;
        return custom ? custom[0] : "Yes";
      }
      case "plugin:fs|read_text_file":
        return staffBytes;
      case "plugin:fs|write_file":
        preview.lastExport = new TextDecoder().decode(args as Uint8Array);
        return null;
      case "plugin:window|set_fullscreen":
        return null;
      // ブラウザ版（確かめ用の画面では、サーバーは動かさない。ブラウザの画面は dev/web-preview.html で確かめる）
      case "web_start":
        webRunning = true;
        return webStatusOf(args.port);
      case "web_stop":
        webRunning = false;
        return null;
      case "web_status":
        return webRunning ? webStatusOf(8443) : { running: false, port: 0, urls: [], caName: "", sha256: "", sha1: "" };
      case "web_respond":
        return null;
      case "web_ca_der":
        return [0x30, 0x82, 0x01, 0x00];
      default:
        console.warn("[確かめ用] 知らない呼び出し", cmd, args);
        return null;
    }
  },
  { shouldMockEvents: true }
);

await import("../src/main");
