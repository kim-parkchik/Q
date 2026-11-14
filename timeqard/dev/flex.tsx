/**
 * Q のフレックスタイム制の清算（src/utils/flexTime.ts・calcSalary.ts）を、見本の勤怠で勤怠の画面の知らせ（FlexSummary.tsx）に出す（開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/flex.html を開く
 * ・給与規定グループ（PayrollGroupTab.tsx）の「フレックスタイム制の決まり」：清算期間（1・2・3か月と起算の月）などを変えて「保存」すると、
 *   B. の4〜6月の計算期間の3か月（末日締め・翌月払い。5〜7月支給）の清算が変わる（前の月を確定したものとして、記録を次の月に渡す）
 * ・A. 清算期間1か月（2026年6月・月給30万円・1日8時間）の働き方
 * ・C〜G. 清算期間3か月の、厚生労働省の手引きの例・途中で退職・途中で入社・日給制
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import dayjs from "dayjs";
import FlexSummary from "../../src/features/attendance/manager/FlexSummary";
import PayrollGroupTab from "../../src/features/settings/company/PayrollGroupTab";
import { calculateSalary, type SalaryExtras, type SalaryResult } from "../../src/utils/calcSalary";
import { describeFlexRule, flexPositionOf, type FlexMonthRecord, type FlexRule } from "../../src/utils/flexTime";

const company = { week_start_day: 0, round_overtime: "round" };
const monthly = {
  id: "S001", name: "山田", wage_type: "monthly", base_wage: 300000, scheduled_work_hours: 8, is_flex: 1,
  commute_type: "none", commute_amount: 0, standard_remuneration: 0, birthday: "1990-06-15",
};
const hourly = { ...monthly, wage_type: "hourly", base_wage: 1200 };
const daily = { ...monthly, wage_type: "daily", base_wage: 12000 };
const row = (date: string, hours: number, type = "normal") => ({ work_date: date, work_hours: hours, night_hours: 0, work_type: type });
const june = (n: number, hours: number) => Array.from({ length: n }, (_, i) => row(`2026-06-${String(i + 1).padStart(2, "0")}`, hours));
const extras = (o: Partial<SalaryExtras>): SalaryExtras => ({
  allowanceName: "", allowanceAmount: 0, residentTax: 0, prefecture: "東京", dependents: 0, customItems: [],
  period: { start: "2026-06-01", end: "2026-06-30" }, periodWorkDays: 22, employedWorkDays: 22, annualWorkDays: 245, ...o,
});
const one = (o: Partial<FlexRule> = {}): FlexRule => ({ total: { mode: "workdays" }, limit: "standard", shortage: "deduct", months: 1, startMonth: 1, ...o });
const fixed160 = one({ total: { mode: "fixed", hours: 160 } });
const three = (o: Partial<FlexRule> = {}): FlexRule => ({ ...fixed160, months: 3, startMonth: 1, ...o });

/** その月の平日（月〜金）の日数（見本の所定労働日数） */
const weekdaysIn = (from: string, to: string) => {
  let n = 0;
  for (let d = dayjs(from); !d.isAfter(dayjs(to)); d = d.add(1, "day")) if (d.day() !== 0 && d.day() !== 6) n++;
  return n;
};
/** その月の平日に、hours を分の単位で同じくらいに分けて働いた勤怠（合計がちょうど hours になる。入社・退職した月は在籍した日だけ） */
const monthRows = (from: string, to: string, hours: number) => {
  const dates: string[] = [];
  for (let d = dayjs(from); !d.isAfter(dayjs(to)); d = d.add(1, "day")) if (d.day() !== 0 && d.day() !== 6) dates.push(d.format("YYYY-MM-DD"));
  const total = Math.round(hours * 60);
  const each = Math.floor(total / dates.length);
  return dates.map((d, i) => row(d, (each + (i < total - each * dates.length ? 1 : 0)) / 60));
};

interface MonthCase { workMonth: number; hours: number }
interface MonthResult { payLabel: string; r: SalaryResult; staff: any }
/**
 * 2026年の計算期間（末日締め・翌月払い）を順に計算する。前の月を確定したものとして、同じ清算期間の記録を次の月に渡す
 * （utils/flexTime.ts の loadFlexPeriod と同じ読み方。確定していない月は missing に入れる）
 */
