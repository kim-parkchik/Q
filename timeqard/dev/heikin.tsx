/**
 * Q の平均賃金（労働基準法12条）と、それを使う額（休業手当・休業補償・解雇予告手当）を、見本の値で画面に出す（開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/heikin.html を開く
 * 会社：末日締め・翌月25日払い。8〜10月の分（9〜11月支給）の給与は、Q の給与の計算（calcSalary.ts）で作って確定してある
 * 見本の5人：
 *   1001 山田さん：月給30万円・通勤手当1万円。水曜日は10時間働く（残業）。11月9日・10日・12日に会社都合で休ませた
 *   1002 佐藤さん：時給1,200円で月〜木に6時間・通勤手当（月額）6千円。最低保障のほうが高い。11月16日に休ませ、17日は2時間で帰した
 *   1003 鈴木さん：月給28万円。育児休業（2025年9月1日〜2026年9月20日）から9月21日に復帰（除く期間）
 *   1004 高橋さん：2026年10月5日に入社（直前の締日までが、ひとつの賃金計算期間に満たないので、Q では計算せず手で入れる）
 *   1005 伊藤さん：月給26万円。11月10日に仕事中にけがをし、11日から休業（最初の3日は会社が休業補償を払う）
 * 1. 平均賃金の画面（AverageWageManager.tsx）　2. 2026年12月支給（11月の分）の給与への反映（calcSalary.ts）
 * 3. 給与規定グループの休業手当の率　4. 給与項目設定の「平均賃金」　5. 従業員の画面の事故の日　6. 勤怠の区分「休業（会社都合）」
 */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import dayjs from "dayjs";
import { ToastProvider } from "../../src/components/Toast";
import { MessageDialogProvider } from "../../src/components/MessageDialog";
import AverageWageManager from "../../src/features/payroll/AverageWageManager";
import PayrollGroupTab from "../../src/features/settings/company/PayrollGroupTab";
import CustomItemManager from "../../src/features/settings/CustomItemManager";
import LeaveSection from "../../src/features/settings/staff/LeaveSection";
import AttendanceTable from "../../src/features/attendance/manager/AttendanceTable";
import { calculateSalary, type SalaryExtras, type SalaryResult } from "../../src/utils/calcSalary";
import { salaryLedgerOf } from "../../src/utils/legalBooks";
import { countNonLeaveWorkDays, leaveByDate } from "../../src/utils/leaveOfAbsence";
import { stringifyLeavePeriods, type LeavePeriod } from "../../src/utils/leaveExemption";
import { countPrescribedWorkDays, isPrescribedWorkDay, parseWorkDays, type CalendarContext } from "../../src/utils/annualWorkDays";
import { loadAverageWagePay } from "../../src/utils/averageWageStore";
import { DEFAULT_FLEX_RULE } from "../../src/utils/flexTime";

// ── Tauri の代わり（確かめの窓は、いつも1つ目のボタン（「はい」「消す」）にする） ──
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

const COMPANY = { week_start_day: 0, round_overtime: "round", round_social_ins: "currency_law", round_emp_ins: "currency_law" };
const calendarOf = (days: string): CalendarContext => ({ patternId: 0, workDays: parseWorkDays(days), holidays: new Set(), companyCalendar: {} });
const periodOf = (month: number) => ({ start: `2026-${String(month).padStart(2, "0")}-01`, end: dayjs(`2026-${month}-01`).endOf("month").format("YYYY-MM-DD") });

