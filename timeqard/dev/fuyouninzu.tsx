/**
 * Q の扶養人数（扶養親族等の数）と、年末調整の画面に入れた扶養控除等申告書を照らし合わせる画面を、見本の値で出す（見直しの P9。開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/fuyouninzu.html を開く
 *
 * 令和8年分。給与は毎月25日払いで、1〜11月分を確定してある。見本の3人（申告書は、年末調整の画面に保存してある）：
 * ・扶養 次郎（甲欄・扶養人数2人）：配偶者 花子（所得0円・特別障害者で同居）、子 太郎（17歳・所得の見積額60万円）、子 三郎（10歳）。
 *   11月30日以前に支払う給与は、太郎は扶養親族でない（線は58万円）ので、配偶者1人＋同居特別障害者2人＝3人。
 *   12月1日以後に支払う給与は、太郎も控除対象扶養親族（線は62万円）で4人。従業員の画面には「3人」と「3人にする」、
 *   年末調整の画面には「4人（11月30日以前に支払う給与は3人）」と、1〜11月の給与（2人）・従業員の画面の扶養人数（2人）が違うことが出る
 * ・乙欄 四郎（乙欄・扶養人数3人）：従たる給与についての扶養控除等申告書に、配偶者（所得0円）と子（17歳・障害者）。
 *   乙欄は障害者などを足さないので2人
 * ・見込み 五郎（甲欄）：扶養人数の、いちばん新しい行は2027年1月分から0人。令和9年分の申告書がまだないので、
 *   令和8年分の申告書（子 一子。令和8年に15歳）から、年齢を令和9年12月31日で数え直した見込み（16歳で1人）が出る
 * 従業員を保存すると window.__fuyouStore.staff に残り、年末調整の画面の「従業員の画面の扶養人数」も変わる
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "../../src/components/Toast";
import { MessageDialogProvider } from "../../src/components/MessageDialog";
import StaffManager from "../../src/features/settings/StaffManager";
import NenchoManager from "../../src/features/nencho/NenchoManager";

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

const company: Record<string, unknown> = { id: 1, name: "扶養サンプル株式会社", prefecture: "東京都", week_start_day: 0 };
const branches = [{ id: 1, name: "本店", prefecture: "東京都", health_ins_num: "" }];
const group = {
  id: 1, name: "全社", closing_day: 99, is_next_month: 0, payment_day: 25, tax_calc_method: "table", social_ins_collection: "current",
  proration_method: "none", leave_proration_method: "workdays", absence_deduction_method: "workdays", tardy_deduction_method: "none",
  fixed_break: null, flex_rule: null, shutdown_allowance_rate: 60, premium_rates: null, is_active: 1,
};
const baseStaff = {
  furigana: "", gender: "male", zip_code: "", address: "", phone: "", mobile: "", status: "active", retirement_date: null, death_date: null,
  branch_id: 1, payroll_group_id: 1, social_insurance_group_id: null, standard_remuneration: 300000, is_employment_ins_eligible: 1,
  is_overtime_eligible: 1, is_executive: 0, is_flex: 0, resident_tax: 0, commute_type: "none", commute_amount: 0,
  scheduled_in: "09:00", scheduled_work_hours: 8, fixed_overtime_hours: 0, fixed_overtime_allowance: 0, branch_name: "本店",
  wage_type: "monthly", base_wage: 300000, calendar_pattern_id: 1, work_days: "mon,tue,wed,thu,fri", join_date: "2020-04-01",
};
const history = (...rows: [string, number][]) => JSON.stringify(rows.map(([from, count]) => ({ from, count })));
const store = {
  staff: [
    { ...baseStaff, id: "5001", name: "扶養 次郎", birthday: "1985-04-04", tax_column: "kou", dependents: 2, dependents_history: history(["", 2]) },
    { ...baseStaff, id: "5002", name: "乙欄 四郎", birthday: "1980-08-08", tax_column: "otsu", dependents: 3, dependents_history: history(["", 3]) },
    { ...baseStaff, id: "5003", name: "見込み 五郎", birthday: "1978-03-03", tax_column: "kou", dependents: 0, dependents_history: history(["", 1], ["2027-01", 0]) },
  ] as any[],
};
(window as any).__fuyouStore = store;

const person = (name: string, relation: string, birthday: string, o: Record<string, unknown> = {}) => ({
  name, relation, birthday, totalIncome: 0, disability: "none", livingTogether: true, linealAscendant: false, ...o,
});
const declaration = (o: Record<string, unknown>) => JSON.stringify({
  self: { disability: "none", widow: false, singleParent: false, workingStudent: false, otherIncome: 0 }, spouse: null, dependents: [], ...o,
});
const saved: any[] = [
  {
    staff_id: "5001", year: 2026, result: null, settle_year: null, settle_month: null, updated_at: "2026-11-20 10:00:00",
    declaration: declaration({
      spouse: { name: "扶養 花子", birthday: "1987-02-02", totalIncome: 0, disability: "special", livingTogether: true },
      dependents: [person("扶養 太郎", "子", "2009-04-01", { totalIncome: 600000 }), person("扶養 三郎", "子", "2016-05-05")],
    }),
  },
  {
    staff_id: "5002", year: 2026, result: null, settle_year: null, settle_month: null, updated_at: "2026-11-20 10:00:00",
    declaration: declaration({
      spouse: { name: "乙欄 春子", birthday: "1982-03-03", totalIncome: 0, disability: "none", livingTogether: true },
      dependents: [person("乙欄 夏子", "子", "2009-08-08", { disability: "general" })],
    }),
  },
  {
    staff_id: "5003", year: 2026, result: null, settle_year: null, settle_month: null, updated_at: "2026-11-20 10:00:00",
    declaration: declaration({ dependents: [person("見込み 一子", "子", "2011-03-01")] }),
  },
];
(window as any).__saved = saved;

// 1〜11月分の確定した給与（使った扶養人数は、そのときの扶養人数）
const salaries = store.staff.flatMap((s) => Array.from({ length: 11 }, (_, i) => ({
  staff_id: s.id, target_month: i + 1, taxable_amount: 300_000, social_ins_total: 45_000, income_tax: 6_000,
  applied_dependents: s.id === "5003" ? 1 : s.dependents, payment_day: 25,
})));

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
    // 年末調整の画面
    if (q.startsWith("SELECT r.staff_id, r.target_month, r.taxable_amount, r.social_ins_total, r.income_tax, r.applied_dependents, g.payment_day")) {
      return params[0] === 2026 ? salaries : [];
    }
    if (q.startsWith("SELECT r.*, s.payment_date AS payment_date FROM bonus_results r")) return [];
    if (q.startsWith("SELECT * FROM year_end_adjustments WHERE year = ?")) return saved.filter((r) => r.year === params[0]);
    if (q.startsWith("SELECT staff_id, target_year, target_month, year_end_adjustment FROM salary_results")) return [];
    // 従業員の画面（扶養人数と比べる申告書）
    if (q.startsWith("SELECT year, declaration, result FROM year_end_adjustments WHERE staff_id = ?")) {
      return saved.filter((r) => r.staff_id === String(params[0])).map(({ year, declaration, result }) => ({ year, declaration, result }));
    }
    return [];
  },
  async execute(sql: string, params: any[] = []) {
    const q = flat(sql);
    if (q.startsWith("UPDATE staff SET")) {
      const cols = /UPDATE staff SET (.*) WHERE id=\?/.exec(q)?.[1].split(",").map((c) => c.trim().replace(/=\?$/, "")) ?? [];
      const s = store.staff.find((x) => x.id === String(params[params.length - 1]));
      if (s) cols.forEach((c, i) => { s[c] = params[i]; });
      console.info("fakeDb: 従業員を保存した", s?.name, { dependents: s?.dependents, dependents_history: s?.dependents_history });
    } else if (q.startsWith("INSERT INTO year_end_adjustments")) {
      const [staff_id, year, declaration, ...rest] = params;
      const withResult = rest.length === 3;
      const row = {
        staff_id: String(staff_id), year, declaration,
        result: withResult ? rest[0] : null, settle_year: withResult ? rest[1] : null, settle_month: withResult ? rest[2] : null,
        updated_at: "2026-11-25 12:00:00",
      };
      const i = saved.findIndex((r) => r.staff_id === row.staff_id && r.year === year);
      if (i >= 0) saved[i] = row; else saved.push(row);
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
      <h1 style={{ fontSize: 20, margin: 0 }}>扶養人数と扶養控除等申告書（確かめ用）</h1>
      <section id="staff" style={{ background: "white", borderRadius: 8, padding: 12 }}>
        <h2 style={{ fontSize: 16 }}>1. 従業員の画面</h2>
        <StaffManager db={fakeDb as any} onDataChange={() => notify()} staffList={staffList} />
      </section>
      <section id="nencho" style={{ background: "white", borderRadius: 8, padding: 12 }}>
        <h2 style={{ fontSize: 16 }}>2. 年末調整の画面（令和8年分）</h2>
        <NenchoManager db={fakeDb as any} staffList={staffList} />
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
