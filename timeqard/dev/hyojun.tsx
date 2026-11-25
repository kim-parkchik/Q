/**
 * Q の標準報酬月額の入れ忘れの知らせ（見直しの P10。src/utils/remunerationMissing.ts）を、見本の値で出す（開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/hyojun.html を開く
 *
 * 2026年11月分（末締め・当月25日払い）。社保規定は「協会けんぽ」（id 1）。見本の4人：
 * ・入社 太郎（月給30万円・社保規定 協会けんぽ・標準報酬月額を入れていない）：給与の一覧に「⚠️標準報酬月額なし」、給与明細に赤い知らせと
 *   見込みの等級（30万円で決めた等級）。「給与確定」で確かめの窓が出て、「やめる」なら確定しない、「このまま確定する」なら確定して、
 *   操作の記録に注意（WARN）を残す
 * ・時給 三郎（時給1,200円・社保規定 協会けんぽ・標準報酬月額を入れていない）：印と知らせは出るが、見込みの等級は出さない
 * ・加入 花子（月給28万円・標準報酬月額 28万円）：知らせない
 * ・パート 次郎（時給1,100円・社保規定「未加入 / 適用除外」）：知らせない（いままでどおり、明細に小さく「未加入のため控除していません」）
 * 確かめの窓は、window.__dialogAnswer を "cancel" にすると「やめる」、それ以外は「このまま確定する」を選ぶ（出した窓は window.__dialogs に残る）。
 * 確定した給与は window.__hyojun.saved、操作の記録は window.__hyojun.logs に残る。従業員の画面で保存すると window.__hyojun.staff が変わる
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "../../src/components/Toast";
import { MessageDialogProvider } from "../../src/components/MessageDialog";
import StaffManager from "../../src/features/settings/StaffManager";
import PaySlipManager from "../../src/features/payroll/PaySlipManager";

// ── Tauri の代わり（確かめの窓は window.__dialogAnswer で答える） ──
(window as any).__dialogs = [];
(window as any).__dialogAnswer = "ok";
(window as any).__TAURI_INTERNALS__ = {
  invoke: async (cmd: string, args: any) => {
    if (cmd.startsWith("plugin:dialog|")) {
      (window as any).__dialogs.push({ title: args?.title, message: args?.message });
      const yes = (window as any).__dialogAnswer !== "cancel";
      const b = args?.buttons;
      if (b?.OkCancelCustom) return yes ? b.OkCancelCustom[0] : b.OkCancelCustom[1];
      if (b?.OkCustom) return b.OkCustom;
      return b === "YesNo" ? (yes ? "Yes" : "No") : b === "OkCancel" ? (yes ? "Ok" : "Cancel") : yes;
    }
    return null;
  },
  transformCallback: () => 0,
};
(window as any).__alerts = [];
window.alert = (message?: unknown) => { (window as any).__alerts.push(String(message)); console.info("知らせ:", message); };

const company: Record<string, unknown> = {
  id: 1, name: "標準報酬サンプル株式会社", prefecture: "東京都", week_start_day: 0, round_overtime: "round", round_social_ins: "currency_law", round_emp_ins: "currency_law",
};
const branches = [{ id: 1, name: "本店", prefecture: "東京都", health_ins_num: "" }];
const group = {
  id: 1, name: "全社", closing_day: 99, is_next_month: 0, payment_day: 25, tax_calc_method: "table", social_ins_collection: "current",
  proration_method: "none", leave_proration_method: "workdays", absence_deduction_method: "workdays", tardy_deduction_method: "none",
  fixed_break: null, flex_rule: null, shutdown_allowance_rate: 60, premium_rates: null, is_active: 1,
};
const insurers = [{ id: 1, name: "協会けんぽ", type: "kyokai", union_office_number: null, union_media_seq: null, is_active: 1 }];
const history = (amount: number) => JSON.stringify([{ from: "", amount, reason: "shutoku" }]);
const baseStaff = {
  furigana: "", gender: "male", zip_code: "", address: "", phone: "", mobile: "", status: "active", retirement_date: null, death_date: null,
  branch_id: 1, payroll_group_id: 1, is_employment_ins_eligible: 1, is_overtime_eligible: 1, is_executive: 0, is_flex: 0, dependents: 0,
  resident_tax: 0, commute_type: "none", commute_amount: 0, scheduled_in: "09:00", scheduled_work_hours: 8, fixed_overtime_hours: 0,
  fixed_overtime_allowance: 0, tax_column: "kou", branch_name: "本店", calendar_pattern_id: 0, work_days: "mon,tue,wed,thu,fri",
  join_date: "2026-04-01", birthday: "1990-05-05",
};
const store = {
  staff: [
    { ...baseStaff, id: "5201", name: "入社 太郎", wage_type: "monthly", base_wage: 300000, social_insurance_group_id: 1, standard_remuneration: 0, standard_remuneration_history: history(0) },
    { ...baseStaff, id: "5202", name: "時給 三郎", wage_type: "hourly", base_wage: 1200, social_insurance_group_id: 1, standard_remuneration: 0, standard_remuneration_history: history(0) },
    { ...baseStaff, id: "5203", name: "加入 花子", gender: "female", wage_type: "monthly", base_wage: 280000, social_insurance_group_id: 1, standard_remuneration: 280000, standard_remuneration_history: history(280000) },
    { ...baseStaff, id: "5204", name: "パート 次郎", wage_type: "hourly", base_wage: 1100, social_insurance_group_id: null, standard_remuneration: 0, standard_remuneration_history: history(0) },
  ] as any[],
  attendance: [] as any[],
  saved: [] as any[],
  logs: [] as any[],
};
(window as any).__hyojun = store;

// 11月の平日に、9時〜18時（休憩1時間・8時間）で確定した勤怠
for (const s of store.staff) {
  for (let d = 1; d <= 30; d++) {
    const date = `2026-11-${String(d).padStart(2, "0")}`;
    const wd = new Date(2026, 10, d).getDay();
    if (wd === 0 || wd === 6) continue;
    store.attendance.push({
      staff_id: s.id, work_date: date, entry_time: "09:00", exit_time: "18:00", breaks: null, csv_breaks: null, work_type: "normal", work_hours: 8,
      night_hours: 0, paid_leave_hours: 0, special_leave_hours: 0, leave_type_id: null, leave_paid: null, memo: "", is_finalized: 1,
      finalized_at: "2026-11-30 18:00", actual_base_wage: s.wage_type === "monthly" ? null : s.base_wage, scheduled_hours: null, break_none: 0, auto_break: null,
    });
  }
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());
const flat = (sql: string) => sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();

const fakeDb = {
  async select(sql: string, params: any[] = []) {
    const q = flat(sql);
    if (q.startsWith("SELECT * FROM company WHERE id = 1")) return [company];
    if (q.startsWith("SELECT * FROM branches")) return branches;
    if (q.startsWith("SELECT id, name, prefecture, health_ins_num FROM branches")) return branches;
    if (q.startsWith("SELECT * FROM payroll_groups")) return [group];
    if (q.startsWith("SELECT g.* FROM payroll_groups g")) return [group];
    if (q.startsWith("SELECT * FROM calendar_patterns")) return [{ id: 1, name: "標準" }];
    if (q.startsWith("SELECT COUNT(*) as count FROM staff")) return [{ count: store.staff.length }];
    if (q.startsWith("SELECT COUNT(*) AS n FROM salary_results")) {
      return [{ n: store.saved.filter((r) => r.staff_id === String(params[0]) && r.target_year === params[1] && r.target_month === params[2]).length }];
    }
    if (q.startsWith("SELECT tax_calc_method")) return [group];
    if (q.startsWith("SELECT payment_day FROM payroll_groups")) return [{ payment_day: 25 }];
    if (q.startsWith("SELECT closing_day, is_next_month")) return [{ closing_day: 99, is_next_month: 0, shutdown_allowance_rate: 60 }];
    if (q.includes("FROM social_insurance_groups")) return insurers;
    // 給与の一覧：確定した勤怠の時間の合計
    if (q.startsWith("SELECT a.staff_id, SUM(CAST(a.work_hours AS REAL)) as total_h")) {
      const [, from, to] = params;
      return store.staff.map((s) => ({
        staff_id: s.id, calendar_invalid: 0,
        total_h: store.attendance.filter((r) => r.staff_id === s.id && r.work_date >= from && r.work_date <= to).reduce((n, r) => n + r.work_hours, 0),
      }));
    }
    if (q.startsWith("SELECT * FROM attendance WHERE staff_id = ? AND work_date BETWEEN ? AND ?")) {
      const [id, from, to] = params;
      return store.attendance.filter((r) => r.staff_id === String(id) && r.work_date >= from && r.work_date <= to)
        .sort((a, b) => a.work_date.localeCompare(b.work_date));
    }
    return [];
  },
  async execute(sql: string, params: any[] = []) {
    const q = flat(sql);
    if (q.startsWith("INSERT INTO salary_results")) {
      const cols = /INSERT INTO salary_results \(([^)]*)\)/.exec(q)?.[1].split(",").map((c) => c.trim()) ?? [];
      const row = Object.fromEntries(cols.map((c, i) => [c, params[i]]));
      store.saved = store.saved.filter((r) => !(r.staff_id === String(row.staff_id) && r.target_year === row.target_year && r.target_month === row.target_month));
      store.saved.push({ ...row, staff_id: String(row.staff_id) });
    } else if (q.startsWith("INSERT INTO app_logs")) {
      store.logs.push({ level: params[1], category: params[2], message: params[3] });
    } else if (q.startsWith("UPDATE staff SET")) {
      const cols = /UPDATE staff SET (.*) WHERE id=\?/.exec(q)?.[1].split(",").map((c) => c.trim().replace(/=\?$/, "")) ?? [];
      const s = store.staff.find((x) => x.id === String(params[params.length - 1]));
      if (s) cols.forEach((c, i) => { s[c] = params[i]; });
    }
    notify();
    return { rowsAffected: 1 };
  },
};

function Page() {
  const [, setTick] = useState(0);
  listeners.clear();
  listeners.add(() => setTick((t) => t + 1));
  const staffList = store.staff.map((s) => ({ ...s }));
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 24, maxWidth: 1240, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, margin: 0 }}>標準報酬月額の入れ忘れ（確かめ用）</h1>
      <section id="payslip" style={{ background: "white", borderRadius: 8, padding: 12 }}>
        <h2 style={{ fontSize: 16 }}>1. 給与の一覧と給与明細（2026年11月分）</h2>
        <PaySlipManager db={fakeDb as any} staffList={staffList} targetYear={2026} targetMonth={11} />
      </section>
      <section id="staff" style={{ background: "white", borderRadius: 8, padding: 12 }}>
        <h2 style={{ fontSize: 16 }}>2. 従業員の画面</h2>
        <StaffManager db={fakeDb as any} onDataChange={() => notify()} staffList={staffList} />
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
