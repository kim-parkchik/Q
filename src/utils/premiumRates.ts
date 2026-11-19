/**
 * 残業代の割増率（会社の決まり。給与規定グループごと。payroll_groups.premium_rates の JSON）
 *
 * ■ 法律の率（労働基準法37条・割増賃金令。constants/labor.ts）より低くはできない：
 *   時間外労働 25%・1か月60時間を超えた時間外労働 50%・法定休日の労働 35%・深夜 25%。
 *   法定内残業（所定労働時間を超えて法定労働時間までの時間）は、法律では割増がいらない（0%）
 * ■ 就業規則・賃金規程でこれより高い率を決めている会社は、その率で払う（決めた賃金を払わないことになる。労働基準法24条）
 * ■ 限度時間を超えた時間外労働の割増率：36協定の特別条項で、1か月・1年の限度時間（45時間・360時間。constants/roumu.ts の
 *   KYOTEI36_LIMITS。労働基準法36条4項）を超えた時間外労働に払う率を決める（25%以上。25%を超える率にするよう努める）。
 *   協定の率は「業務」の行ごとに書くので、Q は給与規定グループに入れた率を使い、従業員の拠点の協定の率より低ければ知らせる
 *   （kyoteiRateGaps）。1年は、協定の起算日から数える（yearStartOf・sumYearOvertime。36協定の画面と同じく、給与の計算期間を1か月として数える）
 * ■ 率の重なり（overtimeSegments）：
 *   ・1か月の時間外労働のうち、45時間までは「時間外労働」の率、45時間を超えて60時間までは「時間外労働」と「月の限度時間を超えた分」の
 *     大きい方、60時間を超えた分は「月60時間を超えた分」・「時間外労働」・「月の限度時間を超えた分」のいちばん大きい率
 *   ・1年の限度時間を超えた時間は、その段の率と「年の限度時間を超えた分」の大きい方
 *   ・深夜は、時間外・休日の率に足す（時間外の深夜は 時間外の率 ＋ 深夜の率）
 *   ・法定休日の労働は時間外労働に数えない（休日の率だけ）
 * ■ 入れていない欄は法律の率（いままでと同じ計算）
 */
import dayjs from "dayjs";
import { HOLIDAY_WORK_RATE, NIGHT_SHIFT_RATE, OVERTIME_PREMIUM_LIMIT_HOURS, OVERTIME_PREMIUM_RATE, OVERTIME_RATE, SME_OVERTIME_PREMIUM_FROM } from "../constants/labor";
import { KYOTEI36_LIMITS } from "../constants/roumu";
import type { Kyotei36 } from "./kyotei36";

/** 割増率（%）。0.25 ではなく 25 で持つ */
export interface PremiumRates {
  /** 時間外労働（法定時間外。1日8時間・週40時間を超えた時間） */
  overtime: number;
  /** 1か月の時間外労働が限度時間（45時間）を超えた分（36協定の特別条項の率） */
  overLimitMonth: number;
  /** 1か月の時間外労働が60時間を超えた分 */
  over60: number;
  /** 1年の時間外労働が限度時間（360時間）を超えた分（36協定の特別条項の率。協定の起算日から数える） */
  overLimitYear: number;
  /** 法定休日の労働 */
  holiday: number;
  /** 深夜（22時〜5時）の労働 */
  night: number;
  /** 法定内残業（所定労働時間を超えて、法定労働時間までの時間） */
  statutory: number;
}

const pct = (multiplier: number) => Math.round(multiplier * 10000) / 100;

/** 法律の率（これより低くはできない。入れていない欄もこの率） */
export const LEGAL_PREMIUM_RATES: PremiumRates = {
  overtime: pct(OVERTIME_RATE - 1),
  overLimitMonth: pct(OVERTIME_RATE - 1),
  over60: pct(OVERTIME_PREMIUM_RATE - 1),
  overLimitYear: pct(OVERTIME_RATE - 1),
  holiday: pct(HOLIDAY_WORK_RATE - 1),
  night: pct(NIGHT_SHIFT_RATE),
  statutory: 0,
};

