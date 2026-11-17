/**
 * 給与支払報告・特別徴収に係る給与所得者異動届出書（住民税）
 *
 * 住民税を特別徴収している人が、退職・休職・死亡などで給与を払わなくなったら、翌月10日までに市区町村に出す（地方税法321条の7）。
 * 次の年度の給与支払報告書を出したあと（1月〜5月）に退職した人も、出した市区町村に出す（給与支払報告に係る異動届出書）。
 * 様式と書き方は、総務省市町村税課・地方税共同機構「給与支払報告・特別徴収に係る給与所得者異動届出書 記載要領」（令和4年3月）、
 * eLTAX に取り込む CSV は、地方税共同機構「給与所得者異動届出書CSVレイアウト仕様書 令和3年4月1日～」
 * （68項目。constants/residentTaxIdouCsvLayout.ts。仕様書の Excel から自動生成）による。
 *
 * ■ 年度（記載要領・仕様書の「年度」欄判定フロー）
 *   ・異動の日に特別徴収をしていて、次の年度の給与支払報告書を出していない → 1：現年度（いま特別徴収している市区町村へ）
 *   ・特別徴収をしていなくて、次の年度の給与支払報告書を出した → 2：新年度（給与支払報告書を出した市区町村へ）
 *   ・特別徴収をしていて、次の年度の給与支払報告書も出した → 3：両年度。ただし、住所が変わって2つの市区町村が違うときは、
 *     現年度分をいまの市区町村へ、新年度分を給与支払報告書を出した市区町村へ、別々に出す
 *   次の年度の給与支払報告書は1月31日までに出すので、Q は、異動の日が2月〜5月なら「出した」を初めの値にする（画面で直せる）
 * ■ 特別徴収税額（年税額）・徴収済額・未徴収税額
 *   年税額は、その年度の12か月の額（住民税の画面で入れた額）の合計。徴収済額は、その年度の分として確定した給与で引いた住民税
 *   （月ごとに、その月の額までを毎月の徴収として数える）。月の額より多く引いた分は、一括徴収した額として数える
 *   （一括徴収は、最後の給与明細の住民税の欄で直す。utils/residentTax.ts）。未徴収税額 ＝ 年税額 − 徴収済額
 * ■ 異動後の未徴収税額の徴収方法（地方税法321条の5第2項）
 *   ・1月1日〜4月30日に退職した人は、残りを5月31日までに払う給与・退職手当等から一括で徴収する（一括徴収の理由「2」。
 *     払う給与が未徴収税額以下で一括徴収できなければ、普通徴収（理由「2：未徴収税額以下」））
 *   ・6月1日〜12月31日に退職した人は、本人が申し出れば一括徴収（理由「1：申出あり」）、申し出なければ普通徴収（理由「1：一括徴収希望なし」）
 *   ・死亡した人は普通徴収（理由「3：死亡退職」）
 *   ・新しい勤務先で特別徴収を続けるときは「1：特別徴収継続」（新しい勤務先の名称・所在地・指定番号・月割額・納入開始月などを書く）
 *   一括徴収・普通徴収の理由の「年」は、理由1は賦課年度（6月〜12月の異動はその年、1月〜5月の異動は前の年）、理由2は賦課年度＋1
 * ■ 市区町村の様式：記載要領の項目のとおりに中身を出す（書き写す・eLTAX で出す）。CSV は1行に1枚（いくつの市区町村の分でも1つのファイルにまとめる）
 */
import {
  IDOU_CSV_FIELDS, IDOU_ERA_CODES, IDOU_FILE_KIND, IDOU_NG_HANKAKU, IDOU_NG_ZENKAKU, type IdouCsvField,
} from "../constants/residentTaxIdouCsvLayout";
import { annualTotal, fiscalYearOf, indexInFiscalYear, paymentMunicipalityOf, RESIDENT_TAX_MONTHS, residentTaxScheduleOf, type ResidentTaxYear } from "./residentTax";
import { toZenkaku, toZenkakuKatakana } from "./salaryPaymentReportCsv";
import { toWareki } from "./wareki";

export type IdouYearKind = "1" | "2" | "3";
export type IdouMethod = "1" | "2" | "3";

