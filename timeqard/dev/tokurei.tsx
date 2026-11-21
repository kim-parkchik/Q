/**
 * Q の週44時間の特例（特例措置対象事業場。src/utils/weekly44.ts）を、見本の値で画面に出す（開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/tokurei.html を開く
 * ・会社設定の支店リスト（src/features/settings/company/BranchTab.tsx）：本店・駅前店（在籍6人）・郊外店（在籍11人）。
 *   拠点ごとに「週44時間の特例」を選ぶとすぐ保存し（window.__tokureiStore.branches）、郊外店で選ぶと10人以上の知らせが出る
 * ・給与明細（src/features/payroll/PayStubModal.tsx）：駅前店のパートの 小売 週子さん（時給1,300円）の2026年11月分。
 *   16日（月）〜21日（土）に7時間30分ずつ働いた（週45時間）。週40時間なら5時間 × 1,300円 × 25% ＝ 1,625円、
 *   駅前店を「第8号（物品の販売…）」にすると週44時間を超えた1時間だけで 325円になり、明細に特例の説明が出る
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "../../src/components/Toast";
import { MessageDialogProvider } from "../../src/components/MessageDialog";
import PayStubModal from "../../src/features/payroll/PayStubModal";
import BranchTab from "../../src/features/settings/company/BranchTab";
import { useCompanyManager } from "../../src/features/settings/useCompanyManager";
import { weekly44BusinessOf } from "../../src/utils/weekly44";

// ── Tauri の代わり（確かめを出す画面は、いつも「はい」にする） ──
(window as any).__TAURI_INTERNALS__ = {
  invoke: async (cmd: string, args: any) => {
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
(window as any).__alerts = [];
window.alert = (message?: unknown) => { (window as any).__alerts.push(String(message)); console.info("知らせ:", message); };

const company: Record<string, unknown> = {
  id: 1, name: "特例サンプル商店", prefecture: "東京都", week_start_day: 0, round_overtime: "round", round_social_ins: "currency_law", round_emp_ins: "currency_law",
};
const store = {
  branches: [
    { id: 1, name: "本店", zip_code: "1000001", prefecture: "東京都", address: "千代田区千代田1-1", health_ins_num: "", weekly44_business: null },
    { id: 2, name: "駅前店", zip_code: "1600022", prefecture: "東京都", address: "新宿区新宿3-1", health_ins_num: "", weekly44_business: null },
    { id: 3, name: "郊外店", zip_code: "1900012", prefecture: "東京都", address: "立川市曙町2-1", health_ins_num: "", weekly44_business: null },
  ] as any[],
  people: [
    { branch_id: 1, status: "active", is_executive: 1 },
    { branch_id: 1, status: "active", is_executive: 0 },
    ...Array.from({ length: 5 }, () => ({ branch_id: 2, status: "active", is_executive: 0 })),
    { branch_id: 2, status: "on_leave", is_executive: 0 },
    { branch_id: 2, status: "retired", is_executive: 0 },
    ...Array.from({ length: 11 }, () => ({ branch_id: 3, status: "active", is_executive: 0 })),
  ],
};
(window as any).__tokureiStore = store;
const group = {
  id: 1, name: "全社", closing_day: 99, is_next_month: 0, payment_day: 25, tax_calc_method: "table", social_ins_collection: "current",
  proration_method: "none", leave_proration_method: "workdays", absence_deduction_method: "workdays", tardy_deduction_method: "none",
  fixed_break: null, flex_rule: null, shutdown_allowance_rate: 60, premium_rates: null, is_active: 1,
};
const attendance = ["16", "17", "18", "19", "20", "21"].map((d) => ({
  work_date: `2026-11-${d}`, work_hours: 7.5, night_hours: 0, work_type: "normal", is_finalized: 1, actual_base_wage: 1300,
}));
const staff = {
  id: "4001", name: "小売 週子", wage_type: "hourly", base_wage: 1300, scheduled_work_hours: 7.5, standard_remuneration: 0, birthday: "1985-05-05",
  join_date: "2023-04-01", social_insurance_group_id: null, payroll_group_id: 1, branch_id: 2, calendar_pattern_id: 0, work_days: "mon,tue,wed,thu,fri,sat",
  dependents: 0, commute_type: "none", commute_amount: 0, is_employment_ins_eligible: 0, status: "active",
  prefecture: "東京", kenpoPrefecture: "東京", periodStart: "2026-11-01", periodEnd: "2026-11-30", periodLabel: "11/1〜11/30",
};

let onChanged: () => void = () => {};
const flat = (sql: string) => sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
const fakeDb = {
  async select(sql: string, params: any[] = []) {
    const q = flat(sql);
    if (q.startsWith("SELECT * FROM company WHERE id = 1")) return [company];
    if (q.startsWith("SELECT * FROM branches")) return store.branches.map((b) => ({ ...b }));
    if (q.startsWith("SELECT branch_id, status, is_executive FROM staff")) return store.people;
    if (q.startsWith("SELECT * FROM payroll_groups")) return [group];
    if (q.startsWith("SELECT tax_calc_method")) return [group];
    if (q.startsWith("SELECT payment_day FROM payroll_groups")) return [{ payment_day: 25 }];
    if (q.startsWith("SELECT closing_day, is_next_month")) return [{ closing_day: 99, is_next_month: 0, shutdown_allowance_rate: 60 }];
    if (q.startsWith("SELECT COUNT(*) AS n FROM salary_results")) return [{ n: 0 }];
    void params;
    return [];
  },
  async execute(sql: string, params: any[] = []) {
    const q = flat(sql);
    if (q.startsWith("UPDATE branches SET weekly44_business = ? WHERE id = ?")) {
      const b = store.branches.find((x) => x.id === Number(params[1]));
      if (b) b.weekly44_business = params[0];
      console.info("fakeDb: 週44時間の特例を保存した", params);
      onChanged();
    }
    return { rowsAffected: 1 };
  },
};

function Branches() {
  const cm = useCompanyManager({ db: fakeDb as any });
  return <BranchTab cm={cm} />;
}

function Page() {
  const [version, setVersion] = useState(0);
  onChanged = () => setVersion((v) => v + 1);
  const business = weekly44BusinessOf(store.branches, staff.branch_id);
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16, maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, margin: 0 }}>週44時間の特例（確かめ用）</h1>
      <section id="branches" style={{ background: "white", borderRadius: 8, padding: 12 }}>
        <h2 style={{ fontSize: 16 }}>1. 会社設定の支店リスト</h2>
        <Branches />
      </section>
      <section id="stub">
        <h2 style={{ fontSize: 16 }}>2. 給与明細（小売 週子さん・駅前店・2026年11月分）</h2>
        <div style={{ position: "relative", transform: "translateZ(0)", height: 1500, overflow: "hidden", borderRadius: 8 }}>
          <PayStubModal
            key={`stub-${version}-${business}`}
            db={fakeDb} year={2026} month={11} companySettings={company} onClose={() => {}}
            staff={{ ...staff, weekly44Business: business }}
            attendanceData={attendance}
          />
        </div>
      </section>
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