export const PREMIUM_RATE_KEYS: (keyof PremiumRates)[] = ["overtime", "overLimitMonth", "over60", "overLimitYear", "holiday", "night", "statutory"];

/** 欄の名前（画面・給与明細・労働条件通知書） */
export const PREMIUM_RATE_LABELS: Record<keyof PremiumRates, string> = {
  overtime: "時間外労働（1日8時間・週40時間を超えた時間）",
  overLimitMonth: `1か月の時間外労働が${KYOTEI36_LIMITS.monthly}時間（限度時間）を超えた分`,
  over60: `1か月の時間外労働が${OVERTIME_PREMIUM_LIMIT_HOURS}時間を超えた分`,
  overLimitYear: `1年の時間外労働が${KYOTEI36_LIMITS.annual}時間（限度時間）を超えた分（36協定の起算日から）`,
  holiday: "法定休日の労働",
  night: "深夜（22時〜5時）の労働",
  statutory: "法定内残業（所定労働時間を超えて、1日8時間・週40時間までの時間）",
};

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** 保存した率（JSON）を読む。入れていない欄・読めない欄は法律の率。法律の率より低い欄も法律の率にする（計算で下回らないように） */
export const parsePremiumRates = (json: unknown): PremiumRates => {
  let v: any = null;
  try {
    v = typeof json === "string" && json.trim() ? JSON.parse(json) : json && typeof json === "object" ? json : null;
  } catch {
    v = null;
  }
  const out = { ...LEGAL_PREMIUM_RATES };
  for (const k of PREMIUM_RATE_KEYS) {
    const n = Number(v?.[k]);
    if (v && v[k] !== null && v[k] !== "" && isNum(n)) out[k] = Math.max(LEGAL_PREMIUM_RATES[k], Math.round(n * 100) / 100);
  }
  return out;
};

/** 保存する JSON（法律の率と同じ欄だけなら null） */
export const stringifyPremiumRates = (r: PremiumRates): string | null =>
  PREMIUM_RATE_KEYS.every((k) => r[k] === LEGAL_PREMIUM_RATES[k]) ? null : JSON.stringify(r);

/** 入れた率の誤り（法律の率より低い・数でない・200%を超える）。なければ空 */
export const premiumRateProblems = (r: Record<keyof PremiumRates, number>): string[] => {
  const out: string[] = [];
  for (const k of PREMIUM_RATE_KEYS) {
    const n = r[k];
    if (!isNum(n)) out.push(`${PREMIUM_RATE_LABELS[k]}の率を数で入れてください`);
    else if (n < LEGAL_PREMIUM_RATES[k]) out.push(`${PREMIUM_RATE_LABELS[k]}は、法律の率（${LEGAL_PREMIUM_RATES[k]}%）より低くできません`);
    else if (n > 200) out.push(`${PREMIUM_RATE_LABELS[k]}の率（${n}%）が大きすぎます`);
  }
  return out;
};

/** 法律の率と違う欄だけを書く（給与規定グループの一覧に出す）。同じなら「法律の率」 */
export const describePremiumRates = (r: PremiumRates): string => {
  const diff = PREMIUM_RATE_KEYS.filter((k) => r[k] !== LEGAL_PREMIUM_RATES[k]);
  if (diff.length === 0) return "法律の率（時間外25%・月60時間超50%・休日35%・深夜25%）";
  const short: Record<keyof PremiumRates, string> = {
    overtime: "時間外", overLimitMonth: `月${KYOTEI36_LIMITS.monthly}時間超`, over60: `月${OVERTIME_PREMIUM_LIMIT_HOURS}時間超`,
    overLimitYear: `年${KYOTEI36_LIMITS.annual}時間超`, holiday: "休日", night: "深夜", statutory: "法定内残業",
  };
  return PREMIUM_RATE_KEYS.map((k) => `${short[k]}${r[k]}%`).join("・");
};

/** 時間外労働の1時間の割増率（%）を、その時間が月の何時間目か・年の限度時間を超えたかで決める */
const rateFor = (r: PremiumRates, p: { overLimitMonth: boolean; high: boolean; overLimitYear: boolean }): number => {
  let rate = r.overtime;
  if (p.overLimitMonth) rate = Math.max(rate, r.overLimitMonth);
  if (p.high) rate = Math.max(rate, r.over60);
  if (p.overLimitYear) rate = Math.max(rate, r.overLimitYear);
  return rate;
};

