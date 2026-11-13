/**
 * Q の振込データ（全銀協規定形式）の画面を、見本の値で画面に出す（開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/furikomi.html を開く
 * ・会社設定の「振込元口座」タブ（src/features/settings/company/TransferSourceTab.tsx）：会社ファイルの代わりに、ページの中の表（fakeDb）に保存する
 * ・「振込データ」の画面（src/features/payroll/TransferDataManager.tsx）：見本の4人（口座1つ・固定額と残りの2つ・口座なし（現金）・
 *   名義に漢字（パートのグループ））の2026年11月支給の給与と、冬季賞与。「中身を見る」でファイルの中身（1レコード120バイト）を出す
 */
import { createRoot } from "react-dom/client";
import { ToastProvider } from "../../src/components/Toast";
import { MessageDialogProvider } from "../../src/components/MessageDialog";
import TransferSourceTab from "../../src/features/settings/company/TransferSourceTab";
import TransferDataManager from "../../src/features/payroll/TransferDataManager";

// ── Tauri の代わり（確かめを出す画面は、いつも「はい」にする。保存の窓は開かない） ──
(window as any).__TAURI_INTERNALS__ = {
  invoke: async (cmd: string, args: any) => {
    if (cmd.startsWith("plugin:dialog|")) {
      console.info("確かめ（自動で「はい」）:", args?.message);
      const b = args?.buttons;
      if (b?.OkCancelCustom) return b.OkCancelCustom[0];
      if (b?.OkCustom) return b.OkCustom;
      return b === "YesNo" ? "Yes" : b === "OkCancel" ? "Ok" : true;
    }
    return null;
  },
  transformCallback: () => 0,
};

const store = {
  sources: [
    {
      id: 1, label: "給与用 三菱UFJ 本店", client_code: "1234567890", client_name: "ｶ)ﾔﾏﾀﾞｼﾖｳﾃﾝ", bank_code: "0005", bank_name: "ﾐﾂﾋﾞｼﾕ-ｴﾌｼﾞｴｲ",
      branch_code: "001", branch_name: "ﾎﾝﾃﾝ", account_type: "ordinary", account_number: "1234567", sort_order: 0, is_active: 1,
    },
  ] as any[],
  groups: [{ id: 1, name: "全社共通規定", payment_day: 25 }, { id: 2, name: "パート", payment_day: 99 }],
  bonuses: [{ id: 1, name: "冬季賞与", target_year: 2026, target_month: 12, payment_date: "2026-12-10", is_closed: 1 }],
  accounts: [
    { staff_id: "1001", seq: 1, bank_code: "0009", bank_name: "ﾐﾂｲｽﾐﾄﾓ", branch_code: "123", branch_name: "ｼﾌﾞﾔ", account_type: "ordinary", account_number: "1234", holder_name: "ﾔﾏﾀﾞ ﾀﾛｳ", fixed_amount: null },
    { staff_id: "1002", seq: 1, bank_code: "9900", bank_name: "ﾕｳﾁﾖ", branch_code: "018", branch_name: "", account_type: "ordinary", account_number: "1234567", holder_name: "ｻﾄｳ ﾊﾅｺ", fixed_amount: 30000 },
    { staff_id: "1002", seq: 2, bank_code: "0005", bank_name: "ﾐﾂﾋﾞｼﾕ-ｴﾌｼﾞｴｲ", branch_code: "250", branch_name: "ｼﾝｼﾞﾕｸ", account_type: "ordinary", account_number: "7654321", holder_name: "ｻﾄｳ ﾊﾅｺ", fixed_amount: null },
    { staff_id: "1004", seq: 1, bank_code: "0001", bank_name: "ﾐｽﾞﾎ", branch_code: "100", branch_name: "ﾄｳｷﾖｳ", account_type: "ordinary", account_number: "1111111", holder_name: "田中 一郎", fixed_amount: null },
  ] as any[],
  salaries: { "2026-11": [["1001", 245000], ["1002", 180500], ["1003", 150000], ["1004", 98000]] } as Record<string, [string, number][]>,
  bonusResults: { 1: [["1001", 400000], ["1002", 300000]] } as Record<number, [string, number][]>,
};
(window as any).__furikomiStore = store;

const fakeDb = {
  async select(sql: string, params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT * FROM transfer_source_accounts")) return [...store.sources].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    if (q.startsWith("SELECT id, name, payment_day FROM payroll_groups")) return store.groups;
    if (q.startsWith("SELECT id, name, target_year, target_month, payment_date, is_closed FROM bonus_settings")) return store.bonuses;
    if (q.startsWith("SELECT * FROM staff_bank_accounts")) return store.accounts;
    if (q.startsWith("SELECT staff_id, net_pay FROM salary_results")) {
      const key = `${params[0]}-${String(params[1]).padStart(2, "0")}`;
      return (store.salaries[key] ?? []).map(([staff_id, net_pay]) => ({ staff_id, net_pay }));
    }
    if (q.startsWith("SELECT staff_id, net_pay FROM bonus_results")) return (store.bonusResults[Number(params[0])] ?? []).map(([staff_id, net_pay]) => ({ staff_id, net_pay }));
    console.warn("fakeDb: 知らない SELECT", q, params);
    return [];
  },
  async execute(sql: string, params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("INSERT INTO transfer_source_accounts")) {
      const [label, client_code, client_name, bank_code, bank_name, branch_code, branch_name, account_type, account_number, sort_order] = params;
      store.sources.push({ id: Math.max(0, ...store.sources.map((s) => s.id)) + 1, label, client_code, client_name, bank_code, bank_name, branch_code, branch_name, account_type, account_number, sort_order, is_active: 1 });
    } else if (q.startsWith("UPDATE transfer_source_accounts SET label")) {
      const [label, client_code, client_name, bank_code, bank_name, branch_code, branch_name, account_type, account_number, id] = params;
      Object.assign(store.sources.find((s) => s.id === Number(id)), { label, client_code, client_name, bank_code, bank_name, branch_code, branch_name, account_type, account_number });
    } else if (q.startsWith("UPDATE transfer_source_accounts SET is_active")) {
      store.sources.find((s) => s.id === Number(params[1])).is_active = Number(params[0]);
    } else if (!q.startsWith("INSERT INTO app_logs")) {
      console.warn("fakeDb: 知らない EXECUTE", q, params);
    }
    return { rowsAffected: 1 };
  },
};

const staffList = [
  { id: "1001", name: "山田 太郎（口座1つ）", payroll_group_id: 1, status: "active" },
  { id: "1002", name: "佐藤 花子（固定額3万円と残り）", payroll_group_id: 1, status: "active" },
  { id: "1003", name: "鈴木 一郎（口座なし）", payroll_group_id: 1, status: "active" },
  { id: "1004", name: "田中 一郎（名義に漢字）", payroll_group_id: 2, status: "active" },
];

function Page() {
  return (
    <ToastProvider>
      <MessageDialogProvider>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: 20 }}>
          <h2>会社設定の「振込元口座」</h2>
          <TransferSourceTab db={fakeDb as any} />
          <h2 style={{ marginTop: 30 }}>振込データ</h2>
          <TransferDataManager db={fakeDb as any} staffList={staffList} />
        </div>
      </MessageDialogProvider>
    </ToastProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Page />);
