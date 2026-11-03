/**
 * 給与支払報告書（個人別明細書）を、eLTAX の PCdesk に取り込む CSV にする
 *
 * ■ 形式：地方税共同機構「給与支払報告書CSVレイアウト仕様書（総務省通知形式）　令和07年分～」（146項目。
 *   項目の並びは constants/salaryPaymentReportCsvLayout.ts。仕様書の Excel から自動生成）
 *   令和8年分も、この形式の CSV を PCdesk に取り込んで出す（地方税共同機構「手続き別ガイド 給与支払報告書提出」1.0版 2026年9月 1.11・2章）
 * ■ ファイルの決まり
 *   ・1行に1人。項目名の行は付けない。値を "" で囲まない
 *     （地方税共同機構「CSVファイルの取り込みによる給与支払報告書の作成でエラーとなっている利用者様へ」3・21ページ）
 *   ・値の中にカンマ・「@」は使えない（区切り文字として扱うため。地方税共同機構「XML構造仕様(詳細)」CSVファイルレイアウト仕様書の文字属性の凡例）
 *     → 全角の項目は全角の「，」「＠」にする
 *   ・文字の形式は UTF-8（eLTAX「eLTAXで利用できる文字について」：使える形式は SJIS と UTF-8。
 *     https://www.eltax.lta.go.jp/eltax/chuuijikou/moji/ ）。保存は utils/fileSaveUtils.ts（BOM 付き）
 *   ・♂ ♀ ℃ ☆ ★ ⌒ Å ♯ ♭ ♪ の10文字は使えない（同ページ）
 *   ・いくつかの市区町村の分を1つのファイルにまとめてよい。1つの市区町村には、指定番号を1つだけ書く（上の資料13・17ページ）
 *   ・受給者のフリガナは半角カナ（仕様書 項番137）。配偶者・扶養親族のフリガナは全角（項番96など）
 * ■ マイナンバー（個人番号）は、「マイナンバー」の画面で登録した番号を書く（事務取扱担当者が書き出すときだけ。utils/myNumber.ts）。
 *   PCdesk では、CSV から作った個人別明細書を後から直せない（手続き別ガイド 2章）ので、番号は CSV に入れる。
 *   5人目からの扶養親族の番号（項番132・133）は書かない
 * ■ 年末調整をしない人（年の途中で退職した人・乙欄の人）の控除対象配偶者の有無は、Q では分からないので空にする（源泉徴収票と同じ）
 */
import { SALARY_REPORT_CSV_FIELDS } from "../constants/salaryPaymentReportCsvLayout";
import { familyKey, SELF_KEY } from "./myNumber";
import type { ReportPerson } from "./salaryPaymentReport";
import type { SlipPerson, WithholdingSlip } from "./withholdingSlip";
import { toWareki, type Wareki } from "./wareki";

export interface ReportCsvCompany {
  name?: string | null;
  address?: string | null;
  phone?: string | null;
  /** 法人番号（13桁。マイナンバーではないので書く） */
  corporateNumber?: string | null;
}

export interface ReportCsvPerson {
  /** 出す人・出す先・徴収のしかた（utils/salaryPaymentReport.ts） */
  report: ReportPerson;
  /** 源泉徴収票と同じ中身（utils/withholdingSlip.ts） */
  slip: WithholdingSlip;
  /** 受給者番号（従業員ID） */
  staffNumber: string;
  /** 出す先の市区町村の指定番号（空なら書かない） */
  designationNumber: string;
  /** まだ CSV に入れられない理由（年末調整がまだ など。空なら入れられる） */
  notReady?: string;
  /** 登録したマイナンバー（キーは utils/myNumber.ts の SELF_KEY・familyKey）。事務取扱担当者が書き出すときだけ渡す。渡さなければ欄は空 */
  myNumbers?: Record<string, string>;
}

export interface ReportCsvResult {
  /** CSV の中身（BOM は保存するときに付ける）。会社の情報に誤りがあれば空 */
  csv: string;
  /** CSV に入れた人数・市区町村の数・本人のマイナンバーを書いた人数 */
  count: number;
  municipalities: number;
  myNumbers: number;
  /** 会社の情報の誤り（あれば CSV を作らない） */
  errors: string[];
  /** 出す人のうち、直すところがあって CSV に入れなかった人 */
  skipped: { name: string; reasons: string[] }[];
  /** CSV には入れたが、知らせておくこと */
  notes: string[];
}

