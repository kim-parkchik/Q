/**
 * Q の「賞与支払届」の画面（src/features/payroll/BonusReportManager.tsx）を、見本の値で画面に出す（開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/shoyo.html を開く
 * 会社：株式会社健保産業（東京都。事業所整理記号 57-ケマ・事業所番号 12345。前に作ったファイルの媒体通番は 023）
 * 2026年12月10日の冬季賞与（確定）と、12月25日の決算賞与（確定。田中さんだけ）、12月28日の臨時賞与（未確定）、11月30日の寸志（確定）
 *   山田さん：ふつうの人（整理番号3・40万円）。冬季賞与は、現物で渡す支給項目の自社製品3万円と合わせて43万円（㋐通貨 400,000・㋑現物 30,000）
 *   佐藤さん：育児休業中（保険料は免除だが届け出る）
 *   鈴木さん：1956年12月5日生まれ（12月4日に70歳に達したので、70歳以上被用者。基礎年金番号 1234-567890）
 *   田中さん：冬季賞与 250,500円（12月10日）と決算賞与 100,000円（12月25日）→ 合わせて 350,500円・賞与額 350,000円・初回支払日 10日
 *   髙橋さん：氏名に「髙」（届書に書けないので漢字の氏名は書かない。カナで届く）・二以上事業所勤務者
 *   パートの人：社会保険に入っていない（届け出ない）
 *   退職した人：11月30日に退職（12月10日の賞与は届け出ない）
 *   寸志（11月30日）：整理番号がない人・フリガナにスペースがない人（直すところがあるので、ファイルを作れない）
 * 賞与支払予定月は7月・12月（7月は賞与を払っていないので、賞与不支給報告書を出す。12月は冬季賞与を払った）
 * 「電子申請用のファイルを保存」で保存の窓の代わりに、保存したバイトを window.__savedFile に入れる
 * 上には会社設定（CompanyInfoTab.tsx）の「社会保険 事業所整理記号・事業所番号」の欄を出す（保存すると、下の届書に使う）
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MyNumberUnlockProvider } from "../../src/features/mynumber/MyNumberUnlock";
import { ToastProvider } from "../../src/components/Toast";
import { MessageDialogProvider } from "../../src/components/MessageDialog";
import BonusReportManager from "../../src/features/payroll/BonusReportManager";
import CompanyInfoTab from "../../src/features/settings/company/CompanyInfoTab";

// ── Tauri の代わり（保存の窓は開かず、保存したバイトを残す） ──
(window as any).__TAURI_INTERNALS__ = {
  invoke: async (cmd: string, args: any, options: any) => {
    if (cmd === "plugin:dialog|save") return `/tmp/${args?.options?.defaultPath ?? "SHFD0006.CSV"}`;
    if (cmd === "plugin:fs|write_file") {
      (window as any).__savedFile = { bytes: args instanceof Uint8Array ? args : new Uint8Array(args), headers: options?.headers };
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

const staff = (o: Record<string, unknown>) => ({ standard_remuneration: 300000, join_date: "2015-04-01", social_insurance_group_id: 1, ...o });
const store = {
  company: {
    id: 1, name: "株式会社健保産業", zip_code: "168-8505", address: "東京都杉並区高井戸3-5-24", phone: "03-2345-6789",
    representative: "健保 良一", shaho_office_symbol: "57-ケマ", shaho_office_number: "12345", shaho_media_seq: 23,
    bonus_plan_months: "7,12" as string | null,
  },
  staff: [
    staff({ id: "1001", name: "山田 太郎", furigana: "ヤマダ タロウ", birthday: "1985-04-10", pension_num: "3" }),
    staff({ id: "1002", name: "佐藤 花子", furigana: "さとう はなこ", birthday: "1992-08-20", pension_num: "5",
      leave_periods: JSON.stringify([{ type: "childcare", start: "2026-10-01", end: "2027-09-30" }]) }),
    staff({ id: "1003", name: "鈴木 一郎", furigana: "スズキ イチロウ", birthday: "1956-12-05", pension_num: "8", basic_pension_number: "1234-567890" }),
    staff({ id: "1004", name: "田中 次郎", furigana: "タナカ ジロウ", birthday: "1975-01-15", pension_num: "12" }),
    staff({ id: "1005", name: "髙橋 三郎", furigana: "タカハシ サブロウ", birthday: "1980-06-30", pension_num: "15", multi_office: 1 }),
    staff({ id: "1006", name: "小林 パート", furigana: "コバヤシ パート", birthday: "1990-03-03", pension_num: "", standard_remuneration: 0 }),
    staff({ id: "1007", name: "中村 退職", furigana: "ナカムラ タイショク", birthday: "1970-09-09", pension_num: "20", retirement_date: "2026-11-30" }),
    staff({ id: "1008", name: "加藤 番号なし", furigana: "カトウバンゴウナシ", birthday: "1995-05-05", pension_num: "" }),
  ] as any[],
  bonuses: [
    { id: 1, name: "冬季賞与", target_year: 2026, target_month: 12, payment_date: "2026-12-10" },
    { id: 2, name: "決算賞与", target_year: 2026, target_month: 12, payment_date: "2026-12-25" },
    { id: 3, name: "寸志", target_year: 2026, target_month: 11, payment_date: "2026-11-30" },
    { id: 4, name: "臨時賞与", target_year: 2026, target_month: 12, payment_date: "2026-12-28" },
  ],
  results: [
    [1, "1001", 430000, 30000], [1, "1002", 150000], [1, "1003", 300000], [1, "1004", 250500], [1, "1005", 280000], [1, "1006", 50000], [1, "1007", 200000],
    [2, "1004", 100000],
    [3, "1001", 30000], [3, "1008", 30000],
  ] as [number, string, number, number?][],
};
(window as any).__shoyoStore = store;

const fakeDb = {
  async select(sql: string, params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT * FROM company WHERE id = 1")) return [store.company];
    if (q.startsWith("SELECT prefecture FROM branches WHERE id = 1")) return [{ prefecture: "東京都" }];
    if (q.startsWith("SELECT * FROM staff")) return store.staff;
    if (q.startsWith("SELECT id, name, type, union_office_number, union_media_seq FROM social_insurance_groups")) return [{ id: 1, name: "協会けんぽ", type: "kyokai" }];
    if (q.startsWith("SELECT group_id, from_month")) return [];
    if (q.startsWith("SELECT s.id, s.name, s.target_year")) {
      return [...store.bonuses]
        .sort((a, b) => b.payment_date.localeCompare(a.payment_date) || b.id - a.id)
        .map((b) => ({ ...b, finalized: store.results.filter((r) => r[0] === b.id).length }));
    }
    if (q.startsWith("SELECT r.bonus_setting_id AS settingId")) {
      return store.results
        .map(([settingId, staffId, totalEarnings, inKind]) => ({ settingId, staffId, totalEarnings, inKind: inKind ?? 0, b: store.bonuses.find((b) => b.id === settingId)! }))
        .filter((r) => r.b.payment_date.slice(0, String(params[0]).length) === params[0])
        .map((r) => ({ settingId: r.settingId, name: r.b.name, paymentDate: r.b.payment_date, staffId: r.staffId, totalEarnings: r.totalEarnings, inKind: r.inKind }));
    }
    console.warn("fakeDb: 知らない SELECT", q, params);
    return [];
  },
  async execute(sql: string, params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("UPDATE company SET shaho_media_seq")) store.company.shaho_media_seq = Number(params[0]);
    else if (q.startsWith("UPDATE company SET bonus_plan_months")) store.company.bonus_plan_months = params[0];
    else if (!q.startsWith("INSERT INTO app_logs")) console.warn("fakeDb: 知らない EXECUTE", q, params);
    return { rowsAffected: 1 };
  },
};

/** 会社設定の画面（useCompanyManager の代わり。事業所整理記号・事業所番号だけ値を持ち、保存すると届書に使う） */
function Page() {
  const [symbol, setSymbol] = useState(store.company.shaho_office_symbol);
  const [number, setNumber] = useState(store.company.shaho_office_number);
  const [key, setKey] = useState(0);
  const values: Record<string, unknown> = {
    hasSavedOnce: true, compName: store.company.name, compZip: store.company.zip_code, compAddr: store.company.address, compPhone: store.company.phone,
    compNum: "1234567890123", compRep: store.company.representative, compShahoSymbol: symbol, setCompShahoSymbol: setSymbol,
    compShahoNumber: number, setCompShahoNumber: setNumber, compLabor: "13-1-01-123456-000", headPref: "東京都", weekStartDay: 0,
    isSaving: false, isInfoDirty: symbol !== store.company.shaho_office_symbol || number !== store.company.shaho_office_number,
    isSearchingZip: false, isWeekStartEditable: false, isSmallBusiness: true, hourlyLeave: false, halfDayLeave: true, isSearchingComp: false,
    saveCompany: () => { Object.assign(store.company, { shaho_office_symbol: symbol, shaho_office_number: number }); setKey((k) => k + 1); },
  };
  const cm = new Proxy(values, { get: (t, p: string) => (p in t ? t[p] : () => {}) }) as any;
  return (
    <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 20 }}>
      <div id="company"><CompanyInfoTab cm={cm} /></div>
      <BonusReportManager key={key} db={fakeDb as any} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <ToastProvider>
    <MessageDialogProvider>
      <MyNumberUnlockProvider>
        <Page />
      </MyNumberUnlockProvider>
    </MessageDialogProvider>
  </ToastProvider>,
);
