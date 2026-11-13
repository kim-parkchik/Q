/**
 * Q の「法定三帳簿」の画面（src/features/legalBooks/LegalBooksManager.tsx）を、見本の値で画面に出す（開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/choubo.html を開く
 * ・労働者名簿：見本の3人（項目がそろった人・履歴と住所がない人・死亡で退職した人（履歴に改行と「,」））
 * ・賃金台帳：山田さんの2026年（4月支給は内訳を残す前に確定した月。5〜11月支給は Q の給与の計算（calculateSalary）で作った内訳。夏季賞与）、
 *   2025年（12月支給で年末調整の還付。冬季賞与）。佐藤さんの2026年は、内訳がない月だけ
 * ・出勤簿：山田さんの2026年10月（1日〜末日。有給・半休・特別休暇・決まった休憩・手入力・時間有給・所定休日出勤）と11月（13日まで。13日は未確定）、
 *   佐藤さん（15日締め・翌月払いのグループ。11月支給は9月16日〜10月15日）
 * 「CSV に保存」の中身は、保存の窓を開かずに window.__choubo.saved に入れる
 * ・下に、従業員の画面の「労働者名簿の項目」（src/features/settings/staff/RosterSection.tsx）も出す（在籍・退職を切り替えて、退職の事由・死亡の欄が出るか）
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "../../src/components/Toast";
import { MessageDialogProvider } from "../../src/components/MessageDialog";
import LegalBooksManager from "../../src/features/legalBooks/LegalBooksManager";
import RosterSection from "../../src/features/settings/staff/RosterSection";
import { calculateSalary } from "../../src/utils/calcSalary";
import { bonusLedgerOf, salaryLedgerOf, type PayLedger } from "../../src/utils/legalBooks";

const saved: { path: string; text: string }[] = [];

// ── Tauri の代わり（確かめを出す画面は、いつも「はい」にする。保存の窓は開かず、中身を saved に入れる） ──
(window as any).__TAURI_INTERNALS__ = {
  invoke: async (cmd: string, args: any, options: any) => {
    if (cmd === "plugin:path|resolve_directory") return "/preview/Documents";
    if (cmd === "plugin:path|join") return (args?.paths ?? []).join("/");
    if (cmd === "plugin:dialog|save") return args?.options?.defaultPath ?? "/preview/file.csv";
    if (cmd === "plugin:fs|write_file") {
      const bytes = args instanceof Uint8Array ? args : new Uint8Array(args ?? []);
      saved.push({ path: decodeURIComponent(options?.headers?.path ?? ""), text: new TextDecoder().decode(bytes) });
      return null;
    }
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

const pad = (n: number) => String(n).padStart(2, "0");
const HOLIDAYS = new Set(["2025-11-03", "2025-11-24", "2026-05-04", "2026-05-05", "2026-05-06", "2026-07-20", "2026-08-11", "2026-09-21", "2026-09-22", "2026-09-23",
  "2026-10-12", "2026-11-03", "2026-11-23"]);
const brk = (...spans: [string, string, boolean?][]) => JSON.stringify(spans.map(([start, end, leave]) => (leave ? { start, end, leave } : { start, end })));

/** 1か月の勤怠（平日 9:00〜18:00・休憩 12:00〜13:00 の打刻。土曜・祝日は公休、日曜は記録なし）。special で日ごとに変える */
const monthRecords = (staffId: string, y: number, m: number, o: { until?: number; special?: Record<number, Record<string, unknown>>; part?: boolean } = {}) => {
  const recs: any[] = [];
  const last = Math.min(new Date(y, m, 0).getDate(), o.until ?? 31);
  for (let d = 1; d <= last; d++) {
    const date = `${y}-${pad(m)}-${pad(d)}`;
    const wd = new Date(y, m - 1, d).getDay();
    const base = wd === 0 ? null
      : wd === 6 || HOLIDAYS.has(date) ? { work_type: "holiday", work_hours: 0, night_hours: 0 }
      : o.part ? { work_type: "normal", csv_entry_time: "10:00", csv_exit_time: "15:00", work_hours: 5, night_hours: 0 }
      : { work_type: "normal", csv_entry_time: "09:00", csv_exit_time: "18:00", csv_breaks: brk(["12:00", "13:00"]), work_hours: 8, night_hours: 0 };
    const rec = o.special?.[d] ?? base;
    if (rec) recs.push({ staff_id: staffId, work_date: date, paid_leave_hours: 0, memo: "", is_finalized: 1, ...base, ...rec });
  }
  return recs;
};