const FIELD_COUNT = SALARY_REPORT_CSV_FIELDS.length;

/** 使えない10文字（Å は、オングストロームの記号と A の上に輪のある文字の両方） */
const BANNED = /[♂♀℃☆★⌒ÅÅ♯♭♪]/u;

/** 受給者番号に使えない文字（特別徴収税額通知を eLTAX で受け取るとき。仕様書の注※2）。カンマ・@ も使えない */
const STAFF_NUMBER_BANNED = /[\\/:*?"'|#%^`~_<>[\]{},@]/;

const ERA_CODE: Record<string, string> = { 昭和: "1", 大正: "2", 明治: "3", 平成: "4", 令和: "5" };

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * 全角にする（全角の項目に書く文字）。半角の英数字・記号・スペースは全角に、半角カナは全角カナにする。改行は全角スペースに
 */
export const toZenkaku = (s: string): string =>
  s
    .replace(/\r?\n/g, " ")
    .replace(/[｡-ﾟ]+/g, (k) => k.normalize("NFKC"))
    .replace(/[\x21-\x7E]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0))
    .replace(/ /g, "　");

/** ひらがなをカタカナに */
const toKatakana = (s: string) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

/** フリガナを全角カタカナに（配偶者・扶養親族のフリガナ） */
export const toZenkakuKatakana = (s: string): string => toZenkaku(toKatakana(s));

const FULL_KANA = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンァィゥェォャュョッー・「」、。ヮヵヶヰヱ";
const HALF_KANA = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝｧｨｩｪｫｬｭｮｯｰ･｢｣､｡ﾜｶｹｲｴ";
const DAKUTEN = "ガギグゲゴザジズゼゾダヂヅデドバビブベボ";
const DAKUTEN_BASE = "カキクケコサシスセソタチツテトハヒフヘホ";
const HANDAKUTEN = "パピプペポ";

/** 半角カナにする（受給者のフリガナ）。ひらがな・全角カタカナ・全角の英数字とスペースを半角に */
export const toHankakuKana = (s: string): string =>
  [...toKatakana(s.normalize("NFKC"))].map((c) => {
    if (c === "　") return " ";
    const i = FULL_KANA.indexOf(c);
    if (i >= 0) return HALF_KANA[i];
    const d = DAKUTEN.indexOf(c);
    if (d >= 0) return HALF_KANA[FULL_KANA.indexOf(DAKUTEN_BASE[d])] + "ﾞ";
    const h = HANDAKUTEN.indexOf(c);
    if (h >= 0) return HALF_KANA[FULL_KANA.indexOf("ハヒフヘホ"[h])] + "ﾟ";
    if (c === "ヴ") return "ｳﾞ";
    return c;
  }).join("");

/** 1つの項目の値が、仕様書の文字属性・文字数に合っているか。合っていれば null */
export const fieldError = (no: number, value: string): string | null => {
  const f = SALARY_REPORT_CSV_FIELDS[no - 1];
  if (!value) return f.required === "○" ? `${f.name}が空です` : null;
  if (BANNED.test(value) || /\p{Extended_Pictographic}/u.test(value)) return `${f.name}に、eLTAX で使えない文字があります`;
  const chars = [...value];
  if (f.attr === "数字" && !/^\d+$/.test(value)) return `${f.name}は数字で書きます`;
  if (f.attr === "半角" && (!/^[\x20-\x7E]+$/.test(value) || /[,@]/.test(value))) return `${f.name}に、半角の英数字・記号でない文字があります`;
  if (f.attr === "全角" && chars.some((c) => /[\x00-\x7F｡-ﾟ]/.test(c))) return `${f.name}に、半角の文字があります`;
  if (f.attr === "半角カナ" && !/^[\x20-\x7E｡-ﾟ]+$/.test(value)) return `${f.name}に、カナでない文字（漢字など）があります`;
  if (/[,@]/.test(value)) return `${f.name}に、カンマか @ があります`;
  if (chars.length > f.max) return `${f.name}が長すぎます（${f.max}文字まで。いまは${chars.length}文字）`;
  return null;
};

const num = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(Math.trunc(n)));
const flag = (b: boolean) => (b ? "1" : "0");
const wareki = (w: Wareki | null): [string, string, string] => (w ? [pad2(w.year), pad2(w.month), pad2(w.day)] : ["", "", ""]);

