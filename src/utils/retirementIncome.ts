/**
 * 退職手当等（退職金）に対する所得税（源泉徴収税額）と住民税（特別徴収税額）
 *
 * 数値（退職所得控除額・2分の1・短期退職手当等の300万円と150万円・5年・住民税の税率・速算表・20.42％）は、
 * scripts/import_taishoku_tables.py で法令の XML と国税庁の PDF から作った constants/taishoku.ts を使う。
 * 決まりは、国税庁 タックスアンサー No.2732「退職手当等に対する源泉徴収」（令和8年4月1日現在法令等）、所得税法30条・201条、
 * 所得税法施行令69条、地方税法50条の3〜50条の6・328条〜328条の6、20条の4の2、
 * 「令和8年分 給与所得の源泉徴収票等の法定調書の作成と提出の手引」第3章（退職所得の源泉徴収票・特別徴収票）による。
 *
 * ■ 勤続年数：就職の日から退職の日まで引き続き勤務した期間の年数。1年未満の端数は1年にする（所得税法施行令69条2項）。
 *   一時勤務しなかった期間・前の勤務先の期間を含めるとき、前に退職手当等を受けた期間を除くときなどは、画面で勤続年数を直す
 * ■ 退職所得控除額：勤続年数20年以下は 40万円 × 勤続年数、20年超は 800万円 ＋ 70万円 ×（勤続年数 − 20年）。80万円未満なら80万円。
 *   障害者になったことが直接の原因で退職したときは100万円を加える（所得税法30条3項・6項）。
 *   前年以前に退職手当等を受けていて重複期間の分を引くとき（30条6項1号）は、Q では計算しないので、画面で額を入れる
 * ■ 課税退職所得金額（1,000円未満の端数は切り捨て。タックスアンサー No.2732 の注1・国税通則法118条1項）
 *   ・一般退職手当等：（収入金額 − 退職所得控除額）× 1/2
 *   ・短期退職手当等（役員等以外の人で、勤続年数5年以下）：残額が300万円以下なら × 1/2、超えるなら 150万円 ＋（収入金額 −（300万円 ＋ 退職所得控除額））
 *   ・特定役員退職手当等（役員等としての勤続年数5年以下の役員等）：収入金額 − 退職所得控除額（1/2 にしない）
 *   同じ年に区分の違う退職手当等があるとき（タックスアンサー No.2741・所得税法施行令71条の2）は、Q では計算しない
 * ■ 所得税（「退職所得の受給に関する申告書」を出している人）：速算表で（課税退職所得金額 × 税率 − 控除額）× 102.1％、1円未満は切り捨て。
 *   申告書に、その年に支払済みの他の退職手当等があると書いてあるときは、合計額で計算した税額から、他の退職手当等で徴収された税額を引く
 *   （所得税法201条1項2号）。申告書を出していない人は、支払金額 × 20.42％（1円未満は切り捨て。201条3項）
 * ■ 住民税：課税退職所得金額（千円未満切り捨て。地方税法20条の4の2第1項）× 6％（市町村民税）・4％（道府県民税）、
 *   それぞれ100円未満は切り捨て（20条の4の2第3項）。申告書を出していない人も、その支払う退職手当等で計算する（他の退職手当等は合わせない。
 *   地方税法328条の6第2項・50条の6第2項）。納めるのは、支払を受けるべき日の属する年の1月1日の住所の市区町村（328条）
 * ■ 死亡退職で払う退職手当等は、相続税がかかり所得税はかからない（源泉徴収しない。退職所得の源泉徴収票ではなく、
 *   相続税法の「退職手当金等受給者別支払調書」を出す）ので、Q では税額を0にして知らせる
 */
import dayjs from "dayjs";
import {
  TAISHOKU_DEDUCTION, TAISHOKU_INCOME, TAISHOKU_LOCAL_RATES, TAISHOKU_NO_DECLARATION_RATE, TAISHOKU_QUICK_TABLES, TAISHOKU_ROUND_UP_YEARS,
  type TaishokuQuickTable,
} from "../constants/taishoku";
import { formatWareki } from "./wareki";

export type RetirementKind = "general" | "short" | "officer";

export const RETIREMENT_KIND_LABELS: Record<RetirementKind, string> = {
  general: "一般退職手当等",
  short: "短期退職手当等",
  officer: "特定役員退職手当等",
};