/** 時間外労働の1つの段（同じ率で払う時間） */
export interface OvertimeSegment {
  hours: number;
  /** 所定労働時間の中の時間（通常の賃金は月給・日給で払っているので、割増分だけを払う） */
  within: boolean;
  /** 割増率（%） */
  rate: number;
  /** 1か月60時間を超えた時間（給与明細・賃金台帳の「60時間超」の行） */
  high: boolean;
  /** 1か月60時間を超えたが、中小企業の猶予（2023年3月31日まで）で60時間超の率にしない時間 */
  deferred: boolean;
  /** 1か月の限度時間（45時間）を超えた時間 */
  overLimitMonth: boolean;
  /** 1年の限度時間（360時間）を超えた時間 */
  overLimitYear: boolean;
}

/**
 * その日（またはフレックスタイム制の1か月）の時間外労働を、率の違う段に分ける
 * 時間外労働も、所定労働時間の外の時間も、限度時間・60時間を超えた時間も、どれもその日の終わりのほうの時間なので、
 * 時間の順に「所定労働時間の中の時間 → 外の時間」と並べ、その月（年）のそれまでの時間外労働に足していった位置で率を決める
 * @param hours その日の時間外労働
 * @param within そのうち所定労働時間の中の時間（はじめの方の時間）
 * @param monthSoFar その月のそれまでの時間外労働（法定休日の労働は数えない）
 * @param yearSoFar 36協定の年のそれまでの時間外労働（わからなければ null。年の限度時間を超えた分の率は使わない）
 */
export const overtimeSegments = (p: {
  hours: number; within: number; monthSoFar: number; yearSoFar: number | null; workDate: string; isSmallBusiness: boolean; rates: PremiumRates;
}): OvertimeSegment[] => {
  const hours = Math.max(0, p.hours);
  if (!(hours > 0)) return [];
  const within = Math.min(hours, Math.max(0, p.within));
  const deferredSme = p.isSmallBusiness && p.workDate < SME_OVERTIME_PREMIUM_FROM;
  const cuts = new Set<number>([0, hours]);
  const add = (x: number) => { if (x > 0 && x < hours) cuts.add(x); };
  add(within);
  add(KYOTEI36_LIMITS.monthly - p.monthSoFar);
  add(OVERTIME_PREMIUM_LIMIT_HOURS - p.monthSoFar);
  if (p.yearSoFar !== null) add(KYOTEI36_LIMITS.annual - p.yearSoFar);
  const points = [...cuts].sort((a, b) => a - b);
  const out: OvertimeSegment[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const len = points[i + 1] - a;
    // 小数の誤差で生まれるごく短い段は作らない
    if (!(len > 1e-9)) continue;
    const monthPos = p.monthSoFar + a;
    const over60 = monthPos >= OVERTIME_PREMIUM_LIMIT_HOURS - 1e-9;
    const seg = {
      hours: len,
      within: a < within - 1e-9,
      high: over60 && !deferredSme,
      deferred: over60 && deferredSme,
      overLimitMonth: monthPos >= KYOTEI36_LIMITS.monthly - 1e-9,
      overLimitYear: p.yearSoFar !== null && p.yearSoFar + a >= KYOTEI36_LIMITS.annual - 1e-9,
    };
    out.push({ ...seg, rate: rateFor(p.rates, seg) });
  }
  return out;
};

/** 36協定の年（起算日から1年）のうち、その日が入る年の初めの日（起算日がなければ null） */
export const yearStartOf = (startDate: string | null | undefined, date: string): string | null => {
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const s = dayjs(startDate);
  const d = dayjs(date);
  let start = s.year(d.year());
  // その年の起算日（2月29日は、うるう年でない年は2月28日）が、その日より後なら前の年の起算日
  if (start.month() !== s.month()) start = start.subtract(1, "day");
  if (start.isAfter(d, "day")) {
    start = s.year(d.year() - 1);
    if (start.month() !== s.month()) start = start.subtract(1, "day");
  }
  return start.format("YYYY-MM-DD");
};

