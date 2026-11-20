/**
 * 雇用保険の賃金の証明（離職証明書の「離職の日以前の賃金支払状況等」の欄。休業開始時賃金月額証明書・六十歳到達時等賃金証明書も同じ形）
 *
 * ■ ⑧ 被保険者期間算定対象期間（A 一般被保険者等）と ⑨ その期間の賃金支払基礎日数
 *   ・離職日の翌日に応当する日から、1か月ずつ前にさかのぼって区切る（1行目は「〇月〇日〜離職日」）。応当する日がない月は、その月の末日
 *     （手引きの記入例(4)：10月30日に離職 → 9月30日〜離職日、8月31日〜9月29日、7月31日〜8月30日 …）
 *   ・⑨が11日以上の完全月（資格取得日で切れていない1か月）が12か月（高年齢被保険者（離職日に65歳以上）は6か月）になるまで。
 *     離職日以前2年間（高年齢被保険者は1年間）まで。資格取得日より前は書かない
 *   ・疾病・負傷・出産・育児などで引き続き30日以上賃金を受けなかった期間は、行に書かずに、その分さかのぼる（最大4年。
 *     手引きの記入例(7)。⑬に期間と理由を書く。証明する書類が要るので、Q は知らせる）
 *   ・11日以上の完全月が足りないときは、⑨が10日以下の行の、賃金支払の基礎となった時間数を⑬に書く（令和2年8月1日以降の離職）
 * ■ ⑩ 賃金支払対象期間・⑪ その基礎日数・⑫ 賃金額（A：月・週など一定の期間で決まる賃金 / B：日・時間・出来高で決まる賃金 / 計）
 *   ・賃金締切日の翌日から賃金締切日まで（1行目は「〇月〇日〜離職日」）。⑪が11日以上の完全月が6か月になるまで（2年間まで）
 *   ・月給の人は、残業代などの変動の手当も A に入れる（手引き：月給者で変動手当のみが翌月払いでも当月に入れる）。
 *     日給・時給の人は、日給・時給の分と残業代などを B に、月額の手当（通勤手当・家族手当など）を A に入れる（記入例(3)）
 *   ・賃金に入れないもの：臨時の賃金（結婚手当など）・3か月を超える期間ごとに払う賃金（賞与など）・労災の待期の休業補償。
 *     給与項目の「平均賃金での扱い」が「入れない」の行は入れない。休業手当（会社都合で休ませた日）は入れる（記入例(8)）
 *   ・現物で払った賃金のうち雇用保険の賃金に入れたもの（定期券など。確定した給与の in_kind_emp）は A に入れる
 * ■ 基礎日数（⑨⑪）：賃金支払の基礎となった日数。有給休暇も入れ、半日でも1日（手引き）
 *   ・月給（月間全部を拘束する意味の月給制。欠勤控除をしない）：暦日数
 *   ・日給月給（欠勤控除をする月給制）：所定労働日のうち、欠勤した日を除いた日数（記入例(5)(6)）
 *   ・日給・時給：働いた日・有給休暇の日・有給の特別休暇の日・休業手当を払った日
 *   ・給与を払わない休業・休職の日は数えない
 * ■ 短期雇用特例被保険者（季節的に雇用される人）は、⑧を B 欄（暦月）で書く：離職した月から順にさかのぼり、⑨はその暦月の基礎日数
 *   （離職日以前1年間・資格取得日まで。手引きの記入例(9)。特例一時金は、11日以上の月が6か月以上で受けられる）
 * ■ 休業期間中の所定休日（月給の人だけ）：休業手当を払った日と、その直後に休業手当を払った日のあいだに、所定休日（有給休暇は含まない）だけが
 *   あるとき、その休日を⑬に「休業期間中の所定休日○日」と書く（賃金月ごとに数える。日給・時給の人は書かない。手引き p.39 の例1〜5）
 * ■ 通勤手当を何か月分かまとめて払ったときは、その月数で割り、それぞれの月に入れる（手引き ⑫欄。従業員の雇用保険の欄で、まとめて払った
 *   給与の支給年月と月数を入れる。1円未満の端数は初めの月に入れる）
 * 出典：厚生労働省「雇用保険事務手続きの手引き【第２編】被保険者資格の取得・喪失編」（令和８年８月版）の離職証明書の記入例と説明
 */