/** 申告書に書いてある、その年に支払済みの他の退職手当等（源泉徴収票の摘要と中段に書く） */
export interface OtherRetirement {
  /** 支払者の氏名又は名称 */
  payer: string;
  amount: number;
  /** その退職手当等の勤続年数 */
  years: number;
  /** 源泉徴収税額（所得税及び復興特別所得税） */
  incomeTax: number;
  /** 特別徴収税額 */
  cityTax: number;
  prefTax: number;
}

/** 画面で入れること（retirement_allowances.detail の JSON） */
export interface RetirementInput {
  /** 就職年月日（勤続期間の初めの日。初めは入社日） */
  serviceFrom: string;
  /** 退職年月日（初めは退職日） */
  serviceTo: string;
  /** 勤続年数を手で決める（null なら勤続期間から） */
  yearsOverride: number | null;
  /** 勤続年数の計算の基礎（手で決めたとき。摘要に書く） */
  yearsNote: string;
  /** 区分（null なら自動：役員で役員等勤続年数が5年以下なら特定役員、役員でなく勤続年数が5年以下なら短期） */
  kind: RetirementKind | null;
  /** 役員等としての勤続年数（役員のとき。null なら勤続年数と同じ） */
  officerYears: number | null;
  /** 「退職所得の受給に関する申告書」を出している */
  declared: boolean;
  /** 障害者になったことが直接の原因で退職した */
  disability: boolean;
  /** 退職所得控除額を手で決める（前年以前の退職手当等との重複期間の分を引くときなど。null なら計算） */
  deductionOverride: number | null;
  /** 手で決めた退職所得控除額の計算の基礎（摘要に書く） */
  deductionNote: string;
  /** 申告書に書いてある、その年に支払済みの他の退職手当等 */
  other: OtherRetirement | null;
  /** 他の退職手当等と合わせた勤続年数（null なら長い方。期間が重なっていないときは手で直す） */
  combinedYears: number | null;
  /** 死亡退職（相続税がかかる。源泉徴収しない） */
  death: boolean;
  /** 源泉徴収票に書く：役職名（退職時） */
  position: string;
  /** 源泉徴収票に書く：住所又は居所（作る日の現況。初めは従業員の住所） */
  address: string;
  /** 源泉徴収票に書く：その年の1月1日の住所 */
  januaryAddress: string;
}

export const emptyRetirementInput = (): RetirementInput => ({
  serviceFrom: "", serviceTo: "", yearsOverride: null, yearsNote: "", kind: null, officerYears: null,
  declared: true, disability: false, deductionOverride: null, deductionNote: "", other: null, combinedYears: null,
  death: false, position: "", address: "", januaryAddress: "",
});

const int = (v: unknown): number => Math.max(0, Math.floor(Number(v) || 0));
const intOrNull = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : int(v));
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export const parseRetirementInput = (v: unknown): RetirementInput => {
  const base = emptyRetirementInput();
  if (typeof v !== "string" || !v.trim()) return base;
  try {
    const x = JSON.parse(v) ?? {};
    const o = x.other;
    return {
      serviceFrom: str(x.serviceFrom), serviceTo: str(x.serviceTo),
      yearsOverride: intOrNull(x.yearsOverride), yearsNote: str(x.yearsNote),
      kind: x.kind === "general" || x.kind === "short" || x.kind === "officer" ? x.kind : null,
      officerYears: intOrNull(x.officerYears),
      declared: x.declared !== false, disability: !!x.disability,
      deductionOverride: intOrNull(x.deductionOverride), deductionNote: str(x.deductionNote),
      other: o && typeof o === "object"
        ? { payer: str(o.payer), amount: int(o.amount), years: int(o.years), incomeTax: int(o.incomeTax), cityTax: int(o.cityTax), prefTax: int(o.prefTax) }
        : null,
      combinedYears: intOrNull(x.combinedYears),
      death: !!x.death, position: str(x.position), address: str(x.address), januaryAddress: str(x.januaryAddress),
    };
  } catch {
    return base;
  }
};

