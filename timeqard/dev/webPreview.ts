/**
 * ブラウザ版の画面（src/web/）を、入口のパソコンなしで確かめるためのもの（開発用。配るものには入らない）
 *
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/web-preview.html を開く
 *
 * ・ブラウザの頼み（fetch の /api/…）を、入口のパソコンの代わりに、ここで src/webApi.ts に渡す
 *   （本物は Rust のサーバー（src-tauri/src/web.rs）が、入口のパソコンの画面に渡す）。
 * ・記録は dev/fakeStore.ts（ブラウザの中の配列）。パスワードは確かめ用の簡単な形にする（本物は Rust の Argon2）。
 * ・はじめから入っている人：
 *     1001 山田 太郎：はじめのパスワード「hajime-1001」（ログインすると、自分のパスワードに変える画面が出る）
 *     1002 佐藤 花子：自分で決めたパスワード「sato-2026」
 *     1003 鈴木 一郎：パスワードなし
 *   管理のパスワード：「kanri1234」
 */
import { buildStaffFile, jstIso } from "../../shared/timeqard";
import { createWebApi } from "../src/webApi";
import * as store from "./fakeStore";

const MARK = "K7M3QP2X";
const db = {} as store.KioskDb;
const IP = "192.168.0.50";

await store.applyStaffFile(
  db,
  buildStaffFile({
    companyName: "確かめ用株式会社",
    companyMark: MARK,
    exportedAt: jstIso(Date.now() - 60 * 60 * 1000),
    staff: [
      { id: "1001", name: "山田 太郎", join_date: "2019-04-01" },
      { id: "1002", name: "佐藤 花子", join_date: "2020-04-01" },
      { id: "1003", name: "鈴木 一郎", join_date: "2021-04-01" },
    ],
    cardHashesByStaff: new Map(),
  }),
  jstIso(Date.now())
);
await store.setSetting(db, "admin_password_hash", "preview:kanri1234");
await store.setSetting(db, "web_enabled", "1");

const api = createWebApi({
  db,
  hash: async (pw) => `preview:${pw}`,
  verify: async (pw, h) => h === `preview:${pw}`,
});
await api.issueInitialPassword("1001", "hajime-1001");
await store.saveWebPassword(db, { companyMark: MARK, staffId: "1002", passwordHash: "preview:sato-2026", initial: false, initialExpiresMs: null, at: Date.now() });

Object.assign(((window as any).__timeqardPreview ??= {}), { webApi: api });

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = new URL(url, window.location.href).pathname;
  if (path === "/api/cert-info") {
    return new Response(
      JSON.stringify({
        caName: "TimeQard 会社専用の証明書（2026-11-12）",
        sha256: "12:34:56:78:9A:BC:DE:F0:12:34:56:78:9A:BC:DE:F0:12:34:56:78:9A:BC:DE:F0:12:34:56:78:9A:BC:DE:F0",
        sha1: "12:34:56:78:9A:BC:DE:F0:12:34:56:78:9A:BC:DE:F0:12:34:56:78",
        fileName: "TimeQard-CA.cer",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
  if (path.startsWith("/api/")) {
    const answer = await api.handle(path.slice(5), typeof init?.body === "string" ? init.body : "", IP);
    console.info("[確かめ用] ブラウザの頼み", path, answer.status);
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "Content-Type": "application/json" } });
  }
  return realFetch(input, init);
};

await import("../src/web/main");