const runMonths = (staff: any, rule: FlexRule, months: MonthCase[]): MonthResult[] => {
  const group = { closing_day: 99, is_next_month: 1 };
  const saved = new Map<string, { record: FlexMonthRecord; carry: number }>();
  return months.map(({ workMonth, hours }) => {
    const payMonth = workMonth + 1;
    const pos = flexPositionOf(rule, group, 2026, payMonth);
    const start = dayjs(new Date(2026, workMonth - 1, 1));
    const periodStart = start.format("YYYY-MM-DD");
    const periodEnd = start.endOf("month").format("YYYY-MM-DD");
    const from = staff.join_date && staff.join_date > periodStart ? staff.join_date : periodStart;
    const to = staff.retirement_date && staff.retirement_date < periodEnd ? staff.retirement_date : periodEnd;
    const previous: FlexMonthRecord[] = [];
    const missing: string[] = [];
    for (const p of pos.previousPays) {
      const s = saved.get(`${p.year}-${p.month}`);
      if (s && s.record.periodStart === pos.from && s.record.months === pos.months) previous.push(s.record);
      else if (!(staff.join_date && dayjs(new Date(p.year, p.month - 2, 1)).endOf("month").format("YYYY-MM-DD") < staff.join_date)) {
        missing.push(`${p.year}年${p.month}月支給の給与を確定していません`);
      }
    }
    const carryIn = saved.get(`${pos.carryFrom.year}-${pos.carryFrom.month}`)?.carry ?? 0;
    const r = calculateSalary(staff, monthRows(from, to, hours), extras({
      period: { start: periodStart, end: periodEnd },
      periodWorkDays: weekdaysIn(periodStart, periodEnd), employedWorkDays: weekdaysIn(from, to),
      flexRule: rule, flexPeriod: { ...pos, previous, missing, carryIn },
    }), 2026, payMonth, company);
    if (r.flex) saved.set(`2026-${payMonth}`, { record: r.flex.record, carry: r.flexCarryOutHours });
    return { payLabel: `2026年${payMonth}月支給（${workMonth}月の計算期間）`, r, staff };
  });
};

const numbers = (r: SalaryResult) => ({
  基本給: r.basePay, 法定内残業手当: r.statutoryOvertimePay, 時間外手当_25: r.standardOvertimePay, 時間外手当_50: r.highOvertimePay,
  フレックス不足時間控除: r.flexShortageDeduction, 支給合計: r.totalEarnings,
  時間外労働: Math.round(r.totalOvertimeHours * 100) / 100, うち60時間超: Math.round(r.highPremiumHours * 100) / 100,
  次の清算期間に繰り越す: r.flexCarryOutHours, 計算式: r.flexShortageDetail, 確定できない理由: r.flexMissing,
});

function Box({ title, r, staff, id }: { title: string; r: SalaryResult; staff: any; id: string }) {
  const am: any = { calcResult: r, selectedStaff: staff };
  return (
    <section id={id} style={{ background: "white", borderRadius: 8, padding: 12, marginBottom: 14 }}>
      <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>{title}</h3>
      <FlexSummary am={am} />
      <pre style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap" }}>{JSON.stringify(numbers(r), null, 1)}</pre>
    </section>
  );
}

const oneMonthCases: { title: string; staff: any; rows: any[]; o: Partial<SalaryExtras> }[] = [
  { title: "A1. 完全週休2日の特例（総枠176時間）で、1日9時間 × 20日 ＝ 180時間", staff: monthly, rows: june(20, 9), o: { flexRule: one({ limit: "fiveDay" }) } },
  { title: "A2. 原則の総枠（171.4時間）で、総労働時間 22日 × 8時間 ＝ 176時間どおり働いた", staff: monthly, rows: june(22, 8), o: {} },
  { title: "A3. 総労働時間160時間で175時間（法定内と時間外）", staff: monthly, rows: [...june(21, 8), row("2026-06-30", 7)], o: { flexRule: fixed160 } },
  { title: "A4. 総労働時間160時間で154時間（清算期間の終わりに清算：6時間を引く）", staff: monthly, rows: [...june(19, 8), row("2026-06-25", 2)], o: { flexRule: fixed160 } },
  { title: "A5. 総労働時間160時間で145時間（次の清算期間に繰り越す：11時間24分まで、残りは引く）", staff: monthly, rows: [...june(18, 8), row("2026-06-25", 1)], o: { flexRule: { ...fixed160, shortage: "carry" } } },
  { title: "A6. 時給制で、1日9時間 × 20日（原則の総枠を超えた分の割増だけ）", staff: hourly, rows: june(20, 9), o: {} },
  { title: "A7. 日給制（日給1万2千円）で、1日9時間 × 20日（日給20日分 ＋ 超えた20時間）", staff: daily, rows: june(20, 9), o: {} },
  { title: "A8. 日給制で、1日7.5時間 × 20日（足りない10時間 × 1,500円を引く）", staff: daily, rows: june(20, 7.5), o: {} },
  { title: "A9. 日給制で、18日 × 8時間・欠勤1日・年休1日（欠勤の日は日給を払わず、足りない時間にもしない）", staff: daily, rows: [...june(18, 8), row("2026-06-19", 0, "absent"), row("2026-06-22", 0, "paid_full")], o: {} },
];

