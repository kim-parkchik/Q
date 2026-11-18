/**
 * 退職手当等の法定調書のうち、非居住者等の支払調書と、e-Tax で出す CSV
 *
 * ■ 非居住者等に支払われる給与、報酬、年金及び賞金の支払調書（非居住者に払った退職手当等。手引 第3章の注）
 *   欄は国税庁の様式（様式ID NTAOHSZ521010040）と記載要領（taishoku-tables/source/kisai_chousho27.pdf）による。
 *   ・「区分」は「退職手当等」、「支払金額」はその年中に支払が確定した国内源泉所得（居住者として勤務した期間に基因する部分）。
 *     まだ払っていないものは内書きする。「計算の基礎」には、その計算の基礎となる事項を書く
 *   ・「勤続年数」は、退職手当等の計算の基礎となった期間を基に、施行令69条・70条で計算した年数。施行令70条の適用があるときは、
 *     その期間と計算の基礎を「摘要」に書く。租税条約で軽減・免除されるときは、その旨を「摘要」に書く
 *   ・合計表の「退職手当等」の欄（utils/retirementIncome.ts の nonResidentSummaryOf）
 * ■ e-Tax の CSV（国税庁「レコードの内容及び記録要領」。項目の並び・全角か半角か・文字数は constants/taishoku.ts の ETAX_LAYOUTS。
 *   scripts/import_taishoku_tables.py で PDF から作ったもの）
 *   ・316 退職所得の源泉徴収票（e-Tax ソフト（WEB版）で読み込む）、325 退職手当金等受給者別支払調書・339 非居住者等に支払われる給与、
 *     報酬、年金及び賞金の支払調書（e-Tax ソフトで読み込む）。法定調書合計表は、e-Tax の画面で作る
 *   ・1行が調書1枚。項目はカンマで区切り、記録しない項目も区切りのカンマは省かない。見出しの行は書かない。最後の項目に書くことがなければ
 *     スペースを1つ書く（e-Tax「法定調書の作成・提出について」の留意事項と標準フォームの説明）
 *   ・半角のカンマは区切りだけに使う。全角の項目は、半角の英数字・記号・カナを全角にする。JIS 第1水準・第2水準にない字（外字等）は書けない
 *     （Q は、社会保険の届書の仕様書の2バイト文字の範囲（JIS X 0208 の非漢字・第1水準・第2水準）で確かめ、書けない字は知らせて直してもらう）
 *   ・整理番号1・整理番号2・提出者の住所と氏名は「記録を省略」。本支店等区分番号は、本店でまとめて出すときだけなので書かない。訂正表示は「0」
 *   ・年分・年月日は和暦の年・月・日を2桁ずつ（令和8年9月30日 → 08,09,30。元号は書かない）
 *   ・個人番号は12桁の前に「0」を付けた13桁。法人番号は13桁。マイナンバーは、事務取扱担当者が保存するときだけ書く
 *   ・文字コードはシフトJIS、行の終わりは CR LF（標準フォームを Excel の「CSV（カンマ区切り）」で保存したものと同じ）
 */
import { ETAX_LAYOUTS, TAISHOKU_NONRESIDENT_REPORT, type EtaxItem } from "../constants/taishoku";
import type { RetirementHeir, RetirementRecord, RetirementResult } from "./retirementIncome";
import { heirKeyOf, heirsOf, submittedHeirs } from "./retirementBenefitReport";
import { toZenkaku } from "./salaryPaymentReportCsv";
import { isShahoChar, SJIS_ALIASES } from "./shahoCsv";
import { encodeSjisText } from "./sjisText";
import { toWareki } from "./wareki";

export type EtaxCode = keyof typeof ETAX_LAYOUTS;

export const ETAX_TITLES: Record<EtaxCode, string> = {
  "316": "退職所得の源泉徴収票",
  "325": "退職手当金等受給者別支払調書",
  "339": "非居住者等に支払われる給与、報酬、年金及び賞金の支払調書",
};

/** 会社（提出義務者・支払者） */
export interface EtaxPayer {
  name: string;
  address: string;
  phone: string;
  corporateNumber: string;
}