/** 勤続期間（年・月・日）と、勤続年数（1年未満の端数は1年）。日付でない・初めが終わりより後なら null */
export const servicePeriodOf = (from: string, to: string): { years: number; months: number; days: number; counted: number } | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return null;
  const start = dayjs(from);
  const end = dayjs(to).add(1, "day"); // 退職の日まで（その日を含む）
  let years = end.diff(start, "year");
  let cursor = start.add(years, "year");
  if (cursor.isAfter(end)) { years -= 1; cursor = start.add(years, "year"); }
  let months = end.diff(cursor, "month");
  let cursor2 = start.add(years * 12 + months, "month");
  if (cursor2.isAfter(end)) { months -= 1; cursor2 = start.add(years * 12 + months, "month"); }
  const days = end.diff(cursor2, "day");
  const remainder = months > 0 || days > 0;
  return { years, months, days, counted: years + (remainder && TAISHOKU_ROUND_UP_YEARS ? 1 : 0) || 1 };
};

/** 「19年8か月20日」 */
export const servicePeriodLabel = (p: { years: number; months: number; days: number }) =>
  `${p.years}年${p.months ? `${p.months}か月` : ""}${p.days ? `${p.days}日` : ""}`;

/** 退職所得控除額（所得税法30条3項・6項2号・3号） */
export const retirementDeduction = (years: number, disability: boolean): number => {
  const d = TAISHOKU_DEDUCTION;
  const y = Math.max(1, Math.floor(years));
  let v = y <= d.yearsThreshold ? d.perYear * y : d.base + d.perYearOver * (y - d.yearsThreshold);
  if (v < d.minimum) v = d.minimum;
  return disability ? v + d.disability : v;
};

/** 課税退職所得金額（1,000円未満の端数は切り捨て） */
export const taxableRetirementIncome = (amount: number, deduction: number, kind: RetirementKind): number => {
  const rest = Math.max(0, amount - deduction);
  const [hn, hd] = TAISHOKU_INCOME.half;
  const s = TAISHOKU_INCOME.short;
  const v = kind === "officer" ? rest
    : kind === "short" && rest > s.threshold ? s.base + (amount - (s.threshold + deduction))
    : Math.floor((rest * hn) / hd);
  return Math.floor(v / 1000) * 1000;
};

/** その年分の速算表（なければ null） */
export const quickTableOf = (year: number): TaishokuQuickTable | null => TAISHOKU_QUICK_TABLES.find((t) => t.year === year) ?? null;

/** 速算表の税額（1円未満の端数は切り捨て） */
export const retirementIncomeTax = (taxable: number, table: TaishokuQuickTable): number => {
  const b = table.brackets.find((x) => x.upTo === null || taxable <= x.upTo) ?? table.brackets[table.brackets.length - 1];
  const scaled = taxable * b.rate - b.deduction * 100; // ％を100倍した整数で計算する
  if (scaled <= 0) return 0;
  const [mn, md] = table.multiplier;
  return Math.floor((scaled * mn) / (100 * md));
};

/** 住民税（市町村民税・道府県民税。それぞれ100円未満の端数は切り捨て） */
export const retirementLocalTax = (taxable: number): { city: number; pref: number } => {
  const of = ([n, d]: readonly [number, number]) => Math.floor((taxable * n) / d / 100) * 100;
  return { city: of(TAISHOKU_LOCAL_RATES.city), pref: of(TAISHOKU_LOCAL_RATES.pref) };
};

/** 申告書を出していない人の所得税（支払金額 × 20.42％。1円未満の端数は切り捨て） */
export const noDeclarationTax = (amount: number): number => {
  const [n, d] = TAISHOKU_NO_DECLARATION_RATE;
  return Math.floor((amount * n) / d);
};

/** 区分の初めの値（役員：役員等勤続年数が5年以下なら特定役員。役員でない：勤続年数が5年以下なら短期） */
export const defaultRetirementKind = (years: number, executive: boolean, officerYears: number | null): RetirementKind =>
  executive
    ? ((officerYears ?? years) <= TAISHOKU_INCOME.officerYears ? "officer" : "general")
    : (years <= TAISHOKU_INCOME.short.years ? "short" : "general");

/** 源泉徴収票の区分の段（上段：申告書あり・他の退職手当等なし、中段：申告書あり・他の退職手当等あり、下段：申告書なし） */
export type RetirementSection = "upper" | "middle" | "lower";

