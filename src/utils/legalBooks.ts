/**
 * 法定三帳簿（労働者名簿・賃金台帳・出勤簿）を作る
 *
 * ■ 労働者名簿（労働基準法107条・施行規則53条）：氏名・生年月日・履歴・性別・住所・従事する業務の種類（常時30人未満の事業は不要）・
 *   雇入れの年月日・退職の年月日とその事由（解雇のときはその理由も）・死亡の年月日とその原因
 * ■ 賃金台帳（労働基準法108条・施行規則54条）：氏名・性別・賃金計算期間・労働日数・労働時間数・時間外労働／休日労働／深夜労働の時間数・
 *   基本給と手当その他賃金の種類ごとの額・控除の額。管理監督者などは、労働時間数と時間外・休日・深夜の時間数を書かなくてよい
 * ■ 出勤簿：日ごとの区分・始業と終業の時刻・休憩・労働時間（厚生労働省「労働時間の適正な把握のために使用者が講ずべき措置に関するガイドライン」）
 * 様式（労働者名簿は様式第19号、賃金台帳は様式第20号）は、書かなければならない項目の最少限度を決めたもので、横書き・縦書きなど
 * ほかの形を使ってもよい（施行規則59条の2）。Q は、一般的な給与ソフトと同じく、項目を並べた表（印刷と CSV）にする。
 * 保存は5年（当分の間は3年。労働基準法109条・附則143条）。
 */
import { WORK_TYPE_LABELS } from "./paidLeave";
import { formatBreakList, parseBreaksJson, effectiveBreaks } from "./breaks";
import type { SalaryResult } from "./calcSalary";
import { OVERTIME_PREMIUM_RATE, OVERTIME_RATE, HOLIDAY_WORK_RATE } from "../constants";

// ── 賃金台帳の内訳（確定するときに残す） ─────────────────────────────

export interface LedgerLine {
  name: string;
  /** 額（支給の中の欠勤控除などはマイナス） */
  amount: number;
}

/** 1回分の給与・賞与の、賃金台帳に書く内訳 */
export interface PayLedger {
  /** 賃金計算期間（YYYY-MM-DD。賞与・わからなければ null） */
  periodStart: string | null;
  periodEnd: string | null;
  /** 労働日数（働いた時間がある日） */
  workDays: number;
  /** 労働時間数・時間外（法定外）・休日（法定休日）・深夜の労働時間数（時間） */
  workHours: number;
  overtimeHours: number;
  holidayHours: number;
  nightHours: number;
  /** 支給の行（給与明細と同じ。足すと総支給額） */
  earnings: LedgerLine[];
  /** 控除の行（足すと控除合計） */
  deductions: LedgerLine[];
  totalEarnings: number;
  totalDeductions: number;
  /** 差引支給額（年末調整の過不足額を含む） */
  netPay: number;
  /** この給与で精算した年末調整の過不足額（＋還付／−徴収） */
  yearEndSettlement: number;
}

const pct = (rate: number) => Math.round((rate - 1) * 100);

/**
 * 給与の計算結果から、賃金台帳の内訳を作る（給与明細の支給・控除の行と同じ。0円の行は入れない。基本給はいつも入れる）
 * @param wageType 給与形態（monthly・daily・hourly。基本給の行の名前）
 */
