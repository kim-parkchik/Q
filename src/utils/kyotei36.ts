/**
 * 36協定（時間外労働・休日労働に関する協定）の届と、実際の時間外労働・休日労働が上限を超えていないかの確認
 *
 * ■ 届（労働基準法36条1項・施行規則16条1項）
 *   ・限度時間の中で時間外・休日労働をさせるときは 様式第9号（一般条項）、臨時的に限度時間を超えるときは 様式第9号の2（特別条項。2枚）。
 *     欄は厚生労働省の様式（Word）と記載心得による。事業場（拠点）ごとに協定して、所轄の労働基準監督署長に届け出る
 *   ・限度時間：1か月45時間・1年360時間（対象期間が3か月を超える1年単位の変形労働時間制の人は42時間・320時間）
 *   ・特別条項：1か月は時間外労働と休日労働の合計で100時間未満、1年は時間外労働で720時間以内、限度時間を超えられるのは1年に6か月まで
 *   （数は src/constants/roumu.ts。労働基準法36条の条文からスクリプトで作ったもの）
 * ■ 実際の時間の確認（労働基準法36条6項2号・3号）
 *   ・1か月の時間外労働と休日労働の合計が100時間未満、2〜6か月の平均（起算日をまたいでも、続いた2〜6か月）が80時間以内
 *   ・協定の1か月・1年の時間（特別条項があれば、その時間と回数）を超えていないか
 *   ・時間は、確定した給与の賃金台帳の内訳の「時間外労働時間数」（法定時間外。週40時間を超えた分も）と「休日労働時間数」（法定休日）。
 *     給与の計算期間を1か月として数える（協定の起算日は、賃金締切日の翌日にそろえるのがふつう）
 */
import dayjs from "dayjs";
import { KYOTEI36_LIMITS } from "../constants/roumu";

export interface OvertimeRow {
  /** 時間外労働をさせる必要のある具体的事由 */
  reason: string;
  /** 業務の種類 */
  work: string;
  /** 労働者数（満18歳以上の者） */
  workers: string;
  /** 所定労働時間（1日。任意） */
  prescribed: string;
  /** 延長することができる時間数（法定労働時間を超える時間数。所定を超える時間数は任意） */
  day: string;
  dayPrescribed: string;
  month: string;
  monthPrescribed: string;
  year: string;
  yearPrescribed: string;
  /** ② 対象期間が3か月を超える1年単位の変形労働時間制により労働する労働者 */
  variable: boolean;
}

export interface HolidayRow {
  reason: string;
  work: string;
  workers: string;
  /** 所定休日（任意） */
  holidays: string;
  /** 労働させることができる法定休日の日数 */
  days: string;
  /** 労働させることができる法定休日における始業及び終業の時刻 */
  hours: string;
}

export interface SpecialRow {
  work: string;
  workers: string;
  /** 1日（任意） */
  day: string;
  dayPrescribed: string;
  /** 限度時間を超えて労働させることができる回数（6回以内） */
  times: string;
  /** 1か月：時間外労働と休日労働を合算した時間数（100時間未満） */
  month: string;
  monthPrescribed: string;
  /** 限度時間を超えた労働に係る割増賃金率（%） */
  monthRate: string;
  /** 1年：時間外労働の時間数（720時間以内） */
  year: string;
  yearPrescribed: string;
  yearRate: string;
}

export interface Kyotei36 {
  /** 事業の種類 */
  businessType: string;
  /** 協定の有効期間 */
  periodFrom: string;
  periodTo: string;
  /** 起算日 */
  startDate: string;
  overtime: OvertimeRow[];
  holiday: HolidayRow[];
  /** 特別条項（様式第9号の2） */
  special: boolean;
  specialCases: string;
  specialRows: SpecialRow[];
  /** 限度時間を超えて労働させる場合における手続 */
  procedure: string;
  /** 健康及び福祉を確保するための措置（該当する番号と具体的内容） */
  measureNumbers: string;
  measureDetail: string;
  /** 協定の成立年月日 */
  agreedOn: string;
  /** 協定の当事者（労働組合の名称、または過半数代表者の職名・氏名）と選出方法 */
  partyUnion: string;
  partyTitle: string;
  partyName: string;
  selectionMethod: string;
  /** 届け出る日・使用者の職名と氏名・労働基準監督署 */
  submittedOn: string;
  employerTitle: string;
  employerName: string;
  office: string;
}