import dayjs from "dayjs";
import { getPeriodForPayMonth, type PayrollGroupForPeriod } from "./payrollPeriod";
import { averageWageKindOfLine, SHUTDOWN_WORK_TYPE } from "./averageWage";
import { parseLedger } from "./legalBooks";
import { parseLeavePeriods, type LeavePeriod } from "./leaveExemption";
import { leaveOn, LEAVE_TYPE_NAMES } from "./leaveOfAbsence";
import { isSpecialLeaveWorkType, SPECIAL_LEAVE_FULL, SPECIAL_LEAVE_HALF, specialLeaveOfRow } from "./specialLeave";
import { staffAsOf } from "./staffHistory";
import { dayScheduledHours, scheduledHoursMissing } from "./scheduledHours";

/** 確定した勤怠（基礎日数・時間数を数えるのに使う項目） */
export interface WageCertDay {
  work_date: string;
  work_type?: string | null;
  work_hours?: number | string | null;
  leave_paid?: number | string | null;
  paid_leave_hours?: number | string | null;
  special_leave_hours?: number | string | null;
  /** その日だけ直した所定労働時間（シフト。utils/scheduledHours.ts） */
  scheduled_hours?: number | string | null;
}

/** 確定した給与（支払った年月ごと） */
export interface WageCertSalary {
  target_year: number;
  target_month: number;
  ledger?: string | null;
  total_earnings: number;
  non_remuneration?: number | null;
  in_kind_emp?: number | null;
}

export interface WageCertInput {
  /** 離職日（休業開始時賃金月額証明書は休業を始めた日の前日、六十歳到達時等賃金証明書は60歳に達した日） */
  endDate: string;
  /** 雇用保険の資格取得日 */
  acquiredOn: string;
  /** 高年齢被保険者（離職日に65歳以上。⑨の完全月は6か月・1年間） */
  elderly: boolean;
  /** 従業員（wage_type の履歴・leave_periods・scheduled_work_hours） */
  staff: any;
  /** 給与規定グループ（締日・翌月払い・欠勤控除のしかた） */
  group: PayrollGroupForPeriod & { absence_deduction_method?: string | null };
  salaries: WageCertSalary[];
  attendance: WageCertDay[];
  /** その日が所定労働日か（日給月給の人で、勤怠を入れていない月に使う。なければ土日を除く） */
  isWorkDay?: (date: string) => boolean;
  /** 短期雇用特例被保険者（⑧を B 欄の暦月で書く） */
  shortTerm?: boolean;
  /** 通勤手当を何か月分かまとめて払った給与（支給年月 YYYY-MM と月数） */
  commuteLumps?: { pay: string; months: number }[];
}

/** ⑧⑨ の1行 */
export interface InsuredPeriodRow {
  from: string;
  to: string;
  /** ⑨ 賃金支払基礎日数 */
  days: number;
  /** 賃金支払の基礎となった時間数（働いた時間と有給休暇の時間） */
  hours: number;
  /** 完全月（資格取得日で切れていない1か月） */
  complete: boolean;
  /** ⑬ 備考 */
  note: string;
  /** 短期雇用特例被保険者の B 欄の月（1〜12。一般被保険者等は書かない） */
  month?: number;
}

/** ⑩⑪⑫⑬ の1行 */
export interface WagePeriodRow {
  from: string;
  to: string;
  /** ⑪ 基礎日数 */
  days: number;
  hours: number;
  /** ⑫ 賃金額（A：月・週など一定の期間で決まる賃金 / B：日・時間・出来高で決まる賃金） */
  a: number;
  b: number;
  total: number;
  complete: boolean;
  note: string;
  /** その期間の給与の支払年月 */
  payYear: number;
  payMonth: number;
}

export interface WageCertResult {
  /** 離職日の翌日 */
  nextDay: string;
  insured: InsuredPeriodRow[];
  wages: WagePeriodRow[];
  /** ⑨が11日以上の完全月の数（80時間以上の月を含まない） */
  fullMonths: number;
  /** ⑪が11日以上の完全月の数 */
  fullWageMonths: number;
  problems: string[];
  notes: string[];
}