export const salaryLedgerOf = (
  r: SalaryResult,
  opts: { wageType?: string | null; allowanceName?: string | null; period?: { start: string; end: string } | null },
): PayLedger => {
  const earnings: LedgerLine[] = [
    { name: opts.wageType === "daily" ? "日給" : opts.wageType === "hourly" ? "時給分" : "基本給", amount: r.basePay },
    { name: "欠勤控除", amount: -r.absenceDeduction },
    { name: "無給休暇控除", amount: -r.unpaidLeaveDeduction },
    { name: "フレックス不足時間控除", amount: -r.flexShortageDeduction },
    { name: "遅刻早退控除", amount: -r.tardyDeduction },
    { name: "時間外手当(法定内)", amount: r.statutoryOvertimePay },
    ...(r.fixedOvertimeAllowance > 0
      ? [{ name: "固定残業代", amount: r.fixedOvertimeAllowance }, { name: "時間外手当(固定残業代の超過分)", amount: r.fixedOvertimeExcess }]
      : [{ name: `時間外手当(${pct(OVERTIME_RATE)}%割増)`, amount: r.standardOvertimePay }, { name: `時間外手当(${pct(OVERTIME_PREMIUM_RATE)}%割増)`, amount: r.highOvertimePay }]),
    { name: `休日出勤手当(${pct(HOLIDAY_WORK_RATE)}%割増)`, amount: r.holidayWorkPay },
    { name: "有給休暇手当", amount: r.paidLeavePay },
    { name: "特別休暇手当", amount: r.specialLeavePay },
    { name: "深夜手当", amount: r.nightPay },
    { name: "通勤手当", amount: r.commutePay },
    { name: (opts.allowanceName || "").trim() || "任意手当", amount: r.allowanceAmount },
    ...r.customEarningLines,
  ].filter((l, i) => i === 0 || l.amount !== 0);
  const deductions: LedgerLine[] = [
    { name: "健康保険料", amount: r.healthInsurance },
    { name: "介護保険料", amount: r.nursingInsurance },
    { name: "子ども・子育て支援金", amount: r.childSupport },
    { name: "国保組合の保険料", amount: r.kokuhoPremium },
    { name: "厚生年金保険料", amount: r.welfarePension },
    { name: "雇用保険料", amount: r.empInsurance },
    { name: "所得税", amount: r.incomeTax },
    { name: "住民税", amount: r.residentTax },
    ...r.customDeductionLines,
  ].filter((l) => l.amount !== 0);
  return {
    periodStart: opts.period?.start ?? null, periodEnd: opts.period?.end ?? null,
    workDays: r.workDays, workHours: r.totalWorkHours, overtimeHours: r.totalOvertimeHours, holidayHours: r.holidayWorkHours, nightHours: r.totalNightHours,
    earnings, deductions, totalEarnings: r.totalEarnings, totalDeductions: r.totalDeductions, netPay: r.netPay, yearEndSettlement: r.yearEndSettlement,
  };
};

/** 賞与の、賃金台帳に書く内訳（賞与の支給項目・控除項目） */
export const bonusLedgerOf = (b: {
  earnings: LedgerLine[]; healthInsurance: number; nursingInsurance: number; childSupport: number; welfarePension: number;
  empInsurance: number; incomeTax: number; customDeductions: LedgerLine[]; totalEarnings: number; totalDeductions: number; netPay: number;
}): PayLedger => ({
  periodStart: null, periodEnd: null, workDays: 0, workHours: 0, overtimeHours: 0, holidayHours: 0, nightHours: 0,
  earnings: b.earnings.filter((l) => l.amount !== 0),
  deductions: [
    { name: "健康保険料", amount: b.healthInsurance },
    { name: "介護保険料", amount: b.nursingInsurance },
    { name: "子ども・子育て支援金", amount: b.childSupport },
    { name: "厚生年金保険料", amount: b.welfarePension },
    { name: "雇用保険料", amount: b.empInsurance },
    { name: "所得税", amount: b.incomeTax },
    ...b.customDeductions,
  ].filter((l) => l.amount !== 0),
  totalEarnings: b.totalEarnings, totalDeductions: b.totalDeductions, netPay: b.netPay, yearEndSettlement: 0,
});

/** 確定した結果の ledger の列（JSON）を読む（ない・読めないときは null） */
export const parseLedger = (value: unknown): PayLedger | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const v = JSON.parse(value);
    return v && Array.isArray(v.earnings) && Array.isArray(v.deductions) ? (v as PayLedger) : null;
  } catch {
    return null;
  }
};

// ── 賃金台帳（1人の1年分。月ごとの給与と賞与を横に並べる） ─────────────────────

/** 賃金台帳の列（1回の給与・賞与）。内訳がない（v18 より前に確定した）ときは ledger が null で、確定した額だけを出す */
export interface WageLedgerColumn {
  label: string;
  kind: "salary" | "bonus";
  ledger: PayLedger | null;
  /** 内訳がないときに出す額（確定した結果の列から） */
  fallback?: { totalEarnings: number; totalDeductions: number; netPay: number };
}