function Page() {
  // 給与規定グループの画面（useCompanyManager の代わり。「保存」で B. に使う）
  const [pgFlexRule, setPgFlexRule] = useState<FlexRule>(three());
  const [applied, setApplied] = useState<FlexRule>(three());
  const groupCm: any = {
    payrollGroups: [{ id: 1, name: "全社共通規定", closing_day: 99, is_next_month: 1, payment_day: 25, tax_calc_method: "table", social_ins_collection: "current",
      proration_method: "none", leave_proration_method: "workdays", absence_deduction_method: "workdays", tardy_deduction_method: "none", fixed_break: null,
      flex_rule: JSON.stringify(applied), shutdown_allowance_rate: 60 }],
    pgName: "全社共通規定", setPgName: () => {}, pgClosingDay: 99, setPgClosingDay: () => {}, pgIsNextMonth: 1, setPgIsNextMonth: () => {}, pgPaymentDay: 25, setPgPaymentDay: () => {},
    pgTaxMethod: "table", setPgTaxMethod: () => {}, pgSocialInsCollection: "current", setPgSocialInsCollection: () => {}, pgProrationMethod: "none", setPgProrationMethod: () => {},
    pgLeaveProrationMethod: "workdays", setPgLeaveProrationMethod: () => {}, pgAbsenceDeductionMethod: "workdays", setPgAbsenceDeductionMethod: () => {},
    pgTardyDeductionMethod: "none", setPgTardyDeductionMethod: () => {}, pgFixedBreak: null, setPgFixedBreak: () => {}, pgShutdownRate: 60, setPgShutdownRate: () => {},
    pgFlexRule, setPgFlexRule,
    editingPgId: 1, deletingPgId: null, setDeletingPgId: () => {}, startEditPg: () => {}, resetPgForm: () => {}, deletePayrollGroup: () => {},
    savePayrollGroup: () => setApplied(pgFlexRule),
  };
  const guide = [{ workMonth: 4, hours: 220 }, { workMonth: 5, hours: 180 }, { workMonth: 6, hours: 140 }];
  const b = runMonths(monthly, applied, guide);
  const c = runMonths(monthly, three(), [{ workMonth: 4, hours: 210 }, { workMonth: 5, hours: 220 }, { workMonth: 6, hours: 185 }]);
  const d = runMonths(daily, three(), guide);
  const e = runMonths({ ...monthly, retirement_date: "2026-05-31" }, three({ shortage: "carry" }), [{ workMonth: 4, hours: 220 }, { workMonth: 5, hours: 180 }]);
  const f = runMonths({ ...monthly, join_date: "2026-04-16" }, three({ total: { mode: "workdays" } }), [{ workMonth: 4, hours: 110 }, { workMonth: 5, hours: 180 }, { workMonth: 6, hours: 170 }]);
  const g = runMonths(monthly, three(), [{ workMonth: 4, hours: 220 }, { workMonth: 6, hours: 140 }]);
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 20 }}>
      <h2>フレックスタイム制の清算（月給30万円・日給1万2千円・時給1,200円、1日8時間）</h2>
      <section id="group" style={{ background: "white", borderRadius: 8, padding: 12, marginBottom: 14 }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>給与規定グループ（「保存」で B. に使う。いま使っている決まり：{describeFlexRule(applied)}）</h3>
        <PayrollGroupTab cm={groupCm} />
      </section>

      <h2 style={{ fontSize: 17 }}>A. 清算期間1か月（2026年6月）</h2>
      {oneMonthCases.map((c, i) => {
        const r = calculateSalary(c.staff, c.rows, extras(c.o), 2026, 6, company);
        return <Box key={i} id={`a${i + 1}`} title={c.title} r={r} staff={c.staff} />;
      })}

      <h2 style={{ fontSize: 17 }}>B. 給与規定グループの決まりで、4〜6月の計算期間（手引きの例：220・180・140時間）</h2>
      {b.map((m, i) => <Box key={i} id={`b${i + 1}`} title={`B${i + 1}. ${m.payLabel}`} r={m.r} staff={m.staff} />)}

      <h2 style={{ fontSize: 17 }}>C. 清算期間3か月：手引きの例（ⅱ）210・220・185時間（最後の月に95時間 → 60時間超は50%）</h2>
      {c.map((m, i) => <Box key={i} id={`c${i + 1}`} title={`C${i + 1}. ${m.payLabel}`} r={m.r} staff={m.staff} />)}

      <h2 style={{ fontSize: 17 }}>D. 清算期間3か月の日給制（日給1万2千円・平日に220・180・140時間）</h2>
      {d.map((m, i) => <Box key={i} id={`d${i + 1}`} title={`D${i + 1}. ${m.payLabel}`} r={m.r} staff={m.staff} />)}

      <h2 style={{ fontSize: 17 }}>E. 清算期間3か月の途中（5月31日）で退職（不足時間は繰り越す決まりでも、退職する月に引く）</h2>
      {e.map((m, i) => <Box key={i} id={`e${i + 1}`} title={`E${i + 1}. ${m.payLabel}`} r={m.r} staff={m.staff} />)}

      <h2 style={{ fontSize: 17 }}>F. 清算期間3か月の途中（4月16日）に入社（総労働時間は所定労働日数 × 8時間）</h2>
      {f.map((m, i) => <Box key={i} id={`f${i + 1}`} title={`F${i + 1}. ${m.payLabel}`} r={m.r} staff={m.staff} />)}

      <h2 style={{ fontSize: 17 }}>G. 5月支給（4月の計算期間）は確定したが、6月支給を確定しないまま、7月支給を開いた</h2>
      {g.slice(1).map((m, i) => <Box key={i} id={`g${i + 1}`} title={`G${i + 1}. ${m.payLabel}`} r={m.r} staff={m.staff} />)}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Page />);