/** 新しい勤務先（特別徴収を続けるとき） */
export interface IdouNewEmployer {
  /** 提出先の市区町村から指定された、新しい勤務先の特別徴収義務者指定番号（指定されていなければ空で isNew） */
  designation: string;
  /** 指定されたことがない（新規） */
  isNew: boolean;
  corporateNumber: string;
  zip: string;
  address: string;
  kana: string;
  name: string;
  dept: string;
  contactName: string;
  phone: string;
  ext: string;
  /** 月割額・納入開始月（現年度分・両年度分） */
  monthly: number;
  startMonth: number;
  staffNumber: string;
  /** 新規のときの納入書の要否（1：必要・2：不要） */
  slip: "1" | "2" | "";
}

/** 画面で入れる・選ぶもの（従業員ごと・異動の日ごとに保存する。staff.resident_tax_idou） */
export interface IdouInput {
  /** 異動年月日（給与の支払を受けなくなった日。退職日など） */
  date: string;
  /** 異動の事由（1：退職 … 7：その他） */
  reason: string;
  /** 7：その他の事由・理由 */
  reasonText?: string;
  /** 次の年度の給与支払報告書を出したか（null・なしなら初めの値） */
  nextYearReported?: boolean | null;
  /** 異動後の未徴収税額の徴収方法（空なら初めの値） */
  method?: IdouMethod | "";
  /** 一括徴収の理由・徴収予定月日・徴収予定額・納入月（空なら初めの値） */
  lumpReason?: "1" | "2" | "";
  lumpDate?: string;
  lumpAmount?: number | null;
  lumpPayMonth?: number | null;
  /** 普通徴収の理由（空なら初めの値） */
  ordinaryReason?: "1" | "2" | "3" | "";
  /** 新しい勤務先（特別徴収を続けるとき） */
  newEmployer?: Partial<IdouNewEmployer> | null;
  /** 届け出た日（CSV を保存した・印刷して出したときに残す） */
  reportedOn?: string | null;
}

export interface IdouSalary {
  /** 支給した年月 */
  year: number;
  month: number;
  /** 引いた住民税 */
  residentTax: number;
  /** 支払った日 */
  payDate: string;
}

