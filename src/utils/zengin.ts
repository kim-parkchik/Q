/**
 * 全銀協規定形式の振込データ（FBデータ。給与振込・賞与振込）を作る
 * レコードの形（項目・バイト数・データ区分など）は constants/zengin.ts（銀行の仕様書の PDF からスクリプトで作ったもの）。
 * 一般的な給与ソフトと同じ形（クラウド型の給与ソフトの「FBデータ」：支給日・振込日・支払口座・振込方法（給与・賞与）を選び、
 * レコード長 120（改行なし）か改行ありで出す）。
 *
 * ・ヘッダー（振込元の口座・委託者）→ データ（振込1件ごと）→ トレーラー（件数・合計金額）→ エンドの順に、1レコード120バイト
 * ・数字の項目は右詰めで前を0で埋め、文字の項目は左詰めで後ろをスペースで埋める
 * ・文字は半角だけ（数字・英大文字・半角カナ・スペースと、両方の銀行で使える記号）。Shift_JIS（JIS8）の1バイトで書く
 * ・名前は、ひらがな・全角カナ・全角英数を半角にし、小文字を大文字に、カナの小さい字を大きい字に、長音（ー）を「-」に、
 *   中点（・）を「.」にする（三菱UFJ銀行の仕様書の文字の変換と同じ）。それでも使えない字（漢字など）があれば知らせる
 */
import {
  ZENGIN_ACCOUNT_TYPE, ZENGIN_CODE_JIS, ZENGIN_DATA, ZENGIN_END, ZENGIN_HEADER, ZENGIN_KIND_CODE, ZENGIN_NAME_SYMBOLS,
  ZENGIN_NEW_CODE, ZENGIN_RECORD_KIND, ZENGIN_RECORD_LENGTH, ZENGIN_TRAILER, type ZenginField,
} from "../constants/zengin";

export type AccountType = keyof typeof ZENGIN_ACCOUNT_TYPE;

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = { ordinary: "普通", current: "当座" };

export const toAccountType = (value: unknown): AccountType => (value === "current" ? "current" : "ordinary");

/** 口座（銀行・支店・預金種目・口座番号。名前は半角カナで入れる） */
export interface BankAccount {
  /** 金融機関コード（4けた） */
  bankCode: string;
  bankName: string;
  /** 支店コード（3けた） */
  branchCode: string;
  branchName: string;
  accountType: AccountType;
  /** 口座番号（7けたまで。前を0で埋める） */
  accountNumber: string;
}

/** 振込元の口座（会社。委託者コードは銀行と契約したときに知らされる10けたの番号） */
export interface SourceAccount extends BankAccount {
  clientCode: string;
  clientName: string;
}

/** 振込先の口座（従業員。fixedAmount が null の口座に残りを振り込む） */
export interface StaffAccount extends BankAccount {
  holderName: string;
  fixedAmount: number | null;
}

// ── 文字 ───────────────────────────────────────────────

const FULL_KANA = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンヰヱ";
const HALF_KANA = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝｲｴ";
const VOICED = "ガギグゲゴザジズゼゾダヂヅデドバビブベボ";
const VOICED_BASE = "カキクケコサシスセソタチツテトハヒフヘホ";
const SEMI_VOICED = "パピプペポ";
const SEMI_VOICED_BASE = "ハヒフヘホ";
/** カナの小さい字 → 大きい字（全角・半角） */
const SMALL = "ァィゥェォッャュョヮヵヶｧｨｩｪｫｯｬｭｮ";
const LARGE = "アイウエオツヤユヨワカケｱｲｳｴｵﾂﾔﾕﾖ";

const toHalf: Record<string, string> = {};
for (let i = 0; i < FULL_KANA.length; i++) toHalf[FULL_KANA[i]] = HALF_KANA[i];
for (let i = 0; i < VOICED.length; i++) toHalf[VOICED[i]] = toHalf[VOICED_BASE[i]] + "ﾞ";
for (let i = 0; i < SEMI_VOICED.length; i++) toHalf[SEMI_VOICED[i]] = toHalf[SEMI_VOICED_BASE[i]] + "ﾟ";
toHalf["ヴ"] = "ｳﾞ";

/** 振込データに書ける字か（数字・英大文字・スペース・半角カナ（小さい字と長音を除く）・濁点・半濁点・使える記号） */
const isAllowed = (c: string) =>
  /^[0-9A-Z ]$/.test(c)
  || (c >= "ｦ" && c <= "ﾝ" && !"ｧｨｩｪｫｬｭｮｯｰ".includes(c))
  || c === "ﾞ" || c === "ﾟ"
  || ZENGIN_NAME_SYMBOLS.includes(c);