/** 電話番号：全角の数字・ハイフンは半角に。数字・ハイフン・かっこだけ残す */
const phoneOf = (s: string | null | undefined) => (s ?? "").normalize("NFKC").replace(/[^0-9\-()]/g, "");
/** 法人番号：13桁の数字なら書く */
const corporateNumberOf = (s: string | null | undefined) => {
  const v = (s ?? "").normalize("NFKC").replace(/[\s-]/g, "");
  return /^\d{13}$/.test(v) ? v : "";
};

/** 控除対象配偶者・扶養親族の4項目（フリガナ・氏名・区分・個人番号） */
const personFields = (p: SlipPerson | null | undefined, numbers: Record<string, string>): string[] =>
  p ? [toZenkakuKatakana(p.furigana), toZenkaku(p.name), p.code || "00", numbers[familyKey(p.name, p.birthday)] ?? ""] : ["", "", "", ""];

/** 提出義務者（会社）の項目：項番4 所在地・5 名称・6 電話番号 */
const companyFields = (company: ReportCsvCompany): [string, string, string] =>
  [toZenkaku((company.address ?? "").trim()), toZenkaku((company.name ?? "").trim()), phoneOf(company.phone)];

/** 1人分の146項目 */
export const buildCsvRow = (year: number, company: ReportCsvCompany, p: ReportCsvPerson): string[] => {
  const { report: r, slip: s } = p;
  const v: string[] = new Array(FIELD_COUNT).fill("");
  const set = (no: number, ...values: string[]) => values.forEach((x, i) => { v[no - 1 + i] = x; });
  const reiwa = toWareki(`${year}-12-31`);

  set(1, "315");
  set(4, ...companyFields(company));
  set(10, "0", reiwa ? pad2(reiwa.year) : "");
  set(12, toZenkaku(s.recipient.address), "0", toZenkaku(s.recipient.name));
  set(16, toZenkaku(s.kind), num(s.payment));
  set(19, num(s.employmentIncome), num(s.deductionTotal), num(s.withholdingTax));
  // 控除対象配偶者の有無（主たる給与：有 1・無 2）。年末調整をしない人は分からないので空
  set(23, s.adjusted ? (s.spouseMark.has ? "1" : "2") : "", s.adjusted ? flag(s.spouseMark.elderly) : "", num(s.spouseDeduction));
  const c = s.dependentCounts;
  set(26, num(c.specific), "", num(c.elderly), num(c.elderlyTogether), "", num(c.other), "");
  set(33, num(s.disabledCounts.special), num(s.disabledCounts.specialTogether), num(s.disabledCounts.other));
  set(36, num(s.socialInsurance), num(s.smallBusinessMutualAid), num(s.lifeInsuranceDeduction), num(s.earthquakeDeduction), num(s.housingLoanCredit));
  set(41, num(s.lifeInsurancePaid.pensionOld), num(s.spouseTotalIncome), num(s.oldLongTerm));
  if (s.birthday) set(44, ERA_CODE[s.birthday.era] ?? "", ...wareki(s.birthday));
  const m = s.marks;
  set(49, flag(m.minor), flag(m.otsu), flag(m.selfSpecialDisabled), flag(m.selfDisabled), "", flag(m.widow), "", flag(m.workingStudent), "0", "0", "0");
  const jr = s.joinRetire;
  const jrKind = jr.retired ? "2" : jr.joined ? "1" : "0";
  set(60, jrKind, ...(jrKind === "0" ? ["", "", ""] : wareki(jr.date)));
  if (s.previousJob) {
    const pj = s.previousJob;
    set(64, toZenkaku(pj.address), "0", toZenkaku(pj.name), num(pj.salary), num(pj.withheldTax), num(pj.socialInsurance), "", ...wareki(pj.retiredOn));
  }
  const loans = s.housingLoan.entries;
  if (loans[0]) set(74, ...wareki(loans[0].residenceStart), num(s.housingLoan.count), num(s.housingLoan.available), loans[0].code, num(loans[0].yearEndBalance));
  if (loans[1]) set(81, ...wareki(loans[1].residenceStart), loans[1].code, num(loans[1].yearEndBalance));
  // 摘要：普通徴収の人は、市区町村が決めた理由を先に書く（仕様書 項番86。普通徴収なら必須）
  set(86, toZenkaku([r.ordinary ? r.reason : "", ...s.reportRemarks].filter(Boolean).join(" ")));
  const lp = s.lifeInsurancePaid;
  set(87, num(lp.generalNew), num(lp.generalOld), num(lp.medical), num(lp.pensionNew), num(s.youngCount), num(s.nationalPension));
  const numbers = p.myNumbers ?? {};
  set(94, corporateNumberOf(company.corporateNumber), numbers[SELF_KEY] ?? "");
  set(96, ...personFields(s.spouse, numbers));
  for (let i = 0; i < 4; i++) set(100 + i * 4, ...personFields(s.dependents[i], numbers));
  // 16歳未満の扶養親族：国内に住所がある人は 00（受給者交付用の源泉徴収票では書かないが、CSV では書く）
  for (let i = 0; i < 4; i++) set(116 + i * 4, ...personFields(s.youngDependents[i], numbers));
  set(134, flag(r.ordinary), "0", "0", toHankakuKana(s.recipient.furigana));
  const staffNumber = p.staffNumber.normalize("NFKC").trim();
  set(138, /^[\x21-\x7E]+$/.test(staffNumber) && !STAFF_NUMBER_BANNED.test(staffNumber) ? staffNumber : "");
  set(139, r.municipality?.code ?? "", p.designationNumber);
  set(141, num(s.basicDeduction), num(s.incomeAdjustment), flag(m.singleParent), num(c.specificRelative), "", num(s.specificRelativeDeduction));
  return v;
};

