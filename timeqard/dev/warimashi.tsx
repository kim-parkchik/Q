/**
 * Q の残業代の割増率（給与規定グループごと。src/utils/premiumRates.ts）を、見本の値で画面に出す（開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/warimashi.html を開く
 * ・会社設定の「給与規定グループ」（src/features/settings/company/PayrollGroupTab.tsx）：「全社」を「編集」すると、割増率の欄が出る。
 *   本店の36協定（特別条項）は、限度時間を超えた労働の割増率を 1か月35%・1年30% と決めているので、法律の率のままだと知らせが出る。
 *   率を入れて保存すると window.__groups に残り、下の給与明細がその率で計算し直す
 * ・給与明細（src/features/payroll/PayStubModal.tsx）：時給1,200円の 長時間 働子さんの2026年6月分（末締め当月払い）。
 *   6月1日〜16日の平日12日に12時間ずつ働いた（1日8時間を超えた4時間ずつで、時間外労働は月48時間）。
 *   36協定の起算日は2025年7月1日で、2025年7月分から2026年5月分まで毎月32時間（合わせて352時間）の時間外労働を確定している
 *   → 6月は、8時間目までが年360時間の内、それより後が年360時間を超えた分。45時間を超えた3時間は月の限度時間を超えた分
 *   法律の率なら 1,200円 × 25% × 48時間 ＝ 14,400円。1か月35%・1年30% にすると
 *   1,200円 ×（25% × 8時間 ＋ 30% × 37時間 ＋ 35% × 3時間）＝ 1,200円 × 14.15 ＝ 16,980円
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "../../src/components/Toast";
import { MessageDialogProvider } from "../../src/components/MessageDialog";
import PayStubModal from "../../src/features/payroll/PayStubModal";
import PayrollGroupTab from "../../src/features/settings/company/PayrollGroupTab";
import { useCompanyManager } from "../../src/features/settings/useCompanyManager";

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

const pad = (n: number) => String(n).padStart(2, "0");
/** 2026年6月1日〜16日の平日（12日）に12時間ずつ */
const WORK_DAYS = Array.from({ length: 16 }, (_, i) => `2026-06-${pad(i + 1)}`)
  .filter((d) => { const w = new Date(`${d}T00:00:00`).getDay(); return w >= 1 && w <= 5; });
const attendance = WORK_DAYS.map((d) => ({ work_date: d, work_hours: 12, night_hours: 0, work_type: "normal", is_finalized: 1, actual_base_wage: 1200 }));

const kyotei36 = JSON.stringify({
  1: {
    businessType: "その他の各種事業", periodFrom: "2025-07-01", periodTo: "2026-06-30", startDate: "2025-07-01",
    overtime: [{ reason: "受注の集中", work: "事務", workers: "5", day: "4", dayPrescribed: "", month: "45", monthPrescribed: "", year: "360", yearPrescribed: "" }],
    holiday: [], special: true, specialCases: "決算",
    specialRows: [{ work: "事務", workers: "5", day: "", dayPrescribed: "", times: "6", month: "80", monthPrescribed: "", monthRate: "35", year: "600", yearPrescribed: "", yearRate: "30" }],
    procedure: "", measureNumbers: "", measureDetail: "", agreedOn: "", partyUnion: "", partyTitle: "", partyName: "", selectionMethod: "",
    submittedOn: "", employerTitle: "", employerName: "", office: "",
  },
});
const company: Record<string, unknown> = {
  id: 1, name: "割増サンプル株式会社", week_start_day: 0, round_overtime: "round", round_social_ins: "currency_law", round_emp_ins: "currency_law", kyotei36,
};
const branches = [{ id: 1, name: "本店", prefecture: "東京都", health_ins_num: "" }];
const groups: any[] = [{
  id: 1, name: "全社", closing_day: 99, is_next_month: 0, payment_day: 25, tax_calc_method: "table", social_ins_collection: "current",
  proration_method: "none", leave_proration_method: "workdays", absence_deduction_method: "workdays", tardy_deduction_method: "none",
  fixed_break: null, flex_rule: null, shutdown_allowance_rate: 60, premium_rates: null, is_active: 1,
}];
(window as any).__groups = groups;
/** 2025年7月分〜2026年5月分の確定した給与（毎月32時間の時間外労働） */
const pastSalaries = Array.from({ length: 11 }, (_, i) => {
  const y = i < 6 ? 2025 : 2026;
  const m = i < 6 ? 7 + i : i - 5;
  const end = `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`;
  return { target_year: y, target_month: m, total_overtime_hours: 32, ledger: JSON.stringify({ periodStart: `${y}-${pad(m)}-01`, periodEnd: end, overtimeHours: 32, earnings: [], deductions: [] }) };
});

