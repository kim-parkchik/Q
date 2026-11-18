/**
 * 高年齢者雇用状況等報告（様式第2号）と障害者雇用状況報告（様式第6号）。毎年6月1日現在の状況を、7月15日までにハローワークに出す
 * （高年齢者等の雇用の安定等に関する法律52条1項、障害者の雇用の促進等に関する法律43条7項）。
 *
 * ■ 障害者雇用状況報告：数え方は様式第6号（表面の式・裏面の注意）と障害者雇用状況報告記入要領による（数は src/constants/roumu.ts）
 *   ・常用雇用労働者：1週間の所定労働時間が20時間以上で、1年を超えて雇用される（見込みを含む）人。30時間未満は短時間労働者で0.5人
 *   ・障害者：身体・知的は重度なら2人（短時間は1人）、重度でなければ1人（短時間は0.5人）。精神は短時間でも1人。
 *     重度身体・重度知的・精神の人は、10時間以上20時間未満（特定短時間労働者）でも0.5人
 *   ・10(ニ) ＝ 10(ハ) − 10(ハ) × 除外率（1人未満切り捨て）、14 不足数 ＝ 10(ニ) × 法定雇用率（1人未満切り捨て）− 12（0を下回れば0）、
 *     13 実雇用率は小数点以下第3位を四捨五入。法定雇用率は、令和8年6月1日現在の報告までは様式の 2.5%、令和9年からは施行令9条の 2.7%
 *   ・報告するのは、法定雇用障害者数が1人以上になる事業主（令和8年は 40.0人以上）
 *   障害の種類と重度かどうかは、従業員ごとに staff.disability_employment（JSON）に残す（障害者手帳などで確かめたもの。とても気をつけて扱う個人情報）
 * ■ 高年齢者雇用状況等報告：Q で数えられる欄だけを出す（⑮常用労働者数（年齢の区分ごと・うち女性）、⑯過去1年間の解雇等による45歳以上70歳未満の
 *   離職者、⑰の定年に達した人）。定年・継続雇用制度などの欄は、就業規則で確かめて書く
 */
import dayjs from "dayjs";
import {
  DISABILITY_EMPLOYMENT_RATE, DISABILITY_EMPLOYMENT_RATE_FORM6, DISABILITY_WEEKLY_HOURS, ELDERLY_AGE_BANDS, ELDERLY_REPORT_REGULAR_WEEKLY_HOURS,
} from "../constants/roumu";
import { parseKoyoInfo, weeklyMinutesOf } from "./koyoInfo";

export type DisabilityKind = "" | "physical" | "intellectual" | "mental";
export const DISABILITY_KIND_LABELS: Record<Exclude<DisabilityKind, "">, string> = {
  physical: "身体障害者", intellectual: "知的障害者", mental: "精神障害者",
};

export interface DisabilityInfo {
  kind: DisabilityKind;
  /** 重度（身体・知的のとき） */
  severe: boolean;
  /** 確かめた書類（身体障害者手帳1級など）。報告には出さない */
  note: string;
}

export const parseDisabilityInfo = (json: unknown): DisabilityInfo => {
  try {
    const o = typeof json === "string" && json.trim() ? JSON.parse(json) : null;
    const kind = ["physical", "intellectual", "mental"].includes(o?.kind) ? o.kind : "";
    return { kind, severe: kind !== "mental" && o?.severe === true, note: typeof o?.note === "string" ? o.note : "" };
  } catch {
    return { kind: "", severe: false, note: "" };
  }
};
export const stringifyDisabilityInfo = (d: DisabilityInfo): string | null => (d.kind ? JSON.stringify(d) : null);

/** 報告の日（その年の6月1日）に在籍しているか */
const employedOn = (s: any, date: string) => {
  const join = String(s?.join_date ?? "");
  const leave = String(s?.retirement_date ?? "");
  return (!join || join <= date) && (!leave || leave >= date);
};

/** 1年を超えて雇用される（見込みを含む）か：期間の定めがあり、更新しない契約で、入社から契約の終わりまでが1年以下なら、超えない */
export const overOneYear = (s: any): boolean => {
  const c = parseKoyoInfo(s?.koyo_info).contract;
  if (!c.has || c.renewal !== "無" || !c.end) return true;
  const from = c.start || String(s?.join_date ?? "");
  return !!from && dayjs(c.end).diff(dayjs(from), "day") >= 365;
};

/** 役員（雇用保険に入っていない役員は、労働者として数えない） */
const notWorker = (s: any) => Number(s?.is_executive) === 1 && Number(s?.is_employment_ins_eligible ?? 1) !== 1;