/** 会社に残すもの（拠点の番号 → 協定） */
export type Kyotei36Settings = Record<string, Kyotei36>;

export const emptyOvertimeRow = (): OvertimeRow => ({
  reason: "", work: "", workers: "", prescribed: "", day: "", dayPrescribed: "", month: "", monthPrescribed: "", year: "", yearPrescribed: "", variable: false,
});
export const emptyHolidayRow = (): HolidayRow => ({ reason: "", work: "", workers: "", holidays: "", days: "", hours: "" });
export const emptySpecialRow = (): SpecialRow => ({
  work: "", workers: "", day: "", dayPrescribed: "", times: "", month: "", monthPrescribed: "", monthRate: "", year: "", yearPrescribed: "", yearRate: "",
});
export const emptyKyotei36 = (): Kyotei36 => ({
  businessType: "", periodFrom: "", periodTo: "", startDate: "", overtime: [emptyOvertimeRow()], holiday: [emptyHolidayRow()],
  special: false, specialCases: "", specialRows: [emptySpecialRow()], procedure: "", measureNumbers: "", measureDetail: "",
  agreedOn: "", partyUnion: "", partyTitle: "", partyName: "", selectionMethod: "", submittedOn: "", employerTitle: "", employerName: "", office: "",
});

const str = (v: unknown) => (typeof v === "string" ? v : "");
const rowsOf = <T>(v: unknown, empty: () => T): T[] => {
  if (!Array.isArray(v)) return [empty()];
  const rows = v.map((r) => {
    const base = empty() as any;
    for (const k of Object.keys(base)) base[k] = typeof base[k] === "boolean" ? r?.[k] === true : str(r?.[k]);
    return base as T;
  });
  return rows.length > 0 ? rows : [empty()];
};

export const parseKyotei36Settings = (json: unknown): Kyotei36Settings => {
  if (typeof json !== "string" || !json.trim()) return {};
  let o: any;
  try {
    o = JSON.parse(json);
  } catch {
    return {};
  }
  const out: Kyotei36Settings = {};
  for (const [key, v] of Object.entries(o ?? {})) {
    const a: any = v ?? {};
    const k = emptyKyotei36() as any;
    for (const f of Object.keys(k)) {
      if (f === "overtime") k.overtime = rowsOf(a.overtime, emptyOvertimeRow);
      else if (f === "holiday") k.holiday = rowsOf(a.holiday, emptyHolidayRow);
      else if (f === "specialRows") k.specialRows = rowsOf(a.specialRows, emptySpecialRow);
      else if (f === "special") k.special = a.special === true;
      else k[f] = str(a[f]);
    }
    out[key] = k as Kyotei36;
  }
  return out;
};

export const stringifyKyotei36Settings = (s: Kyotei36Settings): string | null => (Object.keys(s).length > 0 ? JSON.stringify(s) : null);