/** 確定した給与の1か月分（賃金締切日と時間外労働の時間） */
export interface OvertimeMonth {
  periodEnd: string;
  overtimeHours: number;
}

/**
 * 36協定の年のうち、この給与の計算期間より前に確定した給与の時間外労働の合計（年の限度時間を超えた分の率に使う）
 * 36協定の画面と同じく、給与の計算期間を1か月とし、賃金締切日がその年に入る給与を数える
 * @param periodEnd この給与の賃金締切日（この日が入る協定の年で数える。この給与は数えない）
 */
export const sumYearOvertime = (months: OvertimeMonth[], startDate: string | null | undefined, periodEnd: string): number | null => {
  const yearStart = yearStartOf(startDate, periodEnd);
  if (!yearStart) return null;
  return months
    .filter((m) => m.periodEnd >= yearStart && m.periodEnd < periodEnd)
    .reduce((s, m) => s + (Number(m.overtimeHours) || 0), 0);
};

/** 拠点の36協定の、限度時間を超えた労働の割増率（特別条項の行のうちいちばん高い率。入れていなければ null） */
export const kyoteiOverLimitRates = (k: Kyotei36 | null | undefined): { month: number | null; year: number | null } => {
  if (!k || !k.special) return { month: null, year: null };
  const max = (vals: string[]) => {
    const nums = vals.map((v) => Number(String(v ?? "").replace(/[%％\s]/g, ""))).filter((n) => Number.isFinite(n) && n > 0);
    return nums.length > 0 ? Math.max(...nums) : null;
  };
  return { month: max(k.specialRows.map((r) => r.monthRate)), year: max(k.specialRows.map((r) => r.yearRate)) };
};

/**
 * 給与規定グループの率が、拠点の36協定の「限度時間を超えた労働の割増率」より低いところ（知らせる文。なければ空）
 * 時間外労働の率の方が高ければ、それで払うので知らせない
 */
export const kyoteiRateGaps = (r: PremiumRates, k: Kyotei36 | null | undefined, branchName: string): string[] => {
  const agreed = kyoteiOverLimitRates(k);
  const out: string[] = [];
  const monthPaid = Math.max(r.overtime, r.overLimitMonth);
  if (agreed.month !== null && monthPaid < agreed.month) {
    out.push(`${branchName}の36協定では、1か月の限度時間を超えた時間外労働の割増率を${agreed.month}%と決めていますが、給与規定グループの率は${monthPaid}%です`);
  }
  const yearPaid = Math.max(r.overtime, r.overLimitYear);
  if (agreed.year !== null && yearPaid < agreed.year) {
    out.push(`${branchName}の36協定では、1年の限度時間を超えた時間外労働の割増率を${agreed.year}%と決めていますが、給与規定グループの率は${yearPaid}%です`);
  }
  return out;
};

/**
 * 給与明細・賃金台帳の行の名前（法律の率なら、いままでと同じ「時間外手当(25%割増)」など）
 * ・standard：月60時間までの時間外労働（限度時間・年の限度時間を超えた分の率が高ければ、その率も書く）
 * ・high：月60時間を超えた時間外労働
 */
export const premiumLineNames = (r: PremiumRates) => {
  const month = Math.max(r.overtime, r.overLimitMonth);
  const year = Math.max(r.overtime, r.overLimitYear);
  const extra = [
    month > r.overtime ? `月${KYOTEI36_LIMITS.monthly}時間超${month}%` : "",
    year > r.overtime ? `年${KYOTEI36_LIMITS.annual}時間超${year}%` : "",
  ].filter(Boolean).join("・");
  return {
    statutory: r.statutory > 0 ? `時間外手当(法定内・${r.statutory}%割増)` : "時間外手当(法定内)",
    standard: `時間外手当(${r.overtime}%割増${extra ? `。${extra}` : ""})`,
    high: `時間外手当(${Math.max(r.over60, month)}%割増)`,
    holiday: `休日出勤手当(${r.holiday}%割増)`,
    night: r.night === LEGAL_PREMIUM_RATES.night ? "深夜手当" : `深夜手当(${r.night}%割増)`,
  };
};