export type HoursClass = "regular" | "short" | "specified" | "none";
/** 週の所定労働時間の区分（障害者雇用状況報告） */
export const hoursClassOf = (s: any): HoursClass => {
  const h = weeklyMinutesOf(s) / 60;
  const H = DISABILITY_WEEKLY_HOURS;
  if (h >= H.shortBelow) return "regular";
  if (h >= H.regularMin) return "short";
  if (h >= H.specifiedMin) return "specified";
  return "none";
};

/** 障害者1人の数え方（様式第6号の式。重度×2・短時間×0.5・精神の短時間は1・特定短時間は重度と精神だけ0.5） */
export const disabilityWeight = (d: DisabilityInfo, c: HoursClass): number => {
  if (!d.kind || c === "none") return 0;
  if (d.kind === "mental") return c === "specified" ? 0.5 : 1;
  if (d.severe) return c === "regular" ? 2 : c === "short" ? 1 : 0.5;
  return c === "regular" ? 1 : c === "short" ? 0.5 : 0;
};

/** その年の報告に使う法定雇用率（令和8年までは様式第6号の率、令和9年からは施行令9条の率） */
export const disabilityRateFor = (year: number): [number, number] => (year <= 2026 ? DISABILITY_EMPLOYMENT_RATE_FORM6 : DISABILITY_EMPLOYMENT_RATE);

export interface DisabilityRow {
  id: string;
  name: string;
  info: DisabilityInfo;
  hoursClass: HoursClass;
  weeklyHours: number;
  weight: number;
  /** 6月1日以前1年間に雇い入れた */
  newHire: boolean;
}

export interface DisabilityReport {
  year: number;
  asOf: string;
  /** 10(イ) 常用雇用労働者（短時間を除く）・(ロ) 短時間労働者・(ハ) イ＋ロ×0.5・(ニ) 除外率を引いた数 */
  i: number;
  ro: number;
  ha: number;
  ni: number;
  /** 11 の欄（人数。括弧内は新規に雇い入れた人） */
  cells: Record<"ho" | "he" | "to" | "chi" | "ri" | "ru" | "wo" | "wa" | "ka" | "yo" | "re" | "so" | "tsu", { n: number; newN: number }>;
  /** (ヌ) 身体・(タ) 知的・(ネ) 精神・12 計 */
  physical: number;
  intellectual: number;
  mental: number;
  total: number;
  /** 13 実雇用率（%。小数点以下第3位を四捨五入した2けた） */
  actualRate: number | null;
  /** 法定雇用率・法定雇用障害者数（1人未満切り捨て）・14 不足数 */
  rate: [number, number];
  required: number;
  shortage: number;
  /** 報告する事業主（法定雇用障害者数が1人以上） */
  mustReport: boolean;
  rows: DisabilityRow[];
}

const floor1 = (n: number) => Math.floor(n + 1e-9);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** 障害者雇用状況報告（year 年6月1日現在）。exclusionPct は除外率（%。除外率設定業種でなければ 0） */
export const disabilityReport = (staffList: any[], year: number, exclusionPct: number): DisabilityReport => {
  const asOf = `${year}-06-01`;
  const yearAgo = dayjs(asOf).subtract(1, "year").add(1, "day").format("YYYY-MM-DD");
  let i = 0;
  let ro = 0;
  const rows: DisabilityRow[] = [];
  const empty = () => ({ n: 0, newN: 0 });
  const cells: DisabilityReport["cells"] = {
    ho: empty(), he: empty(), to: empty(), chi: empty(), ri: empty(), ru: empty(), wo: empty(), wa: empty(), ka: empty(), yo: empty(), re: empty(), so: empty(), tsu: empty(),
  };
  for (const s of staffList) {
    if (!employedOn(s, asOf) || notWorker(s) || !overOneYear(s)) continue;
    const c = hoursClassOf(s);
    if (c === "regular") i++;
    else if (c === "short") ro++;
    const info = parseDisabilityInfo(s.disability_employment);
    if (!info.kind) continue;
    const weight = disabilityWeight(info, c);
    const newHire = String(s.join_date ?? "") >= yearAgo;
    rows.push({ id: String(s.id), name: String(s.name ?? ""), info, hoursClass: c, weeklyHours: Math.round(weeklyMinutesOf(s) / 6) / 10, weight, newHire });
    if (weight === 0) continue;
    const key: keyof DisabilityReport["cells"] | null =
      info.kind === "physical" ? (info.severe ? (c === "regular" ? "ho" : c === "short" ? "to" : "ri") : (c === "regular" ? "he" : "chi"))
        : info.kind === "intellectual" ? (info.severe ? (c === "regular" ? "ru" : c === "short" ? "wa" : "yo") : (c === "regular" ? "wo" : "ka"))
          : (c === "regular" ? "re" : c === "short" ? "so" : "tsu");
    cells[key].n++;
    if (newHire) cells[key].newN++;
  }
  const ha = i + ro * 0.5;
  const ni = round1(ha - floor1((ha * exclusionPct) / 100));
  const physical = cells.ho.n * 2 + cells.he.n + cells.to.n + (cells.chi.n + cells.ri.n) * 0.5;
  const intellectual = cells.ru.n * 2 + cells.wo.n + cells.wa.n + (cells.ka.n + cells.yo.n) * 0.5;
  const mental = cells.re.n + cells.so.n + cells.tsu.n * 0.5;
  const total = physical + intellectual + mental;
  const rate = disabilityRateFor(year);
  const required = floor1((ni * rate[0]) / rate[1]);
  return {
    year, asOf, i, ro, ha, ni, cells, physical, intellectual, mental, total,
    actualRate: ni > 0 ? Math.round((total / ni) * 10000) / 100 : null,
    rate, required, shortage: Math.max(0, round1(required - total)), mustReport: required >= 1, rows,
  };
};

