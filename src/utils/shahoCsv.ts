/**
 * 健康保険・厚生年金保険の届書の電子申請用ファイル（CSV形式届書ファイル。年金事務所提出の SHFD0006.CSV）を作る道具
 *
 * ファイルの形（厚生労働省・日本年金機構「CSV形式届書作成仕様書（電子申請）」。項目の並び・種別・文字数・使える字は
 * src/constants/shahoTodoke.ts。仕様書の PDF から scripts/import_shaho_format.py で作ったもの）:
 *   媒体管理レコード（都道府県コード,郡市区符号,事業所記号,媒体通番,作成年月日,代表届書コード）
 *   [kanri]
 *   ,001（事業所数情報）
 *   事業所情報（都道府県コード,郡市区符号,事業所記号,事業所番号,郵便番号,所在地,名称,事業主氏名,電話番号）
 *   [data]
 *   データレコード（1人1行。賞与支払届など）
 * ・1行の終わりは CR LF。項目を省略しても、区切りのカンマは省略しない
 * ・1バイト文字は数字・英字・半角カナ・ハイフン・スペース（JIS X 0201）、2バイト文字はシフトJIS（JIS X 0208 の第1・第2水準など）。
 *   それ以外の字（髙・﨑・①・絵文字など）は書けないので、知らせて直してもらう（仕様書：代替え文字にするか、カナで書く）
 * ・カナの項目（氏名のカナ）は半角カナで、姓と名の間に半角スペース、漢字の項目（氏名・所在地など）は全角で、姓と名の間に全角スペース
 * ・日付は和暦（元号のコード ＋ 年・月・日を2文字ずつ。令和1年7月25日 → 9・010725）
 * ・事業所整理記号は「納入告知書」の記号の上2桁を郡市区符号、残りを事業所記号に分け、都道府県コードは年金機構の一覧（東京都は 21）
 */
import {
  SHAHO_DATA_MARK, SHAHO_DOUBLE_BYTE_RANGES, SHAHO_MEDIA_FIELDS, SHAHO_OFFICE_COUNT, SHAHO_OFFICE_FIELDS, SHAHO_OFFICE_MARK,
  SHAHO_PREFECTURE_CODES, SHAHO_REPRESENTATIVE_CODE, SHAHO_SINGLE_BYTE_CHARS, type ShahoField,
} from "../constants/shahoTodoke";
import { PREFECTURE_MASTER } from "../constants/prefectures";
import { toHankakuKana, toZenkaku } from "./salaryPaymentReportCsv";
import { toWareki } from "./wareki";

// ── 字（1バイト文字・シフトJIS） ─────────────────────────────

const SINGLE = new Set(SHAHO_SINGLE_BYTE_CHARS);
/** 半角カナは 0xA1〜0xDF（U+FF61〜U+FF9F） */
const singleByteOf = (c: string): number => {
  const code = c.charCodeAt(0);
  return code >= 0xff61 && code <= 0xff9f ? code - 0xff61 + 0xa1 : code;
};

/**
 * 同じ字の書き方が違うもの（JIS の書き方の字 → シフトJISのコードで読んだときの字。〜 と ～、− と －、— と ― など）
 * IME や貼り付けで、どちらの字にもなるので、同じコードにする
 */
const SJIS_ALIASES: Record<string, string> = {
  "〜": "～", // 〜（波ダッシュ） → ～
  "‖": "∥", // ‖ → ∥
  "−": "－", // −（マイナス） → －
  "¢": "￠", // ¢ → ￠
  "£": "￡", // £ → ￡
  "—": "―", // —（全角ダッシュ） → ―
};

let sjis: Map<string, number> | null = null;
/** 使える2バイト文字 → シフトJISのコード（仕様書の使用可能コード範囲を、シフトJISとして読んで作る） */
const sjisTable = (): Map<string, number> => {
  if (sjis) return sjis;
  const decoder = new TextDecoder("shift_jis", { fatal: true });
  const map = new Map<string, number>();
  for (const [from, to] of SHAHO_DOUBLE_BYTE_RANGES) {
    for (let code = from; code <= to; code++) {
      const hi = code >> 8;
      const lo = code & 0xff;
      // 下2桁が 7F・FD〜3F、上2桁が A0〜DF は使えない（表3.4-3 の注）
      if (lo === 0x7f || lo >= 0xfd || lo <= 0x3f || (hi >= 0xa0 && hi <= 0xdf)) continue;
      let ch: string;
      try {
        ch = decoder.decode(new Uint8Array([hi, lo]));
      } catch {
        continue;
      }
      if ([...ch].length === 1 && !map.has(ch)) map.set(ch, code);
    }
  }
  for (const [alias, ch] of Object.entries(SJIS_ALIASES)) {
    const code = map.get(ch);
    if (code !== undefined) map.set(alias, code);
  }
  sjis = map;
  return map;
};

/** 届書に書ける字か（1バイト文字・2バイト文字） */
export const isShahoChar = (c: string): boolean => SINGLE.has(c) || sjisTable().has(c);

