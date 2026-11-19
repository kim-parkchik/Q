/**
 * Q の年末調整の画面（src/features/nencho/NenchoManager.tsx）を、見本の値で出す（開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/nencho.html を開く
 *
 * 令和8年分。給与は毎月25日払い（月給30万円。課税対象額 30万円・社会保険料 4万5千円・源泉所得税 6千円）。見本の3人：
 * ・死亡 太郎：8月31日に死亡退職。9月25日に払った給与と12月10日の賞与は死亡した後の支払なので、年末調整に入れない（所得税基本通達9-17）。
 *   年末調整の対象で、父（1956年9月2日生まれ。9月1日に70歳）は、死亡の日には69歳なので老人扶養親族にしない（所得税法85条）。
 *   精算する給与の候補は、8月から12月と翌年1月。初めの値は、死亡の前に払った最後の給与（8月）
 * ・退職 花子：6月30日に退職。初めは年末調整の対象外（理由を選ぶ欄が出る）。「著しい心身の障害」を選んで保存すると、対象になる
 * ・在籍 一郎：12月まで在籍（いつもどおり、12月か翌年1月の給与で精算）
 * 保存した申告書は window.__saved に入る
 */
import { createRoot } from "react-dom/client";
import { ToastProvider } from "../../src/components/Toast";
import { MessageDialogProvider } from "../../src/components/MessageDialog";
import NenchoManager from "../../src/features/nencho/NenchoManager";

const staffList = [
  { id: "4001", name: "死亡 太郎", join_date: "2015-04-01", retirement_date: "2026-08-31", death_date: "2026-08-31", tax_column: "kou", payroll_group_id: 1, birthday: "1975-05-05" },
  { id: "4002", name: "退職 花子", join_date: "2018-04-01", retirement_date: "2026-06-30", death_date: null, tax_column: "kou", payroll_group_id: 1, birthday: "1985-10-10" },
  { id: "4003", name: "在籍 一郎", join_date: "2020-04-01", retirement_date: null, death_date: null, tax_column: "kou", payroll_group_id: 1, birthday: "1990-06-15" },
];

const salary = (staff_id: string, target_month: number) => ({
  staff_id, target_month, taxable_amount: 300_000, social_ins_total: 45_000, income_tax: 6_000, payment_day: 25,
});
const months = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const salaries = [
  ...months(9).map((m) => salary("4001", m)),
  ...months(6).map((m) => salary("4002", m)),
  ...months(11).map((m) => salary("4003", m)),
];
const bonus = (staff_id: string, payment_date: string) => ({
  staff_id, payment_date, total_earnings: 400_000, health_insurance: 19_700, nursing_insurance: 3_240, child_support: 460,
  welfare_pension: 36_600, emp_insurance: 2_000, income_tax: 20_000,
});
const bonuses = [bonus("4001", "2026-07-10"), bonus("4001", "2026-12-10"), bonus("4003", "2026-07-10")];

/** 父（9月2日生まれ）と、19歳になる前の子がいる死亡 太郎の申告書 */
const declarationOfTaro = {
  self: { disability: "none", widow: false, singleParent: false, workingStudent: false, otherIncome: 0 },
  spouse: null,
  dependents: [
    { name: "死亡 父", relation: "父", birthday: "1956-09-02", totalIncome: 0, disability: "none", livingTogether: true, linealAscendant: true },
    { name: "死亡 子", relation: "子", birthday: "2007-12-01", totalIncome: 0, disability: "none", livingTogether: true, linealAscendant: false },
  ],
};

const saved: any[] = [
  { staff_id: "4001", year: 2026, declaration: JSON.stringify(declarationOfTaro), result: null, settle_year: null, settle_month: null, updated_at: "2026-09-01 10:00:00" },
];
(window as any).__saved = saved;

const fakeDb = {
  async select(sql: string, params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT r.staff_id, r.target_month, r.taxable_amount, r.social_ins_total, r.income_tax, g.payment_day")) {
      return params[0] === 2026 ? salaries : [];
    }
    if (q.startsWith("SELECT r.*, s.payment_date AS payment_date FROM bonus_results r")) return params[0] === 2026 ? bonuses : [];
    if (q.startsWith("SELECT * FROM year_end_adjustments WHERE year = ?")) return saved.filter((r) => r.year === params[0]);
    if (q.startsWith("SELECT staff_id, target_year, target_month, year_end_adjustment FROM salary_results")) return [];
    console.warn("fakeDb: 知らない SELECT", q, params);
    return [];
  },
  async execute(sql: string, params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("INSERT INTO year_end_adjustments")) {
      const [staff_id, year, declaration, ...rest] = params;
      const withResult = rest.length === 3;
      const row = {
        staff_id: String(staff_id), year, declaration,
        result: withResult ? rest[0] : null, settle_year: withResult ? rest[1] : null, settle_month: withResult ? rest[2] : null,
        updated_at: "2026-11-19 12:00:00",
      };
      const i = saved.findIndex((r) => r.staff_id === row.staff_id && r.year === year);
      if (i >= 0) saved[i] = row; else saved.push(row);
      return { rowsAffected: 1 };
    }
    console.warn("fakeDb: 知らない文", q, params);
    return { rowsAffected: 0 };
  },
};

createRoot(document.getElementById("root")!).render(
  <MessageDialogProvider>
    <ToastProvider>
      <div style={{ padding: 16 }}>
        <NenchoManager db={fakeDb as any} staffList={staffList} />
      </div>
    </ToastProvider>
  </MessageDialogProvider>,
);