// ── 高年齢者雇用状況等報告 ──────────────────────────────────

export interface ElderlyBand {
  from: number | null;
  to: number | null;
  label: string;
  total: number;
  women: number;
}

export interface ElderlyReport {
  year: number;
  asOf: string;
  /** ⑮ 常用労働者数（総数・年齢の区分ごと・うち女性） */
  total: number;
  women: number;
  bands: ElderlyBand[];
  /** ⑯ 過去1年間（前年6月1日〜その年5月31日）の、解雇等による45歳以上70歳未満の離職者（うち女性） */
  dismissed: { names: string[]; women: number };
  /** ⑰ 過去1年間に定年に達した人（定年で退職した人・続けて雇っている人） */
  retirementAge: number | null;
  reached: { name: string; date: string; outcome: "退職" | "継続雇用" }[];
}

const ageOn = (birthday: string, on: string) => {
  const b = dayjs(birthday);
  const d = dayjs(on);
  let a = d.year() - b.year();
  if (d.month() < b.month() || (d.month() === b.month() && d.date() < b.date())) a -= 1;
  return a;
};

/** 定年の年齢（労働条件通知書の会社の初めの値「有（60歳）」から読む。なければ null） */
export const retirementAgeOf = (text: string | undefined): number | null => {
  const m = /有\s*[（(]\s*(\d{2})\s*歳/.exec(String(text ?? "").normalize("NFKC"));
  return m ? Number(m[1]) : null;
};

const DISMISSAL = /解雇|会社都合|退職勧奨|事業主の都合/;

export const elderlyReport = (staffList: any[], year: number, retirementAge: number | null): ElderlyReport => {
  const asOf = `${year}-06-01`;
  const from = `${year - 1}-06-01`;
  const to = `${year}-05-31`;
  const bands: ElderlyBand[] = ELDERLY_AGE_BANDS.map(([a, b]) => ({
    from: a, to: b, label: a === null ? `〜${b}歳` : b === null ? `${a}歳〜` : `${a}〜${b}歳`, total: 0, women: 0,
  }));
  let total = 0;
  let women = 0;
  for (const s of staffList) {
    if (!employedOn(s, asOf) || notWorker(s) || !overOneYear(s)) continue;
    if (weeklyMinutesOf(s) < ELDERLY_REPORT_REGULAR_WEEKLY_HOURS * 60) continue;
    total++;
    const woman = s.gender === "female";
    if (woman) women++;
    if (!s.birthday) continue;
    const age = ageOn(String(s.birthday), asOf);
    const band = bands.find((b) => (b.from === null || age >= b.from) && (b.to === null || age <= b.to));
    if (band) {
      band.total++;
      if (woman) band.women++;
    }
  }
  const dismissed = { names: [] as string[], women: 0 };
  for (const s of staffList) {
    const leave = String(s.retirement_date ?? "");
    if (!leave || leave < from || leave > to || !s.birthday) continue;
    const age = ageOn(String(s.birthday), leave);
    if (age < 45 || age >= 70 || !DISMISSAL.test(String(s.retirement_reason ?? ""))) continue;
    dismissed.names.push(String(s.name ?? ""));
    if (s.gender === "female") dismissed.women++;
  }
  const reached: ElderlyReport["reached"] = [];
  if (retirementAge !== null) {
    for (const s of staffList) {
      if (!s.birthday) continue;
      // 定年に達した日（誕生日の前日）が過去1年間にある人
      const date = dayjs(String(s.birthday)).add(retirementAge, "year").subtract(1, "day").format("YYYY-MM-DD");
      if (date < from || date > to || !employedOn(s, date)) continue;
      const leave = String(s.retirement_date ?? "");
      const retired = !!leave && /定年/.test(String(s.retirement_reason ?? "")) && dayjs(leave).diff(dayjs(date), "day") <= 62;
      reached.push({ name: String(s.name ?? ""), date, outcome: retired ? "退職" : "継続雇用" });
    }
  }
  return { year, asOf, total, women, bands, dismissed, retirementAge, reached };
};