/** 調書を作る人（従業員の画面の値） */
export interface EtaxPerson {
  name: string;
  deathDate: string;
}

// ── 非居住者等の支払調書 ─────────────────────────────

export interface NonResidentReport {
  /** 年分（支払が確定した年） */
  year: number;
  address: string;
  name: string;
  /** 区分（「退職手当等」） */
  kubun: string;
  /** 計算の基礎 */
  basis: string;
  /** 支払金額（国内源泉所得） */
  amount: number;
  /** 支払金額の内書き（まだ払っていない額） */
  unpaid: number;
  tax: number;
  taxAgent: { name: string; address: string };
  /** 退職所得控除額（万円） */
  deductionMan: number;
  years: number;
  serviceFrom: string;
  serviceTo: string;
  remarks: string;
}

/** 非居住者等の支払調書に書くこと（退職手当等の1枚） */
export const nonResidentReportOf = (r: RetirementRecord, person: EtaxPerson, result: RetirementResult): NonResidentReport => {
  const domestic = r.input.domesticAmount ?? r.amount;
  const basis = r.input.domesticBasis.trim()
    || (domestic < r.amount ? `総額${r.amount.toLocaleString()}円のうち居住者期間の勤務分` : "");
  return {
    year: Number(r.fixedDate.slice(0, 4)),
    address: r.input.address,
    name: person.name,
    kubun: TAISHOKU_NONRESIDENT_REPORT.kubun,
    basis,
    amount: domestic,
    unpaid: Math.min(domestic, r.input.unpaid ?? 0),
    tax: r.incomeTax,
    taxAgent: r.input.taxAgent,
    deductionMan: Math.floor(result.deduction / 10000),
    years: result.years,
    serviceFrom: r.input.serviceFrom,
    serviceTo: r.input.serviceTo,
    remarks: result.remarks.join("　"),
  };
};

// ── e-Tax の CSV ─────────────────────────────────────

/** 和暦の年・月・日（2桁ずつ。日付でなければ空） */
const ymd = (date: string | null | undefined): [string, string, string] => {
  const w = toWareki(date);
  if (!w) return ["", "", ""];
  const p = (n: number) => String(n).padStart(2, "0");
  return [p(w.year), p(w.month), p(w.day)];
};

/** 和暦の年（2桁） */
const eraYear = (year: number): string => ymd(`${year}-12-31`)[0];

/** 個人番号（12桁の前に「0」を付ける） */
const personalNumber = (v: string | null | undefined): string => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length === 12 ? `0${d}` : "";
};

/** 法人番号（13桁） */
const corporateNumber = (v: string | null | undefined): string => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length === 13 ? d : "";
};

/** 半角の項目にする（全角の英数字・記号は半角に） */
const toHankaku = (s: string): string => s.normalize("NFKC").replace(/[\r\n]/g, " ").trim();

/** 1つの項目の値を、全角・半角に合わせて書く形にする */
const cellOf = (item: EtaxItem, v: string | number | null | undefined): string => {
  const s = v === null || v === undefined ? "" : String(v);
  if (!item.zenkaku) return toHankaku(s);
  // 全角にして、同じ字の書き方が違うもの（〜 と ～ など）はシフトJISにある方にする
  const z = [...toZenkaku(s.trim())].map((c) => SJIS_ALIASES[c] ?? c).join("");
  return z.replace(/　+/g, "　").replace(/^　|　$/g, "");
};

/** 項目の値が、全角・半角・文字数に合っているか（合っていれば null） */
export const etaxItemProblem = (item: EtaxItem, value: string): string | null => {
  const chars = [...value];
  if (chars.length === 0) return null;
  if (item.fixed ? chars.length !== item.length : chars.length > item.length) {
    return `「${item.name}」は${item.length}文字${item.fixed ? "で" : "まで"}書きます（いまは${chars.length}文字）`;
  }
  if (item.zenkaku) {
    const bad = [...new Set(chars.filter((c) => !isShahoChar(c) || /[\x20-\x7E｡-ﾟ]/.test(c)))];
    return bad.length ? `「${item.name}」に、e-Tax で使えない字があります（${bad.join("")}）` : null;
  }
  const bad = [...new Set(chars.filter((c) => !/[\x20-\x7E]/.test(c) || c === ","))];
  return bad.length ? `「${item.name}」に、半角で書けない字があります（${bad.join("")}）` : null;
};

