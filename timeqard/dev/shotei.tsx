/**
 * Q の所定労働時間（曜日ごとの時間・その日だけ直した時間。src/utils/scheduledHours.ts）を、見本の値で画面に出す（開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/shotei.html を開く
 * ・従業員の画面（src/features/settings/StaffManager.tsx）：曜日 時子さん（時給1,200円・契約曜日 月・水・金・1日の所定労働時間4時間・水曜6時間）を
 *   「編集」すると、契約曜日の横に曜日の時間が出る（1週間の1日平均 4時間40分）。保存すると window.__shoteiStore.staff に残る。
 *   未入力 太郎さんは「1日の所定労働時間」が空で、赤く知らせる。新しく入れる人も空から始まる
 * ・勤怠の画面（src/features/attendance/AttendanceManager.tsx）：2026年11月分。日付の欄の「所定」に、曜日の時間が薄く出る。
 *   20日（金）はシフトで5時間に直して確定してある。23日（月）を直して確定すると window.__shoteiStore.attendance の scheduled_hours に残る
 * ・給与明細（src/features/payroll/PayStubModal.tsx）：曜日 時子さんの有給は 16日（月）4時間・18日（水）6時間・20日（金）5時間 ＝ 15時間 × 1,200円 ＝ 18,000円
 *   （いままでは、どの日も4時間で 14,400円）。「有給休暇の時間」に日ごとの時間が出る。未入力 太郎さんは8時間で見込みを出し、確定できない
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "../../src/components/Toast";
import { MessageDialogProvider } from "../../src/components/MessageDialog";
import StaffManager from "../../src/features/settings/StaffManager";
import AttendanceManager from "../../src/features/attendance/AttendanceManager";
import PayStubModal from "../../src/features/payroll/PayStubModal";

// ── Tauri の代わり（確かめを出す画面は、いつも「はい」にする） ──
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
(window as any).__alerts = [];
window.alert = (message?: unknown) => { (window as any).__alerts.push(String(message)); console.info("知らせ:", message); };

const company: Record<string, unknown> = {
  id: 1, name: "所定サンプル株式会社", prefecture: "東京都", week_start_day: 0, round_overtime: "round", round_social_ins: "currency_law", round_emp_ins: "currency_law",
  hourly_leave: 1, half_day_leave: 1,
};
const branches = [{ id: 1, name: "本店", prefecture: "東京都", health_ins_num: "" }];
const group = {
  id: 1, name: "全社", closing_day: 99, is_next_month: 0, payment_day: 25, tax_calc_method: "table", social_ins_collection: "current",
  proration_method: "none", leave_proration_method: "workdays", absence_deduction_method: "workdays", tardy_deduction_method: "none",
  fixed_break: null, flex_rule: null, shutdown_allowance_rate: 60, premium_rates: null, is_active: 1,
};
const baseStaff = {
  furigana: "", gender: "female", zip_code: "", address: "", phone: "", mobile: "", status: "active", retirement_date: null,
  branch_id: 1, payroll_group_id: 1, social_insurance_group_id: null, standard_remuneration: 0, is_employment_ins_eligible: 0,
  is_overtime_eligible: 1, is_executive: 0, is_flex: 0, dependents: 0, resident_tax: 0, commute_type: "none", commute_amount: 0,
  scheduled_in: "09:00", fixed_overtime_hours: 0, fixed_overtime_allowance: 0, tax_column: "kou", branch_name: "本店",
};
const store = {
  staff: [
    {
      ...baseStaff, id: "3001", name: "曜日 時子", birthday: "1985-03-03", join_date: "2024-04-01",
      wage_type: "hourly", base_wage: 1200, scheduled_work_hours: 4, weekday_hours: JSON.stringify({ wed: 6 }),
      calendar_pattern_id: 0, work_days: "mon,wed,fri",
    },
    {
      ...baseStaff, id: "3002", name: "未入力 太郎", gender: "male", birthday: "1990-07-07", join_date: "2025-04-01",
      wage_type: "hourly", base_wage: 1100, scheduled_work_hours: null, weekday_hours: null,
      calendar_pattern_id: 0, work_days: "mon,tue,wed,thu,fri",
    },
  ] as any[],
  attendance: [] as any[],
};
(window as any).__shoteiStore = store;

const row = (staffId: string, date: string, type: string, entry = "", exit = "", hours = 0, o: Record<string, unknown> = {}) => ({
  staff_id: staffId, work_date: date, entry_time: entry, exit_time: exit, breaks: null, csv_breaks: null, work_type: type, work_hours: hours,
  night_hours: 0, paid_leave_hours: 0, special_leave_hours: 0, leave_type_id: null, leave_paid: null, memo: "",
  is_finalized: 1, finalized_at: "2026-11-30 18:00", actual_base_wage: staffId === "3001" ? 1200 : 1100, scheduled_hours: null, break_none: 0, auto_break: null, ...o,
});
store.attendance.push(
  row("3001", "2026-11-02", "normal", "09:00", "13:00", 4),
  row("3001", "2026-11-04", "normal", "09:00", "15:00", 6),
  row("3001", "2026-11-06", "normal", "09:00", "13:00", 4),
  row("3001", "2026-11-09", "normal", "09:00", "15:00", 6), // 月曜（4時間）に6時間：2時間は法定内残業
  row("3001", "2026-11-16", "paid_full"),
  row("3001", "2026-11-18", "paid_full"),
  row("3001", "2026-11-20", "paid_full", "", "", 0, { scheduled_hours: 5 }), // シフトで5時間にした金曜
  row("3001", "2026-11-23", "normal", "09:00", "14:00", 5, { is_finalized: 0, finalized_at: null }), // まだ確定していない月曜
  row("3002", "2026-11-16", "paid_full"),
);

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());
/** SQL の列の並び（「INSERT INTO t (a, b) VALUES」「UPDATE t SET a=?, b=? WHERE」）を読む */
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
    if (q.startsWith("SELECT COUNT(*) AS n FROM salary_results")) return [{ n: 0 }];
    if (q.startsWith("SELECT tax_calc_method")) return [group];
    if (q.startsWith("SELECT payment_day FROM payroll_groups")) return [{ payment_day: 25 }];
    if (q.startsWith("SELECT closing_day, is_next_month")) return [{ closing_day: 99, is_next_month: 0, shutdown_allowance_rate: 60 }];
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
    if (q.startsWith("INSERT INTO attendance")) {
      const cols = /INSERT INTO attendance \(([^)]*)\)/.exec(q)?.[1].split(",").map((c) => c.trim()) ?? [];
      const values = Object.fromEntries(cols.map((c, i) => [c, params[i]]));
      const i = store.attendance.findIndex((r) => r.staff_id === String(values.staff_id) && r.work_date === values.work_date);
      if (i >= 0) store.attendance[i] = { ...store.attendance[i], ...values };
      else store.attendance.push(values);
      console.info("fakeDb: 勤怠を確定した", values.work_date, "所定", values.scheduled_hours);
    } else if (q.startsWith("UPDATE attendance SET is_finalized = 0")) {
      const [id, date] = params;
      const r = store.attendance.find((x) => x.staff_id === String(id) && x.work_date === date);
      if (r) Object.assign(r, { is_finalized: 0, auto_break: null, leave_paid: null });
    } else if (q.startsWith("UPDATE staff SET")) {
      const cols = /UPDATE staff SET (.*) WHERE id=\?/.exec(q)?.[1].split(",").map((c) => c.trim().replace(/=\?$/, "")) ?? [];
      const s = store.staff.find((x) => x.id === String(params[params.length - 1]));
      if (s) cols.forEach((c, i) => { s[c] = params[i]; });
      console.info("fakeDb: 従業員を保存した", s?.name, { scheduled_work_hours: s?.scheduled_work_hours, weekday_hours: s?.weekday_hours, work_days: s?.work_days });
    } else if (q.startsWith("INSERT INTO staff")) {
      const cols = /INSERT INTO staff \(([^)]*)\)/.exec(q)?.[1].split(",").map((c) => c.trim()) ?? [];
      store.staff.push(Object.fromEntries(cols.map((c, i) => [c, params[i]])));
    }
    notify();
    return { rowsAffected: 1 };
  },
};