// ── 見本の5人 ──
const base = { scheduled_work_hours: 8, payroll_group_id: 1, status: "active", calendar_pattern_id: 0, standard_remuneration: 300000, birthday: "1985-04-01" };
const staffList: any[] = [
  { ...base, id: "1001", name: "山田 太郎", wage_type: "monthly", base_wage: 300000, commute_type: "monthly", commute_amount: 10000, join_date: "2018-04-01", work_days: "mon,tue,wed,thu,fri" },
  { ...base, id: "1002", name: "佐藤 花子", wage_type: "hourly", base_wage: 1200, scheduled_work_hours: 6, commute_type: "monthly", commute_amount: 6000, join_date: "2021-05-01", work_days: "mon,tue,wed,thu", standard_remuneration: 0 },
  { ...base, id: "1003", name: "鈴木 一郎", wage_type: "monthly", base_wage: 280000, commute_type: "none", commute_amount: 0, join_date: "2019-04-01", work_days: "mon,tue,wed,thu,fri",
    leave_periods: stringifyLeavePeriods([{ type: "childcare", start: "2025-09-01", end: "2026-09-20" }]) },
  { ...base, id: "1004", name: "高橋 二郎", wage_type: "monthly", base_wage: 250000, commute_type: "none", commute_amount: 0, join_date: "2026-10-05", work_days: "mon,tue,wed,thu,fri" },
  { ...base, id: "1005", name: "伊藤 三郎", wage_type: "monthly", base_wage: 260000, commute_type: "none", commute_amount: 0, join_date: "2015-04-01", work_days: "mon,tue,wed,thu,fri",
    leave_periods: stringifyLeavePeriods([{ type: "injury", start: "2026-11-11", end: "2026-11-30", accident: "2026-11-10" }]) },
];
const ctxOf = (s: any) => calendarOf(s.work_days);

/** 勤怠（確定）。from〜to の所定労働日に働き、休業の期間・入社前の日は入れない。dayRow で日ごとに変えられる */
const attendanceOf = (s: any, from: string, to: string, dayRow: (date: string) => { type?: string; hours?: number } | null = () => ({})) => {
  const leaves: LeavePeriod[] = s.leave_periods ? JSON.parse(s.leave_periods) : [];
  const rows: any[] = [];
  for (let d = dayjs(from); !d.isAfter(dayjs(to)); d = d.add(1, "day")) {
    const date = d.format("YYYY-MM-DD");
    if (!isPrescribedWorkDay(d.toDate(), ctxOf(s)) || date < s.join_date || leaves.some((p) => date >= p.start && (!p.end || date <= p.end))) continue;
    const o = dayRow(date);
    if (!o) continue;
    rows.push({ staff_id: s.id, work_date: date, work_type: o.type ?? "normal", work_hours: o.hours ?? s.scheduled_work_hours, night_hours: 0, is_finalized: 1 });
  }
  return rows;
};
/** 山田さんは水曜日に10時間（2時間の残業） */
const dayRowOf = (s: any) => (date: string) => (s.id === "1001" && dayjs(date).day() === 3 ? { hours: 10 } : {});

const extrasOf = (s: any, period: { start: string; end: string }, o: Partial<SalaryExtras> = {}): SalaryExtras => {
  const ctx = ctxOf(s);
  return {
    allowanceName: "", allowanceAmount: 0, residentTax: 0, prefecture: "東京", dependents: 0, customItems: [],
    period, periodWorkDays: countPrescribedWorkDays(ctx, period.start, period.end),
    employedWorkDays: countPrescribedWorkDays(ctx, s.join_date > period.start ? s.join_date : period.start, period.end),
    nonLeaveWorkDays: countNonLeaveWorkDays(ctx, s, period), annualWorkDays: 261, absenceDeductionMethod: "workdays", leaveProrationMethod: "workdays", ...o,
  };
};

