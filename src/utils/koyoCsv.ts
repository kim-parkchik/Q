/**
 * 雇用保険の届書の電子申請用ファイル（ハローワークに出す CSV形式届書ファイル。10101-shutoku.csv など）を作る道具
 *
 * ファイルの形（厚生労働省 職業安定局「ＣＳＶ形式届書作成仕様書（電子申請）（雇用保険適用関係届書）」。項目の並び・名前・種別・
 * 文字数・コードは src/constants/koyoTodoke.ts。仕様書の PDF から scripts/import_koyo_format.py で作ったもの）:
 *   ＦＤ管理レコードの項目行・データ行（郡市区符号,事業所記号,ＦＤ通番,作成年月日,代表届書コード,連記式項目バージョン,XML返戻希望の有無）
 *   [kanri]
 *   事業所数情報の項目行・データ行（社会保険労務士氏名,事業所情報数 → ,001）
 *   事業所情報の項目行・データ行（郡市区符号,事業所記号,事業所番号,郵便番号,所在地,名称,事業主氏名,電話番号,雇用保険適用事業所番号）
 *   [data]
 *   データレコードの項目行と、1人1行のデータ行（1つのファイルに 1,000人まで。届書の種類を混ぜない）
 * ・社会保険の届書のファイル（utils/shahoCsv.ts）と違い、どのレコードも1行目に項目の名前を並べた「項目行」を書く
 * ・1行の終わりは CR LF。字はシフトJIS（使える字は社会保険の届書と同じ。表3.4）。項目を省略しても区切りのカンマは省略しない
 * ・郡市区符号・事業所記号・事業所番号は、厚生年金の「納入告知書」の事業所整理記号・事業所番号（社会保険の届書と同じ）
 * ・雇用保険適用事業所番号・被保険者番号は「1301-123456-7」の形（4けた・6けた・1けた）。6けたの前の0は省いてもよい
 * ・日付は「昭和・平成・令和」の元号と、年・月・日を2文字ずつ（令和8年4月1日 → 令和,08,04,01）
 * ・個人番号（マイナンバー）は、画面に出す・確かめるときは MY_NUMBER_PLACEHOLDER にしておき、ファイルを保存するときだけ番号にする
 */
import {
  KOYO_BANGO_FIELDS, KOYO_DATA_MARK, KOYO_DOUBLE_BYTE_RANGES, KOYO_FORM_VERSIONS, KOYO_MAX_RECORDS, KOYO_MEDIA_FIELDS,
  KOYO_OFFICE_COUNT_FIELDS, KOYO_OFFICE_FIELDS, KOYO_OFFICE_MARK, KOYO_REPRESENTATIVE_CODE, KOYO_RISHOKU_FIELDS, KOYO_SHUTOKU_FIELDS,
  KOYO_SINGLE_BYTE_CHARS, KOYO_SOSHITSU_FIELDS, KOYO_TENKIN_FIELDS, type KoyoField, type KoyoForm,
} from "../constants/koyoTodoke";
import { SHAHO_DOUBLE_BYTE_RANGES, SHAHO_SINGLE_BYTE_CHARS } from "../constants/shahoTodoke";
import { PREFECTURE_MASTER } from "../constants/prefectures";
import { hasNameSpace, MY_NUMBER_PLACEHOLDER, splitOfficeSymbol, toShahoKana, toShahoKanji, unusableChars } from "./shahoCsv";
import { toWareki } from "./wareki";

/** 届書ごとのデータレコードの項目 */
export const KOYO_FIELDS: Record<KoyoForm, KoyoField[]> = {
  shutoku: KOYO_SHUTOKU_FIELDS,
  soshitsu: KOYO_SOSHITSU_FIELDS,
  rishoku: KOYO_RISHOKU_FIELDS,
  tenkin: KOYO_TENKIN_FIELDS,
  bango: KOYO_BANGO_FIELDS,
};

/** 届書の名前 */
export const KOYO_FORM_TITLES: Record<KoyoForm, string> = {
  shutoku: "雇用保険被保険者資格取得届",
  soshitsu: "雇用保険被保険者資格喪失届（離職票交付なし）",
  rishoku: "雇用保険被保険者資格喪失届・離職証明書（離職票交付あり）",
  tenkin: "雇用保険被保険者転勤届",
  bango: "雇用保険個人番号登録届",
};

/**
 * 使える字は、社会保険の届書の仕様書と同じ（1バイト文字は JIS X 0201 の数字・英字・半角カナ・ハイフン・スペース、
 * 2バイト文字はシフトJIS の同じコードの範囲）。違えば、utils/shahoCsv.ts の字の決まりを使えないので知らせる
 */