export const RETIREMENT_SECTION_LABELS: Record<RetirementSection, string> = {
  upper: "上段（「退職所得の受給に関する申告書」あり。その年に支払済みの他の退職手当等なし）",
  middle: "中段（申告書あり。その年に支払済みの他の退職手当等あり）",
  lower: "下段（申告書なし。100分の20.42 で源泉徴収）",
};

export interface RetirementResult {
  year: number;
  section: RetirementSection;
  kind: RetirementKind;
  /** 勤続期間（年・月・日。期間が入っていなければ null） */
  period: { years: number; months: number; days: number; counted: number } | null;
  /** 計算に使った勤続年数（他の退職手当等があるときは合わせた勤続年数） */
  years: number;
  /** 退職所得控除額 */
  deduction: number;
  /** 退職所得控除額の計算に使った支払金額（他の退職手当等があるときは合計） */
  baseAmount: number;
  /** 課税退職所得金額（所得税・住民税の課税標準） */
  taxable: number;
  /** 源泉徴収税額 */
  incomeTax: number;
  /** 特別徴収税額 */
  cityTax: number;
  prefTax: number;
  /** 差引支給額（支払金額 − 所得税 − 住民税） */
  netPay: number;
  /** 源泉徴収票の摘要 */
  remarks: string[];
  notes: string[];
  /** 計算できないとき（保存できない） */
  error: string | null;
}

/**
 * 退職手当等の税額を計算する
 * @param year 年分（支払が確定した日の年）
 * @param amount 支払金額
 * @param executive 役員（法人税法の役員）か
 */
