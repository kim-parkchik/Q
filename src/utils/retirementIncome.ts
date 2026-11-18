/**
 * 退職手当等（退職金）に対する所得税（源泉徴収税額）と住民税（特別徴収税額）
 *
 * 数値（退職所得控除額・2分の1・短期退職手当等の300万円と150万円・5年・住民税の税率・速算表・20.42％・前の退職手当等と重なる期間を数える年数・
 * 区分の違う退職手当等の控除額の係数・源泉徴収票の④番号）は、scripts/import_taishoku_tables.py で法令の XML と国税庁の PDF・HTML から作った
 * constants/taishoku.ts を使う。
 * 決まりは、国税庁 タックスアンサー No.2732「退職手当等に対する源泉徴収」・No.2741「同じ年に一般退職手当等のほか、短期退職手当等や
 * 特定役員退職手当等がある場合」（令和8年4月1日現在法令等）、所得税法30条・201条、所得税法施行令69条・70条、地方税法50条の3〜50条の6・
 * 328条〜328条の6、20条の4の2、「令和8年分 給与所得の源泉徴収票等の法定調書の作成と提出の手引」第3章（退職所得の源泉徴収票・特別徴収票）による。
 *
 * ■ 勤続年数：就職の日から退職の日まで引き続き勤務した期間の年数。1年未満の端数は1年にする（所得税法施行令69条2項）。
 *   一時勤務しなかった期間・前の勤務先の期間を含めるとき、前に退職手当等を受けた期間を除くときなどは、画面で勤続年数を直す。
 *   その年に2つ以上の退職手当等があるときは、いちばん長い勤続期間に、それと重なっていない期間を足した期間の年数（No.2741）
 * ■ 退職所得控除額：勤続年数20年以下は 40万円 × 勤続年数、20年超は 800万円 ＋ 70万円 ×（勤続年数 − 20年）。80万円未満なら80万円。
 *   障害者になったことが直接の原因で退職したときは100万円を加える（所得税法30条3項・6項）。
 *   前年以前に退職手当等を受けているとき（30条6項1号・施行令70条）は、次の額を引く（引いた額が80万円未満なら80万円）。
 *   ・前の勤務先の期間・前に退職手当等を払った期間を、今回の勤続期間に含めたとき（施行令70条1項1号）：その期間の年数で計算した額
 *   ・前年以前4年内（令和8年以後に確定拠出年金の一時金を受けたときは、令和8年以後に受けた分は9年内。その年に確定拠出年金の一時金を
 *     受けるときは19年内）に受けた退職手当等の勤続期間等と重なるとき（1項2号）：重なっている期間の年数で計算した額。
 *     前の退職手当等の収入金額がその退職所得控除額に満たないときは、前の勤続期間等を「収入金額 ÷ 40万円」年（800万円を超えるときは
 *     「（収入金額 − 800万円）÷ 70万円 ＋ 20」年。1未満の端数は切り捨て）に短くする（2項）。期間の1年未満の端数は切り捨て（3項）
 * ■ 課税退職所得金額（1,000円未満の端数は切り捨て。タックスアンサー No.2732 の注1・国税通則法118条1項）
 *   ・一般退職手当等：（収入金額 − 退職所得控除額）× 1/2
 *   ・短期退職手当等（役員等以外の人で、勤続年数5年以下）：残額が300万円以下なら × 1/2、超えるなら 150万円 ＋（収入金額 −（300万円 ＋ 退職所得控除額））
 *   ・特定役員退職手当等（役員等としての勤続年数5年以下の役員等）：収入金額 − 退職所得控除額（1/2 にしない）
 *   同じ年に区分の違う退職手当等があるとき（No.2741・所得税法施行令71条の2）は、特定役員・短期の控除額を 40万円 ×（その勤続年数 − 重複勤続年数）＋
 *   20万円 × 重複勤続年数（3つの区分があるときは、全重複期間の年数に14万円・13万円）で出し、全体の退職所得控除額の残りを一般（一般がなければ短期）の
 *   控除額にして、区分ごとに計算した額を足す。前年以前の退職手当等と重なるときは、特定役員・短期の控除額から、その勤続期間のうち前の退職手当等と重なる
 *   期間などで計算した額を引く（11項・12項）。収入金額がその区分の控除額に満たないときは、満たない部分を、2つの区分ならもう一方の残額から全部、
 *   3つの区分ならほかの2つの区分の残額から2分の1ずつ（一方が足りなければ、足りない分をもう一方から）引く（1項・3項・5項・9項。短期の300万円の判定は、
 *   2つの区分では引いたあとの残額、3つの区分では引く前の残額でする）
 * ■ 所得税（「退職所得の受給に関する申告書」を出している人）：速算表で（課税退職所得金額 × 税率 − 控除額）× 102.1％、1円未満は切り捨て。
 *   申告書に、その年に支払済みの他の退職手当等があると書いてあるときは、合計額で計算した税額から、他の退職手当等で徴収された税額を引く
 *   （所得税法201条1項2号）。申告書を出していない人は、支払金額 × 20.42％（1円未満は切り捨て。201条3項）
 * ■ 住民税：課税退職所得金額（千円未満切り捨て。地方税法20条の4の2第1項）× 6％（市町村民税）・4％（道府県民税）、
 *   それぞれ100円未満は切り捨て（20条の4の2第3項）。申告書を出していない人も、その支払う退職手当等で計算する（他の退職手当等は合わせない。
 *   地方税法328条の6第2項・50条の6第2項）。納めるのは、支払を受けるべき日の属する年の1月1日の住所の市区町村（328条）
 * ■ 死亡退職で払う退職手当等は、相続税がかかり所得税はかからない（源泉徴収しない。退職所得の源泉徴収票ではなく、
 *   相続税法の「退職手当金等受給者別支払調書」を出す。utils/retirementBenefitReport.ts）ので、税額を0にする
 * ■ 非居住者に払う退職手当等：居住者として勤務した期間に基因する部分（国内源泉所得）× 20％（所得税法212条・213条1項1号）× 102.1％。
 *   1円未満は切り捨て。退職所得の受給に関する申告書（居住者が出すもの。203条）・退職所得控除額は使わない。住民税の分離課税は、所得税法199条で
 *   所得税を徴収する（居住者に払う）退職手当等だけなのでかからない（地方税法328条）。源泉徴収票ではなく「非居住者等に支払われる給与、報酬、
 *   年金及び賞金の支払調書」を出す（手引 第3章。utils/retirementReports.ts）。支払調書の退職所得控除額・勤続年数は居住者と同じに計算する
 * ■ 居住者でも、その年の1月1日に国内に住所がなかった人は、住民税を課す市町村がないので、住民税はかからない（地方税法328条）
 */
import dayjs from "dayjs";
import {
  TAISHOKU_DEDUCTION, TAISHOKU_INCOME, TAISHOKU_LOCAL_RATES, TAISHOKU_LOCAL_SCOPE, TAISHOKU_MIXED, TAISHOKU_NO_DECLARATION_RATE, TAISHOKU_NONRESIDENT,
  TAISHOKU_OVERLAP_RULE, TAISHOKU_QUICK_TABLES, TAISHOKU_ROUND_UP_YEARS, TAISHOKU_SLIP_NUMBERS, type TaishokuQuickTable,
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
  /** 区分（この退職手当等と区分が違えば、区分ごとに分けて計算する） */
  kind: RetirementKind;
  /** 勤続期間（入れれば、合わせた勤続年数と、区分の違う期間の重なりを計算する） */
  from: string;
  to: string;
  /** その退職手当等の勤続年数（勤続期間を入れないとき） */
  years: number;
  /** 確定拠出年金（企業型・個人型）の老齢給付金の一時金 */
  dc: boolean;
  /** 源泉徴収税額（所得税及び復興特別所得税） */
  incomeTax: number;
  /** 特別徴収税額 */
  cityTax: number;
  prefTax: number;
  /** 支払を受けた年月日（申告書の E 欄。所得税法施行規則77条1項4号） */
  paidOn: string;
  /** 支払者の所在地（申告書の E 欄） */
  payerAddress: string;
}

