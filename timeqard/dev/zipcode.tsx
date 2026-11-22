/// <reference types="vite/client" />
/**
 * Q の郵便番号から住所（日本郵便の郵便番号データを Q の中で引く。src/utils/zipcode.ts）と、法人番号の「国税庁のページで調べる」
 * （src/utils/houjinBangou.ts）を、見本の画面で確かめる（開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/zipcode.html を開く
 * ・従業員の画面の基本情報（src/features/settings/staff/BasicInfoSection.tsx）：郵便番号に 100-0001 を入れて「住所検索」を押すと、
 *   住所「東京都千代田区千代田」・住所（フリガナ）「トウキョウト チヨダク チヨダ」が入る。761-4103 は「甲」「乙」を選ぶ窓が出る
 * ・最初の会社設定（src/features/settings/company/InitialSetupForm.tsx）：法人番号 7000012050002 で「国税庁のページで調べる」を押すと、
 *   国税庁の法人番号公表サイトのその番号のページを開く（ここでは開く代わりに window.__opened に残す）。本店所在地の「住所検索」
 * ・会社設定の支店（src/features/settings/company/BranchTab.tsx）の住所検索
 * データ（public/zipcode/）は、Q のアプリでは /zipcode/ にある。確かめ用の画面では、Vite の ?url で同じファイルを読む
 * （読んだファイルは window.__zipFetches に残す。外のサイトにはつながない）
 */
import { createRoot } from "react-dom/client";
import { ToastProvider } from "../../src/components/Toast";
import { MessageDialogProvider } from "../../src/components/MessageDialog";
import BasicInfoSection from "../../src/features/settings/staff/BasicInfoSection";
import InitialSetupForm from "../../src/features/settings/company/InitialSetupForm";
import BranchTab from "../../src/features/settings/company/BranchTab";
import { useCompanyManager } from "../../src/features/settings/useCompanyManager";
import { useStaffManager } from "../../src/features/settings/useStaffManager";

// ── 郵便番号のデータ：アプリの /zipcode/zipN.tsv を、リポジトリの public/zipcode/zipN.tsv に読みかえる ──
const zipUrls = import.meta.glob("../../public/zipcode/*.tsv", { query: "?url", import: "default", eager: true }) as Record<string, string>;
(window as any).__zipFetches = [];
const realFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const m = /^\/zipcode\/(zip\d\.tsv)$/.exec(url);
  if (m) {
    (window as any).__zipFetches.push(m[1]);
    return realFetch(zipUrls[`../../public/zipcode/${m[1]}`], init);
  }
  (window as any).__otherFetches = [...((window as any).__otherFetches ?? []), url];
  return realFetch(input, init);
};

// ── Tauri の代わり（確かめを出す画面は「はい」。ブラウザで開くページは window.__opened に残す） ──
(window as any).__opened = [];
(window as any).__TAURI_INTERNALS__ = {
  invoke: async (cmd: string, args: any) => {
    if (cmd === "plugin:opener|open_url") {
      (window as any).__opened.push(args?.url);
      return null;
    }
    if (cmd.startsWith("plugin:dialog|")) {
      const b = args?.buttons;
      if (b?.OkCancelCustom) return b.OkCancelCustom[0];
      if (b?.OkCustom) return b.OkCustom;
      return b === "YesNo" ? "Yes" : b === "OkCancel" ? "Ok" : true;
    }
    return null;
  },
  transformCallback: () => 0,
};

const fakeDb = {
  async select() {
    return [];
  },
  async execute() {
    return { rowsAffected: 1 };
  },
};

function Staff() {
  const cm = useStaffManager({ db: fakeDb as any, onDataChange: () => {}, staffList: [] } as any);
  (window as any).__staff = { zip: cm.targetZip, address: cm.targetAddress, kana: cm.targetAddressKana };
  return <BasicInfoSection cm={cm} />;
}

function Company() {
  const cm = useCompanyManager({ db: fakeDb as any });
  (window as any).__company = { zip: cm.compZip, pref: cm.headPref, addr: cm.compAddr, bZip: cm.bZip, bPref: cm.bPref, bAddr: cm.bAddr };
  return (
    <>
      <section id="setup" style={{ background: "white", borderRadius: 8, padding: 12 }}>
        <h2 style={{ fontSize: 16 }}>2. 最初の会社設定（法人番号・本店所在地）</h2>
        <InitialSetupForm cm={cm} />
      </section>
      <section id="branches" style={{ background: "white", borderRadius: 8, padding: 12 }}>
        <h2 style={{ fontSize: 16 }}>3. 会社設定の支店</h2>
        <BranchTab cm={cm} />
      </section>
    </>
  );
}

function Page() {
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16, maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, margin: 0 }}>郵便番号から住所・法人番号のページ（確かめ用）</h1>
      <section id="staff" style={{ background: "white", borderRadius: 8, padding: 12, maxWidth: 760 }}>
        <h2 style={{ fontSize: 16 }}>1. 従業員の画面の基本情報</h2>
        <Staff />
      </section>
      <Company />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <MessageDialogProvider>
    <ToastProvider>
      <Page />
    </ToastProvider>
  </MessageDialogProvider>,
);
