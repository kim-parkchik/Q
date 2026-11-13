/**
 * Q のフレックスタイム制の清算（src/utils/flexTime.ts・calcSalary.ts）を、見本の勤怠で勤怠の画面の知らせ（FlexSummary.tsx）に出す（開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/flex.html を開く
 * 2026年6月（30日。平日22日）・月給30万円・1日8時間の人で、いくつかの働き方を並べ、給与の計算の結果も下に出す
 */
import { createRoot } from "react-dom/client";
import FlexSummary from "../../src/features/attendance/manager/FlexSummary";
import { calculateSalary, type SalaryExtras } from "../../src/utils/calcSalary";
import type { FlexRule } from "../../src/utils/flexTime";

const monthly = {
  wage_type: "monthly", base_wage: 300000, scheduled_work_hours: 8, is_flex: 1,
  commute_type: "none", commute_amount: 0, standard_remuneration: 0, birthday: "1990-06-15",
};
const hourly = { ...monthly, wage_type: "hourly", base_wage: 1200 };
const june = (n: number, hours: number) => Array.from({ length: n }, (_, i) => ({
  work_date: `2026-06-${String(i + 1).padStart(2, "0")}`, work_hours: hours, night_hours: 0, work_type: "normal",
}));
const extras = (o: Partial<SalaryExtras>): SalaryExtras => ({
  allowanceName: "", allowanceAmount: 0, residentTax: 0, prefecture: "東京", dependents: 0, customItems: [],
  period: { start: "2026-06-01", end: "2026-06-30" }, periodWorkDays: 22, employedWorkDays: 22, annualWorkDays: 245, ...o,
});
const fixed160: FlexRule = { total: { mode: "fixed", hours: 160 }, limit: "standard", shortage: "deduct" };

const cases: { title: string; staff: any; rows: any[]; o: Partial<SalaryExtras> }[] = [
  { title: "1. 完全週休2日の特例（総枠176時間）で、1日9時間 × 20日 ＝ 180時間", staff: monthly, rows: june(20, 9), o: { flexRule: { total: { mode: "workdays" }, limit: "fiveDay", shortage: "deduct" } } },
  { title: "2. 原則の総枠（171時間25分）で、総労働時間 22日 × 8時間 ＝ 176時間どおり働いた", staff: monthly, rows: june(22, 8), o: {} },
  { title: "3. 総労働時間160時間で175時間（法定内と時間外）", staff: monthly, rows: [...june(21, 8), { work_date: "2026-06-30", work_hours: 7, night_hours: 0, work_type: "normal" }], o: { flexRule: fixed160 } },
  { title: "4. 総労働時間160時間で154時間（その月で清算：6時間を引く）", staff: monthly, rows: [...june(19, 8), { work_date: "2026-06-25", work_hours: 2, night_hours: 0, work_type: "normal" }], o: { flexRule: fixed160 } },
  { title: "5. 総労働時間160時間で145時間（次の月に繰り越す：11時間25分まで、残りは引く）", staff: monthly, rows: [...june(18, 8), { work_date: "2026-06-25", work_hours: 1, night_hours: 0, work_type: "normal" }], o: { flexRule: { ...fixed160, shortage: "carry" } } },
  { title: "6. 前の月から6時間繰り越して、166時間働いた", staff: monthly, rows: [...june(20, 8), { work_date: "2026-06-25", work_hours: 6, night_hours: 0, work_type: "normal" }], o: { flexRule: fixed160, flexCarryIn: 6 } },
  { title: "7. 時給制で、1日9時間 × 20日（原則の総枠を超えた分の割増だけ）", staff: hourly, rows: june(20, 9), o: {} },
];

function Page() {
  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: 20 }}>
      <h2>フレックスタイム制の清算（2026年6月・月給30万円・1日8時間）</h2>
      {cases.map((c, i) => {
        const r = calculateSalary(c.staff, c.rows, extras(c.o), 2026, 6, { week_start_day: 0, round_overtime: "round" });
        const am: any = { calcResult: r };
        return (
          <section key={i} id={`case${i + 1}`} style={{ background: "white", borderRadius: 8, padding: 12, marginBottom: 14 }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>{c.title}</h3>
            <FlexSummary am={am} />
            <pre style={{ margin: 0, fontSize: 12 }}>
              {JSON.stringify({
                支給合計: r.totalEarnings, 基本給: r.basePay, 時間外手当_法定内: r.statutoryOvertimePay, 時間外手当_25: r.standardOvertimePay,
                フレックス不足時間控除: r.flexShortageDeduction, 次の月に繰り越す: r.flexCarryOutHours, 計算式: r.flexShortageDetail,
              }, null, 1)}
            </pre>
          </section>
        );
      })}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Page />);
