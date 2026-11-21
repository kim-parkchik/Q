/**
 * Q の固定残業代の日割り（給与規定グループの「固定残業代の日割り」。src/utils/calcSalary.ts の fixedOvertimeProration）を、
 * 見本の値で画面に出す（開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/koteizan.html を開く
 * ・会社設定の「給与規定グループ」（src/features/settings/company/PayrollGroupTab.tsx）：「全社」を「編集」すると、
 *   「固定残業代の日割り」の欄が出る（初めは「日割りしない（満額を払う）」）。選んで保存すると window.__groups に残り、下の給与明細が計算し直す
 * ・給与明細（src/features/payroll/PayStubModal.tsx）：2026年6月分（末締め当月払い。会社カレンダーは月〜金。6月の所定労働日は22日）
 *   - 入社 太郎さん：月給 300,000円・固定残業代 50,000円（20時間分）。6月16日（火）に入社して、所定労働日数で日割り（11日 ÷ 22日）。
 *     16〜18日に12時間ずつ働いた（1日8時間を超えた4時間 × 3日 ＝ 時間外労働12時間）
 *     → 日割りしないなら 基本給 150,000円・固定残業代 50,000円（超過分なし）
 *     → 日割りするなら 固定残業代 25,000円 と、法定の割増賃金が 25,000円を超えた分の超過分
 *   - 休職 花子さん：月給 280,000円・固定残業代 40,000円（15時間分）。6月16日から休職（その他の休職）。休業の月は所定労働日数で日割り
 *     → 日割りしないなら 固定残業代 40,000円、日割りするなら 20,000円
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

const company: Record<string, unknown> = {
  id: 1, name: "日割りサンプル株式会社", week_start_day: 0, round_overtime: "round", round_social_ins: "currency_law", round_emp_ins: "currency_law",
};
const branches = [{ id: 1, name: "本店", prefecture: "東京都", health_ins_num: "" }];
const groups: any[] = [{
  id: 1, name: "全社", closing_day: 99, is_next_month: 0, payment_day: 25, tax_calc_method: "table", social_ins_collection: "current",
  proration_method: "workdays", leave_proration_method: "workdays", fixed_overtime_proration: 0, absence_deduction_method: "workdays", tardy_deduction_method: "none",
  fixed_break: null, flex_rule: null, shutdown_allowance_rate: 60, premium_rates: null, is_active: 1,
}];
(window as any).__groups = groups;

const common = {
  wage_type: "monthly", scheduled_work_hours: 8, birthday: "1990-05-05", social_insurance_group_id: 1, payroll_group_id: 1, branch_id: 1,
  calendar_pattern_id: 0, work_days: "mon,tue,wed,thu,fri", dependents: 0, commute_type: "none", commute_amount: 0, is_employment_ins_eligible: 1,
  status: "active", prefecture: "東京", kenpoPrefecture: "東京", periodStart: "2026-06-01", periodEnd: "2026-06-30", periodLabel: "6/1〜6/30",
};
const joined = {
  ...common, id: "6001", name: "入社 太郎", base_wage: 300000, standard_remuneration: 300000, join_date: "2026-06-16",
  fixed_overtime_allowance: 50000, fixed_overtime_hours: 20,
};
const onLeave = {
  ...common, id: "6002", name: "休職 花子", base_wage: 280000, standard_remuneration: 280000, join_date: "2020-04-01",
  fixed_overtime_allowance: 40000, fixed_overtime_hours: 15,
  leave_periods: JSON.stringify([{ type: "other", start: "2026-06-16", end: "2026-09-30" }]),
};
const joinedAttendance = ["16", "17", "18"].map((d) => ({ work_date: `2026-06-${d}`, work_hours: 12, night_hours: 0, work_type: "normal", is_finalized: 1 }));
const leaveAttendance = ["01", "02", "03", "04", "05", "08", "09", "10", "11", "12", "15"]
  .map((d) => ({ work_date: `2026-06-${d}`, work_hours: 8, night_hours: 0, work_type: "normal", is_finalized: 1 }));

let onGroupsChanged: () => void = () => {};
const fakeDb = {
  async select(sql: string) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT * FROM company WHERE id = 1")) return [company];
    if (q.startsWith("SELECT * FROM branches")) return branches;
    if (q.startsWith("SELECT * FROM payroll_groups")) return groups;
    if (q.startsWith("SELECT COUNT(*) as count FROM staff")) return [{ count: 2 }];
    if (q.startsWith("SELECT COUNT(*) AS n FROM salary_results")) return [{ n: 0 }];
    if (q.startsWith("SELECT id, name, type, union_office_number, union_media_seq FROM social_insurance_groups")) {
      return [{ id: 1, name: "協会けんぽ", type: "kyokai", union_office_number: null, union_media_seq: 0 }];
    }
    if (q.startsWith("SELECT tax_calc_method")) return [groups[0]];
    if (q.startsWith("SELECT payment_day FROM payroll_groups")) return [{ payment_day: 25 }];
    if (q.startsWith("SELECT closing_day, is_next_month")) return [{ closing_day: 99, is_next_month: 0, shutdown_allowance_rate: 60 }];
    return [];
  },
  async execute(sql: string, params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("UPDATE payroll_groups SET")) {
      const cols = /SET (.*) WHERE id=\?/.exec(q)?.[1].split(",").map((c) => c.trim().replace(/=\?$/, "")) ?? [];
      const g = groups.find((x) => x.id === params[params.length - 1]);
      if (g) cols.forEach((c, i) => { g[c] = params[i]; });
      console.info("fakeDb: 給与規定グループを保存した", { fixed_overtime_proration: g?.fixed_overtime_proration });
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
  const stub = (id: string, title: string, staff: any, attendance: any[]) => (
    <section id={id}>
      <h2 style={{ fontSize: 16 }}>{title}</h2>
      <div style={{ position: "relative", transform: "translateZ(0)", height: 1500, overflow: "hidden", borderRadius: 8 }}>
        <PayStubModal
          key={`${id}-${version}`}
          db={fakeDb} year={2026} month={6} companySettings={company} onClose={() => {}}
          staff={staff}
          attendanceData={attendance}
        />
      </div>
    </section>
  );
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16, maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, margin: 0 }}>固定残業代の日割り（確かめ用）</h1>
      <section id="groups" style={{ background: "white", borderRadius: 8, padding: 12 }}>
        <h2 style={{ fontSize: 16 }}>1. 会社設定の「給与規定グループ」</h2>
        <GroupTab />
      </section>
      {stub("joined", "2. 給与明細（入社 太郎さん・2026年6月分。6月16日に入社）", joined, joinedAttendance)}
      {stub("leave", "3. 給与明細（休職 花子さん・2026年6月分。6月16日から休職）", onLeave, leaveAttendance)}
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