/** この退職手当等のうち、区分ごとの部分（使用人としての期間の分と、役員等としての期間の分に分けて払うときなど） */
export interface RetirementPart {
  kind: RetirementKind;
  amount: number;
  /** その部分の勤続期間 */
  from: string;
  to: string;
}

/** 申告書に書いてある、前年以前に支払を受けた退職手当等（退職所得控除額から、勤続期間が重なる分を引く。所得税法施行令70条） */
export interface PriorRetirement {
  /** 支払者の氏名又は名称 */
  payer: string;
  /** 支払を受けた日 */
  paidOn: string;
  /** 収入金額 */
  amount: number;
  /** その退職手当等の勤続期間等（確定拠出年金の一時金は、掛金を出した期間など） */
  from: string;
  to: string;
  /** 確定拠出年金（企業型・個人型）の老齢給付金の一時金 */
  dc: boolean;
  /** その期間を今回の勤続期間に含めた（前の勤務先の期間を通算した・前に払った退職手当等の期間を含めて計算した。施行令70条1項1号） */
  included: boolean;
  /** その退職手当等の区分（今回の勤続期間に含めた前の退職手当等が短期・特定役員のとき、区分の違う退職手当等の控除額から引く。施行令71条の2 11項・12項） */
  kind: RetirementKind;
  /** 支払者の所在地・源泉徴収税額（申告書の E 欄。計算には使わない） */
  payerAddress: string;
  incomeTax: number | null;
}

/** 死亡退職の退職手当等を受ける人（相続人など。退職手当金等受給者別支払調書は1人1枚） */
export interface RetirementHeir {
  name: string;
  address: string;
  /** 受給者と退職者との続柄 */
  relation: string;
  amount: number;
  /** 支払調書を出さない（null なら、受給者の額が出さなくてよい額（相続税法施行規則30条3項）以下のとき。合計表の「支払総額」には入れる） */
  omit: boolean | null;
  /** 住所が国外（e-Tax の CSV の「国外住所表示」） */
  abroad: boolean;
}

/** 非居住者の退職手当等の支払調書の納税管理人 */
export interface TaxAgent {
  name: string;
  address: string;
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
  /** 区分ごとに分けて払う（空なら、全額を1つの区分で） */
  parts: RetirementPart[];
  /** 「退職所得の受給に関する申告書」を出している */
  declared: boolean;
  /** 障害者になったことが直接の原因で退職した */
  disability: boolean;
  /** 退職所得控除額を手で決める（null なら計算） */
  deductionOverride: number | null;
  /** 手で決めた退職所得控除額の計算の基礎（摘要に書く） */
  deductionNote: string;
  /** 申告書に書いてある、その年に支払済みの他の退職手当等 */
  others: OtherRetirement[];
  /** 他の退職手当等と合わせた勤続年数を手で決める（null なら勤続期間から。期間がなければ長い方の年数） */
  combinedYears: number | null;
  /** 申告書に書いてある、前年以前に支払を受けた退職手当等 */
  priors: PriorRetirement[];
  /** 死亡退職（相続税がかかる。源泉徴収しない） */
  death: boolean;
  /** 死亡退職：退職手当金等の種類（退職金・功労金など。支払調書に書く） */
  benefitKind: string;
  /** 死亡退職：受給者（空なら、支払金額の全部を1人が受ける） */
  heirs: RetirementHeir[];
  /** 源泉徴収票を作る日に、まだ払っていない額（⑤支払金額に内書きする） */
  unpaid: number | null;
  /** 未払のため、まだ源泉徴収していない所得税（摘要に書く） */
  unwithheldTax: number | null;
  /** 源泉徴収票の④番号（空なら書かない） */
  slipNumber: string;
  /** ④番号が5〜7のときの経済的利益の価額（摘要に書く） */
  economicBenefit: number | null;
  /** 源泉徴収票に書く：役職名（退職時） */
  position: string;
  /** 源泉徴収票に書く：住所又は居所（作る日の現況。初めは従業員の住所） */
  address: string;
  /** 源泉徴収票に書く：その年の1月1日の住所 */
  januaryAddress: string;
  /** 源泉徴収票・支払調書に書く住所が国外（e-Tax の CSV の「国外住所表示」） */
  abroad: boolean;
  /** その年の1月1日に国内に住所がなかった（居住者でも、住民税はかからない。地方税法328条） */
  noJanuaryAddress: boolean;
  /** 非居住者に払う（所得税法212条・213条。源泉徴収票ではなく、非居住者等に支払われる給与、報酬、年金及び賞金の支払調書） */
  nonResident: boolean;
  /** 非居住者：居住者として勤務した期間に基因する部分（国内源泉所得。null なら支払金額の全部） */
  domesticAmount: number | null;
  /** 非居住者：国内源泉所得の計算の基礎（支払調書の「計算の基礎」） */
  domesticBasis: string;
  /** 非居住者：国内の納税地（e-Tax の CSV） */
  domesticTaxPlace: string;
  /** 非居住者：納税管理人 */
  taxAgent: TaxAgent;
  /** 非居住者：租税条約で軽減・免除されるときなどの摘要 */
  treatyNote: string;
}

export const emptyRetirementInput = (): RetirementInput => ({
  serviceFrom: "", serviceTo: "", yearsOverride: null, yearsNote: "", kind: null, officerYears: null, parts: [],
  declared: true, disability: false, deductionOverride: null, deductionNote: "", others: [], combinedYears: null, priors: [],
  death: false, benefitKind: "退職金", heirs: [], unpaid: null, unwithheldTax: null, slipNumber: "", economicBenefit: null, position: "", address: "", januaryAddress: "",
  abroad: false, noJanuaryAddress: false, nonResident: false, domesticAmount: null, domesticBasis: "", domesticTaxPlace: "", taxAgent: { name: "", address: "" }, treatyNote: "",
});

export const emptyOtherRetirement = (): OtherRetirement => ({
  payer: "", amount: 0, kind: "general", from: "", to: "", years: 0, dc: false, incomeTax: 0, cityTax: 0, prefTax: 0, paidOn: "", payerAddress: "",
});

export const emptyPriorRetirement = (): PriorRetirement => ({
  payer: "", paidOn: "", amount: 0, from: "", to: "", dc: false, included: false, kind: "general", payerAddress: "", incomeTax: null,
});

export const emptyRetirementHeir = (): RetirementHeir => ({ name: "", address: "", relation: "", amount: 0, omit: null, abroad: false });