export type LedgerCell = number | string | null;

export interface WageLedgerRow {
  label: string;
  kind: "info" | "hours" | "earning" | "earningTotal" | "deduction" | "deductionTotal" | "net";
  cells: LedgerCell[];
  total: LedgerCell;
}

/** 合計（数のある列だけを足す。どの列にも数がなければ空） */
const sum = (cells: LedgerCell[]): number | null =>
  cells.some((c) => typeof c === "number") ? cells.reduce<number>((s, c) => s + (typeof c === "number" ? c : 0), 0) : null;
const md = (d: string | null) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "");

/**
 * 項目の名前を、給与明細の順に（同じ名前は1つに）。あとの月にだけある項目は、その月の明細で1つ前にある項目のすぐ後に入れる
 * （例：10月だけ「時間外手当(法定内)」があれば、基本給の次に入れる）。前にない項目は、後にある項目のすぐ前に入れ
 * （賞与だけの「健康保険料」は、給与にもある「所得税」の前）、どちらもなければ、いちばん後に足す（賞与の支給項目は給与の項目の後になる）
 */
const namesOf = (lists: LedgerLine[][]) => {
  const names: string[] = [];
  for (const list of lists) {
    let prev = -1;
    list.forEach((l, i) => {
      const found = names.indexOf(l.name);
      if (found >= 0) {
        prev = found;
        return;
      }
      if (prev < 0) {
        const next = list.slice(i + 1).map((n) => names.indexOf(n.name)).find((j) => j >= 0);
        prev = (next ?? names.length) - 1;
      }
      names.splice(prev + 1, 0, l.name);
      prev += 1;
    });
  }
  return names;
};

/** 賃金台帳の表（行：期間・日数・時間・支給項目・控除項目、列：給与・賞与ごと＋合計） */
export const wageLedgerRows = (columns: WageLedgerColumn[]): WageLedgerRow[] => {
  const ledgers = columns.map((c) => c.ledger);
  const valueOf = (lines: LedgerLine[] | undefined, name: string): number | null => {
    if (!lines) return null;
    const found = lines.filter((l) => l.name === name);
    return found.length > 0 ? found.reduce((s, l) => s + l.amount, 0) : null;
  };
  const hours = (label: string, pick: (l: PayLedger) => number): WageLedgerRow => {
    const cells = columns.map((c) => (c.kind === "salary" && c.ledger ? pick(c.ledger) : null));
    return { label, kind: "hours", cells, total: sum(cells) };
  };
  const earningNames = namesOf(ledgers.map((l) => l?.earnings ?? []));
  const deductionNames = namesOf(ledgers.map((l) => l?.deductions ?? []));
  const amount = (label: string, kind: WageLedgerRow["kind"], pick: (c: WageLedgerColumn) => number | null): WageLedgerRow => {
    const cells = columns.map(pick);
    return { label, kind, cells, total: sum(cells) };
  };
  return [
    {
      label: "賃金計算期間", kind: "info",
      cells: columns.map((c) => (c.ledger?.periodStart ? `${md(c.ledger.periodStart)}〜${md(c.ledger.periodEnd)}` : null)), total: null,
    },
    hours("労働日数", (l) => l.workDays),
    hours("労働時間数", (l) => l.workHours),
    hours("時間外労働時間数", (l) => l.overtimeHours),
    hours("休日労働時間数", (l) => l.holidayHours),
    hours("深夜労働時間数", (l) => l.nightHours),
    ...earningNames.map((name) => amount(name, "earning", (c) => valueOf(c.ledger?.earnings, name))),
    amount("総支給額", "earningTotal", (c) => c.ledger?.totalEarnings ?? c.fallback?.totalEarnings ?? null),
    ...deductionNames.map((name) => amount(name, "deduction", (c) => valueOf(c.ledger?.deductions, name))),
    amount("控除合計", "deductionTotal", (c) => c.ledger?.totalDeductions ?? c.fallback?.totalDeductions ?? null),
    ...(columns.some((c) => (c.ledger?.yearEndSettlement ?? 0) !== 0)
      ? [amount("年末調整の過不足", "net", (c) => (c.ledger ? c.ledger.yearEndSettlement : null))]
      : []),
    amount("差引支給額", "net", (c) => c.ledger?.netPay ?? c.fallback?.netPay ?? null),
  ];
};