// ── 会社ファイルの代わり ──
const store = {
  rate: 60,
  attendance: [] as any[],
  salaries: [] as { staff_id: string; target_year: number; target_month: number; ledger: string; total_earnings: number; leave_paid_days: number | null }[],
  overrides: new Map<string, { amount_sen: number; note: string; created_at: string }>(),
  items: [
    { id: 1, name: "住宅手当", type: "earning", category: "fixed", display_order: 10, in_overtime_base: 0, average_wage: null as string | null },
    { id: 2, name: "歩合給", type: "earning", category: "variable", display_order: 20, in_overtime_base: 1, average_wage: null as string | null },
    { id: 3, name: "結婚祝金", type: "earning", category: "variable", display_order: 30, in_overtime_base: 0, average_wage: "none" as string | null },
    { id: 4, name: "社宅費", type: "deduction", category: "fixed", display_order: 10, in_overtime_base: 1, average_wage: null as string | null },
  ],
  logs: [] as string[],
};
// 8〜10月の分の給与を、Q の計算で作って確定する（9〜11月支給）
for (const s of staffList) {
  store.attendance.push(...attendanceOf(s, "2026-08-01", "2026-10-31", dayRowOf(s)));
  for (const month of [8, 9, 10]) {
    const period = periodOf(month);
    if (s.join_date > period.end) continue;
    const rows = store.attendance.filter((a) => a.staff_id === s.id && a.work_date >= period.start && a.work_date <= period.end);
    const r = calculateSalary(s, rows, extrasOf(s, period), 2026, month + 1, COMPANY);
    store.salaries.push({
      staff_id: s.id, target_year: 2026, target_month: month + 1, total_earnings: r.totalEarnings, leave_paid_days: r.leave?.paidDays ?? null,
      ledger: JSON.stringify(salaryLedgerOf(r, { wageType: s.wage_type, commuteType: s.commute_type, period })),
    });
  }
}
// 11月の分の勤怠（12月支給）：山田さん 9・10・12日、佐藤さん 16日（17日は2時間で帰した）は会社都合で休ませた
const shutdown: Record<string, Record<string, number>> = {
  "1001": { "2026-11-09": 0, "2026-11-10": 0, "2026-11-12": 0 },
  "1002": { "2026-11-16": 0, "2026-11-17": 2 },
};
for (const s of staffList) {
  store.attendance.push(...attendanceOf(s, "2026-11-01", "2026-11-30", (date) => {
    const h = shutdown[s.id]?.[date];
    return h !== undefined ? { type: "company_leave", hours: h } : dayRowOf(s)(date);
  }));
}
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());
(window as any).__heikin = store;

const fakeDb = {
  async select(sql: string, params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT closing_day, is_next_month, shutdown_allowance_rate FROM payroll_groups")) return [{ closing_day: 99, is_next_month: 1, shutdown_allowance_rate: store.rate }];
    if (q.startsWith("SELECT shutdown_allowance_rate FROM payroll_groups")) return [{ shutdown_allowance_rate: store.rate }];
    if (q.startsWith("SELECT target_year, target_month, ledger, total_earnings, leave_paid_days FROM salary_results")) {
      return store.salaries.filter((x) => x.staff_id === String(params[0]) && x.target_year * 12 + x.target_month >= params[1] && x.target_year * 12 + x.target_month <= params[2]);
    }
    if (q.startsWith("SELECT work_date, work_type, work_hours FROM attendance")) {
      return store.attendance.filter((a) => a.staff_id === String(params[0]) && a.work_date >= params[1] && a.work_date <= params[2]);
    }
    if (q.startsWith("SELECT work_date FROM attendance WHERE staff_id = ? AND work_type = ?")) {
      return store.attendance.filter((a) => a.staff_id === String(params[0]) && a.work_type === params[1] && a.work_date >= params[2] && a.work_date < params[3]);
    }
    if (q.startsWith("SELECT amount_sen, note, created_at FROM average_wage_overrides")) {
      const o = store.overrides.get(`${params[0]}:${params[1]}`);
      return o ? [o] : [];
    }
    if (q.startsWith("SELECT id, name, type, category, display_order")) return store.items.map((i) => ({ ...i }));
    if (q.startsWith("SELECT item_id, amount FROM staff_salary_values")) return [];
    console.warn("fakeDb: 知らない SELECT", q, params);
    return [];
  },
  async execute(sql: string, params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("INSERT INTO average_wage_overrides")) {
      store.overrides.set(`${params[0]}:${params[1]}`, { amount_sen: params[2], note: params[3], created_at: "2026-11-14 10:00:00" });
      notify();
    } else if (q.startsWith("DELETE FROM average_wage_overrides")) {
      store.overrides.delete(`${params[0]}:${params[1]}`);
      notify();
    } else if (q.startsWith("UPDATE salary_item_master SET average_wage")) {
      const item = store.items.find((i) => i.id === params[1]);
      if (item) item.average_wage = params[0];
    } else if (q.startsWith("INSERT INTO app_logs")) {
      store.logs.push(String(params[3]));
    } else {
      console.warn("fakeDb: 知らない EXECUTE", q, params);
    }
    return { rowsAffected: 1 };
  },
};

function useStoreTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const f = () => setTick((t) => t + 1);
    listeners.add(f);
    return () => { listeners.delete(f); };
  }, []);
  return tick;
}

/** 12月支給（11月の分）の給与（平均賃金は、確定した給与から loadAverageWagePay で読む） */
function SalaryPreview() {
  const tick = useStoreTick();
  const [results, setResults] = useState<{ name: string; r: SalaryResult }[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const period = periodOf(11);
      const out: { name: string; r: SalaryResult }[] = [];
      for (const id of ["1001", "1002", "1005"]) {
        const s = staffList.find((x) => x.id === id)!;
        const rows = store.attendance.filter((a) => a.staff_id === id && a.work_date >= period.start && a.work_date <= period.end);
        const averageWagePay = await loadAverageWagePay(fakeDb, s, period, rows, ctxOf(s));
        out.push({ name: s.name, r: calculateSalary(s, rows, extrasOf(s, period, { averageWagePay }), 2026, 12, COMPANY) });
      }
      if (!cancelled) setResults(out);
    })();
    return () => { cancelled = true; };
  }, [tick]);
  (window as any).__heikinSalary = results;
  const cell = { border: "1px solid #e2e8f0", padding: 4 } as const;
  return (
    <div style={{ background: "white", borderRadius: 8, padding: 12 }}>
      <table id="salary-table" style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
        <thead>
          <tr>{["", "基本給・時給分", "休業の日の控除", "休業手当", "休業補償(非課税)", "支給合計", "課税対象", "雇用保険", "計算式・知らせ"].map((h) => (
            <th key={h} style={{ ...cell, background: "#f1f5f9" }}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {results.map(({ name, r }) => (
            <tr key={name}>
              <td style={cell}>{name}</td>
              {[r.basePay, -(r.shutdown?.deduction ?? 0), r.shutdown?.allowance ?? 0, r.injuryCompensation?.amount ?? 0, r.totalEarnings, r.taxableAmount, r.empInsurance].map((v, i) => (
                <td key={i} style={{ ...cell, textAlign: "right" }}>{v.toLocaleString()}</td>
              ))}
              <td style={{ ...cell, fontSize: 11 }}>
                {[...(r.shutdown?.lines ?? []), ...(r.shutdown?.notes ?? []), ...(r.injuryCompensation?.lines ?? []), ...r.averageWageMissing].map((l) => <div key={l}>{l}</div>)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Page() {
  useStoreTick();
  // 給与規定グループの画面（useCompanyManager の代わり。休業手当の率を変えると、2. の休業手当が変わる）
  const [rate, setRate] = useState(store.rate);
  const g = { name: "全社共通規定", closing_day: 99, is_next_month: 1, payment_day: 25 };
  const groupCm: any = {
    payrollGroups: [{ id: 1, ...g, tax_calc_method: "table", social_ins_collection: "current", proration_method: "none", leave_proration_method: "workdays",
      absence_deduction_method: "workdays", tardy_deduction_method: "none", fixed_break: null, flex_rule: null, shutdown_allowance_rate: store.rate }],
    pgName: g.name, setPgName: () => {}, pgClosingDay: 99, setPgClosingDay: () => {}, pgIsNextMonth: 1, setPgIsNextMonth: () => {}, pgPaymentDay: 25, setPgPaymentDay: () => {},
    pgTaxMethod: "table", setPgTaxMethod: () => {}, pgSocialInsCollection: "current", setPgSocialInsCollection: () => {}, pgProrationMethod: "none", setPgProrationMethod: () => {},
    pgLeaveProrationMethod: "workdays", setPgLeaveProrationMethod: () => {}, pgAbsenceDeductionMethod: "workdays", setPgAbsenceDeductionMethod: () => {},
    pgTardyDeductionMethod: "none", setPgTardyDeductionMethod: () => {}, pgFixedBreak: null, setPgFixedBreak: () => {}, pgFlexRule: DEFAULT_FLEX_RULE, setPgFlexRule: () => {},
    pgShutdownRate: rate, setPgShutdownRate: setRate,
    editingPgId: 1, deletingPgId: null, setDeletingPgId: () => {}, startEditPg: () => {}, resetPgForm: () => {}, deletePayrollGroup: () => {},
    savePayrollGroup: () => { store.rate = Math.max(60, Math.min(100, Number(rate) || 60)); notify(); },
  };
  // 従業員の画面の「休業・休職」（伊藤さん）
  const [leaves, setLeaves] = useState<LeavePeriod[]>(JSON.parse(staffList[4].leave_periods));
  const staffCm: any = { targetLeavePeriods: leaves, setTargetLeavePeriods: setLeaves, targetIsExecutive: 0 };
  // 勤怠の画面（山田さんの11月）
  const NOV = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`);
  const rows: Record<string, any> = {};
  for (const a of store.attendance.filter((x) => x.staff_id === "1001" && x.work_date.startsWith("2026-11-") && x.work_date <= "2026-11-13")) {
    const worked = a.work_hours > 0;
    rows[a.work_date] = { in: worked ? "09:00" : "", out: worked ? (a.work_hours === 10 ? "20:00" : "18:00") : "", breaks: worked ? [{ start: "12:00", end: "13:00" }] : [], csvBreaks: [],
      is_finalized: 1, workType: a.work_type, leaveTypeId: null, leavePaid: null, specialHours: 0, paidHours: 0, memo: a.work_type === "company_leave" ? "受注減" : "",
      savedHours: a.work_hours, nightHours: 0, breakNone: false, autoBreak: "" };
  }
  const am: any = {
    isLoading: false, isClosed: false, monthlyWorkData: rows, dateList: NOV, holidays: {}, companyHolidays: {}, fixedBreakRule: null, breakInfo: {},
    hourlyLeaveEnabled: false, leaveTypes: [], paidLeave: null, halfDayLeaveEnabled: true, halfDayInPeriod: false, leaveDays: leaveByDate(staffList[0], NOV),
    handleCellChange: () => {}, handleWorkTypeChange: () => {}, handleHourlyLeaveTypeChange: () => {}, finalizeAttendance: async () => true, unfinalizeAttendance: async () => {},
  };
  return (
    <div style={{ maxWidth: 1150, margin: "0 auto", padding: 20, display: "flex", flexDirection: "column", gap: 28 }}>
      <section>
        <h2>1. 平均賃金の画面（メニューの「平均賃金」）</h2>
        <AverageWageManager db={fakeDb as any} staffList={staffList} />
      </section>
      <section>
        <h2 id="salary">2. 給与への反映（2026年12月支給・11月の分。平均賃金は8〜10月の分の確定した給与から）</h2>
        <SalaryPreview />
      </section>
      <section>
        <h2>3. 給与規定グループ（休業手当の率を変えて「保存」すると、2. の休業手当が変わる）</h2>
        <PayrollGroupTab cm={groupCm} />
      </section>
      <section>
        <h2>4. 給与項目設定（支給項目の「平均賃金」）</h2>
        <CustomItemManager db={fakeDb as any} staffList={staffList} />
      </section>
      <section>
        <h2>5. 従業員の画面の「休業・休職」（伊藤さん。業務上の負傷・疾病の事故の日）</h2>
        <div style={{ background: "white", borderRadius: 8, padding: 16, maxWidth: 640 }}>
          <LeaveSection cm={staffCm} />
        </div>
      </section>
      <section>
        <h2>6. 勤怠の画面（山田さんの11月。区分「休業（会社都合）」）</h2>
        <div style={{ background: "white", borderRadius: 8, padding: 10 }}>
          <AttendanceTable am={am} />
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