function Page() {
  const [, setTick] = useState(0);
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(11);
  const [stubFor, setStubFor] = useState("3001");
  listeners.clear();
  listeners.add(() => setTick((t) => t + 1));
  const staffList = store.staff.map((s) => ({ ...s }));
  const stubStaff = { ...store.staff.find((s) => s.id === stubFor), prefecture: "東京", kenpoPrefecture: "東京", periodStart: "2026-11-01", periodEnd: "2026-11-30", periodLabel: "11/1〜11/30" };
  const stubAttendance = store.attendance.filter((r) => r.staff_id === stubFor && r.is_finalized === 1);
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 24, maxWidth: 1240, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, margin: 0 }}>所定労働時間（曜日ごと・その日だけ直す。確かめ用）</h1>
      <section id="staff" style={{ background: "white", borderRadius: 8, padding: 12 }}>
        <h2 style={{ fontSize: 16 }}>1. 従業員の画面</h2>
        <StaffManager db={fakeDb as any} onDataChange={() => notify()} staffList={staffList} />
      </section>
      <section id="attendance" style={{ background: "white", borderRadius: 8, padding: 12 }}>
        <h2 style={{ fontSize: 16 }}>2. 勤怠の画面（2026年11月分）</h2>
        <AttendanceManager db={fakeDb} staffList={staffList as any} targetYear={year} setTargetYear={setYear} targetMonth={month} setTargetMonth={setMonth} />
      </section>
      <section id="stub">
        <h2 style={{ fontSize: 16 }}>3. 給与明細（2026年11月分）</h2>
        <div style={{ marginBottom: 8 }}>
          {store.staff.map((s) => (
            <button key={s.id} id={`stub-${s.id}`} onClick={() => setStubFor(s.id)} style={{ marginRight: 8, fontWeight: s.id === stubFor ? "bold" : "normal" }}>{s.name}</button>
          ))}
        </div>
        <div style={{ position: "relative", transform: "translateZ(0)", height: 1600, overflow: "hidden", borderRadius: 8 }}>
          <PayStubModal
            key={`stub-${stubFor}-${JSON.stringify(stubStaff)}-${stubAttendance.length}`}
            db={fakeDb} year={2026} month={11} companySettings={company} onClose={() => {}}
            staff={stubStaff}
            attendanceData={stubAttendance}
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