const yamadaOctober = monthRecords("1001", 2026, 10, {
  special: {
    7: { csv_exit_time: "20:00", work_hours: 10, memo: "月末の締め作業" },
    16: { work_type: "paid_half", csv_entry_time: "14:00", csv_exit_time: "18:00", csv_breaks: null, work_hours: 4 },
    20: { work_type: "special", leave_type_id: 1, csv_entry_time: null, csv_exit_time: null, csv_breaks: null, work_hours: 0, memo: "親族の葬儀" },
    22: { csv_breaks: null, auto_break: "12:00〜13:00" },
    27: { entry_time: "08:30", csv_entry_time: "08:28", work_hours: 8.5, memo: "打刻忘れのため手入力" },
    29: { breaks: brk(["12:00", "13:00"], ["15:00", "17:00", true]), paid_leave_hours: 2, work_hours: 6, memo: "通院（時間有給）" },
    31: { work_type: "holiday_work", csv_entry_time: "09:00", csv_exit_time: "15:00", csv_breaks: brk(["12:00", "13:00"]), work_hours: 5 },
  },
});
const yamadaNovember = monthRecords("1001", 2026, 11, {
  until: 13,
  special: {
    10: { work_type: "paid_full", csv_entry_time: null, csv_exit_time: null, csv_breaks: null, work_hours: 0 },
    12: { csv_exit_time: "21:30", work_hours: 10.5 },
    13: { csv_entry_time: "13:00", csv_exit_time: "23:00", csv_breaks: brk(["17:00", "18:00"]), work_hours: 9, night_hours: 1, is_finalized: 0 },
  },
});
const satoRecords = [...monthRecords("1002", 2026, 9, { part: true }), ...monthRecords("1002", 2026, 10, { part: true })];