/**
 * 名前などを、振込データに書ける半角の字にする
 * @returns text：変えた字（使えない字はそのまま残す）／invalid：使えない字（漢字など。直してもらう）
 */
export const toZenginText = (input: string): { text: string; invalid: string[] } => {
  let out = "";
  for (const ch of String(input ?? "").normalize("NFC")) {
    let c = ch;
    const code = c.charCodeAt(0);
    if (code >= 0xff01 && code <= 0xff5e) c = String.fromCharCode(code - 0xfee0); // 全角英数・記号 → 半角
    else if (c === "　") c = " ";
    else if (code >= 0x3041 && code <= 0x3096) c = String.fromCharCode(code + 0x60); // ひらがな → カタカナ
    const small = SMALL.indexOf(c);
    if (small >= 0) c = LARGE[small];
    if (toHalf[c]) c = toHalf[c];
    else if (c === "ー" || c === "ｰ" || c === "‐" || c === "−" || c === "―" || c === "—") c = "-";
    else if (c === "・" || c === "･") c = ".";
    else if (c === "゛" || c === "゙") c = "ﾞ";
    else if (c === "゜" || c === "゚") c = "ﾟ";
    out += c.toUpperCase();
  }
  const invalid = [...new Set([...out].filter((c) => !isAllowed(c)))];
  return { text: out, invalid };
};

/** 数字だけか（空は false） */
const isDigits = (s: string) => /^\d+$/.test(s);

// ── 口座の確かめ ───────────────────────────────────────────

/** 口座の入れ方の間違い（なければ空） */
export const bankAccountProblems = (a: BankAccount, holderName?: string): string[] => {
  const problems: string[] = [];
  if (!/^\d{4}$/.test(a.bankCode)) problems.push("金融機関コードは4けたの数字で入れてください");
  if (!/^\d{3}$/.test(a.branchCode)) problems.push("支店コードは3けたの数字で入れてください");
  if (!/^\d{1,7}$/.test(a.accountNumber)) problems.push("口座番号は7けたまでの数字で入れてください");
  const names: [string, string][] = [["金融機関名", a.bankName], ["支店名", a.branchName]];
  if (holderName !== undefined) {
    if (!holderName.trim()) problems.push("口座名義（カナ）を入れてください");
    names.push(["口座名義", holderName]);
  }
  for (const [label, value] of names) {
    const { invalid } = toZenginText(value);
    if (invalid.length > 0) problems.push(`${label}に使えない字があります（${invalid.join("")}）。カナ・英数字で入れてください`);
  }
  return problems;
};

/** 振込元の口座の入れ方の間違い（なければ空） */
export const sourceAccountProblems = (a: SourceAccount): string[] => {
  const problems = bankAccountProblems(a);
  if (!/^\d{10}$/.test(a.clientCode)) problems.push("委託者コード（会社コード）は10けたの数字で入れてください（銀行から知らされた番号）");
  if (!a.clientName.trim()) problems.push("委託者名（カナ）を入れてください");
  const { invalid } = toZenginText(a.clientName);
  if (invalid.length > 0) problems.push(`委託者名に使えない字があります（${invalid.join("")}）。カナ・英数字で入れてください`);
  return problems;
};

// ── 振込額を口座に分ける ──────────────────────────────────────

/**
 * 差引支給額を、振込先の口座に分ける（固定額の口座に順に固定額を、残りを「残り」の口座に。クラウド型の給与ソフトの
 * 「固定額1・固定額2・残額」と同じ）
 * @returns 口座ごとの額（0円の口座は入れない）。分けられないとき（固定額が差引支給額より多い・「残り」の口座がない）は error
 */
export const splitTransfer = (netPay: number, accounts: StaffAccount[]): { lines: { account: StaffAccount; amount: number }[]; error: string | null } => {
  const pay = Math.max(0, Math.floor(netPay));
  const rest = accounts.filter((a) => a.fixedAmount === null);
  if (rest.length !== 1) return { lines: [], error: "残りを振り込む口座を1つ決めてください（従業員の画面の「振込先口座」）" };
  const fixed = accounts.filter((a) => a.fixedAmount !== null);
  const fixedTotal = fixed.reduce((sum, a) => sum + Math.max(0, Math.floor(Number(a.fixedAmount) || 0)), 0);
  if (fixedTotal > pay) return { lines: [], error: `固定額の合計（${fixedTotal.toLocaleString()}円）が差引支給額（${pay.toLocaleString()}円）より多くなっています` };
  const lines = [
    ...fixed.map((a) => ({ account: a, amount: Math.max(0, Math.floor(Number(a.fixedAmount) || 0)) })),
    { account: rest[0], amount: pay - fixedTotal },
  ].filter((l) => l.amount > 0);
  return { lines, error: null };
};

