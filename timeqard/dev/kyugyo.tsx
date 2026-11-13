/**
 * Q の休業・休職（産休・育休・介護休業・業務上の負傷や疾病による休業・その他の休職）の日の扱いを、見本の値で画面に出す（開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/kyugyo.html を開く
 * ・従業員の画面の「休業・休職」（src/features/settings/staff/LeaveSection.tsx）：山田さんの期間を変えると、下の勤怠・給与・出勤簿が変わる
 * ・給与規定グループ（src/features/settings/company/PayrollGroupTab.tsx）の「休業の月の日割り」：変えると、下の給与が変わる
 * ・会社設定の「休暇の種類」（LeaveTypeTab.tsx）の「出勤率での『その他の休職』の日」：保存すると、下の年休の出勤率が変わる
 * ・勤怠の画面（AttendanceTable.tsx）：休業の日の「育休」の印と、休業の日に入れた記録の知らせ
 * ・給与の計算（src/utils/calcSalary.ts）：2026年11月支給（末締め・当月払い）の3人
 *     山田さん：月給30万円・通勤手当1万2千円。11月16日から育休（途中から休業。産休・育休なので社会保険料は免除）
 *     佐藤さん：月給25万円・通勤手当1万円。9月1日〜11月30日に介護休業（まるごと休業。免除がないので社会保険料・住民税を引き、マイナス）
 *     鈴木さん：時給1,200円・固定の皆勤手当1万円。7月1日〜11月15日にその他の休職（16日からの勤怠の分だけ払う）
 * ・年休の出勤率（AnnualLeavePanel.tsx）：11月1日の付与（期間は2025年11月1日〜2026年10月31日）で、佐藤さんの介護休業は出勤とみなし、
 *   鈴木さんのその他の休職は会社の決まり（全労働日から除く・欠勤と同じに数える）で数える
 * ・法定三帳簿の出勤簿（LegalBooksManager.tsx）：山田さんの11月支給の出勤簿で、休業の日の区分が「育児休業」になる
 */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "../../src/components/Toast";
import { MessageDialogProvider } from "../../src/components/MessageDialog";
import LeaveSection from "../../src/features/settings/staff/LeaveSection";
import PayrollGroupTab from "../../src/features/settings/company/PayrollGroupTab";
import LeaveTypeTab from "../../src/features/settings/company/LeaveTypeTab";
import AttendanceTable from "../../src/features/attendance/manager/AttendanceTable";
import { AnnualGrantDueBanner } from "../../src/features/attendance/AnnualLeavePanel";
import LegalBooksManager from "../../src/features/legalBooks/LegalBooksManager";
import { calculateSalary, type ProrationMethod, type AbsenceDeductionMethod, type SocialInsCollection, type TardyDeductionMethod } from "../../src/utils/calcSalary";
import { countNonLeaveWorkDays, leaveByDate, LEAVE_TYPE_NAMES, type LeaveProrationMethod } from "../../src/utils/leaveOfAbsence";
import { stringifyLeavePeriods, type LeavePeriod } from "../../src/utils/leaveExemption";
import { attendanceRateFor, dueAnnualGrants, grantDaysFor, otherLeaveRuleOf, parseAnnualLeaveRule, plannedGrants, workScaleOf, type AttendanceForRate } from "../../src/utils/annualLeaveGrant";
import type { StaffAnnualLeave } from "../../src/utils/annualLeaveOverview";
import { countPrescribedWorkDays, parseWorkDays, type CalendarContext } from "../../src/utils/annualWorkDays";
import { DEFAULT_FLEX_RULE, type FlexRule } from "../../src/utils/flexTime";
import type { FixedBreakRule } from "../../src/utils/fixedBreak";
import type { TaxCalcMethod } from "../../src/utils/incomeTax";
import dayjs from "dayjs";

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

const TODAY = "2026-11-14";
const PERIOD = { start: "2026-11-01", end: "2026-11-30" };
const ctx: CalendarContext = { patternId: 0, workDays: parseWorkDays("mon,tue,wed,thu,fri"), holidays: new Set(), companyCalendar: {} };
const pad = (n: number) => String(n).padStart(2, "0");
const NOV = Array.from({ length: 30 }, (_, i) => `2026-11-${pad(i + 1)}`);
const isWeekday = (date: string) => { const w = new Date(`${date}T00:00:00`).getDay(); return w >= 1 && w <= 5; };

