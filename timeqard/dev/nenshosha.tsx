/**
 * Q の18歳未満の人（年少者）の時間外・休日・深夜の労働（見直しの P13。src/utils/minorWork.ts）を、見本の値で出す（開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/nenshosha.html を開く
 *
 * 2026年11月分（末締め・当月25日払い。週の始まりは日曜日）。本店は週44時間の特例の事業場（別表第一第8号）。
 * 見本の5人（どれも時給 1,300円。勤怠はすべて確定してある）：
 * ・高校 一郎（16歳）：11月16日（月）〜21日（土）に7時間30分ずつ（週45時間。特例でも18歳未満は週40時間で数えるので、21日に時間外 5:00）、
 *   18日は22時まで（深夜 1:00）、22日（日）は法定休日に4時間。勤怠の画面と給与明細に赤い知らせ、「給与確定」で確かめの窓
 * ・誕生 二郎（2008年11月19日生まれ。11月19日に18歳）：18日と19日に22時まで。知らせるのは18日（誕生日の前日）の深夜だけ。
 *   週45時間の週は、18歳になってからの21日に特例の44時間を超えた1時間が時間外
 * ・フレックス 三郎（16歳・フレックスタイム制）：フレックスタイム制を使わず、1日8時間・週40時間で数える（17日に9時間 → 時間外 1:00）
 * ・大人 四郎（30歳）：一郎さんと同じ勤怠でも、知らせない（特例で週44時間、時間外 1:00）
 * ・中学 五郎（2011年12月25日生まれ・14歳）：従業員の画面に、最低年齢（2027年3月31日が終わるまで使えない）の知らせ
 * 確かめの窓は、window.__dialogAnswer を "cancel" にすると「やめる」、それ以外は「このまま確定する」を選ぶ（出した窓は window.__dialogs に残る）。
 * 確定した給与は window.__nensho.saved、操作の記録は window.__nensho.logs に残る。
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "../../src/components/Toast";
import { MessageDialogProvider } from "../../src/components/MessageDialog";
import StaffManager from "../../src/features/settings/StaffManager";
import PaySlipManager from "../../src/features/payroll/PaySlipManager";
import AttendanceManager from "../../src/features/attendance/AttendanceManager";

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
  id: 1, name: "年少者サンプル商店", prefecture: "東京都", week_start_day: 0, round_overtime: "round", round_social_ins: "currency_law", round_emp_ins: "currency_law",
};
const group = {
  id: 1, name: "全社", closing_day: 99, is_next_month: 0, payment_day: 25, tax_calc_method: "table", social_ins_collection: "current",
  proration_method: "none", leave_proration_method: "workdays", absence_deduction_method: "workdays", tardy_deduction_method: "none",
  fixed_break: null, flex_rule: null, shutdown_allowance_rate: 60, premium_rates: null, is_active: 1,
};
const baseStaff = {
  furigana: "", gender: "male", zip_code: "", address: "", phone: "", mobile: "", status: "active", retirement_date: null, death_date: null,
  branch_id: 1, payroll_group_id: 1, is_employment_ins_eligible: 0, is_overtime_eligible: 1, is_executive: 0, is_flex: 0, dependents: 0,
  resident_tax: 0, commute_type: "none", commute_amount: 0, scheduled_in: "09:00", scheduled_work_hours: 7.5, fixed_overtime_hours: 0,
  fixed_overtime_allowance: 0, tax_column: "kou", branch_name: "本店", calendar_pattern_id: 0, work_days: "mon,tue,wed,thu,fri,sat",
  join_date: "2026-04-01", social_insurance_group_id: null, standard_remuneration: 0, specific_min_wage_exempt: 0,
  wage_type: "hourly", base_wage: 1300,
};
const store = {
  branches: [
    { id: 1, name: "本店", zip_code: "1000001", prefecture: "東京都", address: "千代田区千代田1-1", health_ins_num: "", weekly44_business: 8, specific_minimum_wage: null },
  ],
  staff: [
    { ...baseStaff, id: "6301", name: "高校 一郎", birthday: "2010-05-05" },
    { ...baseStaff, id: "6302", name: "誕生 二郎", birthday: "2008-11-19" },
    { ...baseStaff, id: "6303", name: "フレックス 三郎", birthday: "2010-06-06", is_flex: 1, scheduled_work_hours: 8, scheduled_in: null },
    { ...baseStaff, id: "6304", name: "大人 四郎", birthday: "1996-04-04" },
    { ...baseStaff, id: "6305", name: "中学 五郎", birthday: "2011-12-25", join_date: "2026-11-01", scheduled_work_hours: 4, work_days: "sat" },
  ] as any[],
  attendance: [] as any[],
  saved: [] as any[],
  logs: [] as any[],
};
(window as any).__nensho = store;

const row = (staffId: string, date: string, entry: string, exit: string, hours: number, night = 0, type = "normal") => ({
  staff_id: staffId, work_date: `2026-11-${date}`, entry_time: entry, exit_time: exit, breaks: null, csv_breaks: null, work_type: type, work_hours: hours,
  night_hours: night, paid_leave_hours: 0, special_leave_hours: 0, leave_type_id: null, leave_paid: null, memo: "", is_finalized: 1,
  finalized_at: "2026-11-30 18:00", actual_base_wage: 1300, scheduled_hours: null, break_none: 0, auto_break: null,
});
// 一郎・四郎：16日（月）〜21日（土）に7時間30分ずつ。18日は 14:00〜22:30（休憩1時間。深夜 0:30 … ここでは 13:30〜23:00 で深夜 1:00）
for (const id of ["6301", "6304"]) {
  for (const d of ["16", "17", "19", "20", "21"]) store.attendance.push(row(id, d, "09:00", "17:30", 7.5));
  store.attendance.push(row(id, "18", "14:30", "23:00", 7.5, 1));
  store.attendance.push(row(id, "22", "09:00", "13:00", 4, 0, "statutory_holiday"));
}
// 二郎：同じ週の7時間30分ずつ。18日と19日は 14:30〜23:00（深夜 1:00）
for (const d of ["16", "17", "20", "21"]) store.attendance.push(row("6302", d, "09:00", "17:30", 7.5));
for (const d of ["18", "19"]) store.attendance.push(row("6302", d, "14:30", "23:00", 7.5, 1));
// 三郎（フレックスタイム制）：16日〜20日に8時間ずつ、17日だけ9時間
for (const d of ["16", "18", "19", "20"]) store.attendance.push(row("6303", d, "09:00", "18:00", 8));
store.attendance.push(row("6303", "17", "09:00", "19:00", 9));
// 五郎：土曜日に4時間
for (const d of ["07", "14", "21", "28"]) store.attendance.push(row("6305", d, "10:00", "14:00", 4));

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());
const flat = (sql: string) => sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();

const fakeDb = {
  path: "sqlite:nenshosha.qp",
  async select(sql: string, params: any[] = []) {
    const q = flat(sql);
    if (q.startsWith("SELECT * FROM company WHERE id = 1")) return [company];
    if (q.startsWith("SELECT * FROM branches")) return store.branches.map((b) => ({ ...b }));
    if (q.startsWith("SELECT id, name, prefecture, health_ins_num FROM branches")) return store.branches.map((b) => ({ ...b }));
    if (q.startsWith("SELECT id, name, prefecture, health_ins_num, weekly44_business FROM branches")) return store.branches.map((b) => ({ ...b }));
    if (q.startsWith("SELECT branch_id, status, is_executive FROM staff")) return store.staff.map((s) => ({ branch_id: s.branch_id, status: s.status, is_executive: 0 }));
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
      const finalizedOnly = q.includes("is_finalized = 1");
      return store.attendance
        .filter((r) => r.staff_id === String(id) && r.work_date >= from && r.work_date <= to && (!finalizedOnly || r.is_finalized === 1))
        .sort((a, b) => a.work_date.localeCompare(b.work_date));
    }
    return [];
  },
  async execute(sql: string, params: any[] = []) {
    const q = flat(sql);
    if (q.startsWith("INSERT INTO salary_results")) {
      const cols = /INSERT INTO salary_results \(([^)]*)\)/.exec(q)?.[1].split(",").map((c) => c.trim()) ?? [];
      const r = Object.fromEntries(cols.map((c, i) => [c, params[i]]));
      store.saved = store.saved.filter((x) => !(x.staff_id === String(r.staff_id) && x.target_year === r.target_year && x.target_month === r.target_month));
      store.saved.push({ ...r, staff_id: String(r.staff_id) });
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
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(11);
  listeners.clear();
  listeners.add(() => setTick((t) => t + 1));
  const staffList = store.staff.map((s) => ({ ...s }));
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 24, maxWidth: 1240, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, margin: 0 }}>18歳未満の人の時間外・休日・深夜（確かめ用）</h1>
      <section id="attendance" style={{ background: "white", borderRadius: 8, padding: 12 }}>
        <h2 style={{ fontSize: 16 }}>1. 勤怠の画面（2026年11月分）</h2>
        <AttendanceManager db={fakeDb as any} staffList={staffList as any} targetYear={year} setTargetYear={setYear} targetMonth={month} setTargetMonth={setMonth} />
      </section>
      <section id="payslip" style={{ background: "white", borderRadius: 8, padding: 12 }}>
        <h2 style={{ fontSize: 16 }}>2. 給与の一覧と給与明細（2026年11月分）</h2>
        <PaySlipManager db={fakeDb as any} staffList={staffList} targetYear={2026} targetMonth={11} />
      </section>
      <section id="staff" style={{ background: "white", borderRadius: 8, padding: 12 }}>
        <h2 style={{ fontSize: 16 }}>3. 従業員の画面</h2>
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
