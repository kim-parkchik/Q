/**
 * Q の「明細書・一覧表」「所得税の納付書」「住民税の異動届出書」「退職金（退職所得）」「傷病手当金・出産手当金の証明」と、法定三帳簿の「年次有給休暇管理簿」のタブを、
 * 見本の値で画面に出す（開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/meisai.html を開く
 * 会社：帳票サンプル株式会社（東京都。本店・大阪支店）。給与は末日締め・翌月25日払い
 * ・確定した給与：2025年1月〜2026年11月支給。2025年12月支給で年末調整（山田さん 15,000円還付、時給さん 3,000円徴収）
 * ・確定した賞与：2025年冬季（12月10日）・2026年夏季（7月10日。役員の賞与は役員賞与の欄）
 * ・住民税：退職 一郎さん（2026年10月31日に退職。令和8年度は6月〜10月に徴収済）、一括 次郎さん（2026年2月15日に退職し、2月の給与で3月〜5月分を一括徴収。
 *   1月1日の住所が大阪市に変わり、次の年度の給与支払報告書は大阪市に出した → 現年度分（千代田区）と新年度分（大阪市）の2枚）
 * ・日雇 三郎さんは丙欄（日雇労務者の賃金。延べ人員は働いた日の数）
 * ・有給：山田さん（2025年10月1日に10日、2026年10月1日に11日）、時給さん（2026年4月1日に7日）
 * ・退職金：一括 次郎さん（2023年4月1日入社・2026年2月15日退職。150万円を3月10日に支払った。短期退職手当等）を保存してある。
 *   退職 一郎さん（2007年4月1日入社・2026年10月31日退職）は、画面で入れて確かめる
 * ・傷病手当金：時給 花子さんは 2026年9月14日から病気で休み、9月14日〜16日は有給休暇（6時間 × 3日。有給休暇手当 23,400円）、
 *   9月14日〜10月9日を「その他の休職」にしてある。10月5日だけ3時間働いた
 * マイナンバー：事務取扱担当者でログインしている。鍵のパスワードは「mihon-password-2026」
 * 「…を保存」で保存の窓の代わりに、保存したバイトを window.__savedFiles に足す
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "../../src/components/Toast";
import { MessageDialogProvider } from "../../src/components/MessageDialog";
import { MyNumberUnlockProvider } from "../../src/features/mynumber/MyNumberUnlock";
import PayReportManager from "../../src/features/payroll/PayReportManager";
import WithholdingPaymentManager from "../../src/features/payroll/WithholdingPaymentManager";
import ResidentTaxIdouManager from "../../src/features/payroll/ResidentTaxIdouManager";
import LegalBooksManager from "../../src/features/legalBooks/LegalBooksManager";
import NenchoListView from "../../src/features/nencho/NenchoListView";
import FuyouDraftView from "../../src/features/nencho/FuyouDraftView";
import MailLabelCard from "../../src/features/nencho/MailLabelCard";
import { localGovByCode } from "../../src/utils/localGov";
import { emptyDeclaration } from "../../src/utils/nenchoDeclaration";
import RetirementManager from "../../src/features/payroll/RetirementManager";
import KenpoBenefitCertManager from "../../src/features/payroll/KenpoBenefitCertManager";
import { bonusLedgerOf, type PayLedger } from "../../src/utils/legalBooks";
import { createKeys, encryptNumber, type DeriveKey } from "../../src/utils/myNumberCrypto";

const PASSWORD = "mihon-password-2026";
const deriveKey: DeriveKey = async (password, salt) => {
  const bytes = new Uint8Array([...new TextEncoder().encode(password), ...salt]);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
};

const saved: { name: string; bytes: Uint8Array }[] = [];
(window as any).__savedFiles = saved;
let lastSavePath = "";
(window as any).__TAURI_INTERNALS__ = {
  invoke: async (cmd: string, args: any) => {
    if (cmd === "plugin:dialog|save") {
      lastSavePath = String(args?.options?.defaultPath ?? "/tmp/file.csv");
      return lastSavePath;
    }
    if (cmd === "plugin:fs|write_file") {
      saved.push({ name: lastSavePath.split("/").pop() ?? "", bytes: args instanceof Uint8Array ? args : new Uint8Array(args) });
      return null;
    }
    if (cmd === "derive_key") return Array.from(await deriveKey(args.password, new Uint8Array(args.salt), {} as any));
    if (cmd === "plugin:path|resolve_directory") return "/docs";
    if (cmd === "plugin:path|join") return (args?.paths ?? []).join("/");
    if (cmd.startsWith("plugin:dialog|")) {
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
const schedule = (fiscalYear: number, june: number, rest: number, municipality: string, atena?: string) =>
  ({ fiscalYear, amounts: [june, ...Array(11).fill(rest)], municipality, ...(atena ? { atena } : {}) });

const staffList: any[] = [
  { id: "9001", name: "山田　太郎", furigana: "ヤマダ タロウ", birthday: "1980-04-01", address: "東京都千代田区千代田1-1", branch_id: 1, payroll_group_id: 1, department: "営業部",
    social_insurance_group_id: 1, standard_remuneration_history: JSON.stringify([{ from: "", amount: 300000, reason: "shutoku" }, { from: "2026-09", amount: 340000, reason: "teiji" }]),
    wage_type: "monthly", base_wage: 300000, tax_column: "kou", is_executive: 0, scheduled_work_hours: 8, status: "active", join_date: "2025-04-01",
    resident_tax_municipality: "131016", resident_tax_schedule: JSON.stringify([schedule(2025, 13500, 13000, "131016"), schedule(2026, 13500, 13000, "131016")]) },
  { id: "9002", name: "時給　花子", furigana: "ジキュウ ハナコ", birthday: "1995-09-15", address: "大阪府大阪市北区梅田1-1", branch_id: 2, payroll_group_id: 1, department: "総務部",
    social_insurance_group_id: 1, standard_remuneration_history: JSON.stringify([{ from: "", amount: 150000, reason: "shutoku" }, { from: "2026-09", amount: 160000, reason: "teiji" }]),
    wage_type: "hourly", base_wage: 1300, tax_column: "kou", is_executive: 0, scheduled_work_hours: 6, status: "active", join_date: "2025-10-01",
    leave_periods: JSON.stringify([{ type: "other", start: "2026-09-14", end: "2026-10-09" }]),
    resident_tax_municipality: "271004", resident_tax_schedule: JSON.stringify([schedule(2026, 4300, 4000, "271004")]) },
  { id: "9003", name: "退職　一郎", furigana: "タイショク イチロウ", birthday: "1975-12-20", address: "東京都千代田区神田1-2-3", branch_id: 1, payroll_group_id: 1, department: "営業部",
    wage_type: "monthly", base_wage: 280000, tax_column: "kou", is_executive: 0, scheduled_work_hours: 8, status: "retired", retirement_date: "2026-10-31", join_date: "2007-04-01",
    resident_tax_municipality: "131016", resident_tax_schedule: JSON.stringify([schedule(2025, 10300, 10000, "131016"), schedule(2026, 10300, 10000, "131016", "00012345678")]) },
  { id: "9004", name: "一括　次郎", furigana: "イッカツ ジロウ", birthday: "1988-06-30", address: "大阪府大阪市中央区本町2-2", branch_id: 1, payroll_group_id: 1,
    wage_type: "monthly", base_wage: 250000, tax_column: "kou", is_executive: 0, scheduled_work_hours: 8, status: "retired", retirement_date: "2026-02-15", join_date: "2023-04-01",
    resident_tax_municipality: "271004", resident_tax_schedule: JSON.stringify([schedule(2025, 8600, 8000, "131016", "00087654321")]) },
  { id: "9005", name: "役員　一人", furigana: "ヤクイン ヒトリ", birthday: "1965-01-01", address: "東京都港区赤坂1-1", branch_id: 1, payroll_group_id: 1,
    wage_type: "monthly", base_wage: 600000, tax_column: "kou", is_executive: 1, scheduled_work_hours: 8, status: "active", resident_tax_municipality: "131032" },
  { id: "9006", name: "日雇　三郎", furigana: "ヒヤトイ サブロウ", birthday: "2001-03-03", address: "東京都千代田区丸の内1-1", branch_id: 1, payroll_group_id: 1,
    wage_type: "hourly", base_wage: 1200, tax_column: "hei", is_executive: 0, scheduled_work_hours: 8, status: "active" },
];

const store = {
  company: { id: 1, name: "帳票サンプル株式会社", representative: "代表　取締役", journal_settings: null as string | null, round_social_ins: "currency_law", address: "東京都千代田区千代田1-1", phone: "03-1234-5678", corporate_number: "1234567890123", gensen_nofu: null as string | null,
    annual_leave_rule: null, half_day_leave: 1 },
  report: { payer_kana: "チョウヒョウサンプル", contact_dept: "総務部", contact_section: "給与係", contact_name: "事務　担当", contact_phone: "03-1234-5678" },
  municipalities: [{ code: "131016", designation_number: "1234567890", special_due: 0 }, { code: "271004", designation_number: "0000271004", special_due: 0 }],
  retirements: [
    { id: 1, staff_id: "9004", pay_date: "2026-03-10", fixed_date: "2026-02-15", amount: 1500000, income_tax: 7657, city_tax: 9000, pref_tax: 6000, municipality: "271004",
      detail: JSON.stringify({ serviceFrom: "2023-04-01", serviceTo: "2026-02-15", declared: true, address: "大阪府大阪市中央区本町2-2", januaryAddress: "大阪府大阪市中央区本町2-2", position: "" }) },
  ] as any[],
  branches: [{ id: 1, name: "本店", prefecture: "東京都" }, { id: 2, name: "大阪支店", prefecture: "大阪府" }],
  keys: null as any,
  numbers: [] as { staff_id: string; person: string; name: string; relation: string; number: string }[],
  logs: [] as string[],
};

// ── 確定した給与（支給した月ごと。内訳つき） ──
const residentFor = (s: any, y: number, m: number) => {
  const fy = m >= 6 ? y : y - 1;
  const e = JSON.parse(s.resident_tax_schedule ?? "[]").find((x: any) => x.fiscalYear === fy);
  return e ? e.amounts[(m + 6) % 12] : 0;
};
const salaries: any[] = [];
for (let y = 2025; y <= 2026; y++) {
  for (let m = 1; m <= 12; m++) {
    if (y === 2026 && m > 11) continue;
    for (const s of staffList) {
      const last = s.retirement_date;
      // 末日締め・翌月払い：退職した月の分は翌月に払う
      if (last && `${y}-${pad(m)}` > (() => { const d = new Date(last); d.setMonth(d.getMonth() + 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; })()) continue;
      if (s.join_date && `${y}-${pad(m)}-25` < s.join_date) continue;
      const days = s.tax_column === "hei" ? 8 + (m % 4) : 20;
      const base = s.wage_type === "monthly" ? s.base_wage : s.base_wage * s.scheduled_work_hours * days;
      const commute = s.tax_column === "hei" ? 0 : 10000;
      const overtime = s.wage_type === "monthly" && !s.is_executive ? 15000 : 0;
      const total = base + commute + overtime;
      const taxable = total - commute;
      const health = s.tax_column === "hei" ? 0 : Math.round(taxable * 0.05);
      const pension = s.tax_column === "hei" ? 0 : Math.round(taxable * 0.0915);
      const emp = s.is_executive ? 0 : Math.round(total * 0.0055);
      const incomeTax = s.tax_column === "hei" ? Math.round(taxable * 0.03) : s.is_executive ? 52000 : s.wage_type === "monthly" ? 7800 : 1500;
      let residentTax = residentFor(s, y, m);
      // 一括 次郎さん：2026年2月の給与（1月分）で、3月〜5月分（8,000円 × 3）を一括徴収
      if (s.id === "9004" && y === 2026 && m === 3) residentTax = 0;
      if (s.id === "9004" && y === 2026 && m === 2) residentTax = 8000 + 24000;
      const yearEnd = y === 2025 && m === 12 ? (s.id === "9001" ? 15000 : s.id === "9002" ? -3000 : 0) : 0;
      const deductions = [
        { name: "健康保険料", amount: health }, { name: "厚生年金保険料", amount: pension }, { name: "雇用保険料", amount: emp },
        { name: "所得税", amount: incomeTax }, { name: "住民税", amount: residentTax },
      ].filter((d) => d.amount !== 0);
      const totalDeductions = deductions.reduce((t, d) => t + d.amount, 0);
      // 時給 花子さんの9月分（10月支給）：9月14日〜16日の有給休暇（6時間 × 3日 × 1,300円）
      const paidLeave = s.id === "9002" && y === 2026 && m === 10 ? 23400 : 0;
      const earnings: PayLedger["earnings"] = [
        { name: s.wage_type === "monthly" ? "基本給" : s.tax_column === "hei" ? "日給" : "時給分", amount: base, avg: s.wage_type === "monthly" ? "month" : "time" },
        ...(overtime ? [{ name: "時間外手当(25%割増)", amount: overtime, avg: "time" as const }] : []),
        ...(paidLeave ? [{ name: "有給休暇手当", amount: paidLeave, avg: "time" as const }] : []),
        ...(commute ? [{ name: "通勤手当", amount: commute, avg: "month" as const }] : []),
      ];
      const prev = new Date(y, m - 2, 1);
      const ledger: PayLedger = {
        periodStart: `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-01`, periodEnd: `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-${pad(new Date(y, m - 1, 0).getDate())}`,
        workDays: days, workHours: days * s.scheduled_work_hours, overtimeHours: overtime ? 9.5 : 0, holidayHours: 0, nightHours: 0,
        earnings, deductions, totalEarnings: total, totalDeductions, netPay: total - totalDeductions + yearEnd, yearEndSettlement: yearEnd,
      };
      salaries.push({
        staff_id: s.id, target_year: y, target_month: m, total_earnings: total, taxable_amount: taxable, income_tax: incomeTax, resident_tax: residentTax,
        year_end_adjustment: yearEnd, net_pay: ledger.netPay, ledger: JSON.stringify(ledger),
      });
    }
  }
}

// ── 確定した賞与 ──
const bonusSettings = [
  { id: 1, name: "夏季賞与", target_year: 2026, target_month: 7, payment_date: "2026-07-10" },
  { id: 2, name: "冬季賞与", target_year: 2025, target_month: 12, payment_date: "2025-12-10" },
];
const bonusResults: any[] = [];
for (const [settingId, list] of [[1, [["9001", 500000, 20400], ["9002", 100000, 4080], ["9005", 1000000, 84000]]], [2, [["9001", 450000, 18360], ["9003", 400000, 16320]]]] as const) {
  for (const [staffId, amount, tax] of list) {
    const health = Math.round(amount * 0.05);
    const pension = Math.round(amount * 0.0915);
    const ledger = bonusLedgerOf({
      earnings: [{ name: "賞与", amount }], healthInsurance: health, nursingInsurance: 0, childSupport: 0, welfarePension: pension, empInsurance: staffId === "9005" ? 0 : Math.round(amount * 0.0055),
      incomeTax: tax, customDeductions: [], totalEarnings: amount, totalDeductions: 0, netPay: 0,
    });
    ledger.totalDeductions = ledger.deductions.reduce((t, d) => t + d.amount, 0);
    ledger.netPay = amount - ledger.totalDeductions;
    bonusResults.push({ bonus_setting_id: settingId, staff_id: staffId, total_earnings: amount, in_kind: 0, income_tax: tax, net_pay: ledger.netPay, ledger: JSON.stringify(ledger) });
  }
}

// ── 有給（付与と、確定した勤怠の有給の日） ──
const grants = [
  { id: 1, staff_id: "9001", name: "法定有給", grant_date: "2025-10-01", expiry_date: "2027-09-30", days_granted: 10 },
  { id: 2, staff_id: "9001", name: "法定有給", grant_date: "2026-10-01", expiry_date: "2028-09-30", days_granted: 11 },
  { id: 3, staff_id: "9002", name: "法定有給", grant_date: "2026-04-01", expiry_date: "2028-03-31", days_granted: 7 },
];
const leaveDays = [
  { staff_id: "9001", work_date: "2025-11-10", work_type: "paid_full" }, { staff_id: "9001", work_date: "2025-12-24", work_type: "paid_half" },
  { staff_id: "9001", work_date: "2026-03-02", work_type: "normal", paid_leave_hours: 2 }, { staff_id: "9001", work_date: "2026-08-12", work_type: "paid_full" },
  { staff_id: "9001", work_date: "2026-08-13", work_type: "paid_full" }, { staff_id: "9001", work_date: "2026-08-14", work_type: "paid_full" },
  { staff_id: "9001", work_date: "2026-10-05", work_type: "paid_full" },
  { staff_id: "9002", work_date: "2026-05-01", work_type: "paid_full" }, { staff_id: "9002", work_date: "2026-08-17", work_type: "paid_half" },
];
// 時給 花子さんの9月・10月の勤怠（9月1日〜11日は平日に6時間、11日は4時間で早退。14日〜16日は有給休暇。10月5日だけ3時間）
const sickAttendance: any[] = [];
for (const d of [1, 2, 3, 4, 7, 8, 9, 10, 11]) sickAttendance.push({ staff_id: "9002", work_date: `2026-09-${pad(d)}`, work_type: "normal", work_hours: d === 11 ? 4 : 6, paid_leave_hours: 0, special_leave_hours: 0, leave_paid: null });
for (const d of [14, 15, 16]) sickAttendance.push({ staff_id: "9002", work_date: `2026-09-${pad(d)}`, work_type: "paid_full", work_hours: 0, paid_leave_hours: 0, special_leave_hours: 0, leave_paid: null });
sickAttendance.push({ staff_id: "9002", work_date: "2026-10-05", work_type: "normal", work_hours: 3, paid_leave_hours: 0, special_leave_hours: 0, leave_paid: null });
(window as any).__meisai = { store, staffList, saved, salaries, bonusResults };

const setupMyNumbers = async () => {
  const { record, keys } = await createKeys(PASSWORD, deriveKey);
  store.keys = record;
  for (const [staffId, number] of [["9003", "123456789018"], ["9004", "234567890123"]] as [string, string][]) {
    store.numbers.push({ staff_id: staffId, person: "self", name: "", relation: "", number: await encryptNumber(keys, number, staffId, "self") });
  }
};

const staffOf = (id: unknown) => staffList.find((s) => s.id === String(id));
const fakeDb = {
  async select(sql: string, params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT name FROM company WHERE id = 1")) return [store.company];
    if (q.startsWith("SELECT name, hourly_leave FROM company WHERE id = 1")) return [{ ...store.company, hourly_leave: 1 }];
    if (q.startsWith("SELECT name, journal_settings FROM company")) return [store.company];
    if (q.startsWith("SELECT round_social_ins FROM company")) return [store.company];
    if (q.startsWith("SELECT id, social_ins_collection FROM payroll_groups")) return [{ id: 1, social_ins_collection: "next" }];
    if (q.startsWith("SELECT id, name, type, union_office_number, union_media_seq FROM social_insurance_groups")) return [{ id: 1, name: "協会けんぽ", type: "kyokai", union_office_number: null, union_media_seq: 0 }];
    if (q.startsWith("SELECT group_id, from_month, health_rate")) return [];
    if (q.startsWith("SELECT id, name, prefecture FROM branches")) return store.branches;
    if (q.startsWith("SELECT gensen_nofu FROM company")) return [store.company];
    if (q.startsWith("SELECT name, address, corporate_number, phone FROM company")) return [store.company];
    if (q.startsWith("SELECT annual_leave_rule, half_day_leave FROM company")) return [store.company];
    if (q.startsWith("SELECT payer_kana, contact_dept")) return [store.report];
    if (q.startsWith("SELECT code, designation_number FROM resident_tax_municipalities")) return store.municipalities;
    if (q.startsWith("SELECT holiday_date FROM holiday_master")) return [{ holiday_date: "2026-10-12" }, { holiday_date: "2026-11-23" }];
    if (q.startsWith("SELECT id, name FROM branches")) return store.branches;
    if (q.startsWith("SELECT id, payment_day FROM payroll_groups")) return [{ id: 1, payment_day: 25 }];
    if (q.startsWith("SELECT id, closing_day, is_next_month FROM payroll_groups")) return [{ id: 1, closing_day: 99, is_next_month: 1 }];
    if (q.startsWith("SELECT s.id, s.name, s.target_year, s.target_month, s.payment_date, COUNT(r.staff_id)")) {
      return bonusSettings.map((b) => ({ ...b, n: bonusResults.filter((r) => r.bonus_setting_id === b.id).length }));
    }
    if (q.startsWith("SELECT r.staff_id, r.total_earnings, r.net_pay, r.year_end_adjustment, r.ledger")) {
      return salaries.filter((r) => r.target_year === params[0] && r.target_month === params[1])
        .map((r) => ({ ...r, name: staffOf(r.staff_id).name, branch_id: staffOf(r.staff_id).branch_id, payroll_group_id: 1, department: staffOf(r.staff_id).department ?? null, is_executive: staffOf(r.staff_id).is_executive }))
        .sort((a, b) => a.branch_id - b.branch_id || a.staff_id.localeCompare(b.staff_id));
    }
    if (q.startsWith("SELECT r.staff_id, r.total_earnings, r.in_kind, r.net_pay, r.ledger")) {
      return bonusResults.filter((r) => r.bonus_setting_id === params[0])
        .map((r) => ({ ...r, name: staffOf(r.staff_id).name, branch_id: staffOf(r.staff_id).branch_id, department: staffOf(r.staff_id).department ?? null, is_executive: staffOf(r.staff_id).is_executive }))
        .sort((a, b) => a.branch_id - b.branch_id || a.staff_id.localeCompare(b.staff_id));
    }
    if (q.startsWith("SELECT r.staff_id, r.target_year, r.target_month, r.taxable_amount")) {
      return salaries.filter((r) => params.includes(r.target_year))
        .map((r) => ({ ...r, is_executive: staffOf(r.staff_id).is_executive, tax_column: staffOf(r.staff_id).tax_column, payroll_group_id: 1 }));
    }
    if (q.startsWith("SELECT r.staff_id, r.total_earnings, r.income_tax, s.is_executive, b.payment_date")) {
      return bonusResults.map((r) => ({ ...r, ...bonusSettings.find((b) => b.id === r.bonus_setting_id), is_executive: staffOf(r.staff_id).is_executive }))
        .filter((r) => params.includes(r.target_year));
    }
    if (q.startsWith("SELECT r.staff_id, r.target_year, r.target_month, r.resident_tax")) {
      return salaries.filter((r) => r.target_year >= params[0]).map((r) => ({ ...r, payroll_group_id: 1 }));
    }
    if (q.startsWith("SELECT id, name, grant_date, expiry_date, days_granted FROM paid_leave_grants")) return grants.filter((g) => g.staff_id === params[0]);
    if (q.startsWith("SELECT work_date, work_type, paid_leave_hours FROM attendance")) return leaveDays.filter((a) => a.staff_id === params[0]);
    if (q.startsWith("SELECT id, usage_date, days_used, description FROM paid_leave_usage")) return [];
    if (q.startsWith("SELECT my_number_access FROM users")) return [{ my_number_access: 1 }];
    if (q.startsWith("SELECT COUNT(*) AS n FROM my_numbers")) return [{ n: store.numbers.length }];
    if (q.startsWith("SELECT staff_id, person, number FROM my_numbers")) return store.numbers.map(({ staff_id, person, number }) => ({ staff_id, person, number }));
    if (q.startsWith("SELECT * FROM retirement_allowances")) return store.retirements;
    if (q.startsWith("SELECT name, address, phone, representative FROM company")) return [store.company];
    if (q.startsWith("SELECT name, address FROM company")) return [store.company];
    if (q.startsWith("SELECT code, mail_zip, mail_address, mail_name FROM resident_tax_municipalities")) return store.municipalities;
    if (q.startsWith("SELECT leave_proration_method, absence_deduction_method FROM payroll_groups")) return [{ leave_proration_method: "workdays", absence_deduction_method: "workdays" }];
    if (q.startsWith("SELECT work_date, work_type, work_hours, paid_leave_hours, special_leave_hours, leave_paid FROM attendance")) {
      return sickAttendance.filter((a) => a.staff_id === params[0] && a.work_date >= params[1] && a.work_date <= params[2]);
    }
    if (q.startsWith("SELECT target_year, target_month, ledger, prescribed_work_days, leave_paid_days FROM salary_results")) {
      return salaries.filter((x) => x.staff_id === params[0] && x.target_year * 100 + x.target_month >= params[1] && x.target_year * 100 + x.target_month <= params[2])
        .map((x) => ({ ...x, prescribed_work_days: 20, leave_paid_days: null }));
    }
    if (q.startsWith("SELECT staff_id, pay_date, amount, income_tax, detail FROM retirement_allowances")) {
      return store.retirements.filter((r) => r.pay_date >= params[0] && r.pay_date <= params[1]);
    }
    if (q.startsWith("SELECT name, address, phone, corporate_number FROM company")) return [store.company];
    if (q.startsWith("SELECT code, special_due FROM resident_tax_municipalities")) return store.municipalities;
    if (q.startsWith("SELECT kdf, salt, wrapped_by_password")) {
      const r = store.keys;
      return [{ kdf: JSON.stringify(r.kdf), salt: r.salt, wrapped_by_password: r.wrappedByPassword, recovery_salt: r.recoverySalt, wrapped_by_recovery: r.wrappedByRecovery }];
    }
    console.warn("fakeDb: 知らない SELECT", q, params);
    return [];
  },
  async execute(sql: string, params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("UPDATE company SET gensen_nofu")) store.company.gensen_nofu = String(params[0]);
    else if (q.startsWith("UPDATE company SET journal_settings")) store.company.journal_settings = String(params[0]);
    else if (q.startsWith("UPDATE staff SET resident_tax_idou = ? WHERE id = ?")) {
      const s = staffOf(params[1]);
      if (s) s.resident_tax_idou = params[0];
    } else if (q.startsWith("INSERT INTO resident_tax_municipalities (code, mail_zip, mail_address, mail_name")) {
      const [code, mail_zip, mail_address, mail_name] = params;
      const m: any = store.municipalities.find((x) => x.code === code) ?? (store.municipalities.push({ code, designation_number: "", special_due: 0 } as any), store.municipalities[store.municipalities.length - 1]);
      Object.assign(m, { mail_zip, mail_address, mail_name });
    } else if (q.startsWith("INSERT INTO retirement_allowances")) {
      const [staff_id, pay_date, fixed_date, amount, income_tax, city_tax, pref_tax, municipality, detail] = params;
      store.retirements.push({ id: Math.max(0, ...store.retirements.map((r) => r.id)) + 1, staff_id, pay_date, fixed_date, amount, income_tax, city_tax, pref_tax, municipality, detail });
    } else if (q.startsWith("UPDATE retirement_allowances SET")) {
      const [staff_id, pay_date, fixed_date, amount, income_tax, city_tax, pref_tax, municipality, detail, id] = params;
      const r = store.retirements.find((x) => x.id === id);
      if (r) Object.assign(r, { staff_id, pay_date, fixed_date, amount, income_tax, city_tax, pref_tax, municipality, detail });
    } else if (q.startsWith("DELETE FROM retirement_allowances WHERE id = ?")) {
      store.retirements = store.retirements.filter((x) => x.id !== params[0]);
    } else if (q.startsWith("INSERT INTO app_logs") || q.startsWith("INSERT INTO my_number_logs")) {
      store.logs.push(params.map(String).join(" | "));
    } else console.warn("fakeDb: 知らない EXECUTE", q, params);
    return { rowsAffected: 1 };
  },
};

const user = { id: 1, login_id: "tanto", display_name: "事務 担当" };

type Tab = "meisai" | "nofu" | "idou" | "choubo" | "nencho" | "fuyou" | "taishoku" | "kenpo" | "label";
const TABS: [Tab, string][] = [["meisai", "明細書・一覧表"], ["nofu", "所得税の納付書"], ["idou", "住民税の異動届出書"], ["choubo", "法定三帳簿（年次有給休暇管理簿）"], ["nencho", "年末調整一覧表"], ["fuyou", "扶養控除等申告書の下書き"], ["taishoku", "退職金（退職所得）"], ["kenpo", "傷病手当金・出産手当金の証明"], ["label", "給与支払報告書の送付ラベル"]];

/** 年末調整一覧表の見本（年末調整の画面の一覧と同じ形の行） */
const nenchoRows: any[] = [
  { staff: staffList[0], exclusion: null, note: null, totals: { salary: 4380000, socialInsurance: 640000, withheldTax: 98000, salaryMonths: [], bonusCount: 1 },
    saved: { declaration: {
      ...emptyDeclaration(),
      spouse: { name: "山田　花子", furigana: "ヤマダ ハナコ", birthday: "1982-05-05", totalIncome: 400000, disability: "none", livingTogether: true },
      dependents: [
        { name: "山田　一郎", furigana: "ヤマダ イチロウ", relation: "子", birthday: "2011-05-01", totalIncome: 0, disability: "none", livingTogether: true, linealAscendant: false },
        { name: "山田　次郎", furigana: "ヤマダ ジロウ", relation: "子", birthday: "2015-04-02", totalIncome: 0, disability: "none", livingTogether: true, linealAscendant: false },
        { name: "山田　父", furigana: "ヤマダ チチ", relation: "父", birthday: "1957-06-01", totalIncome: 300000, disability: "general", livingTogether: true, linealAscendant: true },
      ],
    }, updatedAt: "", settleYear: 2026, settleMonth: 12, result: { employmentIncomeAdjusted: 3088000, deductions: { total: 1360000 }, taxableIncome: 1728000, annualTax: 88200, withheldTax: 98000, difference: 9800 } },
    stale: false, settlement: "done" },
  { staff: staffList[1], exclusion: null, note: null, totals: { salary: 1700000, socialInsurance: 250000, withheldTax: 18000, salaryMonths: [], bonusCount: 1 },
    saved: { declaration: emptyDeclaration(), updatedAt: "", settleYear: 2026, settleMonth: 12, result: { employmentIncomeAdjusted: 1050000, deductions: { total: 830000 }, taxableIncome: 220000, annualTax: 11200, withheldTax: 18000, difference: 6800 } },
    stale: false, settlement: null },
  { staff: staffList[2], exclusion: "年の途中で退職", note: null, totals: { salary: 3050000, socialInsurance: 460000, withheldTax: 78000, salaryMonths: [], bonusCount: 1 }, saved: null, stale: false, settlement: null },
  { staff: staffList[4], exclusion: null, note: null, totals: { salary: 7200000, socialInsurance: 960000, withheldTax: 624000, salaryMonths: [], bonusCount: 1 }, saved: null, stale: false, settlement: null },
];