/** 1行（1枚）を作る。values は項番 → 値。直すところがあれば problems に入れる */
const recordOf = (code: EtaxCode, values: Record<number, string | number | null | undefined>, who: string, problems: string[]): string[] => {
  const items = ETAX_LAYOUTS[code];
  const cells = items.map((item) => {
    const v = cellOf(item, values[item.no]);
    const p = etaxItemProblem(item, v);
    if (p) problems.push(`${who}：${p}`);
    return v;
  });
  // 最後の項目に書くことがなければ、スペースを1つ書く
  if (cells[cells.length - 1] === "") cells[cells.length - 1] = " ";
  return cells;
};

/** 提出義務者の欄（項番 1〜10） */
const headOf = (code: EtaxCode, payer: EtaxPayer): Record<number, string> => ({
  1: code, 4: payer.address, 5: payer.name, 6: payer.phone, 10: "0",
});

export interface EtaxFile {
  code: EtaxCode;
  /** 1行ずつ（項目の配列） */
  rows: string[][];
  /** 直すところ（あれば保存しない） */
  problems: string[];
  /** 知らせること */
  notes: string[];
}

/**
 * 316 退職所得の源泉徴収票（その年分の、居住者に払った退職手当等。死亡退職・非居住者は除く）
 * @param numbers 従業員 → マイナンバー（書くときだけ。12桁）
 */
export const etax316Of = (
  records: { record: RetirementRecord; result: RetirementResult; person: EtaxPerson }[], payer: EtaxPayer, numbers: Record<string, string> | null,
): EtaxFile => {
  const problems: string[] = [];
  const notes: string[] = [];
  const rows = records.map(({ record: r, result, person }) => {
    const who = person.name || r.staffId;
    if (result.deduction % 10000 !== 0) problems.push(`${who}：退職所得控除額（${result.deduction.toLocaleString()}円）が万円で割り切れません（源泉徴収票の欄は万円です）`);
    if (r.input.unpaid) notes.push(`${who}：未払の額（${r.input.unpaid.toLocaleString()}円）の内書きは CSV に欄がないので、e-Tax の画面で入れてください。`);
    // 区分の段：上段（201条1項1号）・中段（1項2号）・下段（3項）
    const at = result.section === "upper" ? 15 : result.section === "middle" ? 19 : 23;
    const numberAt = result.section === "upper" ? 39 : result.section === "middle" ? 40 : 41;
    const [fy, fm, fd] = ymd(r.input.serviceFrom);
    const [ty, tm, td] = ymd(r.input.serviceTo);
    const v: Record<number, string | number | null> = {
      ...headOf("316", payer), 11: eraYear(Number(r.fixedDate.slice(0, 4))),
      12: r.input.address, 13: r.input.abroad ? "1" : "0", 14: person.name,
      [at]: r.amount, [at + 1]: r.incomeTax, [at + 2]: r.cityTax, [at + 3]: r.prefTax,
      27: result.deduction / 10000, 28: result.years, 29: fy, 30: fm, 31: fd, 32: ty, 33: tm, 34: td,
      35: r.input.position, 36: result.remarks.join("　"),
      37: corporateNumber(payer.corporateNumber), 38: numbers ? personalNumber(numbers[r.staffId]) : "",
      [numberAt]: r.input.slipNumber,
    };
    return recordOf("316", v, who, problems);
  });
  if (!corporateNumber(payer.corporateNumber)) notes.push("会社の法人番号が入っていないので、提出義務者の法人番号の欄が空です（会社の設定で入れてください）。");
  return { code: "316", rows, problems, notes };
};

