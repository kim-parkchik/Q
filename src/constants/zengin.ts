/**
 * 全銀協規定形式（給与・賞与振込）のレコードの形（scripts/import_zengin_format.py が銀行の仕様書の PDF から作る。手で直さない）
 * 出典: 三菱UFJ銀行 BizSTATION「給与・賞与振込（全銀形式）レコードフォーマット」（form_4_1_2_20080512.pdf）
 * 照らし合わせ: ゆうちょ銀行「給与振込媒体仕様説明書（ゆうちょBizダイレクト全銀形式）」1.1版（dataform_kyuyo.pdf）
 * 入手元と SHA-256 は zengin-format/README.md
 */

/** 項目（type は N：数字（右詰め・前を0で埋める）／C：文字（左詰め・後ろをスペースで埋める）。length はバイト数） */
export interface ZenginField {
  name: string;
  type: "N" | "C";
  length: number;
}

/** 1レコードのバイト数 */
export const ZENGIN_RECORD_LENGTH = 120;

/** ヘッダーレコード */
export const ZENGIN_HEADER: ZenginField[] = [
  { name: "データ区分", type: "N", length: 1 },
  { name: "種別コード", type: "N", length: 2 },
  { name: "コード区分", type: "N", length: 1 },
  { name: "会社コード", type: "N", length: 10 },
  { name: "会社名", type: "C", length: 40 },
  { name: "振込指定日", type: "N", length: 4 },
  { name: "仕向銀行番号", type: "N", length: 4 },
  { name: "仕向銀行名", type: "C", length: 15 },
  { name: "仕向支店番号", type: "N", length: 3 },
  { name: "仕向支店名", type: "C", length: 15 },
  { name: "預金種目(企業等)", type: "N", length: 1 },
  { name: "口座番号(企業等)", type: "N", length: 7 },
  { name: "ダミー", type: "C", length: 17 },
];

/** データレコード（振込1件） */
export const ZENGIN_DATA: ZenginField[] = [
  { name: "データ区分", type: "N", length: 1 },
  { name: "被仕向銀行番号", type: "N", length: 4 },
  { name: "被仕向銀行名", type: "C", length: 15 },
  { name: "被仕向支店番号", type: "N", length: 3 },
  { name: "被仕向支店名", type: "C", length: 15 },
  { name: "手形交換所番号", type: "N", length: 4 },
  { name: "預金種目", type: "N", length: 1 },
  { name: "口座番号", type: "N", length: 7 },
  { name: "預金者名", type: "C", length: 30 },
  { name: "振込金額", type: "N", length: 10 },
  { name: "新規コード", type: "N", length: 1 },
  { name: "社員番号", type: "N", length: 10 },
  { name: "所属コード", type: "N", length: 10 },
  { name: "ダミー", type: "C", length: 9 },
];

/** トレーラーレコード */
export const ZENGIN_TRAILER: ZenginField[] = [
  { name: "データ区分", type: "N", length: 1 },
  { name: "合計件数", type: "N", length: 6 },
  { name: "合計金額", type: "N", length: 12 },
  { name: "ダミー", type: "C", length: 101 },
];

/** エンドレコード */
export const ZENGIN_END: ZenginField[] = [
  { name: "データ区分", type: "N", length: 1 },
  { name: "ダミー", type: "C", length: 119 },
];

/** データ区分 */
export const ZENGIN_RECORD_KIND = { header: "1", data: "2", trailer: "8", end: "9" } as const;

/** 種別コード（給与振込・賞与振込） */
export const ZENGIN_KIND_CODE = { salary: "11", bonus: "12" } as const;

/** コード区分（JIS） */
export const ZENGIN_CODE_JIS = "0";

/** 預金種目（普通預金・当座預金） */
export const ZENGIN_ACCOUNT_TYPE = { ordinary: "1", current: "2" } as const;

/** 新規コード */
export const ZENGIN_NEW_CODE = "0";

/** 受取人名・依頼人名などに使える記号（数字・英大文字・半角カナ・スペースのほか。両方の銀行で使えるものだけ） */
export const ZENGIN_NAME_SYMBOLS = "()-/,.";