function Page() {
  const [tab, setTab] = useState<Tab>("meisai");
  const [, setTick] = useState(0);
  return (
    <div style={{ padding: 20 }}>
      <div className="no-print" style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map(([key, label]) => (
          <button key={key} id={`tab-${key}`} onClick={() => setTab(key)} style={{ padding: "8px 16px", border: "none", borderRadius: 6, cursor: "pointer", backgroundColor: tab === key ? "#2563eb" : "#e2e8f0", color: tab === key ? "white" : "#334155" }}>
            {label}
          </button>
        ))}
      </div>
      {tab === "meisai" && <PayReportManager db={fakeDb as any} staffList={staffList} />}
      {tab === "nofu" && <WithholdingPaymentManager db={fakeDb as any} />}
      {tab === "idou" && <ResidentTaxIdouManager db={fakeDb as any} staffList={staffList} currentUser={user} onDataChange={() => setTick((n) => n + 1)} />}
      {tab === "choubo" && <LegalBooksManager db={fakeDb as any} staffList={staffList} />}
      {tab === "label" && (
        <MailLabelCard db={fakeDb as any} company={{ name: store.company.name, zip: "1000001", address: store.company.address }}
          targets={["131016", "271004", "131032"].map((code, i) => ({ code, municipality: localGovByCode(code)!, count: [3, 1, 1][i] }))} />
      )}
      {tab === "kenpo" && <KenpoBenefitCertManager db={fakeDb as any} staffList={staffList} />}
      {tab === "taishoku" && <RetirementManager db={fakeDb as any} staffList={staffList} currentUser={user} />}
      {tab === "nencho" && <NenchoListView year={2026} rows={nenchoRows} statusLabel={(r: any) => r.settlement === "done" ? "精算済み" : "精算前"} />}
      {tab === "fuyou" && <FuyouDraftView db={fakeDb as any} year={2026} rows={nenchoRows} />}
    </div>
  );
}

setupMyNumbers().then(() => {
  createRoot(document.getElementById("root")!).render(
    <MessageDialogProvider>
      <ToastProvider>
        <MyNumberUnlockProvider>
          <Page />
        </MyNumberUnlockProvider>
      </ToastProvider>
    </MessageDialogProvider>,
  );
});