/**
 * 325 退職手当金等受給者別支払調書（死亡退職。受給者ごとに1行。出さなくてよい受給者は除く。支払った月ごとに作る）
 * @param records その月に支払った死亡退職の退職手当等
 * @param numbers 従業員 → 退職者のマイナンバー（書くときだけ）
 */
export const etax325Of = (
  records: { record: RetirementRecord; person: EtaxPerson }[], payer: EtaxPayer, submitDate: string, numbers: Record<string, string> | null,
): EtaxFile => {
  const problems: string[] = [];
  const notes: string[] = ["受給者（相続人など）の個人番号は Q に残さないので、e-Tax ソフトで入れてください。"];
  const rows: string[][] = [];
  const all = records.map((x) => x.record);
  for (const { record: r, person } of records) {
    const submitted = submittedHeirs(all, r.payDate.slice(0, 7));
    const heirs = heirsOf(r).filter((h: RetirementHeir, i) => submitted.has(heirKeyOf(r, h, i)));
    heirs.forEach((h, i) => {
      const who = `${person.name || r.staffId}（受給者 ${h.name || i + 1}）`;
      const [ry, rm, rd] = ymd(r.input.serviceTo);
      const [py, pm, pd] = ymd(r.payDate);
      const [dy, dm, dd] = ymd(person.deathDate);
      const [sy, sm, sd] = ymd(submitDate);
      const v: Record<number, string | number | null> = {
        ...headOf("325", payer),
        11: r.input.address, 12: r.input.abroad ? "1" : "0", 13: person.name,
        14: h.address, 15: h.abroad ? "1" : "0", 16: h.name,
        17: r.input.benefitKind, 18: h.amount, 19: ry, 20: rm, 21: rd, 22: r.input.position, 23: h.relation,
        24: py, 25: pm, 26: pd, 27: dy, 28: dm, 29: dd, 30: sy, 31: sm, 32: sd,
        34: corporateNumber(payer.corporateNumber), 36: numbers ? personalNumber(numbers[r.staffId]) : "",
      };
      rows.push(recordOf("325", v, who, problems));
    });
  }
  return { code: "325", rows, problems, notes };
};

/** 339 非居住者等に支払われる給与、報酬、年金及び賞金の支払調書（その年分の、非居住者に払った退職手当等） */
export const etax339Of = (
  records: { record: RetirementRecord; result: RetirementResult; person: EtaxPerson }[], payer: EtaxPayer, numbers: Record<string, string> | null,
): EtaxFile => {
  const problems: string[] = [];
  const notes: string[] = [];
  const rows = records.map(({ record: r, result, person }) => {
    const who = person.name || r.staffId;
    const rep = nonResidentReportOf(r, person, result);
    if (result.deduction % 10000 !== 0) problems.push(`${who}：退職所得控除額（${result.deduction.toLocaleString()}円）が万円で割り切れません（支払調書の欄は万円です）`);
    const [fy, fm, fd] = ymd(rep.serviceFrom);
    const [ty, tm, td] = ymd(rep.serviceTo);
    const v: Record<number, string | number | null> = {
      ...headOf("339", payer), 11: eraYear(rep.year),
      12: rep.address, 13: r.input.abroad ? "1" : "0", 14: r.input.domesticTaxPlace, 15: rep.name,
      16: rep.kubun, 17: rep.basis, 18: rep.amount, 19: rep.unpaid || "", 20: rep.tax,
      36: rep.taxAgent.address, 37: rep.taxAgent.name,
      38: rep.deductionMan, 39: rep.years, 40: fy, 41: fm, 42: fd, 43: ty, 44: tm, 45: td,
      46: rep.remarks, 47: corporateNumber(payer.corporateNumber), 48: numbers ? personalNumber(numbers[r.staffId]) : "",
    };
    return recordOf("339", v, who, problems);
  });
  return { code: "339", rows, problems, notes };
};

/** ファイルにする（シフトJIS・CR LF。書けない字があれば知らせる） */
export const encodeEtaxFile = (file: EtaxFile): { bytes: Uint8Array; unknown: string[] } =>
  encodeSjisText(file.rows.map((r) => r.join(",")).join("\r\n") + "\r\n");
