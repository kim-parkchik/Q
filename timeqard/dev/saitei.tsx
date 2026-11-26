/**
 * Q の最低賃金の比べ方（見直しの P12。src/utils/minimumWage.ts）を、見本の値で出す（開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/saitei.html を開く
 *
 * 2026年11月分（末締め・当月25日払い）。東京の地域別最低賃金は 1,280円（2026年10月1日から）。
 * 拠点：本店（東京都）と工場（東京都。特定最低賃金「見本の製造業最低賃金」1,400円（2025年12月1日から）を入れてある）。
 * 給与項目：職務手当（固定・最低賃金に入れる）・家族手当（固定・入れない）・歩合給（変動・日・時間・出来高で決まる賃金・入れる）。
 * 見本の5人：
 * ・手当 一郎（本店・月給20万円＋職務手当3万円）：基本給だけなら下回るが、職務手当を足すと上回るので、知らせない
 * ・家族 二郎（本店・月給20万円＋家族手当3万円）：家族手当は入れないので下回る。給与明細に赤い知らせ、「給与確定」で確かめの窓
 * ・歩合 三郎（本店・時給1,000円＋歩合給6万円）：給与明細では、歩合給をその月に働いた時間で割って足すので上回る
 *   （従業員の画面は変動の項目を入れないので、下回ると出る）
 * ・特定 四郎（工場・時給1,300円）：地域別は上回るが、特定最低賃金 1,400円を下回る
 * ・除外 五郎（工場・時給1,300円・特定最低賃金から除く）：地域別だけと比べるので、知らせない
 * 確かめの窓は、window.__dialogAnswer を "cancel" にすると「やめる」、それ以外は「このまま確定する」を選ぶ（出した窓は window.__dialogs に残る）。
 * 確定した給与は window.__saitei.saved、操作の記録は window.__saitei.logs に残る。
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "../../src/components/Toast";
import { MessageDialogProvider } from "../../src/components/MessageDialog";
import StaffManager from "../../src/features/settings/StaffManager";
import PaySlipManager from "../../src/features/payroll/PaySlipManager";
import CustomItemManager from "../../src/features/settings/CustomItemManager";
import BranchTab from "../../src/features/settings/company/BranchTab";
import { useCompanyManager } from "../../src/features/settings/useCompanyManager";

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
  id: 1, name: "最低賃金サンプル株式会社", prefecture: "東京都", week_start_day: 0, round_overtime: "round", round_social_ins: "currency_law", round_emp_ins: "currency_law",
};
const group = {
  id: 1, name: "全社", closing_day: 99, is_next_month: 0, payment_day: 25, tax_calc_method: "table", social_ins_collection: "current",
  proration_method: "none", leave_proration_method: "workdays", absence_deduction_method: "workdays", tardy_deduction_method: "none",
  fixed_break: null, flex_rule: null, shutdown_allowance_rate: 60, premium_rates: null, is_active: 1,
};
const baseStaff = {
  furigana: "", gender: "male", zip_code: "", address: "", phone: "", mobile: "", status: "active", retirement_date: null, death_date: null,
  branch_id: 1, payroll_group_id: 1, is_employment_ins_eligible: 1, is_overtime_eligible: 1, is_executive: 0, is_flex: 0, dependents: 0,
  resident_tax: 0, commute_type: "none", commute_amount: 0, scheduled_in: "09:00", scheduled_work_hours: 8, fixed_overtime_hours: 0,
  fixed_overtime_allowance: 0, tax_column: "kou", branch_name: "本店", calendar_pattern_id: 0, work_days: "mon,tue,wed,thu,fri",
  join_date: "2026-04-01", birthday: "1990-05-05", social_insurance_group_id: null, standard_remuneration: 0, specific_min_wage_exempt: 0,
};
const store = {
  branches: [
    { id: 1, name: "本店", zip_code: "1000001", prefecture: "東京都", address: "千代田区千代田1-1", health_ins_num: "", weekly44_business: null, specific_minimum_wage: null as string | null },
    { id: 2, name: "工場", zip_code: "1000001", prefecture: "東京都", address: "千代田区千代田1-2", health_ins_num: "", weekly44_business: null,
      specific_minimum_wage: JSON.stringify({ name: "見本の製造業最低賃金", wages: [{ from: "2025-12-01", amount: 1400 }] }) as string | null },
  ],
  items: [
    { id: 1, name: "職務手当", type: "earning", category: "fixed", display_order: 10, in_overtime_base: 1, average_wage: "month", in_minimum_wage: 1 },
    { id: 2, name: "家族手当", type: "earning", category: "fixed", display_order: 20, in_overtime_base: 0, average_wage: "month", in_minimum_wage: 0 },
    { id: 3, name: "歩合給", type: "earning", category: "variable", display_order: 30, in_overtime_base: 1, average_wage: "time", in_minimum_wage: 1 },
  ] as any[],
  values: { "5301": { 1: 30000 }, "5302": { 2: 30000 }, "5303": { 3: 60000 } } as Record<string, Record<number, number>>,
  staff: [
    { ...baseStaff, id: "5301", name: "手当 一郎", wage_type: "monthly", base_wage: 200000 },
    { ...baseStaff, id: "5302", name: "家族 二郎", wage_type: "monthly", base_wage: 200000 },
    { ...baseStaff, id: "5303", name: "歩合 三郎", wage_type: "hourly", base_wage: 1000 },
    { ...baseStaff, id: "5304", name: "特定 四郎", wage_type: "hourly", base_wage: 1300, branch_id: 2, branch_name: "工場" },
    { ...baseStaff, id: "5305", name: "除外 五郎", wage_type: "hourly", base_wage: 1300, branch_id: 2, branch_name: "工場", specific_min_wage_exempt: 1 },
  ] as any[],
  attendance: [] as any[],
  saved: [] as any[],
  logs: [] as any[],
};
(window as any).__saitei = store;

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
  path: "sqlite:saitei.qp",
  async select(sql: string, params: any[] = []) {
    const q = flat(sql);
    if (q.startsWith("SELECT * FROM company WHERE id = 1")) return [company];
    if (q.startsWith("SELECT * FROM branches")) return store.branches.map((b) => ({ ...b }));
    if (q.startsWith("SELECT id, name, prefecture, health_ins_num FROM branches")) return store.branches.map((b) => ({ ...b }));
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
    // 給与項目設定（項目の一覧と、人ごとの額）
    if (q.startsWith("SELECT id, name, type, category, display_order")) return store.items.map((i) => ({ ...i }));
    if (q.startsWith("SELECT item_id, amount FROM staff_salary_values")) {
      return Object.entries(store.values[String(params[0])] ?? {}).map(([item_id, amount]) => ({ item_id: Number(item_id), amount }));
    }
    // 従業員の給与項目（utils/calcSalary.ts の loadCustomItems）
    if (q.startsWith("SELECT m.name, m.type, m.category, COALESCE(v.amount, 0) as amount")) {
      const values = store.values[String(params[0])] ?? {};
      return store.items.filter((i) => i.category !== "formula")
        .map((i) => ({ name: i.name, type: i.type, category: i.category, amount: values[i.id] ?? 0, in_overtime_base: i.in_overtime_base, average_wage: i.average_wage, in_minimum_wage: i.in_minimum_wage }));
    }
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
    } else if (q.startsWith("UPDATE salary_item_master SET in_minimum_wage = ? WHERE id = ?")) {
      const i = store.items.find((x) => x.id === Number(params[1]));
      if (i) i.in_minimum_wage = params[0];
    } else if (q.startsWith("UPDATE branches SET specific_minimum_wage = ? WHERE id = ?")) {
      const b = store.branches.find((x) => x.id === Number(params[1]));
      if (b) b.specific_minimum_wage = params[0];
    }
    notify();
    return { rowsAffected: 1 };
  },
};

function Branches() {
  const cm = useCompanyManager({ db: fakeDb as any });
  return <BranchTab cm={cm} />;
}

function Page() {
  const [, setTick] = useState(0);
  listeners.clear();
  listeners.add(() => setTick((t) => t + 1));
  const staffList = store.staff.map((s) => ({ ...s }));
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 24, maxWidth: 1240, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, margin: 0 }}>最低賃金の比べ方（確かめ用）</h1>
      <section id="payslip" style={{ background: "white", borderRadius: 8, padding: 12 }}>
        <h2 style={{ fontSize: 16 }}>1. 給与の一覧と給与明細（2026年11月分）</h2>
        <PaySlipManager db={fakeDb as any} staffList={staffList} targetYear={2026} targetMonth={11} />
      </section>
      <section id="staff" style={{ background: "white", borderRadius: 8, padding: 12 }}>
        <h2 style={{ fontSize: 16 }}>2. 従業員の画面</h2>
        <StaffManager db={fakeDb as any} onDataChange={() => notify()} staffList={staffList} />
      </section>
      <section id="items" style={{ background: "white", borderRadius: 8, padding: 12 }}>
        <h2 style={{ fontSize: 16 }}>3. 給与項目設定</h2>
        <CustomItemManager db={fakeDb as any} staffList={staffList} />
      </section>
      <section id="branches" style={{ background: "white", borderRadius: 8, padding: 12 }}>
        <h2 style={{ fontSize: 16 }}>4. 会社設定の支店リスト</h2>
        <Branches />
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