// ── 労働者名簿 ─────────────────────────────────────────────

export const GENDER_LABELS: Record<string, string> = { male: "男", female: "女" };

export interface RosterRow {
  id: string;
  name: string;
  furigana: string;
  birthday: string;
  gender: string;
  address: string;
  jobType: string;
  joinDate: string;
  retirementDate: string;
  retirementReason: string;
  deathDate: string;
  deathCause: string;
  careerHistory: string;
}

/** 労働者名簿の1人分（従業員の画面の値から） */
export const rosterRowOf = (s: any): RosterRow => ({
  id: String(s.id ?? ""), name: String(s.name ?? ""), furigana: String(s.furigana ?? ""), birthday: String(s.birthday ?? ""),
  gender: GENDER_LABELS[String(s.gender ?? "")] ?? "", address: [s.zip_code ? `〒${s.zip_code}` : "", String(s.address ?? "")].filter(Boolean).join(" "),
  jobType: String(s.job_type ?? ""), joinDate: String(s.join_date ?? ""), retirementDate: String(s.retirement_date ?? ""),
  retirementReason: String(s.retirement_reason ?? ""), deathDate: String(s.death_date ?? ""), deathCause: String(s.death_cause ?? ""),
  careerHistory: String(s.career_history ?? ""),
});

/** 労働者名簿の列（名前・値） */
export const ROSTER_COLUMNS: [string, keyof RosterRow][] = [
  ["従業員ID", "id"], ["氏名", "name"], ["フリガナ", "furigana"], ["生年月日", "birthday"], ["性別", "gender"], ["住所", "address"],
  ["従事する業務の種類", "jobType"], ["雇入れの年月日", "joinDate"], ["退職の年月日", "retirementDate"], ["退職の事由", "retirementReason"],
  ["死亡の年月日", "deathDate"], ["死亡の原因", "deathCause"], ["履歴", "careerHistory"],
];

/** 労働者名簿で、書いていない項目（業務の種類は常時30人未満なら不要なので、知らせるだけ） */
export const rosterMissing = (r: RosterRow): string[] => [
  ...(!r.birthday ? ["生年月日"] : []), ...(!r.gender ? ["性別"] : []), ...(!r.address ? ["住所"] : []), ...(!r.joinDate ? ["雇入れの年月日"] : []),
  ...(!r.careerHistory ? ["履歴"] : []), ...(r.retirementDate && !r.retirementReason ? ["退職の事由"] : []),
];