// ── 会社ファイルの代わり ──
const store = { annualRule: null as string | null, attendance: [] as any[] };
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());
const fakeDb = {
  async select(sql: string, params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT * FROM leave_types ORDER BY")) return [];
    if (q.startsWith("SELECT annual_leave_rule FROM company")) return [{ annual_leave_rule: store.annualRule }];
    if (q.startsWith("SELECT id, closing_day, is_next_month FROM payroll_groups")) return [{ id: 1, closing_day: 99, is_next_month: 0 }];
    if (q.startsWith("SELECT a.*, lt.name AS leave_name FROM attendance a")) {
      return store.attendance.filter((a) => a.staff_id === String(params[0]) && a.work_date >= params[1] && a.work_date <= params[2]);
    }
    if (q.includes("FROM salary_results") || q.includes("FROM bonus_results")) return [];
    console.warn("fakeDb: 知らない SELECT", q, params);
    return [];
  },
  async execute(sql: string, params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("UPDATE company SET annual_leave_rule")) {
      store.annualRule = params[0];
      notify();
    } else if (!q.startsWith("INSERT INTO app_logs")) {
      console.warn("fakeDb: 知らない EXECUTE", q, params);
    }
    return { rowsAffected: 1 };
  },
};

// ── 見本の3人 ──
const yamadaBase = {
  id: "1001", name: "山田 太郎", wage_type: "monthly", base_wage: 300000, scheduled_work_hours: 8, commute_type: "monthly", commute_amount: 12000,
  standard_remuneration: 300000, birthday: "1990-06-15", join_date: "2018-04-01", payroll_group_id: 1, status: "active", calendar_pattern_id: 0, work_days: "mon,tue,wed,thu,fri",
};
const sato = {
  id: "1002", name: "佐藤 花子", wage_type: "monthly", base_wage: 250000, scheduled_work_hours: 8, commute_type: "monthly", commute_amount: 10000,
  standard_remuneration: 260000, birthday: "1975-02-10", join_date: "2021-05-01", payroll_group_id: 1, status: "active", calendar_pattern_id: 0, work_days: "mon,tue,wed,thu,fri",
  leave_periods: stringifyLeavePeriods([{ type: "family_care", start: "2026-09-01", end: "2026-11-30" }]),
};
const suzuki = {
  id: "1003", name: "鈴木 一郎", wage_type: "hourly", base_wage: 1200, scheduled_work_hours: 8, commute_type: "none", commute_amount: 0,
  standard_remuneration: 0, birthday: "1988-09-01", join_date: "2020-05-01", payroll_group_id: 1, status: "active", calendar_pattern_id: 0, work_days: "mon,tue,wed,thu,fri",
  leave_periods: stringifyLeavePeriods([{ type: "other", start: "2026-07-01", end: "2026-11-15" }]),
};

/** 平日に8時間の勤怠（確定）。休業の日は入れない（期間の外） */
const workRows = (staffId: string, from: string, to: string, leaves: LeavePeriod[] = []) => {
  const rows: AttendanceForRate[] & any[] = [];
  for (let d = dayjs(from); !d.isAfter(dayjs(to)); d = d.add(1, "day")) {
    const date = d.format("YYYY-MM-DD");
    if (!isWeekday(date) || leaves.some((p) => date >= p.start && (!p.end || date <= p.end))) continue;
    rows.push({ staff_id: staffId, work_date: date, work_type: "normal", work_hours: 8, night_hours: 0, is_finalized: 1,
      csv_entry_time: "09:00", csv_exit_time: "18:00", csv_breaks: JSON.stringify([{ start: "12:00", end: "13:00" }]) });
  }
  return rows;
};

function useStoreTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const f = () => setTick((t) => t + 1);
    listeners.add(f);
    return () => { listeners.delete(f); };
  }, []);
}