const num = (v: string): number | null => {
  const t = v.normalize("NFKC").replace(/[,，時間]/g, "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** 協定の中身の決まり（限度時間・特別条項の上限）に合わないところ */
export const kyotei36Problems = (k: Kyotei36): string[] => {
  const L = KYOTEI36_LIMITS;
  const out: string[] = [];
  if (!k.startDate) out.push("起算日を入れてください（1年の時間を数えはじめる日）");
  if (!k.periodFrom || !k.periodTo) out.push("協定の有効期間を入れてください（1年間がふつうです）");
  if (!k.agreedOn) out.push("協定の成立年月日を入れてください");
  if (!k.partyUnion && !k.partyName) out.push("協定の当事者（労働組合の名称、または労働者の過半数を代表する者の職名・氏名）を入れてください");
  if (!k.partyUnion && k.partyName && !k.selectionMethod) out.push("労働者の過半数を代表する者の選出方法（投票・挙手など）を入れてください");
  k.overtime.forEach((r, i) => {
    if (!r.work && !r.month && !r.year) return;
    const mLimit = r.variable ? L.monthlyVariable : L.monthly;
    const yLimit = r.variable ? L.annualVariable : L.annual;
    const m = num(r.month);
    const y = num(r.year);
    if (m === null || y === null) out.push(`時間外労働の${i + 1}行目：1箇月と1年の延長することができる時間数を入れてください`);
    if (m !== null && m > mLimit) out.push(`時間外労働の${i + 1}行目：1箇月は${mLimit}時間までです（${m}時間）。超えるときは特別条項（様式第9号の2）で定めます`);
    if (y !== null && y > yLimit) out.push(`時間外労働の${i + 1}行目：1年は${yLimit}時間までです（${y}時間）。超えるときは特別条項（様式第9号の2）で定めます`);
    if (!r.work) out.push(`時間外労働の${i + 1}行目：業務の種類を入れてください`);
  });
  if (k.special) {
    if (!k.specialCases.trim()) out.push("特別条項：臨時的に限度時間を超えて労働させることができる場合を、具体的に入れてください");
    if (!k.procedure.trim()) out.push("特別条項：限度時間を超えて労働させる場合における手続（協議・通告など）を入れてください");
    if (!k.measureNumbers.trim()) out.push("特別条項：健康及び福祉を確保するための措置（該当する番号）を入れてください");
    k.specialRows.forEach((r, i) => {
      if (!r.work && !r.month && !r.year) return;
      const m = num(r.month);
      const y = num(r.year);
      const t = num(r.times);
      if (m !== null && m >= L.specialMonthlyBelow) out.push(`特別条項の${i + 1}行目：1箇月（時間外労働と休日労働の合計）は${L.specialMonthlyBelow}時間未満です（${m}時間）`);
      if (y !== null && y > L.specialAnnual) out.push(`特別条項の${i + 1}行目：1年（時間外労働）は${L.specialAnnual}時間以内です（${y}時間）`);
      if (t !== null && t > L.specialMonthsMax) out.push(`特別条項の${i + 1}行目：限度時間を超えられる回数は${L.specialMonthsMax}回以内です（${t}回）`);
      if (m === null || y === null || t === null) out.push(`特別条項の${i + 1}行目：回数・1箇月・1年の時間数を入れてください`);
    });
  }
  return out;
};

/** 確認に使う上限（協定がないか読めなければ、法律の限度時間） */
export interface Kyotei36Limits {
  month: number;
  year: number;
  /** 特別条項（なければ null） */
  special: { month: number; year: number; times: number } | null;
  /** 協定が入っている */
  agreed: boolean;
}

export const limitsOf = (k: Kyotei36 | null | undefined): Kyotei36Limits => {
  const L = KYOTEI36_LIMITS;
  if (!k) return { month: L.monthly, year: L.annual, special: null, agreed: false };
  const rows = k.overtime.filter((r) => num(r.month) !== null || num(r.year) !== null);
  const month = rows.reduce((m, r) => Math.max(m, num(r.month) ?? 0), 0) || L.monthly;
  const year = rows.reduce((m, r) => Math.max(m, num(r.year) ?? 0), 0) || L.annual;
  const sRows = k.special ? k.specialRows.filter((r) => num(r.month) !== null) : [];
  const special = sRows.length === 0 ? null : {
    month: sRows.reduce((m, r) => Math.max(m, num(r.month) ?? 0), 0),
    year: sRows.reduce((m, r) => Math.max(m, num(r.year) ?? 0), 0) || L.specialAnnual,
    times: sRows.reduce((m, r) => Math.max(m, num(r.times) ?? 0), 0),
  };
  return { month, year, special, agreed: true };
};

/** 1か月（給与の計算期間）の時間 */
export interface MonthHours {
  /** 給与の月（YYYY-MM） */
  ym: string;
  periodEnd: string;
  /** 時間外労働（法定時間外）と休日労働（法定休日）の時間 */
  overtime: number;
  holiday: number;
}

export interface MonthCheck extends MonthHours {
  total: number;
  /** 協定の年（起算日から1年）の中で、この月までの時間外労働の合計 */
  yearToDate: number;
  /** 1か月の限度時間（協定の1か月）を超えた（特別条項の回数に数える） */
  overMonth: boolean;
  /** 2〜6か月の平均でいちばん大きいもの（この月で終わる期間） */
  maxAverage: { months: number; average: number } | null;
  /** 法律違反・協定違反 */
  violations: string[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * 1人の確認：月の順に並べた時間から、法律（100時間未満・2〜6か月平均80時間以内）と協定（1か月・1年・回数）を確かめる
 * startDate は起算日（YYYY-MM-DD）。この日から1年ごとに、1年の時間と回数を数え直す
 */
export const check36 = (months: MonthHours[], limits: Kyotei36Limits, startDate: string): MonthCheck[] => {
  const L = KYOTEI36_LIMITS;
  const sorted = [...months].sort((a, b) => a.ym.localeCompare(b.ym));
  const yearIndexOf = (date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return 0;
    const d = dayjs(date);
    const s = dayjs(startDate);
    let i = d.year() - s.year();
    if (d.isBefore(s.add(i, "year"))) i -= 1;
    return i;
  };
  const yearTotals = new Map<number, number>();
  const yearOverCounts = new Map<number, number>();
  return sorted.map((m, idx) => {
    const total = round1(m.overtime + m.holiday);
    const yi = yearIndexOf(m.periodEnd);
    const ytd = round1((yearTotals.get(yi) ?? 0) + m.overtime);
    yearTotals.set(yi, ytd);
    const overMonth = m.overtime > limits.month;
    const count = (yearOverCounts.get(yi) ?? 0) + (overMonth ? 1 : 0);
    yearOverCounts.set(yi, count);
    let maxAverage: MonthCheck["maxAverage"] = null;
    for (const n of L.averageMonths) {
      if (idx + 1 < n) break;
      const slice = sorted.slice(idx + 1 - n, idx + 1);
      // 続いた月でなければ平均を出さない（間に給与のない月がある）
      const continuous = slice.every((x, j) => j === 0 || dayjs(`${x.ym}-01`).diff(dayjs(`${slice[j - 1].ym}-01`), "month") === 1);
      if (!continuous) break;
      const avg = round1(slice.reduce((s, x) => s + x.overtime + x.holiday, 0) / n);
      if (!maxAverage || avg > maxAverage.average) maxAverage = { months: n, average: avg };
    }
    const violations: string[] = [];
    if (total >= L.actualMonthlyBelow) violations.push(`時間外労働と休日労働の合計が${L.actualMonthlyBelow}時間以上です（法律違反）`);
    if (maxAverage && maxAverage.average > L.averageMax) violations.push(`${maxAverage.months}か月の平均が${L.averageMax}時間を超えています（法律違反）`);
    if (overMonth && !limits.special) violations.push(`時間外労働が協定の1か月の時間（${limits.month}時間）を超えています`);
    if (overMonth && limits.special && m.overtime + m.holiday >= limits.special.month) violations.push(`時間外労働と休日労働の合計が特別条項の1か月の時間（${limits.special.month}時間）以上です`);
    if (overMonth && limits.special && count > limits.special.times) violations.push(`限度時間を超えた月が、特別条項の回数（${limits.special.times}回）を超えています`);
    const yearLimit = limits.special ? Math.max(limits.year, limits.special.year) : limits.year;
    if (ytd > yearLimit) violations.push(`起算日からの時間外労働の合計が協定の1年の時間（${yearLimit}時間）を超えています`);
    return { ...m, total, yearToDate: ytd, overMonth, maxAverage, violations };
  });
};

/** 注意（違反ではないが、近づいている） */
export const warningsOf = (c: MonthCheck, limits: Kyotei36Limits): string[] => {
  const L = KYOTEI36_LIMITS;
  const out: string[] = [];
  if (c.violations.length > 0) return out;
  if (c.total >= L.actualMonthlyBelow * 0.8) out.push(`合計が${round1(c.total)}時間で、${L.actualMonthlyBelow}時間に近づいています`);
  if (c.maxAverage && c.maxAverage.average > L.averageMax * 0.9) out.push(`${c.maxAverage.months}か月の平均が${c.maxAverage.average}時間で、${L.averageMax}時間に近づいています`);
  if (c.overMonth && limits.special) out.push(`協定の1か月の時間（${limits.month}時間）を超えました（特別条項の手続を取った月か確かめてください）`);
  return out;
};
