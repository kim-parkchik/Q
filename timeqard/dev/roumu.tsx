/**
 * Q の「労働条件通知書」「36協定」「社会保険のそのほかの届書」「労災の書類」「高年齢者・障害者の雇用状況報告」「毎月勤労統計調査」と、
 * 雇用保険の届書の画面の「外国人雇用状況届出書」を、見本の値で画面に出す（開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/roumu.html を開く
 * 会社：労務サンプル株式会社（東京都。本店・大阪支店）。給与は末日締め・翌月25日払い。定年は60歳（労働条件通知書の会社の初めの値）
 * ・正社員 一郎（月給 30万円・役職手当 2万円・通勤手当 1万円。9時〜18時・休憩1時間。2026年4月〜10月の残業 50・90・46・20 時間…）
 * ・パート 花子（時給 1,200円・月水金の5時間・有期契約（更新あり）。雇用保険に入っていない外国人の方（ベトナム。2026年10月5日入社））
 * ・定年 二郎（1966年6月10日生まれ。2026年6月9日に60歳で定年、続けて雇っている）・障害 三郎（身体障害者（重度）・週25時間）
 * 給与は2026年5月〜11月支給の分を確定してある（賃金台帳の内訳つき）。賞与は2026年7月10日に正社員 一郎へ50万円
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "../../src/components/Toast";
import { MessageDialogProvider } from "../../src/components/MessageDialog";
import LaborConditionsManager from "../../src/features/settings/LaborConditionsManager";
import Kyotei36Manager from "../../src/features/attendance/Kyotei36Manager";
import ShahoOtherManager from "../../src/features/payroll/ShahoOtherManager";
import RousaiManager from "../../src/features/payroll/RousaiManager";
import EmploymentStatusManager from "../../src/features/payroll/EmploymentStatusManager";
import MaikinManager from "../../src/features/payroll/MaikinManager";
import GaikokujinReportPanel from "../../src/features/payroll/GaikokujinReportPanel";

const pad = (n: number) => String(n).padStart(2, "0");
const store: any = {
  company: {
    id: 1, name: "労務サンプル株式会社", zip_code: "100-0005", address: "東京都千代田区丸の内1-1-1", phone: "03-1234-5678", representative: "代表取締役 見本 太郎",
    corporate_number: "1234567890123", labor_ins_num: "13101123456000", koyo_office_number: "1301-123456-7", koyo_hello_work: "飯田橋", rousai_business: "94",
    shaho_office_symbol: "01-イロハ", shaho_office_number: "12345", bonus_plan_months: "7,12", annual_holidays: 120, hourly_leave: 1,
    labor_conditions: JSON.stringify({ retirementAge: "有（60歳）", continuedEmployment: "有（65歳まで）", resignNotice: "退職する30日以上前に届け出ること" }),
    kyotei36: null, employment_report: null,
  },
  branches: [
    { id: 1, name: "本店", prefecture: "東京都", address: "東京都千代田区丸の内1-1-1", phone: "03-1234-5678", labor_ins_num: "", rousai_business: "" },
    { id: 2, name: "大阪支店", prefecture: "大阪府", address: "大阪府大阪市北区梅田1-1-1", phone: "06-1234-5678", labor_ins_num: "", rousai_business: "" },
  ],
};
const staffList: any[] = [
  {
    id: "1001", name: "正社員 一郎", furigana: "せいしゃいん いちろう", gender: "male", birthday: "1985-04-10", join_date: "2015-04-01", branch_id: 1, payroll_group_id: 1,
    wage_type: "monthly", base_wage: 300000, scheduled_in: "09:00", scheduled_work_hours: 8, calendar_pattern_id: 1, is_overtime_eligible: 1, commute_type: "monthly",
    commute_amount: 10000, is_employment_ins_eligible: 1, standard_remuneration: 340000, social_insurance_group_id: 1, pension_num: "12", basic_pension_number: "1234567890",
    health_ins_num: "12345678 1", zip_code: "160-0001", address: "東京都新宿区片町1-1", job_type: "営業", status: "active",
  },
  {
    id: "1002", name: "パート 花子", furigana: "ぐえん てぃ はな", gender: "female", birthday: "1998-02-03", join_date: "2026-10-05", branch_id: 1, payroll_group_id: 1,
    wage_type: "hourly", base_wage: 1200, scheduled_in: "10:00", scheduled_work_hours: 5, calendar_pattern_id: 0, work_days: "mon,wed,fri", is_employment_ins_eligible: 0,
    standard_remuneration: 0, job_type: "販売", status: "active",
    koyo_info: JSON.stringify({
      contract: { has: true, start: "2026-10-05", end: "2027-03-31", renewal: "有" },
    }), foreign_info: JSON.stringify({ romaji: "NGUYEN THI HOA", nationality: "ベトナム", status: "35", statusText: "", periodEnd: "2028-03-31", permission: "無", card: "AB12345678CD", dispatch: "非該当", checkedOn: "2026-10-05" }),
  },
  {
    id: "1003", name: "定年 二郎", furigana: "ていねん じろう", gender: "male", birthday: "1966-06-10", join_date: "1990-04-01", branch_id: 1, payroll_group_id: 1,
    wage_type: "monthly", base_wage: 250000, scheduled_in: "09:00", scheduled_work_hours: 8, calendar_pattern_id: 1, is_employment_ins_eligible: 1,
    standard_remuneration: 260000, social_insurance_group_id: 1, pension_num: "3", status: "active",
  },
  {
    id: "1004", name: "障害 三郎", furigana: "しょうがい さぶろう", gender: "male", birthday: "1975-09-01", join_date: "2022-04-01", branch_id: 1, payroll_group_id: 1,
    wage_type: "hourly", base_wage: 1300, scheduled_in: "09:00", scheduled_work_hours: 5, calendar_pattern_id: 0, work_days: "mon,tue,wed,thu,fri",
    is_employment_ins_eligible: 1, standard_remuneration: 142000, social_insurance_group_id: 1, pension_num: "4", status: "active",
    disability_employment: JSON.stringify({ kind: "physical", severe: true, note: "身体障害者手帳2級" }),
  },
];
const ledger = (o: any) => JSON.stringify({
  periodStart: o.periodStart ?? null, periodEnd: o.periodEnd ?? null, workDays: 0, workHours: 0, overtimeHours: 0, holidayHours: 0, nightHours: 0,
  earnings: [], deductions: [], totalEarnings: (o.earnings ?? []).reduce((s: number, x: any) => s + x.amount, 0), totalDeductions: 0, netPay: 0, yearEndSettlement: 0, ...o,
});
// 2026年4月〜10月の分（5月〜11月支給）。正社員 一郎の時間外労働（法定時間外）と休日労働
const overtime: Record<number, [number, number]> = { 4: [50, 10], 5: [90, 15], 6: [46, 0], 7: [20, 0], 8: [10, 0], 9: [30, 0], 10: [44, 0] };
const salaries: any[] = [];
for (let m = 4; m <= 10; m++) {
  const from = `2026-${pad(m)}-01`;
  const to = `2026-${pad(m)}-${pad(new Date(2026, m, 0).getDate())}`;
  const [ot, hol] = overtime[m];
  const otPay = Math.round(ot * 2200 * 1.25);
  salaries.push({
    staff_id: "1001", target_year: 2026, target_month: m + 1, total_earnings: 330000 + otPay, total_overtime_hours: ot,
    ledger: ledger({ periodStart: from, periodEnd: to, workDays: 21, workHours: 168 + ot + hol, overtimeHours: ot, holidayHours: hol,
      earnings: [{ name: "基本給", amount: 300000, avg: "month" }, { name: "役職手当", amount: 20000, avg: "month" }, { name: "時間外手当(25%割増)", amount: otPay, avg: "time" }, { name: "通勤手当", amount: 10000, avg: "month" }] }),
  });
  salaries.push({
    staff_id: "1003", target_year: 2026, target_month: m + 1, total_earnings: 250000, total_overtime_hours: 0,
    ledger: ledger({ periodStart: from, periodEnd: to, workDays: 21, workHours: 168, earnings: [{ name: "基本給", amount: 250000, avg: "month" }] }),
  });
  salaries.push({
    staff_id: "1004", target_year: 2026, target_month: m + 1, total_earnings: 136500, total_overtime_hours: 0,
    ledger: ledger({ periodStart: from, periodEnd: to, workDays: 21, workHours: 105, earnings: [{ name: "時給分", amount: 136500, avg: "time" }] }),
  });
}
const bonuses = [{ staff_id: "1001", payment_date: "2026-07-10", name: "2026年夏季賞与", total_earnings: 500000 }];
const attendance: any[] = [];
for (let m = 1; m <= 11; m++) {
  for (let d = 1; d <= new Date(2026, m, 0).getDate(); d++) {
    const day = new Date(2026, m - 1, d).getDay();
    if (day !== 0 && day !== 6) attendance.push({ staff_id: "1001", work_date: `2026-${pad(m)}-${pad(d)}`, work_type: "normal", work_hours: 8 });
  }
}
(window as any).__roumu = { store, staffList, salaries };

const staffOf = (id: unknown) => staffList.find((s) => s.id === String(id));
const fakeDb = {
  async select(sql: string, params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT * FROM company WHERE id = 1") || q.includes("FROM company WHERE id = 1")) return [store.company];
    if (q.startsWith("SELECT * FROM branches") || q.startsWith("SELECT id, name, address, phone, labor_ins_num, rousai_business FROM branches") || q.startsWith("SELECT id, name FROM branches")) return store.branches;
    if (q.startsWith("SELECT prefecture FROM branches WHERE id = 1")) return [store.branches[0]];
    if (q.startsWith("SELECT name, address FROM branches WHERE id = ?")) return store.branches.filter((b: any) => b.id === params[0]);
    if (q.startsWith("SELECT closing_day, is_next_month, payment_day, fixed_break FROM payroll_groups")) {
      return [{ closing_day: 99, is_next_month: 1, payment_day: 25, fixed_break: JSON.stringify({ mode: "time", start: "12:00", end: "13:00", combine: "record" }) }];
    }
    if (q.startsWith("SELECT closing_day, is_next_month, payment_day FROM payroll_groups")) return [{ closing_day: 99, is_next_month: 1, payment_day: 25 }];
    if (q.startsWith("SELECT id, closing_day")) return [{ id: 1, closing_day: 99, is_next_month: 1 }];
    if (q.startsWith("SELECT closing_day, is_next_month, shutdown_allowance_rate FROM payroll_groups")) return [{ closing_day: 99, is_next_month: 1, shutdown_allowance_rate: 60 }];
    if (q.startsWith("SELECT m.name, v.amount FROM staff_salary_values")) return params[0] === "1001" ? [{ name: "役職手当", amount: 20000 }] : [];
    if (q.startsWith("SELECT name FROM salary_item_master")) return [{ name: "役職手当" }, { name: "家族手当" }];
    if (q.startsWith("SELECT name, is_paid FROM leave_types")) return [{ name: "慶弔休暇", is_paid: 1 }, { name: "生理休暇", is_paid: 0 }];
    if (q.startsWith("SELECT COUNT(*) AS n FROM staff_bank_accounts")) return [{ n: params[0] === "1001" ? 1 : 0 }];
    if (q.startsWith("SELECT holiday_date FROM holiday_master")) return [{ holiday_date: "2026-11-03" }, { holiday_date: "2026-11-23" }];
    if (q.startsWith("SELECT work_date, is_holiday FROM company_calendar")) return [];
    if (q.startsWith("SELECT name FROM social_insurance_groups")) return [];
    if (q.startsWith("SELECT target_year, target_month, ledger, total_overtime_hours FROM salary_results")) {
      return salaries.filter((r) => r.staff_id === params[0] && r.target_year * 100 + r.target_month >= params[1] && r.target_year * 100 + r.target_month <= params[2]);
    }
    if (q.startsWith("SELECT target_year, target_month, ledger, total_earnings, leave_paid_days FROM salary_results")) {
      return salaries.filter((r) => r.staff_id === params[0] && r.target_year * 12 + r.target_month >= params[1] && r.target_year * 12 + r.target_month <= params[2])
        .map((r) => ({ ...r, leave_paid_days: null }));
    }
    if (q.startsWith("SELECT work_date, work_type, work_hours FROM attendance")) {
      return attendance.filter((a) => a.staff_id === params[0] && a.work_date >= params[1] && a.work_date <= params[2]);
    }
    if (q.startsWith("SELECT amount_sen, note, created_at FROM average_wage_overrides")) return [];
    if (q.startsWith("SELECT s.payment_date, b.total_earnings FROM bonus_results")) {
      return bonuses.filter((b) => b.staff_id === params[0] && b.payment_date >= params[1] && b.payment_date <= params[2]);
    }
    if (q.startsWith("SELECT staff_id, ledger, total_earnings FROM salary_results")) {
      return salaries.filter((r) => r.target_year === params[0] && r.target_month === params[1] && params.slice(2).includes(r.staff_id));
    }
    if (q.startsWith("SELECT b.staff_id, s.name, b.total_earnings FROM bonus_results")) {
      return bonuses.filter((b) => b.payment_date >= params[0] && b.payment_date <= params[1] && params.slice(2).includes(b.staff_id));
    }
    console.warn("fakeDb: 知らない SELECT", q, params);
    return [];
  },
  async execute(sql: string, params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    let m: RegExpMatchArray | null;
    if ((m = /^UPDATE company SET (\w+) = \? WHERE id = 1/.exec(q))) store.company[m[1]] = params[0];
    else if ((m = /^UPDATE staff SET (\w+) = \? WHERE id = \?/.exec(q))) {
      const s = staffOf(params[1]);
      if (s) s[m[1]] = params[0];
    } else console.warn("fakeDb: 知らない EXECUTE", q, params);
    return { rowsAffected: 1 };
  },
};

type Tab = "rouken" | "kyotei36" | "shahosonota" | "rousai" | "koyoujoukyou" | "maikin" | "gaikokujin";
const TABS: [Tab, string][] = [
  ["rouken", "労働条件通知書"], ["kyotei36", "36協定"], ["shahosonota", "社会保険のそのほかの届書"], ["rousai", "労災の書類"],
  ["koyoujoukyou", "高年齢者・障害者の雇用状況報告"], ["maikin", "毎月勤労統計調査"], ["gaikokujin", "外国人雇用状況届出書"],
];

function App() {
  const [tab, setTab] = useState<Tab>("rouken");
  return (
    <div style={{ padding: 16 }}>
      <div className="no-print" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {TABS.map(([key, label]) => (
          <button key={key} id={`tab-${key}`} onClick={() => setTab(key)} style={{ padding: "8px 16px", border: "none", borderRadius: 6, cursor: "pointer", background: tab === key ? "#2563eb" : "#cbd5e1", color: tab === key ? "white" : "#1e293b" }}>{label}</button>
        ))}
      </div>
      {tab === "rouken" && <LaborConditionsManager db={fakeDb as any} staffList={staffList} />}
      {tab === "kyotei36" && <Kyotei36Manager db={fakeDb as any} staffList={staffList} />}
      {tab === "shahosonota" && <ShahoOtherManager db={fakeDb as any} staffList={staffList} />}
      {tab === "rousai" && <RousaiManager db={fakeDb as any} staffList={staffList} />}
      {tab === "koyoujoukyou" && <EmploymentStatusManager db={fakeDb as any} staffList={staffList} />}
      {tab === "maikin" && <MaikinManager db={fakeDb as any} staffList={staffList} />}
      {tab === "gaikokujin" && <GaikokujinReportPanel db={fakeDb as any} staffList={staffList} />}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <ToastProvider><MessageDialogProvider><App /></MessageDialogProvider></ToastProvider>,
);