// ── 出勤簿 ──────────────────────────────────────────────

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export interface AttendanceBookRow {
  date: string;
  weekday: string;
  /** 区分（出勤・公休・有給・特別休暇の名前など。勤怠がない日は空） */
  type: string;
  entry: string;
  exit: string;
  breaks: string;
  workHours: number | null;
  nightHours: number | null;
  paidLeaveHours: number | null;
  memo: string;
  /** 勤怠を確定したか（勤怠がない日は null） */
  finalized: boolean | null;
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * 出勤簿の行（期間の毎日。勤怠がない日も行を作る）
 * @param records 勤怠の行（attendance の列。特別休暇の名前は leave_name）
 */
export const attendanceBookRows = (period: { start: string; end: string }, records: any[]): AttendanceBookRow[] => {
  const byDate = new Map(records.map((r) => [String(r.work_date), r]));
  const rows: AttendanceBookRow[] = [];
  for (let d = new Date(`${period.start}T00:00:00`); ymd(d) <= period.end; d.setDate(d.getDate() + 1)) {
    const date = ymd(d);
    const r = byDate.get(date);
    if (!r) {
      rows.push({ date, weekday: WEEKDAYS[d.getDay()], type: "", entry: "", exit: "", breaks: "", workHours: null, nightHours: null, paidLeaveHours: null, memo: "", finalized: null });
      continue;
    }
    const type = String(r.work_type || "normal");
    const label = (type === "special" || type === "special_half") && r.leave_name
      ? `${r.leave_name}${type === "special_half" ? "（半日）" : ""}`
      : WORK_TYPE_LABELS[type] ?? type;
    const breaks = effectiveBreaks(parseBreaksJson(r.breaks), parseBreaksJson(r.csv_breaks) ?? []);
    // 確定したときに引いた決まった休憩（utils/fixedBreak.ts。「12:00〜13:00」「45分」）も、休憩として書く
    const autoBreak = String(r.auto_break ?? "").trim();
    rows.push({
      date, weekday: WEEKDAYS[d.getDay()], type: label,
      entry: String(r.entry_time || r.csv_entry_time || ""), exit: String(r.exit_time || r.csv_exit_time || ""),
      breaks: [formatBreakList(breaks), autoBreak ? `決まった休憩 ${autoBreak}` : ""].filter(Boolean).join(" "), workHours: Number(r.work_hours) || 0, nightHours: Number(r.night_hours) || 0,
      paidLeaveHours: Number(r.paid_leave_hours) || 0, memo: String(r.memo ?? ""), finalized: Number(r.is_finalized) === 1,
    });
  }
  return rows;
};

/** 出勤簿の合計（出勤日数・労働時間・深夜・時間有給） */
export const attendanceBookTotals = (rows: AttendanceBookRow[]) => ({
  workDays: rows.filter((r) => (r.workHours ?? 0) > 0).length,
  workHours: rows.reduce((s, r) => s + (r.workHours ?? 0), 0),
  nightHours: rows.reduce((s, r) => s + (r.nightHours ?? 0), 0),
  paidLeaveHours: rows.reduce((s, r) => s + (r.paidLeaveHours ?? 0), 0),
});

// ── 書き方 ─────────────────────────────────────────────

/** 時間（10進）を「8:30」にする */
export const hoursText = (h: number | null | undefined): string => {
  if (h === null || h === undefined) return "";
  const minutes = Math.round(h * 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
};

/** CSV の1行（「,」「"」・改行がある値は "" で囲む） */
const csvLine = (cells: (string | number | null)[]) =>
  cells.map((c) => {
    const s = c === null ? "" : String(c);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",");

export const rosterCsv = (rows: RosterRow[]): string =>
  [csvLine(ROSTER_COLUMNS.map(([label]) => label)), ...rows.map((r) => csvLine(ROSTER_COLUMNS.map(([, key]) => r[key])))].join("\r\n");

export const wageLedgerCsv = (header: { name: string; gender: string; year: number }, columns: WageLedgerColumn[]): string => {
  const rows = wageLedgerRows(columns);
  const value = (row: WageLedgerRow, c: LedgerCell) => (typeof c === "number" && row.kind === "hours" && row.label !== "労働日数" ? hoursText(c) : c);
  return [
    csvLine([`賃金台帳（${header.year}年）`, `氏名：${header.name}`, `性別：${header.gender}`]),
    csvLine(["項目", ...columns.map((c) => c.label), "合計"]),
    ...rows.map((row) => csvLine([row.label, ...row.cells.map((c) => value(row, c)), value(row, row.total)])),
  ].join("\r\n");
};

export const attendanceBookCsv = (header: { name: string; period: { start: string; end: string } }, rows: AttendanceBookRow[]): string => {
  const t = attendanceBookTotals(rows);
  return [
    csvLine([`出勤簿（${header.period.start}〜${header.period.end}）`, `氏名：${header.name}`]),
    csvLine(["日付", "曜日", "区分", "出勤", "退勤", "休憩", "労働時間", "深夜", "時間有給", "備考", "確定"]),
    ...rows.map((r) => csvLine([
      r.date, r.weekday, r.type, r.entry, r.exit, r.breaks, hoursText(r.workHours), hoursText(r.nightHours),
      r.paidLeaveHours ? hoursText(r.paidLeaveHours) : "", r.memo, r.finalized === null ? "" : r.finalized ? "確定" : "未確定",
    ])),
    csvLine(["合計", "", `出勤 ${t.workDays}日`, "", "", "", hoursText(t.workHours), hoursText(t.nightHours), hoursText(t.paidLeaveHours), "", ""]),
  ].join("\r\n");
};