function Page() {
  useStoreTick();
  // 従業員の画面の「休業・休職」（山田さん）
  const [leaves, setLeaves] = useState<LeavePeriod[]>([{ type: "childcare", start: "2026-11-16", end: "2027-03-31" }]);
  const yamada = { ...yamadaBase, leave_periods: stringifyLeavePeriods(leaves) };
  const staffCm: any = { targetLeavePeriods: leaves, setTargetLeavePeriods: setLeaves, targetIsExecutive: 0 };

  // 給与規定グループの画面（useCompanyManager の代わり）
  const [pgName, setPgName] = useState("全社共通規定");
  const [pgClosingDay, setPgClosingDay] = useState(99);
  const [pgIsNextMonth, setPgIsNextMonth] = useState(0);
  const [pgPaymentDay, setPgPaymentDay] = useState(25);
  const [pgTaxMethod, setPgTaxMethod] = useState<TaxCalcMethod>("table");
  const [pgSocialInsCollection, setPgSocialInsCollection] = useState<SocialInsCollection>("current");
  const [pgProrationMethod, setPgProrationMethod] = useState<ProrationMethod>("none");
  const [pgLeaveProrationMethod, setPgLeaveProrationMethod] = useState<LeaveProrationMethod>("workdays");
  const [pgAbsenceDeductionMethod, setPgAbsenceDeductionMethod] = useState<AbsenceDeductionMethod>("workdays");
  const [pgTardyDeductionMethod, setPgTardyDeductionMethod] = useState<TardyDeductionMethod>("none");
  const [pgFixedBreak, setPgFixedBreak] = useState<FixedBreakRule | null>(null);
  const [pgFlexRule, setPgFlexRule] = useState<FlexRule>(DEFAULT_FLEX_RULE);
  const groupCm: any = {
    payrollGroups: [{ id: 1, name: pgName, closing_day: pgClosingDay, is_next_month: pgIsNextMonth, payment_day: pgPaymentDay, tax_calc_method: pgTaxMethod,
      social_ins_collection: pgSocialInsCollection, proration_method: pgProrationMethod, leave_proration_method: pgLeaveProrationMethod,
      absence_deduction_method: pgAbsenceDeductionMethod, tardy_deduction_method: pgTardyDeductionMethod, fixed_break: null, flex_rule: null }],
    pgName, setPgName, pgClosingDay, setPgClosingDay, pgIsNextMonth, setPgIsNextMonth, pgPaymentDay, setPgPaymentDay, pgTaxMethod, setPgTaxMethod,
    pgSocialInsCollection, setPgSocialInsCollection, pgProrationMethod, setPgProrationMethod, pgLeaveProrationMethod, setPgLeaveProrationMethod,
    pgAbsenceDeductionMethod, setPgAbsenceDeductionMethod, pgTardyDeductionMethod, setPgTardyDeductionMethod, pgFixedBreak, setPgFixedBreak,
    pgFlexRule, setPgFlexRule, editingPgId: 1, deletingPgId: null, setDeletingPgId: () => {}, startEditPg: () => {}, resetPgForm: () => {},
    savePayrollGroup: () => console.info("給与規定グループを保存（見本では、選んだ値をそのまま使う）"), deletePayrollGroup: () => {},
  };

  // 勤怠の画面（山田さんの11月）：11月2日〜13日の平日は確定、休業の17日に記録を入れた（未確定）
  const [rows, setRows] = useState<Record<string, any>>(() => {
    const r: Record<string, any> = {};
    for (const d of NOV.filter((x) => isWeekday(x) && x <= "2026-11-13")) {
      r[d] = { in: "09:00", out: "18:00", breaks: [{ start: "12:00", end: "13:00" }], csvBreaks: [], is_finalized: 1, workType: "normal", leaveTypeId: null,
        leavePaid: null, specialHours: 0, paidHours: 0, memo: "", savedHours: 8, nightHours: 0, breakNone: false, autoBreak: "", csv_entry_time: "09:00", csv_exit_time: "18:00" };
    }
    r["2026-11-17"] = { ...r["2026-11-13"], in: "10:00", out: "12:00", breaks: [], is_finalized: 0, savedHours: 2, memo: "引き継ぎ" };
    return r;
  });
  const am: any = {
    isLoading: false, isClosed: false, monthlyWorkData: rows, dateList: NOV, holidays: {}, companyHolidays: {}, fixedBreakRule: null, breakInfo: {},
    hourlyLeaveEnabled: false, leaveTypes: [], paidLeave: null, halfDayLeaveEnabled: true, halfDayInPeriod: false,
    leaveDays: leaveByDate(yamada, NOV),
    handleCellChange: (date: string, field: string, value: any) => setRows((p) => ({ ...p, [date]: { ...(p[date] ?? {}), [field]: value } })),
    handleWorkTypeChange: (date: string, value: string) => setRows((p) => ({ ...p, [date]: { ...(p[date] ?? {}), workType: value } })),
    handleHourlyLeaveTypeChange: () => {},
    finalizeAttendance: async (date: string) => { setRows((p) => ({ ...p, [date]: { ...p[date], is_finalized: 1 } })); return true; },
    unfinalizeAttendance: async (date: string) => setRows((p) => ({ ...p, [date]: { ...p[date], is_finalized: 0 } })),
  };
  // 出勤簿に出す勤怠（山田さんは画面の勤怠、鈴木さんは16日からの平日）
  store.attendance = [
    ...Object.entries(rows).filter(([, r]) => r.in || r.out).map(([date, r]) => ({
      staff_id: "1001", work_date: date, work_type: r.workType, work_hours: r.savedHours, night_hours: 0, is_finalized: r.is_finalized,
      entry_time: r.in, exit_time: r.out, breaks: JSON.stringify(r.breaks ?? []), memo: r.memo,
    })),
    ...workRows("1003", "2026-11-16", "2026-11-30"),
  ];

  // 給与の計算（2026年11月支給）
  const yamadaRows = Object.entries(rows).filter(([, r]) => r.is_finalized === 1).map(([date, r]) => ({ work_date: date, work_hours: r.savedHours, night_hours: 0, work_type: r.workType }));
  const people = [
    { staff: yamada, rows: yamadaRows, residentTax: 18000, items: [] as any[] },
    { staff: sato, rows: [], residentTax: 15000, items: [] as any[] },
    { staff: suzuki, rows: workRows("1003", "2026-11-16", "2026-11-20"), residentTax: 0, items: [{ name: "皆勤手当", amount: 10000, type: "earning" as const, fixed: true }] },
  ];
  const results = people.map((p) => {
    const r = calculateSalary(p.staff, p.rows, {
      allowanceName: "", allowanceAmount: 0, residentTax: p.residentTax, prefecture: "東京", dependents: 0, customItems: p.items,
      period: PERIOD, periodWorkDays: countPrescribedWorkDays(ctx, PERIOD.start, PERIOD.end), employedWorkDays: countPrescribedWorkDays(ctx, PERIOD.start, PERIOD.end),
      nonLeaveWorkDays: countNonLeaveWorkDays(ctx, p.staff, PERIOD), annualWorkDays: 261,
      prorationMethod: pgProrationMethod, leaveProrationMethod: pgLeaveProrationMethod, absenceDeductionMethod: pgAbsenceDeductionMethod,
    }, 2026, 11, { week_start_day: 0, round_overtime: "round", round_social_ins: "currency_law", round_emp_ins: "currency_law" });
    return { name: p.staff.name, r };
  });
  (window as any).__kyugyo = { store, results, leaves };

  // 年休の出勤率（11月1日の付与。期間は2025年11月1日〜2026年10月31日）
  const rule = parseAnnualLeaveRule(store.annualRule);
  const annualItems: StaffAnnualLeave[] = [sato, suzuki].map((s) => {
    const leaveList: LeavePeriod[] = JSON.parse(s.leave_periods);
    const rateRows = workRows(s.id, "2025-11-01", "2026-10-31", leaveList);
    const planned = plannedGrants(s.join_date, { mode: "hire" }, TODAY);
    const due = dueAnnualGrants(planned, [], TODAY).filter((g) => g.date === "2026-11-01").map((g) => ({
      grant: g, ...grantDaysFor(g.stage, workScaleOf({ ...s }, null)),
      rate: attendanceRateFor(g.periodFrom, g.periodTo, ctx, rateRows, leaveList, null, otherLeaveRuleOf(rule)),
    }));
    return { staffId: s.id, name: `${s.name}（${leaveList.map((l) => `${LEAVE_TYPE_NAMES[l.type]} ${l.start}〜${l.end}`).join("、")}）`, due, noJoinDate: false, next: null, fiveDays: [] };
  });

  const yen = (n: number) => n.toLocaleString();
  return (
    <div style={{ maxWidth: 1150, margin: "0 auto", padding: 20, display: "flex", flexDirection: "column", gap: 28 }}>
      <section>
        <h2>1. 従業員の画面の「休業・休職」（山田 太郎さん）</h2>
        <div style={{ background: "white", borderRadius: 8, padding: 16, maxWidth: 640 }}>
          <LeaveSection cm={staffCm} />
        </div>
      </section>

      <section>
        <h2>2. 給与規定グループ（「休業の月の日割り」を変えると、5. の給与が変わる）</h2>
        <PayrollGroupTab cm={groupCm} />
      </section>

      <section>
        <h2>3. 勤怠の画面（山田 太郎さん・2026年11月）</h2>
        <div style={{ background: "white", borderRadius: 8, padding: 10 }}>
          <AttendanceTable am={am} />
        </div>
      </section>

      <section>
        <h2>4. 会社設定の「休暇の種類」（出勤率での「その他の休職」の日を変えて保存すると、6. が変わる）</h2>
        <LeaveTypeTab db={fakeDb as any} />
      </section>

      <section>
        <h2 id="salary">5. 給与（2026年11月支給・末締め当月払い。平日21日）</h2>
        <table id="salary-table" style={{ background: "white", borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
          <thead>
            <tr>{["", "休業", "日割り", "基本給", "固定の支給項目", "通勤手当", "支給合計", "健康保険", "介護保険", "厚生年金", "雇用保険", "所得税", "住民税", "差引支給額", "支払基礎日数（月給）", "休業の日の記録"].map((h) => (
              <th key={h} style={{ border: "1px solid #cbd5e1", padding: 4, background: "#f1f5f9" }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {results.map(({ name, r }) => (
              <tr key={name}>
                <td style={{ border: "1px solid #e2e8f0", padding: 4 }}>{name}</td>
                <td style={{ border: "1px solid #e2e8f0", padding: 4 }}>{r.leave ? `${r.leave.types.map((t) => LEAVE_TYPE_NAMES[t]).join("・")} ${r.leave.days}日${r.leave.full ? "（まるごと）" : ""}` : "なし"}</td>
                <td style={{ border: "1px solid #e2e8f0", padding: 4 }}>{r.proration ? `${r.proration.numerator}/${r.proration.denominator}（${r.proration.method === "workdays" ? "所定" : "暦日"}）` : r.prorationNote ?? "-"}</td>
                {[r.basePay, r.customEarnings, r.commutePay, r.totalEarnings, r.healthInsurance, r.nursingInsurance, r.welfarePension, r.empInsurance, r.incomeTax, r.residentTax, r.netPay].map((v, i) => (
                  <td key={i} style={{ border: "1px solid #e2e8f0", padding: 4, textAlign: "right", color: v < 0 ? "#b91c1c" : undefined }}>{yen(v)}</td>
                ))}
                <td style={{ border: "1px solid #e2e8f0", padding: 4, textAlign: "right" }}>{r.leave?.paidDays ?? "-"}</td>
                <td style={{ border: "1px solid #e2e8f0", padding: 4 }}>{r.leave?.workedDates.join("・") || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 id="annual">6. 年次有給休暇の付与の知らせ（11月1日の付与。出勤率の期間は2025年11月1日〜2026年10月31日）</h2>
        <AnnualGrantDueBanner items={annualItems} rule={rule} busy={false} onGrant={() => {}} onSkip={() => {}} />
      </section>

      <section>
        <h2>7. 法定三帳簿（出勤簿のタブで、山田さんの2026年11月支給を見る）</h2>
        <LegalBooksManager db={fakeDb as any} staffList={[yamada, sato, suzuki]} />
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