/** 年度の中の徴収の状況 */
export interface IdouCollection {
  fiscalYear: number;
  municipality: string;
  /** 特別徴収税額（年税額）。その年度の額がなければ 0 */
  annual: number;
  /** 毎月の徴収で引いた額（月の額まで）と、その最初と最後の月（YYYY-MM） */
  collected: number;
  collectedFrom: string | null;
  collectedTo: string | null;
  /** 未徴収税額と、その期間（徴収した最後の月の次の月〜5月） */
  uncollected: number;
  uncollectedFrom: string | null;
  uncollectedTo: string | null;
  /** 月の額より多く引いた額（一括徴収した額）と、引いた給与の支払日 */
  lump: number;
  lumpPayDate: string | null;
  /** 年度の宛名番号（特別徴収税額通知から取り込んだもの。なければ空） */
  atena: string;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const ym = (year: number, month: number) => `${year}-${pad2(month)}`;
/** 年度の i 番目（6月分が0）の支給年月 */
const monthOfIndex = (fiscalYear: number, i: number) => {
  const m = RESIDENT_TAX_MONTHS[i];
  return ym(m >= 6 ? fiscalYear : fiscalYear + 1, m);
};

/** その年度の徴収の状況（その年度の分として確定した給与で引いた住民税から） */
export const collectionOf = (entry: ResidentTaxYear | null | undefined, fiscalYear: number, municipality: string, salaries: IdouSalary[]): IdouCollection => {
  const amounts = entry?.amounts ?? Array(12).fill(0);
  const annual = entry ? annualTotal(amounts) : 0;
  const actual = Array(12).fill(0) as number[];
  const payDates: (string | null)[] = Array(12).fill(null);
  for (const s of salaries) {
    if (fiscalYearOf(s.year, s.month) !== fiscalYear) continue;
    const i = indexInFiscalYear(s.month);
    actual[i] += Math.max(0, Math.floor(Number(s.residentTax) || 0));
    if (!payDates[i] || s.payDate > payDates[i]!) payDates[i] = s.payDate;
  }
  let collected = 0;
  let lump = 0;
  let lumpPayDate: string | null = null;
  let first: number | null = null;
  let last: number | null = null;
  for (let i = 0; i < 12; i++) {
    const regular = Math.min(actual[i], amounts[i] ?? 0);
    collected += regular;
    if (regular > 0) {
      if (first === null) first = i;
      last = i;
    }
    const extra = actual[i] - regular;
    if (extra > 0) {
      lump += extra;
      lumpPayDate = payDates[i];
    }
  }
  const lumpAndRest = Math.max(0, annual - collected);
  const restFrom = last === null ? 0 : last + 1;
  return {
    fiscalYear, municipality, annual,
    collected,
    collectedFrom: first === null ? null : monthOfIndex(fiscalYear, first),
    collectedTo: last === null ? null : monthOfIndex(fiscalYear, last),
    // 未徴収税額は、毎月の徴収のあとに残った額（一括徴収した額を含む。届出書では、その額を一括徴収の徴収予定額に書く）
    uncollected: lumpAndRest,
    uncollectedFrom: lumpAndRest > 0 && restFrom < 12 ? monthOfIndex(fiscalYear, restFrom) : null,
    uncollectedTo: lumpAndRest > 0 && restFrom < 12 ? monthOfIndex(fiscalYear, 11) : null,
    lump: Math.min(lump, lumpAndRest),
    lumpPayDate,
    atena: entry?.atena ?? "",
  };
};

/** 異動の日の月（1〜12） */
const monthOfDate = (date: string) => Number(date.slice(5, 7)) || 0;

/** 次の年度の給与支払報告書を出したか（初めの値：異動の日が2月〜5月なら出した） */
export const defaultNextYearReported = (date: string): boolean => {
  const m = monthOfDate(date);
  return m >= 2 && m <= 5;
};

export interface IdouDefaults {
  method: IdouMethod | "";
  lumpReason: "1" | "2" | "";
  lumpDate: string;
  lumpAmount: number;
  lumpPayMonth: number | null;
  ordinaryReason: "1" | "2" | "3" | "";
  /** 初めの値を決めた理由・気を付けること */
  notes: string[];
}

/** 徴収方法などの初めの値（地方税法321条の5第2項） */
export const idouDefaults = (input: Pick<IdouInput, "date" | "reason">, c: IdouCollection): IdouDefaults => {
  const m = monthOfDate(input.date);
  const notes: string[] = [];
  const nextMonthOf = (date: string) => (Number(date.slice(5, 7)) % 12) + 1;
  if (input.reason === "4") {
    return { method: "3", lumpReason: "", lumpDate: "", lumpAmount: 0, lumpPayMonth: null, ordinaryReason: "3", notes: ["死亡した人は、残りを普通徴収にします（理由「3：死亡退職」）。"] };
  }
  if (c.uncollected <= 0) {
    notes.push("未徴収税額がないので、徴収方法は選ばなくてもよいことが多いです。書き方は、提出先の市区町村に確かめてください。");
    return { method: "", lumpReason: "", lumpDate: "", lumpAmount: 0, lumpPayMonth: null, ordinaryReason: "", notes };
  }
  if (c.lump > 0 && c.lumpPayDate) {
    const reason = m >= 1 && m <= 5 ? "2" : "1";
    if (c.lump !== c.uncollected) notes.push(`最後の給与で一括して引いた額（${c.lump.toLocaleString()}円）が、未徴収税額（${c.uncollected.toLocaleString()}円）と違います。`);
    return { method: "2", lumpReason: reason, lumpDate: c.lumpPayDate, lumpAmount: c.lump, lumpPayMonth: nextMonthOf(c.lumpPayDate), ordinaryReason: "", notes };
  }
  if (m >= 1 && m <= 4) {
    notes.push(
      "1月1日〜4月30日に退職した人は、残りの住民税を5月31日までに払う給与・退職手当等から一括で引きます（地方税法321条の5第2項）。" +
      "最後の給与明細の住民税の欄に残りの額を足して確定し直すと、一括徴収の額と日を入れます。払う給与が未徴収税額以下で引けないときは、普通徴収（理由「2：未徴収税額以下」）にします。",
    );
    return { method: "2", lumpReason: "2", lumpDate: "", lumpAmount: c.uncollected, lumpPayMonth: null, ordinaryReason: "", notes };
  }
  if (m === 5) {
    notes.push("5月に退職して5月分を引いていない人の書き方は、提出先の市区町村に確かめてください（初めは普通徴収にしています）。");
    return { method: "3", lumpReason: "", lumpDate: "", lumpAmount: 0, lumpPayMonth: null, ordinaryReason: "", notes };
  }
  notes.push("6月1日〜12月31日に退職した人は、本人が申し出れば一括徴収、申し出なければ普通徴収です（初めは普通徴収にしています）。");
  return { method: "3", lumpReason: "", lumpDate: "", lumpAmount: 0, lumpPayMonth: null, ordinaryReason: "1", notes };
};

/** 1枚の届出書 */
export interface IdouForm {
  yearKind: IdouYearKind;
  /** 提出先の市区町村（団体コード） */
  municipality: string;
  /** 年税額・徴収済額などを書く年度（現年度分・両年度分。新年度分は次の年度） */
  fiscalYear: number;
  collection: IdouCollection | null;
}

/**
 * 出す届出書（年度ごと・市区町村ごと。出さなくてよければ空）
 * @param current 異動の日の年度の徴収の状況（特別徴収していなければ annual 0）
 * @param nextMunicipality 次の年度の給与支払報告書を出した市区町村（1月1日の住所。従業員の市区町村）
 */
export const idouForms = (current: IdouCollection, nextReported: boolean, nextMunicipality: string): IdouForm[] => {
  const tokuchoNow = current.annual > 0;
  if (tokuchoNow && !nextReported) return [{ yearKind: "1", municipality: current.municipality, fiscalYear: current.fiscalYear, collection: current }];
  if (!tokuchoNow && nextReported) return [{ yearKind: "2", municipality: nextMunicipality, fiscalYear: current.fiscalYear + 1, collection: null }];
  if (tokuchoNow && nextReported) {
    if (!nextMunicipality || nextMunicipality === current.municipality) {
      return [{ yearKind: "3", municipality: current.municipality, fiscalYear: current.fiscalYear, collection: current }];
    }
    return [
      { yearKind: "1", municipality: current.municipality, fiscalYear: current.fiscalYear, collection: current },
      { yearKind: "2", municipality: nextMunicipality, fiscalYear: current.fiscalYear + 1, collection: null },
    ];
  }
  return [];
};

export interface IdouPerson {
  staffId: string;
  name: string;
  furigana: string;
  birthday: string;
  /** 異動後の住所（わからなければ、給与を払わなくなったときの住所） */
  address: string;
  /** 本人のマイナンバー（書くときだけ渡す） */
  myNumber?: string;
}

/** 届出書を作るのに使うもの（入れたもの＋初めの値） */
export interface IdouResolved {
  input: IdouInput;
  defaults: IdouDefaults;
  method: IdouMethod | "";
  lumpReason: "1" | "2" | "";
  lumpDate: string;
  lumpAmount: number;
  lumpPayMonth: number | null;
  ordinaryReason: "1" | "2" | "3" | "";
  nextYearReported: boolean;
  newEmployer: IdouNewEmployer;
}

const EMPTY_EMPLOYER: IdouNewEmployer = {
  designation: "", isNew: false, corporateNumber: "", zip: "", address: "", kana: "", name: "", dept: "", contactName: "", phone: "", ext: "",
  monthly: 0, startMonth: 0, staffNumber: "", slip: "",
};

/** 入れたものと初めの値を合わせる */
export const resolveIdou = (input: IdouInput, c: IdouCollection): IdouResolved => {
  const defaults = idouDefaults(input, c);
  const pick = <T,>(v: T | undefined | null, d: T): T => (v === undefined || v === null || (v as unknown) === "" ? d : v);
  const method = pick(input.method, defaults.method);
  return {
    input, defaults, method,
    lumpReason: pick(input.lumpReason, defaults.lumpReason),
    lumpDate: pick(input.lumpDate, defaults.lumpDate),
    lumpAmount: pick(input.lumpAmount ?? undefined, method === "2" ? (defaults.lumpAmount || c.uncollected) : 0),
    lumpPayMonth: pick(input.lumpPayMonth ?? undefined, defaults.lumpPayMonth ?? 0) || null,
    ordinaryReason: pick(input.ordinaryReason, defaults.ordinaryReason),
    nextYearReported: input.nextYearReported ?? defaultNextYearReported(input.date),
    newEmployer: { ...EMPTY_EMPLOYER, ...(input.newEmployer ?? {}) },
  };
};

// ── CSV（68項目） ──────────────────────────────────────

const fieldByNo = (no: number): IdouCsvField => IDOU_CSV_FIELDS[no - 1];

/** 元号の数字と2けたの年 */
const eraYear = (date: string): [string, string] => {
  const w = toWareki(date);
  return w ? [IDOU_ERA_CODES[w.era] ?? "", pad2(w.year)] : ["", ""];
};
const eraYmd = (date: string): [string, string, string, string] => {
  const w = toWareki(date);
  return w ? [IDOU_ERA_CODES[w.era] ?? "", pad2(w.year), pad2(w.month), pad2(w.day)] : ["", "", "", ""];
};
const eraYm = (month: string | null): [string, string, string] => {
  if (!month) return ["", "", ""];
  const [e, y, m] = eraYmd(`${month}-01`);
  return [e, y, m];
};

const digits = (s: string | null | undefined) => (s ?? "").normalize("NFKC").replace(/[^0-9]/g, "");
const hankaku = (s: string | null | undefined) => (s ?? "").normalize("NFKC").replace(/[^\x20-\x7E]/g, "").replace(/[,@]/g, "").trim();
const zen = (s: string | null | undefined) => toZenkaku((s ?? "").trim()).replace(/[,，]/g, "，").replace(/[@＠]/g, "＠");

/** 書く条件（必須・任意・設定不可）。条件付きのものは、ほかの項目の値で決める */
export const ruleOf = (f: IdouCsvField, mode: keyof IdouCsvField["when"], values: string[]): "必須" | "任意" | "設定不可" => {
  const raw = f.when[mode];
  if (raw === "必須" || raw === "任意" || raw === "設定不可") return raw;
  const valueOf = (name: string) => {
    const g = IDOU_CSV_FIELDS.find((x) => x.name === name);
    if (!g) throw new Error(`書く条件の項目がわからない: ${name}`);
    return values[g.no - 1] ?? "";
  };
  let m = /^(.+)が1円以上の場合は(必須|任意|設定不可)0円の場合は(必須|任意|設定不可)$/.exec(raw);
  if (m) return (Number(valueOf(m[1])) >= 1 ? m[2] : m[3]) as "必須" | "任意" | "設定不可";
  m = /^(.+)が(\d)の場合は(必須|任意|設定不可)(\d)(以外)?の場合は(必須|任意|設定不可)$/.exec(raw);
  if (m) {
    const v = valueOf(m[1]);
    if (v === m[2]) return m[3] as "必須" | "任意" | "設定不可";
    if (m[5] ? v !== m[4] : v === m[4]) return m[6] as "必須" | "任意" | "設定不可";
    return "任意";
  }
  throw new Error(`書く条件を読めない: ${f.no} ${raw}`);
};

/** 1つの項目の値が、文字属性・文字数に合っているか（合っていれば null） */
export const idouFieldError = (f: IdouCsvField, value: string): string | null => {
  if (!value) return null;
  const chars = [...value];
  if (f.attr === "数字" && !/^\d+$/.test(value)) return `${f.name}は数字で書きます`;
  if (f.attr === "半角" && (!/^[\x20-\x7E]+$/.test(value) || IDOU_NG_HANKAKU.some((c) => value.includes(c)))) return `${f.name}に、半角の英数字・記号でない文字があります`;
  if (f.attr === "全角" && chars.some((c) => /[\x00-\x7F｡-ﾟ]/.test(c))) return `${f.name}に、半角の文字があります`;
  if (f.attr === "全角" && chars.some((c) => IDOU_NG_ZENKAKU.includes(c))) return `${f.name}に、eLTAX で使えない文字があります`;
  if (chars.length > f.max) return `${f.name}が長すぎます（${f.max}文字まで。いまは${chars.length}文字）`;
  return null;
};

export interface IdouRow {
  form: IdouForm;
  values: string[];
  /** 直すところ（あれば CSV に入れない） */
  problems: string[];
}

/**
 * 1枚の届出書の68項目
 * @param designation 提出先の市区町村の指定番号（会社の番号）
 */
export const buildIdouRow = (form: IdouForm, person: IdouPerson, r: IdouResolved, designation: string, staffNumber: string): IdouRow => {
  const v: string[] = Array(IDOU_CSV_FIELDS.length).fill("");
  const set = (no: number, value: string | number | null | undefined) => {
    v[no - 1] = value === null || value === undefined ? "" : String(value);
  };
  const problems: string[] = [];
  const kind = form.yearKind;
  const c = form.collection;
  const fy = form.fiscalYear;

  set(1, IDOU_FILE_KIND);
  set(2, kind);
  set(3, hankaku(designation));
  set(4, hankaku(c?.atena));
  set(5, zen(toZenkakuKatakana(person.furigana)));
  set(6, zen(person.name));
  const [be, by, bm, bd] = eraYmd(person.birthday);
  set(7, be); set(8, by); set(9, bm); set(10, bd);
  set(11, digits(person.myNumber));
  set(12, /^[0-9A-Za-z-]+$/.test(staffNumber) ? staffNumber : "");
  // 13：1月1日現在の住所（任意）。Q は住民税の通知の住所を持たない（utils/residentTaxNotice.ts）ので書かない
  set(14, zen(person.address));
  if (kind !== "2" && c) {
    set(15, c.annual);
    if (c.collected > 0) {
      const [fe, fy1, fm] = eraYm(c.collectedFrom);
      const [te, ty, tm] = eraYm(c.collectedTo);
      set(16, fe); set(17, fy1); set(18, fm); set(19, te); set(20, ty); set(21, tm);
    }
    set(22, c.collected);
    if (c.uncollected > 0) {
      const [fe, fy1, fm] = eraYm(c.uncollectedFrom);
      const [te, ty, tm] = eraYm(c.uncollectedTo);
      set(23, fe); set(24, fy1); set(25, fm); set(26, te); set(27, ty); set(28, tm);
    }
    set(29, c.uncollected);
  }
  const [de, dy, dm, dd] = eraYmd(r.input.date);
  set(30, de); set(31, dy); set(32, dm); set(33, dd);
  set(34, r.input.reason);
  if (r.input.reason === "7") set(35, zen(r.input.reasonText));
  if (kind !== "2") set(36, r.method);
  // 特別徴収を続ける（新年度分は、続けるときだけ「特別徴収継続の場合」の欄を書く。記載要領(2)）
  const continuing = r.method === "1";
  if (continuing) {
    const e = r.newEmployer;
    if (!e.isNew) set(37, hankaku(e.designation));
    set(38, e.isNew ? "1" : "0");
    set(39, digits(e.corporateNumber));
    set(40, digits(e.zip));
    set(41, zen(e.address));
    set(42, zen(toZenkakuKatakana(e.kana)));
    set(43, zen(e.name));
    set(44, zen(e.dept));
    set(45, zen(e.contactName));
    set(46, hankaku(e.phone));
    set(47, digits(e.ext));
    if (kind !== "2") {
      set(48, e.monthly > 0 ? Math.floor(e.monthly) : "");
      set(49, e.startMonth >= 1 && e.startMonth <= 12 ? pad2(e.startMonth) : "");
    }
    set(50, hankaku(e.staffNumber));
    if (e.isNew) set(51, e.slip);
  }
  if (kind !== "2" && r.method === "2") {
    set(52, r.lumpReason);
    if (r.lumpReason === "1") { const [e, y] = eraYear(`${fy}-06-01`); set(53, e); set(54, y); }
    if (r.lumpReason === "2") { const [e, y] = eraYear(`${fy + 1}-01-01`); set(55, e); set(56, y); }
    if (r.lumpDate) { const [e, y, m, d] = eraYmd(r.lumpDate); set(57, e); set(58, y); set(59, m); set(60, d); }
    set(61, r.lumpAmount > 0 ? r.lumpAmount : "");
    set(62, r.lumpPayMonth ? pad2(r.lumpPayMonth) : "");
  }
  if (kind !== "2" && r.method === "3") {
    set(63, r.ordinaryReason);
    if (r.ordinaryReason === "1") { const [e, y] = eraYear(`${fy}-06-01`); set(64, e); set(65, y); }
    if (r.ordinaryReason === "2") { const [e, y] = eraYear(`${fy + 1}-01-01`); set(66, e); set(67, y); }
  }
  set(68, digits(form.municipality));

  // 決まりに合うか（仕様書の書く条件・文字属性・文字数）
  if (kind !== "2" && !r.method) problems.push("異動後の未徴収税額の徴収方法を選んでください");
  const mode: keyof IdouCsvField["when"] = kind === "2" ? "newYear" : r.method === "1" ? "tokucho" : r.method === "2" ? "ikkatsu" : "futsu";
  if (kind === "2" || r.method) {
    for (const f of IDOU_CSV_FIELDS) {
      const value = v[f.no - 1];
      // 特別徴収継続の欄は、新年度分では続けるときだけ書く（記載要領(2)）
      const rule = kind === "2" && f.group === "特別徴収継続の場合" && !continuing ? "任意" : ruleOf(f, mode, v);
      if (rule === "必須" && !value) problems.push(`${f.name}${f.group ? `（${f.group}）` : ""}を入れてください`);
      if (rule === "設定不可" && value) problems.push(`${f.name}は書きません（Q の誤りです）`);
      const err = idouFieldError(f, value);
      if (err) problems.push(err);
      if (f.codes && value && !f.codes.some((x) => x.code === value)) problems.push(`${f.name}のコード「${value}」は使えません`);
    }
  }
  if (kind !== "2" && c && c.annual - c.collected !== c.uncollected) problems.push("未徴収税額が、年税額 − 徴収済額と合いません");
  if (kind !== "2" && r.method === "2" && c && r.lumpAmount !== c.uncollected) {
    problems.push(`一括徴収の徴収予定額（${r.lumpAmount.toLocaleString()}円）は、未徴収税額（${c.uncollected.toLocaleString()}円）と同じにします`);
  }
  if (!person.address.trim()) problems.push("異動後の住所（わからなければ、給与を払わなくなったときの住所）を、従業員の画面で入れてください");
  return { form, values: v, problems: [...new Set(problems)] };
};

/** CSV（1行に1枚。項目名の行は付けない。値を "" で囲まない。給与支払報告書の CSV と同じ） */
export const buildIdouCsv = (rows: IdouRow[]): string =>
  rows.filter((r) => r.problems.length === 0).map((r) => r.values.join(",")).join("\r\n") + "\r\n";

/** 異動の事由・徴収方法などの名前（仕様書のコードから） */
export const codeLabel = (no: number, code: string): string => fieldByNo(no).codes?.find((c) => c.code === code)?.label ?? "";

export const IDOU_REASON_OPTIONS = (fieldByNo(34).codes ?? []).map((c) => ({ value: c.code, label: c.label }));
export const IDOU_METHOD_OPTIONS = (fieldByNo(36).codes ?? []).map((c) => ({ value: c.code as IdouMethod, label: c.label }));
export const IDOU_LUMP_REASON_OPTIONS = (fieldByNo(52).codes ?? []).map((c) => ({ value: c.code as "1" | "2", label: c.label }));
export const IDOU_ORDINARY_REASON_OPTIONS = (fieldByNo(63).codes ?? []).map((c) => ({ value: c.code as "1" | "2" | "3", label: c.label }));
export const IDOU_YEAR_LABELS: Record<IdouYearKind, string> = Object.fromEntries((fieldByNo(2).codes ?? []).map((c) => [c.code, c.label])) as Record<IdouYearKind, string>;

// ── 保存（staff.resident_tax_idou：異動の日ごとの入れたもの） ──────────────────

export const parseIdouInputs = (json: unknown): Record<string, IdouInput> => {
  if (typeof json !== "string" || !json.trim()) return {};
  try {
    const v = JSON.parse(json);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Record<string, IdouInput> = {};
    for (const [date, x] of Object.entries(v as Record<string, any>)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !x || typeof x !== "object") continue;
      out[date] = { ...x, date } as IdouInput;
    }
    return out;
  } catch {
    return {};
  }
};

export const stringifyIdouInputs = (map: Record<string, IdouInput>): string | null =>
  Object.keys(map).length === 0 ? null : JSON.stringify(map);

/** その人の、異動の日の年度の徴収の状況（年度の納付先・宛名番号は、住民税の画面の年度から） */
export const staffCollectionOf = (staff: any, date: string, salaries: IdouSalary[]): IdouCollection => {
  const fy = fiscalYearOf(Number(date.slice(0, 4)), Number(date.slice(5, 7)));
  const entry = residentTaxScheduleOf(staff).find((e) => e.fiscalYear === fy) ?? null;
  return collectionOf(entry, fy, paymentMunicipalityOf(staff, fy), salaries);
};