// ── 賃金台帳の内訳（Q の給与の計算で作る） ──
const company = { week_start_day: 0, round_overtime: "round", round_social_ins: "currency_law", round_emp_ins: "currency_law" };
const yamada = {
  id: "1001", wage_type: "monthly", base_wage: 280000, scheduled_work_hours: 8, commute_type: "none", commute_amount: 0, standard_remuneration: 320000,
  birthday: "1985-04-12", social_insurance_group_id: 1,
};
const ledgerOf = (y: number, m: number, recs: any[], yearEndSettlement = 0): PayLedger => {
  const r = calculateSalary(yamada, recs, {
    allowanceName: "役職手当", allowanceAmount: 20000, residentTax: 15000, prefecture: "東京", dependents: 1, yearEndSettlement,
    customItems: [{ name: "住宅手当", amount: 15000, type: "earning", fixed: true }, { name: "社内預金", amount: 5000, type: "deduction" }],
  }, y, m, company);
  return salaryLedgerOf(r, { wageType: "monthly", allowanceName: "役職手当", period: { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}` } });
};
const overtimeMonth = (y: number, m: number, extra: Record<number, number>) =>
  monthRecords("1001", y, m, { special: Object.fromEntries(Object.entries(extra).map(([d, h]) => [Number(d), { work_hours: 8 + h, csv_exit_time: `${18 + Math.floor(h)}:${pad((h % 1) * 60)}` }])) });

type SalaryRow = { staff_id: string; year: number; month: number; total_earnings: number; net_pay: number; year_end_adjustment: number; ledger: string | null };
const salaryRow = (staffId: string, y: number, m: number, l: PayLedger): SalaryRow => ({
  staff_id: staffId, year: y, month: m, total_earnings: l.totalEarnings, net_pay: l.netPay, year_end_adjustment: l.yearEndSettlement, ledger: JSON.stringify(l),
});
const bonusLedger = (total: number) => {
  const d = { healthInsurance: Math.round(total * 0.0491), nursingInsurance: 0, childSupport: 0, welfarePension: Math.round(total * 0.0915), empInsurance: Math.round(total * 0.0055) };
  const incomeTax = Math.floor((total - d.healthInsurance - d.welfarePension - d.empInsurance) * 0.04084);
  const totalDeductions = d.healthInsurance + d.welfarePension + d.empInsurance + incomeTax;
  return bonusLedgerOf({ earnings: [{ name: "賞与", amount: total - 30000 }, { name: "業績加算", amount: 30000 }], ...d, incomeTax, customDeductions: [],
    totalEarnings: total, totalDeductions, netPay: total - totalDeductions });
};

const store = {
  groups: [{ id: 1, closing_day: 99, is_next_month: 0 }, { id: 2, closing_day: 15, is_next_month: 1 }],
  leaveTypes: [{ id: 1, name: "慶弔休暇" }],
  attendance: [...yamadaOctober, ...yamadaNovember, ...satoRecords],
  salaries: [
    { staff_id: "1001", year: 2026, month: 4, total_earnings: 315000, net_pay: 251234, year_end_adjustment: 0, ledger: null },
    salaryRow("1001", 2026, 5, ledgerOf(2026, 5, overtimeMonth(2026, 5, { 12: 2, 19: 1.5 }))),
    salaryRow("1001", 2026, 6, ledgerOf(2026, 6, overtimeMonth(2026, 6, { 9: 3 }))),
    salaryRow("1001", 2026, 7, ledgerOf(2026, 7, overtimeMonth(2026, 7, {}))),
    salaryRow("1001", 2026, 8, ledgerOf(2026, 8, overtimeMonth(2026, 8, { 25: 2.5 }))),
    salaryRow("1001", 2026, 9, ledgerOf(2026, 9, overtimeMonth(2026, 9, { 30: 4 }))),
    salaryRow("1001", 2026, 10, ledgerOf(2026, 10, yamadaOctober)),
    salaryRow("1001", 2026, 11, ledgerOf(2026, 11, monthRecords("1001", 2026, 11, { special: { 10: { work_type: "paid_full", work_hours: 0 }, 12: { work_hours: 10.5 } } }))),
    salaryRow("1001", 2025, 11, ledgerOf(2025, 11, overtimeMonth(2025, 11, { 20: 2 }))),
    salaryRow("1001", 2025, 12, ledgerOf(2025, 12, overtimeMonth(2025, 12, { 10: 1 }), 12480)),
    { staff_id: "1002", year: 2026, month: 9, total_earnings: 112500, net_pay: 104320, year_end_adjustment: 0, ledger: null },
    { staff_id: "1002", year: 2026, month: 10, total_earnings: 120000, net_pay: 111250, year_end_adjustment: 0, ledger: null },
  ] as SalaryRow[],
  bonuses: [
    { staff_id: "1001", year: 2026, month: 7, name: "夏季賞与", payment_date: "2026-07-10", ...(() => { const l = bonusLedger(500000); return { total_earnings: l.totalEarnings, net_pay: l.netPay, ledger: JSON.stringify(l) }; })() },
    { staff_id: "1001", year: 2025, month: 12, name: "冬季賞与", payment_date: "2025-12-10", ...(() => { const l = bonusLedger(550000); return { total_earnings: l.totalEarnings, net_pay: l.netPay, ledger: JSON.stringify(l) }; })() },
  ],
};
(window as any).__choubo = { store, saved };

const fakeDb = {
  async select(sql: string, params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT id, closing_day, is_next_month FROM payroll_groups")) return store.groups;
    if (q.startsWith("SELECT CAST(target_month AS INTEGER) AS month") && q.includes("FROM salary_results")) {
      return store.salaries.filter((s) => s.staff_id === String(params[0]) && s.year === Number(params[1])).sort((a, b) => a.month - b.month);
    }
    if (q.startsWith("SELECT s.name, s.payment_date") && q.includes("FROM bonus_results b")) {
      return store.bonuses.filter((b) => b.staff_id === String(params[0]) && b.year === Number(params[1]));
    }
    if (q.startsWith("SELECT a.*, lt.name AS leave_name FROM attendance a")) {
      return store.attendance
        .filter((a) => a.staff_id === String(params[0]) && a.work_date >= params[1] && a.work_date <= params[2])
        .map((a) => ({ ...a, leave_name: store.leaveTypes.find((t) => t.id === a.leave_type_id)?.name ?? null }));
    }
    console.warn("fakeDb: 知らない SELECT", q, params);
    return [];
  },
  async execute(sql: string, params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (!q.startsWith("INSERT INTO app_logs")) console.warn("fakeDb: 知らない EXECUTE", q, params);
    return { rowsAffected: 1 };
  },
};

const staffList = [
  {
    id: "1001", name: "山田 太郎", furigana: "ヤマダ タロウ", birthday: "1985-04-12", gender: "male", zip_code: "150-0002", address: "東京都渋谷区渋谷1-2-3",
    job_type: "営業", career_history: "2008年3月 ○○大学 卒業\n2008年4月 株式会社△△ 入社（営業）", join_date: "2015-04-01", payroll_group_id: 1, status: "active",
  },
  {
    id: "1002", name: "佐藤 花子", furigana: "サトウ ハナコ", birthday: "1992-08-30", gender: "female", zip_code: "", address: "",
    job_type: "一般事務（パート）", career_history: "", join_date: "2024-10-01", payroll_group_id: 2, status: "active",
  },
  {
    id: "1003", name: "鈴木 一郎", furigana: "スズキ イチロウ", birthday: "1960-01-20", gender: "male", zip_code: "160-0022", address: "東京都新宿区新宿3-4-5",
    job_type: "製造（組立）", career_history: "1978年3月 □□工業高校 卒業\n1978年4月 有限会社××, 入社", join_date: "2001-06-01",
    retirement_date: "2026-03-15", retirement_reason: "死亡", death_date: "2026-03-15", death_cause: "病気", payroll_group_id: 1, status: "retired",
  },
];

/** 従業員の画面の「労働者名簿の項目」（従業員の画面の状態の代わりに、ここで持つ） */
function RosterSectionDemo() {
  const [targetStatus, setTargetStatus] = useState("active");
  const [targetJobType, setTargetJobType] = useState("");
  const [targetCareerHistory, setTargetCareerHistory] = useState("");
  const [targetRetirementReason, setTargetRetirementReason] = useState("");
  const [targetDeathDate, setTargetDeathDate] = useState("");
  const [targetDeathCause, setTargetDeathCause] = useState("");
  const cm = {
    targetStatus, targetJobType, setTargetJobType, targetCareerHistory, setTargetCareerHistory,
    targetRetirementReason, setTargetRetirementReason, targetDeathDate, setTargetDeathDate, targetDeathCause, setTargetDeathCause,
  };
  (window as any).__choubo.roster = cm;
  return (
    <div style={{ maxWidth: 520, margin: "20px auto 0", backgroundColor: "white", padding: 20, borderRadius: 12 }}>
      <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>従業員の画面の「労働者名簿の項目」</h3>
      <label style={{ fontSize: 13 }}>
        在籍状況：
        <select value={targetStatus} onChange={(e) => setTargetStatus(e.target.value)}>
          <option value="active">在籍</option>
          <option value="retired">退職</option>
        </select>
      </label>
      <RosterSection cm={cm as any} />
    </div>
  );
}

function Page() {
  return (
    <ToastProvider>
      <MessageDialogProvider>
        <div style={{ padding: 20 }}>
          <LegalBooksManager db={fakeDb as any} staffList={staffList} />
          <RosterSectionDemo />
        </div>
      </MessageDialogProvider>
    </ToastProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Page />);