// ── レコード ─────────────────────────────────────────────

/** 項目の値を、決まったバイト数にする（数字：右詰め・前を0で埋める。空ならスペース／文字：左詰め・後ろをスペースで埋める。長ければ切る） */
const fieldText = (field: ZenginField, value: string | number | null): string => {
  const v = value === null ? "" : String(value);
  if (field.type === "N") {
    if (v === "") return " ".repeat(field.length);
    if (!isDigits(v)) throw new Error(`${field.name}は数字で入れてください（${v}）`);
    if (v.length > field.length) throw new Error(`${field.name}が${field.length}けたを超えています（${v}）`);
    return v.padStart(field.length, "0");
  }
  return v.slice(0, field.length).padEnd(field.length, " ");
};

/** 項目の名前と値から、1レコード（120バイト）を作る */
const record = (fields: ZenginField[], values: Record<string, string | number | null>): string => {
  const text = fields.map((f) => fieldText(f, f.name in values ? values[f.name] : f.type === "C" ? "" : null)).join("");
  if (text.length !== ZENGIN_RECORD_LENGTH) throw new Error(`レコードが${text.length}バイトになりました（${ZENGIN_RECORD_LENGTH}のはず）`);
  return text;
};

/** 振込1件 */
export interface TransferLine {
  account: StaffAccount;
  amount: number;
  /** 社員番号（数字だけなら書く。数字でなければ空） */
  staffCode: string;
}

export interface ZenginFileInput {
  kind: "salary" | "bonus";
  source: SourceAccount;
  /** 振込指定日（YYYY-MM-DD。レコードには月日だけを書く） */
  transferDate: string;
  lines: TransferLine[];
}

/** 振込データのレコード（ヘッダー・データ・トレーラー・エンド）を作る */
export const buildZenginRecords = (input: ZenginFileInput): string[] => {
  const name = (s: string) => toZenginText(s).text;
  const { source } = input;
  const [, mm, dd] = input.transferDate.split("-");
  const header = record(ZENGIN_HEADER, {
    "データ区分": ZENGIN_RECORD_KIND.header,
    "種別コード": ZENGIN_KIND_CODE[input.kind],
    "コード区分": ZENGIN_CODE_JIS,
    "会社コード": source.clientCode,
    "会社名": name(source.clientName),
    "振込指定日": `${mm}${dd}`,
    "仕向銀行番号": source.bankCode,
    "仕向銀行名": name(source.bankName),
    "仕向支店番号": source.branchCode,
    "仕向支店名": name(source.branchName),
    "預金種目(企業等)": ZENGIN_ACCOUNT_TYPE[source.accountType],
    "口座番号(企業等)": source.accountNumber,
  });
  const data = input.lines.map((l) => record(ZENGIN_DATA, {
    "データ区分": ZENGIN_RECORD_KIND.data,
    "被仕向銀行番号": l.account.bankCode,
    "被仕向銀行名": name(l.account.bankName),
    "被仕向支店番号": l.account.branchCode,
    "被仕向支店名": name(l.account.branchName),
    "手形交換所番号": null,
    "預金種目": ZENGIN_ACCOUNT_TYPE[l.account.accountType],
    "口座番号": l.account.accountNumber,
    "預金者名": name(l.account.holderName),
    "振込金額": Math.floor(l.amount),
    "新規コード": ZENGIN_NEW_CODE,
    "社員番号": isDigits(l.staffCode) && l.staffCode.length <= 10 ? l.staffCode : null,
    "所属コード": null,
  }));
  const total = input.lines.reduce((sum, l) => sum + Math.floor(l.amount), 0);
  const trailer = record(ZENGIN_TRAILER, { "データ区分": ZENGIN_RECORD_KIND.trailer, "合計件数": input.lines.length, "合計金額": total });
  const end = record(ZENGIN_END, { "データ区分": ZENGIN_RECORD_KIND.end });
  return [header, ...data, trailer, end];
};

/**
 * レコードを、銀行に送るファイルの中身（Shift_JIS の1バイトの字）にする
 * @param newline true なら各レコードの後ろに改行（CR+LF）を付ける（レコード長122）。false なら付けない（レコード長120）
 */
export const encodeZengin = (records: string[], newline: boolean): Uint8Array => {
  const text = records.join(newline ? "\r\n" : "") + (newline ? "\r\n" : "");
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if ((code >= 0x20 && code <= 0x7e) || code === 0x0d || code === 0x0a) bytes[i] = code;
    else if (code >= 0xff61 && code <= 0xff9f) bytes[i] = code - 0xfec0; // 半角カナ → Shift_JIS の 0xA1〜0xDF
    else throw new Error(`振込データに書けない字があります（${text[i]}）`);
  }
  return bytes;
};