const staff = {
  id: "5001", name: "長時間 働子", wage_type: "hourly", base_wage: 1200, scheduled_work_hours: 8, standard_remuneration: 0, birthday: "1990-05-05",
  join_date: "2020-04-01", social_insurance_group_id: 1, payroll_group_id: 1, branch_id: 1, calendar_pattern_id: 0, work_days: "mon,tue,wed,thu,fri",
  dependents: 0, commute_type: "none", commute_amount: 0, is_employment_ins_eligible: 1, status: "active",
  prefecture: "東京", kenpoPrefecture: "東京", periodStart: "2026-06-01", periodEnd: "2026-06-30", periodLabel: "6/1〜6/30",
};

let onGroupsChanged: () => void = () => {};
const fakeDb = {
  async select(sql: string, params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT * FROM company WHERE id = 1")) return [company];
    if (q.startsWith("SELECT * FROM branches")) return branches;
    if (q.startsWith("SELECT * FROM payroll_groups")) return groups;
    if (q.startsWith("SELECT COUNT(*) as count FROM staff")) return [{ count: 1 }];
    if (q.startsWith("SELECT COUNT(*) AS n FROM salary_results")) return [{ n: 0 }];
    if (q.startsWith("SELECT id, name, type, union_office_number, union_media_seq FROM social_insurance_groups")) {
      return [{ id: 1, name: "協会けんぽ", type: "kyokai", union_office_number: null, union_media_seq: 0 }];
    }
    if (q.startsWith("SELECT tax_calc_method")) return [groups[0]];
    if (q.startsWith("SELECT payment_day FROM payroll_groups")) return [{ payment_day: 25 }];
    if (q.startsWith("SELECT closing_day, is_next_month")) return [{ closing_day: 99, is_next_month: 0, shutdown_allowance_rate: 60 }];
    if (q.startsWith("SELECT target_year, target_month, ledger, total_overtime_hours FROM salary_results WHERE staff_id = ?")) return params[0] === "5001" ? pastSalaries : [];
    return [];
  },
  async execute(sql: string, params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("UPDATE payroll_groups SET")) {
      const cols = /SET (.*) WHERE id=\?/.exec(q)?.[1].split(",").map((c) => c.trim().replace(/=\?$/, "")) ?? [];
      const g = groups.find((x) => x.id === params[params.length - 1]);
      if (g) cols.forEach((c, i) => { g[c] = params[i]; });
      onGroupsChanged();
    }
    return { rowsAffected: 1 };
  },
};

function GroupTab() {
  const cm = useCompanyManager({ db: fakeDb as any });
  return <PayrollGroupTab cm={cm} />;
}

function Page() {
  const [version, setVersion] = useState(0);
  onGroupsChanged = () => setVersion((v) => v + 1);
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16, maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, margin: 0 }}>残業代の割増率（確かめ用）</h1>
      <section id="groups" style={{ background: "white", borderRadius: 8, padding: 12 }}>
        <h2 style={{ fontSize: 16 }}>1. 会社設定の「給与規定グループ」</h2>
        <GroupTab />
      </section>
      <section>
        <h2 style={{ fontSize: 16 }}>2. 給与明細（長時間 働子さん・2026年6月分）</h2>
        <div style={{ position: "relative", transform: "translateZ(0)", height: 1500, overflow: "hidden", borderRadius: 8 }}>
          <PayStubModal
            key={`stub-${version}`}
            db={fakeDb} year={2026} month={6} companySettings={company} onClose={() => {}}
            staff={staff}
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