/** 出す人をまとめて CSV にする（市区町村の団体コードの順） */
export const buildSalaryReportCsv = (year: number, company: ReportCsvCompany, people: ReportCsvPerson[]): ReportCsvResult => {
  const result: ReportCsvResult = { csv: "", count: 0, municipalities: 0, myNumbers: 0, errors: [], skipped: [], notes: [] };
  const noSelfNumber: string[] = [];
  const noFamilyNumber: string[] = [];
  companyFields(company).forEach((value, i) => {
    const e = fieldError(4 + i, value);
    if (e) result.errors.push(`${e}（会社の設定で直してください）`);
  });
  if (result.errors.length > 0) return result;

  const lines: { code: string; line: string }[] = [];
  for (const p of people) {
    const r = p.report;
    if (!r.submit) continue;
    const reasons: string[] = [];
    if (p.notReady) reasons.push(p.notReady);
    if (!r.code) reasons.push("市区町村を選んでいません");
    else if (!r.municipality) reasons.push(`団体コード ${r.code} は一覧にありません`);
    if (r.ordinary && !r.reason) reasons.push("普通徴収にする理由がありません");
    if (r.missing.length > 0) reasons.push(`${r.missing.join("・")}が入っていません`);
    // 上で知らせた項目（市区町村・住所・フリガナ・生年月日）は、「空です」を重ねて出さない
    const known = new Set([139, ...(r.missing.length > 0 ? [12, 44, 45, 46, 47, 137] : [])]);
    const row = buildCsvRow(year, company, p);
    row.forEach((value, i) => {
      const e = fieldError(i + 1, value);
      if (e && !(known.has(i + 1) && !value)) reasons.push(e);
    });
    if (reasons.length > 0) {
      result.skipped.push({ name: r.name, reasons: [...new Set(reasons)] });
      continue;
    }
    if (p.staffNumber && !row[137]) result.notes.push(`${r.name}：従業員ID（${p.staffNumber}）に使えない記号があるので、受給者番号は空にしました`);
    if (p.myNumbers) {
      if (row[94]) result.myNumbers++;
      else noSelfNumber.push(r.name);
      // 配偶者・扶養親族（4人まで）の欄で、名前があるのに番号がない
      if ([99, 103, 107, 111, 115, 119, 123, 127, 131].some((no) => row[no - 1 - 2] && !row[no - 1])) noFamilyNumber.push(r.name);
    }
    lines.push({ code: r.municipality!.code, line: row.join(",") });
  }
  if (noSelfNumber.length > 0) result.notes.push(`本人のマイナンバーが登録されていない人（欄は空）：${noSelfNumber.join("、")}`);
  if (noFamilyNumber.length > 0) result.notes.push(`配偶者・扶養親族のマイナンバーが登録されていない人がいる人（欄は空）：${noFamilyNumber.join("、")}`);
  lines.sort((a, b) => a.code.localeCompare(b.code));
  result.count = lines.length;
  result.municipalities = new Set(lines.map((l) => l.code)).size;
  result.csv = lines.map((l) => `${l.line}\r\n`).join("");
  return result;
};