export const sameCharsAsShaho = (): boolean =>
  KOYO_SINGLE_BYTE_CHARS === SHAHO_SINGLE_BYTE_CHARS && JSON.stringify(KOYO_DOUBLE_BYTE_RANGES) === JSON.stringify(SHAHO_DOUBLE_BYTE_RANGES);

const SINGLE = new Set(KOYO_SINGLE_BYTE_CHARS);
const isDigitChar = (c: string) => c >= "0" && c <= "9";
const isAlphaChar = (c: string) => (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c === "-" || c === " ";
const isKanaChar = (c: string) => c === " " || (c >= "｡" && c <= "ﾟ");

/**
 * 項目の値が、仕様書の種別・文字数に合っているか（合っていれば null）
 * ・「漢字」だけの項目は2バイト文字だけ。「漢字 数字 英字 カナ」の項目は全角・半角どちらでもよい
 * ・「－」の項目（安定所番号・確認通知年月日など、ハローワークが書く項目）は空にする
 * ・「漢字」の項目にカナなどで書くときの決まり（alt）があれば、1バイト文字だけで書いた値はそちらで確かめる
 */
export const koyoFieldProblem = (f: KoyoField, value: string): string | null => {
  if (value === MY_NUMBER_PLACEHOLDER) return null;
  const chars = [...value];
  const n = chars.length;
  if (f.kinds.length === 1 && f.kinds[0] === "-") return n === 0 ? null : `${f.name}は書きません`;
  if (n === 0) return f.min === 0 ? null : `${f.name}が空です`;
  const bad = unusableChars(value);
  if (bad.length > 0) return `${f.name}に、届書に書けない字があります（${bad.join("")}）`;
  const allSingle = chars.every((c) => SINGLE.has(c));
  const rule = f.alt && allSingle ? { ...f, ...f.alt, name: f.name } : f;
  if (rule.only ? !rule.only.includes(n) : n < rule.min || n > rule.max) {
    return rule.only
      ? `${f.name}は${rule.only.filter((x) => x > 0).join("・")}文字で書きます（いまは${n}文字）`
      : n > rule.max ? `${f.name}が長すぎます（${rule.max}文字まで。いまは${n}文字）` : `${f.name}が短すぎます（${rule.min}文字から。いまは${n}文字）`;
  }
  const kinds = rule.kinds;
  if (kinds.includes("漢字")) {
    if (kinds.length > 1) return null; // 全角・半角どちらでもよい
    const half = chars.filter((c) => SINGLE.has(c));
    return half.length > 0 ? `${f.name}に、半角の字があります（${[...new Set(half)].join("")}）` : null;
  }
  const ok = (c: string) =>
    (kinds.includes("数字") && isDigitChar(c)) || (kinds.includes("英字") && isAlphaChar(c)) || (kinds.includes("カナ") && isKanaChar(c));
  const wrong = chars.filter((c) => !ok(c));
  if (wrong.length === 0) return null;
  return `${f.name}は${kinds.join("・")}で書きます（「${[...new Set(wrong)].join("")}」は書けません）`;
};

/** データ行の項目を、項目の決まりで確かめる（直すところの一覧） */
export const koyoRowProblems = (form: KoyoForm, values: string[], who = ""): string[] => {
  const fields = KOYO_FIELDS[form];
  if (values.length !== fields.length) return [`${who}${KOYO_FORM_TITLES[form]}の項目の数が違います（${values.length}／${fields.length}）`];
  const out: string[] = [];
  fields.forEach((f, i) => {
    const p = koyoFieldProblem(f, values[i] ?? "");
    if (p) out.push(`${who}${p}`);
    if (f.eras && values[i] && !f.eras.includes(values[i])) out.push(`${who}${f.name}は${f.eras.join("・")}のどれかです（「${values[i]}」）`);
  });
  return out;
};

// ── 書き方 ─────────────────────────────────────────────

/** 漢字の項目にする（全角。スペースは全角1つ） */
export const koyoKanji = (s: string | null | undefined): string => toShahoKanji(s);
/** カナの項目にする（半角カナ。スペースは半角1つ） */
export const koyoKana = (s: string | null | undefined): string => toShahoKana(s);

/**
 * 全角・半角どちらでもよい項目にする（字はそのまま。改行やタブ・続く半角スペースを1つの半角スペースにし、前後の空白を取る。
 * 書けない字はそのまま残し、確かめるときに知らせる）
 */
export const koyoText = (s: string | null | undefined): string => String(s ?? "").replace(/[ \t\r\n]+/g, " ").trim();

/** 氏名の漢字の項目（12文字を超えるところは省く。仕様書：全角スペースを含め13文字目以降の文字は省略する） */
export const koyoNameKanji = (name: string | null | undefined, max = 12): string => [...koyoKanji(name)].slice(0, max).join("");

/** ローマ字の氏名（大文字の英字とスペース。英字以外は書けない） */
export const koyoRomaji = (s: string | null | undefined): string =>
  String(s ?? "").normalize("NFKC").toUpperCase().replace(/\s+/g, " ").trim();

/**
 * 「1301-123456-7」の形の番号（雇用保険適用事業所番号・被保険者番号）を、4けた・6けた・1けたに分ける（11けたでなければ null）
 * 区切りの「-」がなくても、数字が11けたなら分ける
 */
export const splitKoyoNumber = (value: string | null | undefined): [string, string, string] | null => {
  const s = String(value ?? "").normalize("NFKC").trim();
  if (/[-ｰー－\s]/.test(s)) {
    // 区切りがあれば、4けた・1〜6けた・1けたの3つ（6けたの前の0は省いてもよい）
    const parts = s.split(/\s*[-ｰー－]\s*|\s+/).filter(Boolean);
    if (parts.length !== 3 || !/^\d{4}$/.test(parts[0]) || !/^\d{1,6}$/.test(parts[1]) || !/^\d$/.test(parts[2])) return null;
    return [parts[0], parts[1].padStart(6, "0"), parts[2]];
  }
  return /^\d{11}$/.test(s) ? [s.slice(0, 4), s.slice(4, 10), s.slice(10)] : null;
};

/** 番号を「1301-123456-7」の形で出す（分けられなければ、そのまま） */
export const formatKoyoNumber = (value: string | null | undefined): string => {
  const p = splitKoyoNumber(value);
  return p ? p.join("-") : String(value ?? "");
};

/** 和暦の日付（元号の漢字と、年・月・日を2文字ずつ）。日付でなければ null */
export const koyoDate = (date: string | null | undefined): { era: string; y: string; m: string; d: string } | null => {
  const w = toWareki(date);
  if (!w) return null;
  const p2 = (n: number) => String(n).padStart(2, "0");
  return { era: w.era, y: p2(w.year), m: p2(w.month), d: p2(w.day) };
};

/** 日付の4つの項目（元号・年・月・日）。日付がなければ空4つ */
export const koyoDateValues = (date: string | null | undefined): [string, string, string, string] => {
  const d = koyoDate(date);
  return d ? [d.era, d.y, d.m, d.d] : ["", "", "", ""];
};

/** 電話番号を3つ（市外局番・市内局番・加入者番号）に分ける（「-」や「()」で区切る。分けられなければ null） */
export const splitPhone3 = (phone: string | null | undefined): [string, string, string] | null => {
  const s = String(phone ?? "").normalize("NFKC").replace(/[()（）]/g, "-").replace(/[^0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const parts = s.split("-");
  return parts.length === 3 && parts.every((p) => p.length > 0) ? [parts[0], parts[1], parts[2]] : null;
};

// ── 事業所 ────────────────────────────────────────────

/** 届書に書く事業所の情報（会社設定・拠点の設定から） */
export interface KoyoOffice {
  /** 社会保険の事業所整理記号（「01-イロハ」）と事業所番号（厚生年金の納入告知書） */
  symbol: string | null | undefined;
  number: string | null | undefined;
  /** 事業所の都道府県（所在地を都道府県名から書く） */
  prefecture: string | null | undefined;
  zip: string | null | undefined;
  address: string | null | undefined;
  name: string | null | undefined;
  owner: string | null | undefined;
  phone: string | null | undefined;
  /** 雇用保険適用事業所番号（「1301-123456-7」） */
  koyoNumber: string | null | undefined;
}

/**
 * 事業所の情報を、事業所情報の項目（12）にする。郡市区符号・事業所記号は、ＦＤ管理レコードにも書く
 * problems：直すところ（会社設定・拠点の設定で直してもらう）
 */
export const koyoOfficeValues = (o: KoyoOffice): { values: string[]; problems: string[] } => {
  const problems: string[] = [];
  const reported = new Set<number>();
  const problem = (message: string, ...fields: number[]) => {
    problems.push(message);
    for (const i of fields) reported.add(i);
  };
  const sym = splitOfficeSymbol(o.symbol);
  if (!sym) problem("社会保険の事業所整理記号がないか、書き方が違います（雇用保険の届書のファイルにも書きます。会社設定の「事業所整理記号」）", 0, 1);
  const number = String(o.number ?? "").normalize("NFKC").trim();
  if (!number) problem("社会保険の事業所番号がありません（雇用保険の届書のファイルにも書きます。会社設定の「事業所番号」）", 2);
  const zip = String(o.zip ?? "").normalize("NFKC").replace(/[^0-9]/g, "");
  if (zip.length !== 7) problem("事業所の郵便番号がないか、7けたではありません", 3, 4);
  const prefName = PREFECTURE_MASTER.find((x) => x.name === o.prefecture || x.name0 === o.prefecture)?.name ?? "";
  let address = koyoKanji(o.address);
  if (prefName && address && !address.startsWith(prefName)) address = koyoKanji(prefName) + address;
  const owner = koyoKanji(o.owner);
  if (owner && !hasNameSpace(owner, "　")) problem("代表者の氏名の、姓と名の間にスペースを入れてください（会社設定）", 7);
  const phone = String(o.phone ?? "").normalize("NFKC").replace(/[()（）]/g, "-").replace(/[^0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (phone.split("-").length !== 3) problem("事業所の電話番号は「03-1234-5678」のように、ハイフンで3つに区切って入れてください", 8);
  const koyo = splitKoyoNumber(o.koyoNumber);
  if (!koyo) problem("雇用保険適用事業所番号がないか、11けたではありません（「1301-123456-7」の形。会社設定・拠点の設定）", 9, 10, 11);
  const values = [
    sym?.district ?? "", sym?.mark ?? "", number, zip.slice(0, 3), zip.slice(3), address, koyoKanji(o.name), owner, phone,
    koyo?.[0] ?? "", koyo?.[1] ?? "", koyo?.[2] ?? "",
  ];
  KOYO_OFFICE_FIELDS.forEach((f, i) => {
    if (reported.has(i)) return;
    const p = koyoFieldProblem(f, values[i]);
    if (p) problems.push(`事業所の${p}`);
  });
  return { values, problems };
};

/**
 * ファイルの行
 * @param officeValues 事業所情報の12項目（koyoOfficeValues）
 * @param mediaNumber ＦＤ通番（1〜999）
 * @param createdOn 作成年月日（YYYY-MM-DD）
 * @param xmlReturn 通知書（公文書）を XML でも受け取るか（XML返戻希望の有無）
 * @param dataRows データ行（項目の並び。KOYO_FIELDS[form] の順）
 */
export const buildKoyoLines = (
  form: KoyoForm, officeValues: string[], mediaNumber: number, createdOn: string, xmlReturn: boolean, dataRows: string[][],
): string[] => {
  if (dataRows.length === 0) throw new Error("届け出る人がいません");
  if (dataRows.length > KOYO_MAX_RECORDS) throw new Error(`1つのファイルに書けるのは ${KOYO_MAX_RECORDS}人までです`);
  const media = [
    officeValues[0], officeValues[1], String(mediaNumber).padStart(3, "0"), createdOn.replace(/-/g, ""), KOYO_REPRESENTATIVE_CODE,
    KOYO_FORM_VERSIONS[form], xmlReturn ? "有" : "無",
  ];
  KOYO_MEDIA_FIELDS.forEach((f, i) => {
    const p = koyoFieldProblem(f, media[i]);
    if (p) throw new Error(`ＦＤ管理レコードの${p}`);
  });
  const count = ["", "001"];
  KOYO_OFFICE_COUNT_FIELDS.forEach((f, i) => {
    const p = koyoFieldProblem(f, count[i]);
    if (p) throw new Error(`事業所数情報の${p}`);
  });
  const fields = KOYO_FIELDS[form];
  for (const row of dataRows) {
    if (row.length !== fields.length) throw new Error(`${KOYO_FORM_TITLES[form]}の項目の数が違います`);
  }
  const header = (fs: KoyoField[]) => fs.map((f) => f.name).join(",");
  return [
    header(KOYO_MEDIA_FIELDS), media.join(","),
    KOYO_OFFICE_MARK,
    header(KOYO_OFFICE_COUNT_FIELDS), count.join(","),
    header(KOYO_OFFICE_FIELDS), officeValues.join(","),
    KOYO_DATA_MARK,
    header(fields),
    ...dataRows.map((r) => r.join(",")),
  ];
};

/** 届書に書く漢字の氏名か（書けない字がない・姓と名の間に全角スペース） */
export const koyoNameProblem = (name: string, label: string): string | null => {
  if (!name) return `${label}がありません`;
  if (!hasNameSpace(name, "　")) return `${label}の姓と名の間にスペースを入れてください`;
  const bad = unusableChars(name);
  return bad.length > 0 ? `${label}に、届書に書けない字があります（${bad.join("")}。「高」などの字にするか、カナで届けます）` : null;
};