const int = (v: unknown): number => Math.max(0, Math.floor(Number(v) || 0));
const intOrNull = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : int(v));
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const kindOf = (v: unknown): RetirementKind | null => (v === "general" || v === "short" || v === "officer" ? v : null);
const objects = (v: unknown): any[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
const SLIP_CODES = new Set(TAISHOKU_SLIP_NUMBERS.map((x) => x.code));

const otherOf = (o: any): OtherRetirement => ({
  payer: str(o.payer), amount: int(o.amount), kind: kindOf(o.kind) ?? "general", from: str(o.from), to: str(o.to), years: int(o.years),
  dc: !!o.dc, incomeTax: int(o.incomeTax), cityTax: int(o.cityTax), prefTax: int(o.prefTax), paidOn: str(o.paidOn), payerAddress: str(o.payerAddress),
});

export const parseRetirementInput = (v: unknown): RetirementInput => {
  const base = emptyRetirementInput();
  if (typeof v !== "string" || !v.trim()) return base;
  try {
    const x = JSON.parse(v) ?? {};
    // 前の形（他の退職手当等を1つだけ持つ other）も読む
    const others = [...objects(x.others), ...(x.other && typeof x.other === "object" ? [x.other] : [])].map(otherOf);
    return {
      serviceFrom: str(x.serviceFrom), serviceTo: str(x.serviceTo),
      yearsOverride: intOrNull(x.yearsOverride), yearsNote: str(x.yearsNote),
      kind: kindOf(x.kind),
      officerYears: intOrNull(x.officerYears),
      parts: objects(x.parts).map((p) => ({ kind: kindOf(p.kind) ?? "general", amount: int(p.amount), from: str(p.from), to: str(p.to) })),
      declared: x.declared !== false, disability: !!x.disability,
      deductionOverride: intOrNull(x.deductionOverride), deductionNote: str(x.deductionNote),
      others,
      combinedYears: intOrNull(x.combinedYears),
      priors: objects(x.priors).map((p) => ({
        payer: str(p.payer), paidOn: str(p.paidOn), amount: int(p.amount), from: str(p.from), to: str(p.to), dc: !!p.dc, included: !!p.included,
        kind: kindOf(p.kind) ?? "general", payerAddress: str(p.payerAddress), incomeTax: intOrNull(p.incomeTax),
      })),
      death: !!x.death,
      benefitKind: typeof x.benefitKind === "string" ? x.benefitKind : base.benefitKind,
      heirs: objects(x.heirs).map((h) => ({
        name: str(h.name), address: str(h.address), relation: str(h.relation), amount: int(h.amount),
        omit: typeof h.omit === "boolean" ? h.omit : null, abroad: !!h.abroad,
      })),
      unpaid: intOrNull(x.unpaid), unwithheldTax: intOrNull(x.unwithheldTax),
      slipNumber: SLIP_CODES.has(str(x.slipNumber)) ? str(x.slipNumber) : "",
      economicBenefit: intOrNull(x.economicBenefit),
      position: str(x.position), address: str(x.address), januaryAddress: str(x.januaryAddress),
      abroad: !!x.abroad, noJanuaryAddress: !!x.noJanuaryAddress, nonResident: !!x.nonResident,
      domesticAmount: intOrNull(x.domesticAmount), domesticBasis: str(x.domesticBasis), domesticTaxPlace: str(x.domesticTaxPlace),
      taxAgent: { name: str(x.taxAgent?.name), address: str(x.taxAgent?.address) }, treatyNote: str(x.treatyNote),
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

/** 1円未満を含むことがある額（「12,345.5円」） */
const yenLabel = (v: number) => `${v.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}円`;

/** 「19年8か月20日」 */
export const servicePeriodLabel = (p: { years: number; months: number; days: number }) =>
  `${p.years}年${p.months ? `${p.months}か月` : ""}${p.days ? `${p.days}日` : ""}`;

// ---------- 期間（初めの日と終わりの日を含む。日の通し番号で持つ） ----------
export type Range = [number, number];
const DAY_MS = 86_400_000;
const dayNo = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))) / DAY_MS;
const dateOfDay = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
export const rangeOf = (from: string, to: string): Range[] => (isDate(from) && isDate(to) && from <= to ? [[dayNo(from), dayNo(to)]] : []);

/** 重なる・つながる期間をまとめて、初めの日の順に並べる */
export const mergeRanges = (list: Range[]): Range[] => {
  const out: Range[] = [];
  for (const r of [...list].sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
};

export const intersectRanges = (a: Range[], b: Range[]): Range[] => {
  const out: Range[] = [];
  for (const x of a) for (const y of b) {
    const s = Math.max(x[0], y[0]);
    const e = Math.min(x[1], y[1]);
    if (s <= e) out.push([s, e]);
  }
  return mergeRanges(out);
};

export const subtractRanges = (a: Range[], b: Range[]): Range[] => {
  let cur = mergeRanges(a);
  for (const y of mergeRanges(b)) {
    const next: Range[] = [];
    for (const x of cur) {
      if (y[1] < x[0] || y[0] > x[1]) { next.push(x); continue; }
      if (x[0] < y[0]) next.push([x[0], y[0] - 1]);
      if (y[1] < x[1]) next.push([y[1] + 1, x[1]]);
    }
    cur = next;
  }
  return cur;
};

/** 期間の長さ（年・月・日）。いくつかに分かれているときは、月と日を足す（日は30日で1か月にする） */
const lengthOf = (ranges: Range[]) => {
  const list = mergeRanges(ranges);
  if (list.length === 1) {
    const p = servicePeriodOf(dateOfDay(list[0][0]), dateOfDay(list[0][1]))!;
    return { years: p.years, months: p.months, days: p.days };
  }
  let months = 0;
  let days = 0;
  for (const [s, e] of list) {
    const p = servicePeriodOf(dateOfDay(s), dateOfDay(e))!;
    months += p.years * 12 + p.months;
    days += p.days;
  }
  months += Math.floor(days / 30);
  return { years: Math.floor(months / 12), months: months % 12, days: days % 30 };
};

/** 年数（1年未満の端数は1年。期間がなければ0） */
export const ceilYears = (ranges: Range[]) => {
  if (ranges.length === 0) return 0;
  const l = lengthOf(ranges);
  return l.years + (l.months > 0 || l.days > 0 ? 1 : 0);
};

/** 年数（1年未満の端数は切り捨て。施行令70条3項） */
export const floorYears = (ranges: Range[]) => (ranges.length === 0 ? 0 : lengthOf(ranges).years);

export const rangesLabel = (ranges: Range[]) =>
  mergeRanges(ranges).map(([s, e]) => `${formatWareki(dateOfDay(s))}～${formatWareki(dateOfDay(e))}`).join("・");

/** 「令和5年4月1日～令和8年3月31日（3年）」（計算の基礎として摘要に書く） */
const rangesBasis = (ranges: Range[]) => `${rangesLabel(ranges)}（${servicePeriodLabel(lengthOf(ranges))}）`;

// ---------- 退職所得控除額 ----------

/** 所得税法30条3項の額（80万円の下限・障害者の100万円は入れない。年数が0なら0） */
export const basicDeduction = (years: number): number => {
  const d = TAISHOKU_DEDUCTION;
  const y = Math.max(0, Math.floor(years));
  return y <= d.yearsThreshold ? d.perYear * y : d.base + d.perYearOver * (y - d.yearsThreshold);
};

/** 「40万円 × 7年」「800万円 ＋ 70万円 ×（25年 − 20年）」 */
const basicFormula = (years: number) => {
  const d = TAISHOKU_DEDUCTION;
  const man = (v: number) => `${(v / 10000).toLocaleString()}万円`;
  return years <= d.yearsThreshold
    ? `${man(d.perYear)} × ${years}年`
    : `${man(d.base)} ＋ ${man(d.perYearOver)} ×（${years}年 − ${d.yearsThreshold}年）`;
};

/** 退職所得控除額（所得税法30条3項・6項。reduction は前年以前の退職手当等と重なる分として引く額） */
export const retirementDeduction = (years: number, disability: boolean, reduction = 0): number => {
  const d = TAISHOKU_DEDUCTION;
  const v = Math.max(d.minimum, basicDeduction(Math.max(1, Math.floor(years))) - reduction);
  return disability ? v + d.disability : v;
};

/** 前年以前の退職手当等と重なる分（施行令70条）の内訳 */
export interface PriorOverlapRow {
  /** included：今回の勤続期間に含めた前の退職手当等の期間（1項1号）、overlap：重なっている期間（1項2号） */
  type: "included" | "overlap";
  priors: PriorRetirement[];
  /** 数えた期間（2号は、短くしたあとの前の勤続期間等と、今回の勤続期間等が重なっている部分） */
  period: string;
  /** 年数（1年未満の端数は切り捨て） */
  years: number;
  /** 退職所得控除額から引く額 */
  amount: number;
}

/**
 * 前年以前の退職手当等と重なる分として、退職所得控除額から引く額（所得税法施行令70条）
 * @param year 年分
 * @param current その年の退職手当等の勤続期間等
 * @param currentDc その年に確定拠出年金の一時金も受ける（1項2号ハ）
 */
export const priorOverlapOf = (year: number, current: Range[], priors: PriorRetirement[], currentDc: boolean) => {
  const R = TAISHOKU_OVERLAP_RULE;
  const D = TAISHOKU_DEDUCTION;
  const rows: PriorOverlapRow[] = [];
  const notes: string[] = [];
  const errors: string[] = [];
  /** 今回の勤続期間に含めた前の退職手当等の期間（前の退職手当等の区分ごと。施行令71条の2 11項1号・12項1号） */
  const includedByKind: Record<RetirementKind, Range[]> = { officer: [], short: [], general: [] };
  /** 重なる期間を数える前の勤続期間等（2項で短くしたあと。11項2号・12項2号） */
  let overlapSpan: Range[] = [];
  const label = (p: PriorRetirement) => p.payer.trim() || "名前を入れていない支払者";
  for (const p of priors) {
    if (!rangeOf(p.from, p.to).length) errors.push(`前年以前の退職手当等（${label(p)}）の勤続期間等の初めの日と終わりの日を入れてください。`);
    else if (!p.included && !isDate(p.paidOn)) errors.push(`前年以前の退職手当等（${label(p)}）の支払を受けた日を入れてください。`);
    else if (!p.included && Number(p.paidOn.slice(0, 4)) >= year) {
      errors.push(`${label(p)}の退職手当等は${year}年以後に支払を受けています。その年に受けた退職手当等は「その年に支払済みの他の退職手当等」に入れてください。`);
    }
  }
  if (errors.length) return { reduction: 0, rows, notes, errors, includedByKind, overlapSpan };

  // 1号：今回の勤続期間に含めた前の退職手当等の期間
  const included = priors.filter((p) => p.included);
  for (const p of included) includedByKind[p.kind] = mergeRanges([...includedByKind[p.kind], ...rangeOf(p.from, p.to)]);
  if (included.length) {
    const span = mergeRanges(included.flatMap((p) => rangeOf(p.from, p.to)));
    const years = floorYears(span);
    rows.push({ type: "included", priors: included, period: rangesLabel(span), years, amount: basicDeduction(years) });
  }

  // 2号：その年の前年以前の決まった年数のうちに受けた退職手当等（イ・ロ・ハ）
  const within = (p: PriorRetirement, n: number) => { const y = Number(p.paidOn.slice(0, 4)); return y >= year - n && y <= year - 1; };
  const rest = priors.filter((p) => !p.included);
  const dcAfter = rest.some((p) => p.dc && p.paidOn >= R.dcSince && within(p, R.dcPriorYears));
  const target = rest.filter((p) => currentDc ? within(p, R.dcCurrentYears)
    : dcAfter ? within(p, p.paidOn >= R.dcSince ? R.dcPriorYears : R.priorYears)
    : within(p, R.priorYears));
  const outside = rest.filter((p) => !target.includes(p));
  if (outside.length) {
    const window = currentDc ? `${R.dcCurrentYears}年内`
      : dcAfter ? `${R.dcPriorYears}年内。${formatWareki(R.dcSince)}より前に受けたものは${R.priorYears}年内` : `${R.priorYears}年内`;
    notes.push(`${outside.map(label).join("・")}の退職手当等は、重なる期間を数える年（その年の前年以前${window}）より前に受けているので、退職所得控除額から引きません。`);
  }
  if (target.length) {
    // 前の退職手当等の収入金額がその退職所得控除額に満たないときは、前の勤続期間等を短くする（2項）
    const spans: Range[] = [];
    for (const p of target) {
      const [r] = rangeOf(p.from, p.to);
      const own = basicDeduction(ceilYears([r]));
      if (p.amount >= own) { spans.push(r); continue; }
      const n = p.amount <= D.base ? Math.floor(p.amount / D.perYear) : Math.floor((p.amount - D.base) / D.perYearOver) + D.yearsThreshold;
      const end = n > 0 ? dayNo(dayjs(p.from).add(n, "year").subtract(1, "day").format("YYYY-MM-DD")) : r[0] - 1;
      if (end >= r[0]) spans.push([r[0], Math.min(r[1], end)]);
      notes.push(`${label(p)}の退職手当等の収入金額（${p.amount.toLocaleString()}円）は、その退職所得控除額（${own.toLocaleString()}円）に満たないので、` +
        `前の勤続期間等を${n}年（${n > 0 ? `${formatWareki(p.from)}～${formatWareki(dateOfDay(Math.min(r[1], end)))}` : "なし"}）にして数えます（施行令70条2項）。`);
    }
    overlapSpan = mergeRanges(spans);
    if (current.length === 0) {
      notes.push("今回の勤続期間（就職年月日と退職年月日）が入っていないので、前の退職手当等と重なる期間を数えられません。");
    } else {
      const overlap = intersectRanges(current, overlapSpan);
      if (overlap.length) {
        const years = floorYears(overlap);
        rows.push({ type: "overlap", priors: target, period: rangesLabel(overlap), years, amount: basicDeduction(years) });
      }
    }
  }
  return { reduction: rows.reduce((s, r) => s + r.amount, 0), rows, notes, errors, includedByKind, overlapSpan };
};

/** 区分の違う退職手当等の、特定役員・短期の控除額から引く額の内訳（施行令71条の2 11項・12項） */
export interface MixedPriorCut {
  kind: "officer" | "short";
  /** included：今回の勤続期間に含めた前の退職手当等（同じ区分のもの）の期間（1号）、overlap：前の勤続期間等と重なっている期間（2号） */
  type: "included" | "overlap";
  period: string;
  /** 年数（1年未満の端数は切り捨て） */
  years: number;
  amount: number;
}

/**
 * 前年以前の退職手当等と重なるときに、特定役員退職所得控除額・短期退職所得控除額から引く額（施行令71条の2 11項・12項）
 * 1号：今回の勤続期間に含めた前の退職手当等が同じ区分（短期・特定役員）のとき、その区分の勤続期間のうち、その前の退職手当等の期間で計算した額
 * 2号：その区分の勤続期間が、前の勤続期間等（施行令70条1項2号。2項で短くしたあと）と重なっているとき、重なっている期間で計算した額
 */
export const mixedPriorCutsOf = (
  spans: Record<RetirementKind, Range[]>, prior: { includedByKind: Record<RetirementKind, Range[]>; overlapSpan: Range[] },
): MixedPriorCut[] => {
  const out: MixedPriorCut[] = [];
  for (const kind of ["officer", "short"] as const) {
    if (!spans[kind].length) continue;
    for (const [type, other] of [["included", prior.includedByKind[kind]], ["overlap", prior.overlapSpan]] as const) {
      const common = intersectRanges(spans[kind], other);
      const years = floorYears(common);
      if (years > 0) out.push({ kind, type, period: rangesLabel(common), years, amount: basicDeduction(years) });
    }
  }
  return out;
};

// ---------- 課税退職所得金額 ----------

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

/** 区分の違う退職手当等の、区分ごとの額（タックスアンサー No.2741） */
export interface MixedRow {
  kind: RetirementKind;
  /** 収入金額 */
  amount: number;
  /** その区分の勤続期間（短期勤続年数・特定役員等勤続年数など） */
  years: number;
  /** 重複勤続年数（3つの区分があるときは、全重複期間を除いた期間の年数） */
  overlapYears: number;
  /** 全重複勤続年数（3つの区分があるときだけ） */
  fullOverlapYears: number;
  /** その区分の退職所得控除額（前年以前の退職手当等と重なる分を引いたあと） */
  deduction: number;
  /** 前年以前の退職手当等と重なる分として、この区分の控除額から引いた額（施行令71条の2 11項・12項） */
  priorCut: number;
  /** 収入金額がこの区分の控除額に満たない部分（ほかの区分の残額から引く） */
  shortfall: number;
  /** ほかの区分の満たない部分のうち、この区分の残額から引いた額（1円未満を含むことがある） */
  absorbed: number;
  /** その区分の退職所得（1/2 をかけたあと。1円未満を含むことがある） */
  income: number;
}

const KIND_ORDER: RetirementKind[] = ["officer", "short", "general"];

/**
 * 区分の違う退職手当等の控除額と退職所得（タックスアンサー No.2741・所得税法施行令71条の2）
 * @param amounts 区分ごとの収入金額
 * @param spans 区分ごとの勤続期間
 * @param base 全体の勤続年数で計算した退職所得控除額
 * @param priorCut 前年以前の退職手当等と重なる分として、特定役員・短期の控除額から引く額（11項・12項。mixedPriorCutsOf）
 */
export const mixedRetirementIncome = (
  amounts: Record<RetirementKind, number>, spans: Record<RetirementKind, Range[]>, base: number,
  priorCut: { officer: number; short: number } = { officer: 0, short: 0 },
) => {
  const M = TAISHOKU_MIXED;
  const S = TAISHOKU_INCOME.short;
  const [hn, hd] = TAISHOKU_INCOME.half;
  const [sn, sd] = M.shortfallShare;
  const present = KIND_ORDER.filter((k) => amounts[k] > 0);
  const years = (k: RetirementKind) => ceilYears(spans[k]);
  const ded: Record<RetirementKind, number> = { officer: 0, short: 0, general: 0 };
  const ov: Record<RetirementKind, number> = { officer: 0, short: 0, general: 0 };
  const cut: Record<RetirementKind, number> = { officer: 0, short: 0, general: 0 };
  let full = 0;
  if (present.length === 3) {
    const F = intersectRanges(intersectRanges(spans.general, spans.short), spans.officer);
    full = ceilYears(F);
    for (const k of ["officer", "short"] as const) {
      const others = KIND_ORDER.filter((x) => x !== k);
      const both = mergeRanges(others.flatMap((o) => intersectRanges(spans[k], spans[o])));
      ov[k] = ceilYears(subtractRanges(both, F));
      const v = M.base * Math.max(0, years(k) - (ov[k] + full)) + M.overlap * ov[k] + (k === "officer" ? M.officerFullOverlap : M.shortFullOverlap) * full;
      cut[k] = Math.min(v, priorCut[k]);
      ded[k] = v - cut[k];
    }
    ded.general = Math.max(0, base - ded.officer - ded.short);
  } else if (present.length === 2) {
    // 特定役員があれば特定役員、なければ短期の控除額を出し、全体の控除額の残りをもう1つの区分にする
    const first = present.includes("officer") ? "officer" : "short";
    const second = present.find((k) => k !== first)!;
    ov[first] = ceilYears(intersectRanges(spans[first], spans[second]));
    ov[second] = ov[first];
    const v = M.base * Math.max(0, years(first) - ov[first]) + M.overlap * ov[first];
    cut[first] = Math.min(v, priorCut[first]);
    ded[first] = v - cut[first];
    ded[second] = Math.max(0, base - ded[first]);
  }

  // 残額と満たない部分。1/2 と、満たない部分の2分の1の端数が出るので、U 分の1円の整数で数える
  const U = sd * hd;
  const rest: Record<RetirementKind, number> = { officer: 0, short: 0, general: 0 };
  const lack: Record<RetirementKind, number> = { officer: 0, short: 0, general: 0 };
  const absorbed: Record<RetirementKind, number> = { officer: 0, short: 0, general: 0 };
  for (const k of present) {
    const v = (amounts[k] - ded[k]) * U;
    rest[k] = Math.max(0, v);
    lack[k] = Math.max(0, -v);
  }
  const threshold = S.threshold * U;
  let shortOver = false;
  if (present.length === 2) {
    // 満たない部分の全部を、もう一方の残額から引く（1項・3項・5項）。短期の300万円の判定は、引いたあとの残額でする
    const [a, b] = present;
    const ca = Math.min(rest[a], lack[b]);
    const cb = Math.min(rest[b], lack[a]);
    rest[a] -= ca;
    rest[b] -= cb;
    absorbed[a] = ca;
    absorbed[b] = cb;
    shortOver = rest.short > threshold;
    if (shortOver) rest.short -= threshold; // 短期の「ロ」：収入金額 −（300万円 ＋ 控除額）の残額
  } else if (present.length === 3) {
    // 短期の300万円の判定は、引く前の残額でする（7項2号）。満たない部分の2分の1ずつを、ほかの2つの区分の残額から引く（9項。一方が
    // 足りなければ、足りない分をもう一方から引く）。短期の「ロ」の残額は、収入金額 −（300万円 ＋ 控除額）
    shortOver = rest.short > threshold;
    if (shortOver) rest.short -= threshold;
    const order: [RetirementKind, RetirementKind, RetirementKind][] = [["officer", "short", "general"], ["short", "officer", "general"], ["general", "officer", "short"]];
    for (const [s, a, b] of order) {
      if (!lack[s]) continue;
      const half = (lack[s] * sn) / sd;
      const ca = Math.min(rest[a], half + Math.max(0, half - rest[b]));
      const cb = Math.min(rest[b], half + Math.max(0, half - rest[a]));
      rest[a] -= ca;
      rest[b] -= cb;
      absorbed[a] += ca;
      absorbed[b] += cb;
    }
  }
  const incomeU = (k: RetirementKind) =>
    k === "officer" ? rest[k]
    : k === "short" && shortOver ? S.base * U + rest[k]
    : (rest[k] * hn) / hd;
  const rows: MixedRow[] = present.map((k) => ({
    kind: k, amount: amounts[k], years: years(k), overlapYears: ov[k], fullOverlapYears: present.length === 3 ? full : 0,
    deduction: ded[k], priorCut: cut[k], shortfall: lack[k] / U, absorbed: absorbed[k] / U, income: incomeU(k) / U,
  }));
  // 合計してから1,000円未満を切り捨てる
  const total = present.reduce((s, k) => s + incomeU(k), 0);
  const taxable = Math.max(0, Math.floor(total / U / 1000) * 1000);
  return { rows, taxable };
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
  /** 区分（区分ごとに分けて払うときは、いちばん大きい部分の区分） */
  kind: RetirementKind;
  /** 勤続期間（年・月・日。期間が入っていなければ null） */
  period: { years: number; months: number; days: number; counted: number } | null;
  /** 計算に使った勤続年数（他の退職手当等があるときは合わせた勤続年数） */
  years: number;
  /** 退職所得控除額 */
  deduction: number;
  /** 前年以前の退職手当等と重なる分として、退職所得控除額から引いた額と内訳 */
  overlapReduction: number;
  overlaps: PriorOverlapRow[];
  /** 区分の違う退職手当等があるときの区分ごとの額（なければ null） */
  mixed: MixedRow[] | null;
  /** 前年以前の退職手当等と重なる分として、特定役員・短期の控除額から引いた額の内訳（施行令71条の2 11項・12項） */
  mixedCuts: MixedPriorCut[];
  /** 重なる期間を数える前年以前の退職手当等の勤続期間（施行令70条2項で短くしたあと。申告書の⑥）と、今回の勤続期間と重なる期間（⑦） */
  priorSpan: Range[];
  overlapRanges: Range[];
  /** 非居住者に払う退職手当等（源泉徴収票ではなく、非居住者等の支払調書） */
  nonResident: boolean;
  /** 非居住者：国内源泉所得（源泉徴収の対象） */
  domesticAmount: number;
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

interface Piece { kind: RetirementKind; amount: number; ranges: Range[]; years: number }

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
  const parts = input.parts.filter((p) => p.amount > 0);
  const partRanges = mergeRanges(parts.flatMap((p) => rangeOf(p.from, p.to)));
  const ownYears = input.yearsOverride ?? (parts.length ? ceilYears(partRanges) || period?.counted : period?.counted) ?? 0;
  const autoKind = input.kind ?? defaultRetirementKind(ownYears, executive, input.officerYears);
  const kind = parts.length ? [...parts].sort((a, b) => b.amount - a.amount)[0].kind : autoKind;
  // 非居住者は申告書を出さない（203条は居住者）ので、他の退職手当等と合わせない
  const others = input.declared && !input.nonResident ? input.others : [];
  const section: RetirementSection = !input.declared ? "lower" : input.others.length ? "middle" : "upper";
  const base = {
    year, section, kind, period, years: ownYears, deduction: 0, overlapReduction: 0, overlaps: [] as PriorOverlapRow[], mixed: null,
    mixedCuts: [] as MixedPriorCut[], priorSpan: [] as Range[], overlapRanges: [] as Range[], nonResident: input.nonResident && !input.death, domesticAmount: 0,
    baseAmount: amount, taxable: 0, incomeTax: 0, cityTax: 0, prefTax: 0, netPay: amount, remarks, notes,
  };
  if (input.death) {
    notes.push("死亡退職で払う退職手当等は、相続税がかかるので、所得税・住民税を引きません。退職所得の源泉徴収票ではなく、" +
      "相続税法の「退職手当金等受給者別支払調書」を税務署に出します（この画面の下で作れます）。");
    return { ...base, error: null };
  }
  if (ownYears <= 0) return { ...base, error: "勤続期間（就職年月日と退職年月日）か、勤続年数を入れてください。" };
  const table = quickTableOf(year);
  if (!table) {
    const years = TAISHOKU_QUICK_TABLES.map((t) => t.year);
    return { ...base, error: `${year}年分の「退職所得の源泉徴収税額の速算表」がありません（Q で計算できるのは ${years.join("年分・")}年分です）。` };
  }
  if (parts.length) {
    const sum = parts.reduce((s, p) => s + p.amount, 0);
    if (sum !== amount) return { ...base, error: `区分ごとの額の合計（${sum.toLocaleString()}円）が、支払金額（${amount.toLocaleString()}円）と合いません。` };
    if (parts.some((p) => !rangeOf(p.from, p.to).length)) return { ...base, error: "区分ごとに分けて払うときは、それぞれの部分の勤続期間（初めの日と終わりの日）を入れてください。" };
  } else if (executive && input.officerYears !== null && input.officerYears < ownYears && input.officerYears <= TAISHOKU_INCOME.officerYears && kind !== "general") {
    notes.push("役員になる前に使用人として勤めた期間の分も含めて払う退職手当等は、使用人としての期間の分と、役員等としての期間の分" +
      "（特定役員退職手当等）に分けて計算します（国税庁 タックスアンサー No.2741）。「区分ごとに分けて払う」に、それぞれの額と期間を入れてください。");
  }
  if (input.others.length && input.nonResident) notes.push("非居住者は「退職所得の受給に関する申告書」を出さないので、他の退職手当等と合わせて計算しません。");
  else if (input.others.length && !input.declared) notes.push("申告書を出していない人は、他の退職手当等と合わせて計算しません（申告書がないので、支払金額の20.42％を源泉徴収します）。");

  // この退職手当等と、申告書に書いてある他の退職手当等を、区分ごとの部分にする
  const ownRanges = parts.length ? partRanges : rangeOf(input.serviceFrom, input.serviceTo);
  const pieces: Piece[] = parts.length
    ? parts.map((p) => ({ kind: p.kind, amount: p.amount, ranges: rangeOf(p.from, p.to), years: ceilYears(rangeOf(p.from, p.to)) }))
    : [{ kind, amount, ranges: ownRanges, years: ownYears }];
  for (const o of others) {
    const r = rangeOf(o.from, o.to);
    pieces.push({ kind: o.kind, amount: o.amount, ranges: r, years: r.length ? ceilYears(r) : o.years });
  }
  const kinds = new Set(pieces.filter((p) => p.amount > 0).map((p) => p.kind));
  const mixed = kinds.size >= 2;
  if (mixed && pieces.some((p) => p.amount > 0 && p.ranges.length === 0)) {
    return { ...base, error: "区分の違う退職手当等があるときは、他の退職手当等の勤続期間（初めの日と終わりの日）も入れてください（重なる期間を数えます）。" };
  }

  // 勤続年数：いちばん長い勤続期間に、重なっていない期間を足す（期間がない他の退職手当等は年数で比べる）
  const allRanges = mergeRanges(pieces.flatMap((p) => p.ranges));
  const noRange = pieces.filter((p) => p.ranges.length === 0);
  const autoYears = input.yearsOverride !== null
    ? Math.max(ownYears, ...others.map((o) => (rangeOf(o.from, o.to).length ? ceilYears(rangeOf(o.from, o.to)) : o.years)))
    : Math.max(ceilYears(allRanges), ...noRange.map((p) => p.years));
  const totalYears = others.length ? (input.combinedYears ?? autoYears) : ownYears;
  if (others.length && input.combinedYears === null && others.some((o) => !rangeOf(o.from, o.to).length)) {
    notes.push("勤続期間を入れていない他の退職手当等は、勤続年数の長い方にしています。勤続期間を入れると、重なっていない期間を足して勤続年数を出します。");
  }

  // 前年以前の退職手当等と重なる分（申告書に書いてあるとき。非居住者は、支払調書の退職所得控除額・勤続年数を施行令70条で計算するので入れる）
  const prior = input.deductionOverride === null
    ? priorOverlapOf(year, allRanges, input.declared || input.nonResident ? input.priors : [], others.some((o) => o.dc))
    : {
      reduction: 0, rows: [] as PriorOverlapRow[], notes: [] as string[], errors: [] as string[],
      includedByKind: { officer: [], short: [], general: [] } as Record<RetirementKind, Range[]>, overlapSpan: [] as Range[],
    };
  if (prior.errors.length) return { ...base, error: prior.errors.join("\n") };
  notes.push(...prior.notes);
  if (input.priors.length && !input.declared && !input.nonResident) notes.push("申告書を出していない人は、前年以前の退職手当等と重なる分を退職所得控除額から引きません。");
  const reduction = prior.reduction;
  const spansOf = () => ({ priorSpan: prior.overlapSpan, overlapRanges: allRanges.length ? intersectRanges(allRanges, prior.overlapSpan) : [] });
  const deduction = input.deductionOverride ?? retirementDeduction(totalYears, input.disability, reduction);
  const baseAmount = pieces.reduce((s, p) => s + p.amount, 0);

  // 課税退職所得金額
  let taxable: number;
  let mixedRows: MixedRow[] | null = null;
  let mixedCuts: MixedPriorCut[] = [];
  if (mixed) {
    const amounts: Record<RetirementKind, number> = { officer: 0, short: 0, general: 0 };
    const spans: Record<RetirementKind, Range[]> = { officer: [], short: [], general: [] };
    for (const p of pieces) { amounts[p.kind] += p.amount; spans[p.kind] = mergeRanges([...spans[p.kind], ...p.ranges]); }
    // 前年以前の退職手当等と重なるときは、特定役員・短期の控除額から引く（施行令71条の2 11項・12項。控除額を手で決めたときは引かない）
    mixedCuts = input.deductionOverride === null ? mixedPriorCutsOf(spans, prior) : [];
    const sumCut = (k: "officer" | "short") => mixedCuts.filter((c) => c.kind === k).reduce((s, c) => s + c.amount, 0);
    const m = mixedRetirementIncome(amounts, spans, deduction, { officer: sumCut("officer"), short: sumCut("short") });
    for (const r of m.rows.filter((x) => x.shortfall > 0)) {
      const to = m.rows.filter((x) => x.absorbed > 0).map((x) => `${RETIREMENT_KIND_LABELS[x.kind]}の残額から ${yenLabel(x.absorbed)}`).join("・");
      notes.push(`${RETIREMENT_KIND_LABELS[r.kind]}の収入金額（${r.amount.toLocaleString()}円）がその控除額（${r.deduction.toLocaleString()}円）に満たないので、` +
        `満たない部分（${r.shortfall.toLocaleString()}円）を${to || "ほかの区分の残額から"}引きました（所得税法施行令71条の2）。`);
    }
    taxable = m.taxable;
    mixedRows = m.rows;
  } else {
    taxable = taxableRetirementIncome(baseAmount, deduction, [...kinds][0] ?? kind);
  }

  // 税額
  const local = retirementLocalTax(taxable);
  let incomeTax: number;
  let cityTax = local.city;
  let prefTax = local.pref;
  const domestic = input.domesticAmount ?? amount;
  if (input.nonResident) {
    // 国内源泉所得 × 20％ × 102.1％（所得税法213条1項1号。1円未満は切り捨て）。住民税はかからない（地方税法328条）
    if (domestic > amount) return { ...base, error: `国内源泉所得の額（${domestic.toLocaleString()}円）が、支払金額より大きくなっています。` };
    const [rn, rd] = TAISHOKU_NONRESIDENT.rate;
    const [mn, md] = table.multiplier;
    incomeTax = Math.floor((domestic * rn * mn) / (rd * md));
    if (TAISHOKU_LOCAL_SCOPE.residentOnly) {
      cityTax = 0;
      prefTax = 0;
    }
    notes.push(`非居住者に払う退職手当等なので、居住者として勤務した期間の分（国内源泉所得 ${domestic.toLocaleString()}円）の` +
      `${(rn * 100) / rd}％ × ${(mn * 100) / md}％ を源泉徴収します（所得税法212条・213条）。住民税（分離課税）はかかりません（地方税法328条）。` +
      "退職所得の源泉徴収票ではなく「非居住者等に支払われる給与、報酬、年金及び賞金の支払調書」を出し、所得税は「非居住者・外国法人の所得についての" +
      "所得税徴収高計算書（納付書）」で、徴収した月の翌月" + `${TAISHOKU_NONRESIDENT.dueDay}日まで（国外で払うときは翌月末日まで）に納めます。` +
      "本人は、確定申告で、居住者として計算した税額との差の精算を受けられることがあります（退職所得の選択課税）。");
    if (input.domesticAmount === null) notes.push("国内源泉所得を支払金額の全部にしています。非居住者として勤務した期間（海外勤務など）があるときは、居住者として勤務した期間の分の額を入れてください。");
  } else if (!input.declared) {
    incomeTax = noDeclarationTax(amount);
    notes.push("「退職所得の受給に関する申告書」を出していないので、所得税は支払金額の20.42％です（本人が確定申告で精算します）。" +
      "住民税は、申告書がなくても、この退職手当等の退職所得控除額を引いて計算します。");
  } else {
    incomeTax = retirementIncomeTax(taxable, table);
    if (others.length) {
      incomeTax = Math.max(0, incomeTax - others.reduce((s, o) => s + o.incomeTax, 0));
      cityTax = Math.max(0, cityTax - others.reduce((s, o) => s + o.cityTax, 0));
      prefTax = Math.max(0, prefTax - others.reduce((s, o) => s + o.prefTax, 0));
    }
  }
  if (input.noJanuaryAddress && !input.nonResident && (cityTax || prefTax)) {
    cityTax = 0;
    prefTax = 0;
    notes.push(`${year}年${TAISHOKU_LOCAL_SCOPE.month}月${TAISHOKU_LOCAL_SCOPE.day}日に国内に住所がなかった人なので、住民税（分離課税）を課す市町村がなく、` +
      "住民税はかかりません（地方税法328条）。");
  }

  // 前年以前の退職手当等と重なる分の摘要（源泉徴収票：手引 第3章 ⑩摘要の (5)(6)、非居住者等の支払調書：記載要領 2(6)）
  const priorRemarks = () => prior.rows.map((r) => {
    const who = r.priors.map((p) => `${p.payer.trim() || "（支払者）"}${r.type === "overlap" ? ` ${formatWareki(p.paidOn)}支払・収入金額 ${p.amount.toLocaleString()}円` : ""}`).join("、");
    return r.type === "included"
      ? `前の退職手当等の期間を今回の計算の基礎に含めた：${who}の期間 ${r.period}（${r.years}年）・退職所得控除額から ${r.amount.toLocaleString()}円（${basicFormula(r.years)}）を引いた`
      : `勤続期間等が前の退職手当等（${who}）と重複：${r.period}（${r.years}年）・退職所得控除額から ${r.amount.toLocaleString()}円（${basicFormula(r.years)}）を引いた`;
  });
  if (input.unpaid && input.unpaid > amount) return { ...base, error: "未払の額が支払金額より大きくなっています。" };
  if (input.nonResident) {
    // 非居住者等の支払調書の摘要：施行令70条の計算の基礎（2(6)）、租税条約などで軽減・免除されるとき（2(8)）
    if (input.yearsOverride !== null && input.yearsNote.trim()) remarks.push(`勤続年数の計算の基礎：${input.yearsNote.trim()}`);
    if (input.deductionOverride !== null) remarks.push(`退職所得控除額の計算の基礎：${input.deductionNote.trim() || "（書いてください）"}`);
    else remarks.push(...priorRemarks());
    if (input.treatyNote.trim()) remarks.push(input.treatyNote.trim());
    return {
      ...base, years: totalYears, deduction, overlapReduction: reduction, overlaps: prior.rows, mixed: mixedRows, mixedCuts, ...spansOf(),
      baseAmount, taxable: 0, incomeTax, cityTax, prefTax, netPay: amount - incomeTax, domesticAmount: domestic, error: null,
    };
  }

  // 摘要（手引 第3章 ⑩摘要の (1)〜(7)）
  const slip = TAISHOKU_SLIP_NUMBERS.find((x) => x.code === input.slipNumber);
  if (slip?.benefit) {
    if (input.economicBenefit === null) notes.push(`④番号が「${slip.code}」のときは、摘要に経済的利益の価額を書きます（入れてください）。`);
    else remarks.push(`経済的利益の価額 ${input.economicBenefit.toLocaleString()}円`);
  }
  if (input.yearsOverride !== null && input.yearsNote.trim()) remarks.push(`勤続年数の計算の基礎：${input.yearsNote.trim()}`);
  if (others.length && input.yearsOverride === null && input.combinedYears === null && others.every((o) => rangeOf(o.from, o.to).length)) {
    remarks.push(`勤続年数の計算の基礎：${rangesBasis(allRanges)}`);
  }
  const ownPiece = (k: RetirementKind) => pieces.slice(0, parts.length || 1).filter((p) => p.kind === k);
  for (const k of ["short", "officer"] as const) {
    for (const p of ownPiece(k)) {
      const y = !parts.length && k === "officer" ? (input.officerYears ?? p.years) : p.years;
      const basis = p.ranges.length ? rangesBasis(p.ranges) : "";
      const withBasis = basis && (parts.length || k === "short" || input.officerYears === null);
      remarks.push(`${RETIREMENT_KIND_LABELS[k]} ${p.amount.toLocaleString()}円・${k === "officer" ? "特定役員等勤続年数" : "短期勤続年数"} ${y}年${withBasis ? `（${basis}）` : ""}`);
    }
  }
  for (const o of others) {
    remarks.push(`支払済みの他の退職手当等：${o.payer.trim() || "（支払者）"} 支払金額 ${o.amount.toLocaleString()}円・勤続年数 ${o.years || ceilYears(rangeOf(o.from, o.to))}年・` +
      `源泉徴収税額 ${o.incomeTax.toLocaleString()}円・特別徴収税額 市町村民税 ${o.cityTax.toLocaleString()}円 道府県民税 ${o.prefTax.toLocaleString()}円` +
      (mixed && o.kind !== "general" ? `（${RETIREMENT_KIND_LABELS[o.kind]}・${o.kind === "officer" ? "特定役員等勤続年数" : "短期勤続年数"} ${ceilYears(rangeOf(o.from, o.to))}年（${rangesBasis(rangeOf(o.from, o.to))}））` : ""));
  }
  if (mixedRows) {
    // 2つの区分は先に控除額を出した区分（特定役員か短期）に1行、3つの区分は特定役員と短期に1行ずつ
    const r3 = mixedRows.length === 3;
    for (const r of (r3 ? mixedRows.filter((x) => x.kind !== "general") : mixedRows.slice(0, 1)).filter((x) => x.overlapYears > 0 || x.fullOverlapYears > 0)) {
      remarks.push(`${RETIREMENT_KIND_LABELS[r.kind]}の重複勤続年数 ${r.overlapYears}年${r3 ? `・全重複勤続年数 ${r.fullOverlapYears}年` : ""}`);
    }
  }
  if (input.deductionOverride !== null) {
    remarks.push(`退職所得控除額の計算の基礎：${input.deductionNote.trim() || "（書いてください）"}`);
    if (!input.deductionNote.trim()) notes.push("退職所得控除額を手で決めたときは、その計算の基礎（前の退職手当等の勤続期間・重複している期間など）を摘要に書きます。");
  } else {
    remarks.push(...priorRemarks());
    // 前の退職手当等に短期・特定役員退職手当等が含まれる・短期勤続期間などが前の退職手当等と重複するとき（(5) の注1・注3、(6) の注）
    for (const c of mixedCuts) {
      const ded = c.kind === "officer" ? "特定役員退職所得控除額" : "短期退職所得控除額";
      const span = c.kind === "officer" ? "特定役員等勤続期間" : "短期勤続期間";
      remarks.push(c.type === "included"
        ? `${span}のうち前の退職手当等（${RETIREMENT_KIND_LABELS[c.kind]}）の期間 ${c.period}（${c.years}年）・${ded}から ${c.amount.toLocaleString()}円（${basicFormula(c.years)}）を引いた`
        : `${span}が前の退職手当等と重複：${c.period}（${c.years}年）・${ded}から ${c.amount.toLocaleString()}円（${basicFormula(c.years)}）を引いた`);
    }
  }
  if (input.disability) remarks.push("（障）");
  if (input.unpaid && input.unwithheldTax) remarks.push(`未徴収税額 ${input.unwithheldTax.toLocaleString()}円`);
  if (input.unpaid && input.unwithheldTax === null) notes.push("未払の分の所得税をまだ源泉徴収していないときは、その未徴収税額を入れてください（摘要に書きます）。");

  if (taxable === 0) notes.push("支払金額が退職所得控除額以下なので、課税退職所得金額は0円です（所得税・住民税はかかりません）。");
  const netPay = amount - incomeTax - cityTax - prefTax;
  return {
    ...base, years: totalYears, deduction, overlapReduction: reduction, overlaps: prior.rows, mixed: mixedRows, mixedCuts, ...spansOf(),
    baseAmount, taxable, incomeTax, cityTax, prefTax, netPay, error: null,
  };
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

/** 法定調書合計表の「2 退職所得の源泉徴収票合計表」（令和8年分から、Ⓐ と Ⓑ は同じ：すべての受給者の源泉徴収票を出す。非居住者は入れない） */
export const retirementSummaryOf = (records: RetirementRecord[], year: number) => {
  const list = records.filter((r) => r.fixedDate.startsWith(`${year}-`) && !r.input.death && !r.input.nonResident);
  return {
    persons: new Set(list.map((r) => r.staffId)).size,
    amount: list.reduce((s, r) => s + r.amount, 0),
    tax: list.reduce((s, r) => s + r.incomeTax, 0),
  };
};

/**
 * 非居住者等に支払われる給与、報酬、年金及び賞金の支払調書合計表の「退職手当等」の行（課税分。すべての受給者の支払調書を出すとき）
 * 支払金額は、支払調書と同じく国内源泉所得の額（内書きのまだ払っていない額も、国内源泉所得の額まで）
 */
export const nonResidentSummaryOf = (records: RetirementRecord[], year: number) => {
  const list = records.filter((r) => r.fixedDate.startsWith(`${year}-`) && !r.input.death && r.input.nonResident);
  const domesticOf = (r: RetirementRecord) => Math.min(r.amount, r.input.domesticAmount ?? r.amount);
  return {
    persons: new Set(list.map((r) => r.staffId)).size,
    amount: list.reduce((s, r) => s + domesticOf(r), 0),
    unpaid: list.reduce((s, r) => s + Math.min(domesticOf(r), r.input.unpaid ?? 0), 0),
    tax: list.reduce((s, r) => s + r.incomeTax, 0),
  };
};