export const calcRetirement = (year: number, amount: number, executive: boolean, input: RetirementInput): RetirementResult => {
  const notes: string[] = [];
  const remarks: string[] = [];
  const period = servicePeriodOf(input.serviceFrom, input.serviceTo);
  const ownYears = input.yearsOverride ?? period?.counted ?? 0;
  const kind = input.kind ?? defaultRetirementKind(ownYears, executive, input.officerYears);
  const section: RetirementSection = !input.declared ? "lower" : input.other ? "middle" : "upper";
  const base = {
    year, section, kind, period, years: ownYears, deduction: 0, baseAmount: amount, taxable: 0,
    incomeTax: 0, cityTax: 0, prefTax: 0, netPay: amount, remarks, notes,
  };
  if (input.death) {
    notes.push("死亡退職で払う退職手当等は、相続税がかかるので、所得税・住民税を引きません。退職所得の源泉徴収票ではなく、" +
      "相続税法の「退職手当金等受給者別支払調書」を税務署に出します（Q では作りません）。");
    return { ...base, error: null };
  }
  if (ownYears <= 0) return { ...base, error: "勤続期間（就職年月日と退職年月日）か、勤続年数を入れてください。" };
  const table = quickTableOf(year);
  if (!table) {
    const years = TAISHOKU_QUICK_TABLES.map((t) => t.year);
    return { ...base, error: `${year}年分の「退職所得の源泉徴収税額の速算表」がありません（Q で計算できるのは ${years.join("年分・")}年分です）。` };
  }
  if (executive && input.officerYears !== null && input.officerYears < ownYears && input.officerYears <= TAISHOKU_INCOME.officerYears && kind !== "general") {
    notes.push("役員になる前に使用人として勤めた期間の分も含めて払う退職手当等は、一般退職手当等と特定役員退職手当等に分けて計算します" +
      "（国税庁 タックスアンサー No.2741）。Q ではこの計算をしないので、役員の期間の分だけを払うときに使ってください。");
  }
  if (input.other && !input.declared) notes.push("申告書を出していない人は、他の退職手当等と合わせて計算しません（申告書がないので、支払金額の20.42％を源泉徴収します）。");

  // 他の退職手当等（申告書に書いてあるとき）と合わせる
  const other = input.declared ? input.other : null;
  const combinedYears = other ? (input.combinedYears ?? Math.max(ownYears, other.years)) : ownYears;
  const baseAmount = amount + (other?.amount ?? 0);
  const deduction = input.deductionOverride ?? retirementDeduction(combinedYears, input.disability);
  const taxable = taxableRetirementIncome(baseAmount, deduction, kind);
  const local = retirementLocalTax(taxable);
  let incomeTax: number;
  let cityTax = local.city;
  let prefTax = local.pref;
  if (!input.declared) {
    incomeTax = noDeclarationTax(amount);
    notes.push("「退職所得の受給に関する申告書」を出していないので、所得税は支払金額の20.42％です（本人が確定申告で精算します）。" +
      "住民税は、申告書がなくても、この退職手当等の退職所得控除額を引いて計算します。");
  } else {
    incomeTax = retirementIncomeTax(taxable, table);
    if (other) {
      incomeTax = Math.max(0, incomeTax - other.incomeTax);
      cityTax = Math.max(0, cityTax - other.cityTax);
      prefTax = Math.max(0, prefTax - other.prefTax);
    }
  }
  if (input.disability) remarks.push("（障）");
  if (input.yearsOverride !== null && input.yearsNote.trim()) remarks.push(`勤続年数の計算の基礎：${input.yearsNote.trim()}`);
  if (input.deductionOverride !== null) {
    remarks.push(`退職所得控除額の計算の基礎：${input.deductionNote.trim() || "（書いてください）"}`);
    if (!input.deductionNote.trim()) notes.push("退職所得控除額を手で決めたときは、その計算の基礎（前の退職手当等の勤続期間・重複している期間など）を摘要に書きます。");
  }
  if (kind !== "general") {
    const y = kind === "officer" ? (input.officerYears ?? ownYears) : ownYears;
    const basis = period ? `${formatWareki(input.serviceFrom)}～${formatWareki(input.serviceTo)}（${servicePeriodLabel(period)}）` : "";
    const withBasis = basis && (kind === "short" || input.officerYears === null);
    remarks.push(`${RETIREMENT_KIND_LABELS[kind]} ${amount.toLocaleString()}円・${kind === "officer" ? "特定役員等勤続年数" : "短期勤続年数"} ${y}年${withBasis ? `（${basis}）` : ""}`);
  }
  if (other) {
    remarks.push(`支払済みの他の退職手当等：${other.payer.trim() || "（支払者）"} 支払金額 ${other.amount.toLocaleString()}円・勤続年数 ${other.years}年・` +
      `源泉徴収税額 ${other.incomeTax.toLocaleString()}円・特別徴収税額 市町村民税 ${other.cityTax.toLocaleString()}円 道府県民税 ${other.prefTax.toLocaleString()}円`);
    if (input.combinedYears === null) notes.push("他の退職手当等と合わせた勤続年数は、長い方の年数にしています。勤続期間が重なっていない部分があれば、その分を足した年数に直してください（所得税法施行令69条1項3号）。");
  }
  if (taxable === 0) notes.push("支払金額が退職所得控除額以下なので、課税退職所得金額は0円です（所得税・住民税はかかりません）。");
  const netPay = amount - incomeTax - cityTax - prefTax;
  return { ...base, years: combinedYears, deduction, baseAmount, taxable, incomeTax, cityTax, prefTax, netPay, error: null };
};

/** 退職所得控除額を源泉徴収票に書く形（万円。万円で割り切れなければ円） */
export const deductionLabel = (v: number) => (v % 10000 === 0 ? `${(v / 10000).toLocaleString()}万円` : `${v.toLocaleString()}円`);

/** 保存した退職手当等（retirement_allowances の行） */
export interface RetirementRecord {
  id: number;
  staffId: string;
  /** 支払う日（所得税の納付書・住民税の納入の月） */
  payDate: string;
  /** 支払が確定した日（年分） */
  fixedDate: string;
  amount: number;
  incomeTax: number;
  cityTax: number;
  prefTax: number;
  /** 住民税の納入先（その年の1月1日の住所の市区町村の団体コード） */
  municipality: string;
  input: RetirementInput;
}

/** 法定調書合計表の「2 退職所得の源泉徴収票合計表」（令和8年分から、Ⓐ と Ⓑ は同じ：すべての受給者の源泉徴収票を出す） */
export const retirementSummaryOf = (records: RetirementRecord[], year: number) => {
  const list = records.filter((r) => r.fixedDate.startsWith(`${year}-`) && !r.input.death);
  return {
    persons: new Set(list.map((r) => r.staffId)).size,
    amount: list.reduce((s, r) => s + r.amount, 0),
    tax: list.reduce((s, r) => s + r.incomeTax, 0),
  };
};
