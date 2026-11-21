// 郵便番号の検索は、Tauri の通信の部品（Rust の側）でつなぐ。Q の窓の CSP（src-tauri/tauri.conf.json）は、画面から外へ直接つなぐのを
// 止めているので、外につなぐのは src-tauri/capabilities/default.json の http:allow-fetch に書いた先だけ
import { fetch } from "@tauri-apps/plugin-http";

export const fetchAddressByZip = async (zip: string) => {
  const cleanZip = zip.replace(/[^\d]/g, "");
  if (cleanZip.length !== 7) return null;

  const response = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${cleanZip}`);
  const data = await response.json();
  return data.results ? data.results[0] : null;
};