/** 書けない字（同じ字は1つにまとめる） */
export const unusableChars = (s: string): string[] => [...new Set([...s].filter((c) => !isShahoChar(c)))];

/** 1行をシフトJISのバイトにする（書けない字があれば止める。呼ぶ前に確かめておく） */
const encodeLine = (line: string, out: number[]) => {
  const table = sjisTable();
  for (const c of line) {
    if (SINGLE.has(c) || c === "," || c === "[" || c === "]") {
      out.push(singleByteOf(c));
      continue;
    }
    const code = table.get(c);
    if (code === undefined) throw new Error(`届書に書けない字があります：「${c}」`);
    out.push(code >> 8, code & 0xff);
  }
};

/** 行を、CR LF で終わるシフトJISのファイルにする */
export const encodeShahoFile = (lines: string[]): Uint8Array => {
  const out: number[] = [];
  for (const line of lines) {
    encodeLine(line, out);
    out.push(0x0d, 0x0a);
  }
  return Uint8Array.from(out);
};

// ── 項目 ─────────────────────────────────────────────

const isDigitChar = (c: string) => c >= "0" && c <= "9";
const isAlphaChar = (c: string) => (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c === "-";
const isKanaChar = (c: string) => c === " " || (c >= "｡" && c <= "ﾟ");

/**
 * 項目の値が、仕様書の種別・文字数に合っているか（合っていれば null）
 * 漢字の項目は2バイト文字だけ、カナの項目は半角カナとスペースだけ
 */
export const fieldProblem = (f: ShahoField, value: string): string | null => {
  const chars = [...value];
  const n = chars.length;
  if (n === 0) return f.min === 0 ? null : `${f.name}が空です`;
  if (f.only ? !f.only.includes(n) : n < f.min || n > f.max) {
    return f.only
      ? `${f.name}は${f.only.filter((x) => x > 0).join("・")}文字で書きます（いまは${n}文字）`
      : n > f.max ? `${f.name}が長すぎます（${f.max}文字まで。いまは${n}文字）` : `${f.name}が短すぎます（${f.min}文字から。いまは${n}文字）`;
  }
  const bad = unusableChars(value);
  if (bad.length > 0) return `${f.name}に、届書に書けない字があります（${bad.join("")}）`;
  if (f.kinds.includes("漢字")) {
    const half = chars.filter((c) => SINGLE.has(c));
    return half.length > 0 ? `${f.name}に、半角の字があります（${[...new Set(half)].join("")}）` : null;
  }
  const ok = (c: string) =>
    (f.kinds.includes("数字") && isDigitChar(c)) || (f.kinds.includes("英字") && isAlphaChar(c)) || (f.kinds.includes("カナ") && isKanaChar(c));
  const wrong = chars.filter((c) => !ok(c));
  if (wrong.length === 0) return null;
  const kinds = f.kinds.join("・");
  return `${f.name}は${kinds}で書きます（「${[...new Set(wrong)].join("")}」は書けません）`;
};

/** 全角の字にする（漢字の項目。英数字・記号・スペースは全角に、半角カナは全角カナに。スペースが続けば1つに） */
export const toShahoKanji = (s: string | null | undefined): string =>
  toZenkaku(String(s ?? "").trim()).replace(/　+/g, "　");

/** 半角カナにする（カナの項目。ひらがな・全角カナ・全角スペースを半角に。スペースが続けば1つに） */
export const toShahoKana = (s: string | null | undefined): string =>
  toHankakuKana(String(s ?? "").trim()).replace(/ +/g, " ");

/** 姓と名の間にスペースがあるか（スペースで2つ以上に分かれる） */
export const hasNameSpace = (name: string, space: " " | "　"): boolean => name.split(space).filter(Boolean).length >= 2;

/** 和暦の日付（元号のコードと、年・月・日を2文字ずつ）。元号のコードがない日付は null */
export const shahoDate = (date: string | null | undefined, eraCodes: Record<string, string>): { era: string; ymd: string } | null => {
  const w = toWareki(date);
  if (!w || !eraCodes[w.era]) return null;
  const p2 = (n: number) => String(n).padStart(2, "0");
  return { era: eraCodes[w.era], ymd: `${p2(w.year)}${p2(w.month)}${p2(w.day)}` };
};

// ── 事業所 ────────────────────────────────────────────

/** 届書に書く事業所の情報（会社設定から） */
export interface ShahoOffice {
  /** 事業所がある都道府県（本店の拠点の都道府県。「東京都」「東京」どちらでも） */
  prefecture: string | null | undefined;
  /** 事業所整理記号（納入告知書の「01-イロハ」のような記号） */
  symbol: string | null | undefined;
  /** 事業所番号（1〜5けた） */
  number: string | null | undefined;
  zip: string | null | undefined;
  address: string | null | undefined;
  name: string | null | undefined;
  /** 事業主氏名（代表者。姓と名の間にスペース） */
  owner: string | null | undefined;
  phone: string | null | undefined;
}

/** 都道府県名（「東京」も）を、年金機構の都道府県コードにする（わからなければ null） */
export const shahoPrefectureCode = (prefecture: string | null | undefined): string | null => {
  const p = PREFECTURE_MASTER.find((x) => x.name === prefecture || x.name0 === prefecture);
  return p ? SHAHO_PREFECTURE_CODES[p.name] ?? null : null;
};

/** 事業所整理記号を、郡市区符号（上2桁）と事業所記号（残り。半角）に分ける */
export const splitOfficeSymbol = (symbol: string | null | undefined): { district: string; mark: string } | null => {
  // 全角の数字・ひらがな・カタカナを半角にし、上2桁のあとの区切り（「-」「ー」・スペース）を除く
  const s = toShahoKana(String(symbol ?? "").normalize("NFKC")).replace(/\s+/g, " ");
  const m = /^(\d{2}) ?[-ｰ]? ?(\S+)$/.exec(s);
  return m ? { district: m[1], mark: m[2] } : null;
};

/**
 * 事業所の情報を、事業所情報の項目（12）と、媒体管理レコードの頭（都道府県コード・郡市区符号・事業所記号）にする
 * problems：直すところ（会社設定で直してもらう）
 */
export const shahoOfficeValues = (o: ShahoOffice): { values: string[]; problems: string[] } => {
  const problems: string[] = [];
  /** すでに直すところを書いた項目（項目の決まりで、同じことを2回知らせない） */
  const reported = new Set<number>();
  const problem = (message: string, ...fields: number[]) => {
    problems.push(message);
    for (const i of fields) reported.add(i);
  };
  const pref = shahoPrefectureCode(o.prefecture);
  if (!pref) problem("本店の拠点の都道府県がわかりません（会社設定の「本店の都道府県」）", 0);
  const sym = splitOfficeSymbol(o.symbol);
  if (!sym) problem("事業所整理記号がないか、書き方が違います（納入告知書の「01-イロハ」のような記号を、会社設定で入れてください）", 1, 2);
  const number = String(o.number ?? "").normalize("NFKC").trim();
  if (!number) problem("事業所番号がありません（納入告知書の番号を、会社設定で入れてください）", 3);
  const zip = String(o.zip ?? "").normalize("NFKC").replace(/[^0-9]/g, "");
  if (zip.length !== 7) problem("会社の郵便番号がないか、7けたではありません", 4, 5);
  // 所在地は都道府県名から書く
  const prefName = PREFECTURE_MASTER.find((x) => x.name === o.prefecture || x.name0 === o.prefecture)?.name ?? "";
  let address = toShahoKanji(o.address);
  if (prefName && address && !address.startsWith(prefName)) address = toShahoKanji(prefName) + address;
  const owner = toShahoKanji(o.owner);
  if (owner && !hasNameSpace(owner, "\u3000")) problem("代表者の氏名の、姓と名の間にスペースを入れてください（会社設定）", 8);
  const phone = String(o.phone ?? "").normalize("NFKC").replace(/[()（）]/g, "-").replace(/[^0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const tel = phone.split("-");
  if (tel.length !== 3) problem("会社の電話番号は「03-1234-5678」のように、ハイフンで3つに区切って入れてください", 9, 10, 11);
  const values = [
    pref ?? "", sym?.district ?? "", sym?.mark ?? "", number, zip.slice(0, 3), zip.slice(3),
    address, toShahoKanji(o.name), owner, tel[0] ?? "", tel[1] ?? "", tel[2] ?? "",
  ];
  SHAHO_OFFICE_FIELDS.forEach((f, i) => {
    if (reported.has(i)) return;
    const p = fieldProblem(f, values[i]);
    if (p) problems.push(`事業所の${p}`);
  });
  return { values, problems };
};

/** 媒体通番（001〜999。999 の次は 001） */
export const nextMediaNumber = (last: number | null | undefined): number => {
  const n = Math.trunc(Number(last) || 0);
  return n >= 999 || n < 0 ? 1 : n + 1;
};

/**
 * ファイルの行（媒体管理レコード・[kanri]・事業所数情報・事業所情報・[data]・データレコード）
 * @param officeValues 事業所情報の12項目（shahoOfficeValues）
 * @param mediaNumber 媒体通番（1〜999）
 * @param createdOn 作成年月日（YYYY-MM-DD）
 */
export const buildShahoLines = (officeValues: string[], mediaNumber: number, createdOn: string, dataLines: string[]): string[] => {
  const media = [officeValues[0], officeValues[1], officeValues[2], String(mediaNumber).padStart(3, "0"), createdOn.replace(/-/g, ""), SHAHO_REPRESENTATIVE_CODE];
  SHAHO_MEDIA_FIELDS.forEach((f, i) => {
    const p = fieldProblem(f, media[i]);
    if (p) throw new Error(`媒体管理レコードの${p}`);
  });
  return [media.join(","), SHAHO_OFFICE_MARK, `,${SHAHO_OFFICE_COUNT}`, officeValues.join(","), SHAHO_DATA_MARK, ...dataLines];
};