const fmt = (d: dayjs.Dayjs) => d.format("YYYY-MM-DD");
const addDays = (date: string, n: number) => fmt(dayjs(date).add(n, "day"));
const maxDate = (a: string, b: string) => (a > b ? a : b);
const minDate = (a: string, b: string) => (a < b ? a : b);
const eachDate = (from: string, to: string, fn: (date: string) => void) => {
  for (let d = dayjs(from); !d.isAfter(dayjs(to), "day"); d = d.add(1, "day")) fn(fmt(d));
};
const isWeekday = (date: string) => {
  const w = dayjs(date).day();
  return w !== 0 && w !== 6;
};
/** 「8月1日」 */
export const md = (date: string) => `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;

/** 離職日の翌日に応当する日（k か月前。その日がない月は月末。dayjs の月の引き算は月末にそろえる） */
const monthsBefore = (nextDay: string, k: number) => fmt(dayjs(nextDay).subtract(k, "month"));

/** その日が、賃金支払の基礎となった日（働いた・有給休暇・有給の特別休暇・休業手当） */
const isPaidDay = (r: WageCertDay | undefined): boolean =>
  !!r && ((Number(r.work_hours) || 0) > 0 || r.work_type === "paid_full" || r.work_type === "paid_half"
    || (isSpecialLeaveWorkType(r.work_type) && specialLeaveOfRow(r).paid) || r.work_type === SHUTDOWN_WORK_TYPE);

/** 欠勤として賃金を引いた日（欠勤・無給の特別休暇（1日）） */
const isAbsentDay = (r: WageCertDay | undefined): boolean =>
  !!r && (r.work_type === "absent" || (r.work_type === SPECIAL_LEAVE_FULL && !specialLeaveOfRow(r).paid));

/** その日の、賃金支払の基礎となった時間数（働いた時間・有給休暇の時間（1日はその日の所定労働時間、半日はその半分）） */
const hoursOf = (r: WageCertDay | undefined, scheduled: number): number => {
  if (!r) return 0;
  let h = Number(r.work_hours) || 0;
  if (r.work_type === "paid_full") h += scheduled;
  else if (r.work_type === "paid_half") h += scheduled / 2;
  h += Number(r.paid_leave_hours) || 0;
  if (isSpecialLeaveWorkType(r.work_type) && specialLeaveOfRow(r).paid) h += r.work_type === SPECIAL_LEAVE_HALF ? scheduled / 2 : scheduled;
  return h;
};

/**
 * 期間の基礎日数と時間数
 * @param monthly 月給（その期間の給与形態）
 * @param fullMonthly 欠勤控除をしない月給（月間全部を拘束する意味の月給制。暦日数）
 */
const daysIn = (
  from: string, to: string, byDate: Map<string, WageCertDay>, leaves: LeavePeriod[], monthly: boolean, fullMonthly: boolean,
  scheduled: (date: string, r: WageCertDay | undefined) => number, isWorkDay: (date: string) => boolean,
): { days: number; hours: number; leaveDays: number; absentDays: number; shutdownDays: number } => {
  let days = 0;
  let hours = 0;
  let leaveDays = 0;
  let absentDays = 0;
  let shutdownDays = 0;
  let anyRecord = false;
  eachDate(from, to, (d) => { if (byDate.has(d)) anyRecord = true; });
  eachDate(from, to, (d) => {
    const r = byDate.get(d);
    const onLeave = !!leaveOn(leaves, d) && !((Number(r?.work_hours) || 0) > 0);
    if (onLeave) {
      leaveDays++;
      return;
    }
    hours += hoursOf(r, scheduled(d, r));
    if (r?.work_type === SHUTDOWN_WORK_TYPE) shutdownDays++;
    if (isAbsentDay(r)) absentDays++;
    if (monthly && fullMonthly) {
      days++;
    } else if (monthly) {
      // 日給月給：勤怠があれば、賃金を払った日（働いた・有給など）。勤怠を入れていない期間は、所定労働日
      if (anyRecord ? isPaidDay(r) : isWorkDay(d)) days++;
    } else if (isPaidDay(r)) {
      days++;
    }
  });
  if (monthly && !anyRecord && !fullMonthly) hours = 0;
  return { days, hours: Math.round(hours * 10) / 10, leaveDays, absentDays, shutdownDays };
};

/**
 * 休業期間中の所定休日：休業手当を払った日と、その直後に休業手当を払った日のあいだに、所定休日（有給休暇・働いた日を除く）だけがあるときの、
 * その休日（手引き p.39。月給の人の⑬に書く）
 */
export const shutdownHolidaysOf = (byDate: Map<string, WageCertDay>, isWorkDay: (date: string) => boolean): Set<string> => {
  const shutdown = [...byDate.values()].filter((r) => r.work_type === SHUTDOWN_WORK_TYPE).map((r) => r.work_date).sort();
  const out = new Set<string>();
  for (let i = 0; i + 1 < shutdown.length; i++) {
    const between: string[] = [];
    let onlyHolidays = true;
    for (let d = addDays(shutdown[i], 1); d < shutdown[i + 1]; d = addDays(d, 1)) {
      const r = byDate.get(d);
      if (isWorkDay(d) || isPaidDay(r) || isAbsentDay(r)) { onlyHolidays = false; break; }
      between.push(d);
    }
    if (onlyHolidays) between.forEach((d) => out.add(d));
  }
  return out;
};

/**
 * 通勤手当を何か月分かまとめて払った給与の、月ごとに入れる額との差（支給年月 YYYY-MM → A に足す額。まとめて払った月は、割った額から払った額を引いた額）
 * @param commuteOf その給与で払った通勤手当（給与の内訳の「通勤」を含む行）
 */
export const commuteSpreadOf = (salaries: WageCertSalary[], lumps: { pay: string; months: number }[]): Map<string, number> => {
  const out = new Map<string, number>();
  const add = (ym: string, v: number) => out.set(ym, (out.get(ym) ?? 0) + v);
  for (const lump of lumps) {
    const s = salaries.find((x) => `${x.target_year}-${String(x.target_month).padStart(2, "0")}` === lump.pay);
    if (!s) continue;
    const ledger = parseLedger(s.ledger);
    const paid = (ledger?.earnings ?? []).filter((l) => String(l.name ?? "").includes("通勤")).reduce((t, l) => t + (Number(l.amount) || 0), 0);
    if (paid <= 0) continue;
    const share = Math.floor(paid / lump.months);
    add(lump.pay, -paid + share + (paid - share * lump.months));
    for (let k = 1; k < lump.months; k++) add(dayjs(`${lump.pay}-01`).add(k, "month").format("YYYY-MM"), share);
  }
  return out;
};

/** 給与の、A（月・週など）・B（日・時間・出来高）の額と、休業手当の額 */
export const wageAmountsOf = (salary: WageCertSalary, wageType: string): { a: number; b: number; shutdownPay: number; excluded: number; fromLedger: boolean } => {
  const ledger = parseLedger(salary.ledger);
  const inKind = Number(salary.in_kind_emp) || 0;
  if (!ledger) {
    const total = (Number(salary.total_earnings) || 0) - (Number(salary.non_remuneration) || 0);
    return wageType === "monthly" ? { a: total + inKind, b: 0, shutdownPay: 0, excluded: 0, fromLedger: false }
      : { a: inKind, b: total, shutdownPay: 0, excluded: 0, fromLedger: false };
  }
  let a = inKind;
  let b = 0;
  let shutdownPay = 0;
  let excluded = 0;
  for (const line of ledger.earnings) {
    const amount = Number(line.amount) || 0;
    let kind = averageWageKindOfLine(line, wageType);
    if (line.name === "休業手当") {
      shutdownPay += amount;
      kind = wageType === "monthly" ? "month" : "time";
    }
    if (kind === "none") {
      excluded += amount;
      continue;
    }
    if (wageType === "monthly" || kind === "month") a += amount;
    else b += amount;
  }
  return { a, b, shutdownPay, excluded, fromLedger: true };
};

/** 休業・休職の期間の名前（「育児休業」など） */
const leaveNameOn = (leaves: LeavePeriod[], date: string): string => {
  const l = leaveOn(leaves, date);
  return l ? LEAVE_TYPE_NAMES[l.type] : "";
};

/**
 * 賃金の証明の欄（⑧〜⑬）を作る
 */
export const buildWageCertificate = (input: WageCertInput): WageCertResult => {
  const { endDate, acquiredOn, staff, group } = input;
  const problems: string[] = [];
  const notes: string[] = [];
  const nextDay = addDays(endDate, 1);
  const leaves = parseLeavePeriods(staff?.leave_periods);
  const byDate = new Map(input.attendance.map((r) => [r.work_date, r]));
  // その日の所定労働時間（勤怠で直した時間 → 曜日の時間 → 1日の所定労働時間。入れていなければ8時間として数えて知らせる。utils/scheduledHours.ts）
  const scheduled = (date: string, r: WageCertDay | undefined) => dayScheduledHours(staff, date, r?.scheduled_hours) ?? 8;
  if (scheduledHoursMissing(staff) && String(staff?.wage_type ?? "") !== "monthly") {
    notes.push("1日の所定労働時間が入っていないので、有給休暇の日の時間は8時間として数えています（従業員の画面で入れてください）。");
  }
  const fullMonthly = String(group.absence_deduction_method ?? "workdays") === "none";
  const isWorkDay = input.isWorkDay ?? isWeekday;
  const wageTypeOn = (date: string) => String(staffAsOf(staff, Number(date.slice(0, 4)), Number(date.slice(5, 7))).wage_type ?? staff?.wage_type ?? "");
  const result: WageCertResult = { nextDay, insured: [], wages: [], fullMonths: 0, fullWageMonths: 0, problems, notes };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    problems.push("離職日（証明する日）がありません");
    return result;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(acquiredOn)) {
    problems.push("雇用保険の資格取得日（入社日）がありません");
    return result;
  }
  if (acquiredOn > endDate) {
    problems.push("資格取得日が、離職日より後です");
    return result;
  }

  // ── ⑧⑨ ──
  if (input.shortTerm) {
    // 短期雇用特例被保険者：B 欄。離職した月から暦月でさかのぼる（離職日以前1年間・資格取得日まで）
    const yearAgo = addDays(fmt(dayjs(endDate).subtract(1, "year")), 1);
    for (let k = 0; k < 12; k++) {
      const first = dayjs(endDate).startOf("month").subtract(k, "month");
      const from = maxDate(maxDate(fmt(first), acquiredOn), yearAgo);
      const to = minDate(fmt(first.endOf("month")), endDate);
      if (to < from) break;
      const monthly = wageTypeOn(to) === "monthly";
      const d = daysIn(from, to, byDate, leaves, monthly, fullMonthly, scheduled, isWorkDay);
      const complete = from === fmt(first) && to === fmt(first.endOf("month"));
      result.insured.push({ from, to, days: d.days, hours: d.hours, complete, note: "", month: first.month() + 1 });
      if (d.days >= 11) result.fullMonths++;
      if (from > fmt(first)) break;
    }
    if (result.fullMonths < 6) notes.push(`⑨が11日以上の月が${result.fullMonths}か月です（特例一時金は、離職の日以前1年間に11日以上の月が6か月以上あるときに受けられます）。`);
  }
  const needFull = input.elderly ? 6 : 12;
  const span = input.elderly ? 12 : 24;
  let limit = span;
  let prevStart = nextDay;
  let skipped: { from: string; to: string; days: number; reason: string } | null = null;
  for (let k = 1; !input.shortTerm && k <= 48 && k <= limit; k++) {
    const start = monthsBefore(nextDay, k);
    const to = addDays(prevStart, -1);
    prevStart = start;
    if (to < acquiredOn) break;
    const from = maxDate(start, acquiredOn);
    const monthly = wageTypeOn(to) === "monthly";
    const d = daysIn(from, to, byDate, leaves, monthly, fullMonthly, scheduled, isWorkDay);
    const complete = from === start;
    const span30 = dayjs(to).diff(dayjs(from), "day") + 1;
    // 給与を払わない休業・休職で、まるまる賃金がない1か月は書かずに、さかのぼる（最大4年）
    if (d.days === 0 && d.leaveDays === span30 && complete) {
      const reason = leaveNameOn(leaves, from) || "休業";
      skipped = skipped ? { from, to: skipped.to, days: skipped.days + span30, reason: skipped.reason } : { from, to, days: span30, reason };
      limit = Math.min(48, limit + 1);
      continue;
    }
    let note = "";
    if (skipped) {
      // 賃金がなかった期間を、その前（古い方）の行の備考に書く（手引きの記入例(7)）
      note = `${md(skipped.from)}〜${md(skipped.to)}${skipped.reason}賃金なし`;
      notes.push(`${skipped.from}〜${skipped.to}の${skipped.days}日間は、${skipped.reason}で賃金を払っていないので、⑧〜⑫欄に書かずにさかのぼりました。期間と理由を確かめられる書類（診断書の写しなど）を添えてください。`);
      skipped = null;
    }
    result.insured.push({ from, to, days: d.days, hours: d.hours, complete, note });
    if (complete && d.days >= 11) result.fullMonths++;
    if (result.fullMonths >= needFull || from > start) break;
  }
  if (skipped) notes.push(`${skipped.from}〜${skipped.to}は${skipped.reason}で賃金を払っていない期間です。`);
  if (!input.shortTerm && result.fullMonths < needFull) {
    // 11日以上の完全月が足りないとき：10日以下の行の時間数を備考に（80時間以上なら1か月として数える）
    for (const r of result.insured) {
      if (r.complete && r.days <= 10 && r.hours > 0) r.note = [r.note, `${Math.floor(r.hours)}時間`].filter(Boolean).join(" ");
    }
    notes.push(`⑨が11日以上の完全月が${result.fullMonths}か月です（${needFull}か月に足りないので、10日以下の月は時間数を備考に書きました）。`);
  }

  // ── ⑩⑪⑫⑬ ──
  const salaries = [...input.salaries].sort((x, y) => (y.target_year - x.target_year) || (y.target_month - x.target_month));
  const periodOf = (s: WageCertSalary) => {
    const ledger = parseLedger(s.ledger);
    if (ledger?.periodStart && ledger.periodEnd) return { start: ledger.periodStart, end: ledger.periodEnd };
    const p = getPeriodForPayMonth(group, s.target_year, s.target_month);
    return { start: p.startStr, end: p.endStr };
  };
  const latest = salaries.find((s) => {
    const p = periodOf(s);
    return p.start <= endDate && endDate <= p.end;
  });
  if (!latest) {
    problems.push(`離職日（${endDate}）を含む給与の計算期間の給与を確定してください`);
  }
  const lowest = fmt(dayjs(endDate).subtract(2, "year"));
  const commuteSpread = commuteSpreadOf(salaries, input.commuteLumps ?? []);
  const holidays = shutdownHolidaysOf(byDate, isWorkDay);
  if ((input.commuteLumps ?? []).length > 0) notes.push("まとめて払った通勤手当は、月数で割ってそれぞれの月の A に入れました。");
  for (const s of salaries) {
    const p = periodOf(s);
    if (p.start > endDate) continue;
    if (p.end < acquiredOn || p.end < lowest) break;
    const from = maxDate(p.start, acquiredOn);
    const to = minDate(p.end, endDate);
    const wageType = String(staffAsOf(staff, s.target_year, s.target_month).wage_type ?? staff?.wage_type ?? "");
    const monthly = wageType === "monthly";
    const d = daysIn(from, to, byDate, leaves, monthly, fullMonthly, scheduled, isWorkDay);
    const amounts = wageAmountsOf(s, wageType);
    amounts.a += commuteSpread.get(`${s.target_year}-${String(s.target_month).padStart(2, "0")}`) ?? 0;
    const total = amounts.a + amounts.b;
    if (total === 0 && d.days === 0) continue; // 賃金のない期間（休業など）は書かない
    const complete = from === p.start && to === p.end;
    const noteParts: string[] = [];
    if (d.shutdownDays > 0 && amounts.shutdownPay > 0) noteParts.push(`休業${d.shutdownDays}日 ${amounts.shutdownPay}円`);
    if (monthly) {
      let n = 0;
      eachDate(from, to, (x) => { if (holidays.has(x)) n++; });
      if (n > 0) noteParts.push(`休業期間中の所定休日${n}日`);
    }
    if (monthly && !fullMonthly && d.absentDays > 0) noteParts.push(`欠勤${d.absentDays}日`);
    result.wages.push({
      from, to, days: d.days, hours: d.hours, a: amounts.a, b: amounts.b, total, complete, note: noteParts.join(" "),
      payYear: s.target_year, payMonth: s.target_month,
    });
    if (complete && d.days >= 11) result.fullWageMonths++;
    if (result.fullWageMonths >= 6) break;
  }
  if (result.fullWageMonths < 6) {
    for (const r of result.wages) {
      if (r.complete && r.days <= 10 && r.hours > 0) r.note = [r.note, `${Math.floor(r.hours)}時間`].filter(Boolean).join(" ");
    }
    if (result.wages.length > 0) notes.push(`⑪が11日以上の完全月が${result.fullWageMonths}か月です（6か月に足りないので、10日以下の月は時間数を備考に書きました）。`);
  }
  return result;
};
