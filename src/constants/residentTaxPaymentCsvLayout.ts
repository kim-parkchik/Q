/**
 * eLTAX の納付情報発行依頼（個人住民税（特別徴収））に取り込む CSV の項目（ヘッダー・レコード 10項目・データ・レコード 12項目・トレーラー・レコード 8項目・エンド・レコード 2項目）
 * ファイルは ヘッダー・レコード（1行）→ データ・レコード（市区町村ごと）→ トレーラー・レコード → エンド・レコード の順。文字コードは UTF-8
 *
 * ⚠️ このファイルは自動生成です。手で書き換えないでください。
 * 元データ: 地方税共同機構「個人住民税（特別徴収）CSVレイアウト仕様書（CSVフォーマット）」の Excel（個人住民税（特別徴収）CSVレイアウト仕様書（CSVフォーマット）.xlsx。SHA-256 2c93204fa4592668161506d9a00c71cf63142660d90a78a639cd461eac83b492）
 * 出典    : 地方税共同機構「共通納税（電子納付） 仕様書・様式集」（https://www.lta.go.jp/documents/00103）
 * 作り方  : python3 -I scripts/import_nofu_csv_layout.py <Excel> <このファイル>
 * 中身    : no 項目の番号 / name CSV項目名称 / required 必須（○：必須。※１：取り込むときは必須でないが、計算を確かめるので入れる）/
 *           attr 文字属性 / max 文字数 / fixed 決まった値（「○であること」）
 */

export interface ResidentTaxPaymentCsvField {
  no: number;
  name: string;
  required: string;
  attr: "数字" | "半角" | "全角" | "半角カナ";
  max: number;
  fixed?: string;
}

export const RESIDENT_TAX_PAYMENT_CSV: Record<"header" | "data" | "trailer" | "end", ResidentTaxPaymentCsvField[]> = {
  header: [
    {"no": 1, "name": "データ区分", "required": "○", "attr": "数字", "max": 1, "fixed": "1"},
    {"no": 2, "name": "種別コード", "required": "○", "attr": "数字", "max": 2, "fixed": "99"},
    {"no": 3, "name": "使用コード", "required": "", "attr": "数字", "max": 1},
    {"no": 4, "name": "委託者コード", "required": "", "attr": "数字", "max": 10},
    {"no": 5, "name": "取引支店番号", "required": "", "attr": "数字", "max": 3},
    {"no": 6, "name": "納期限", "required": "", "attr": "数字", "max": 6},
    {"no": 7, "name": "納付月分", "required": "", "attr": "数字", "max": 4},
    {"no": 8, "name": "特別徴収義務者名", "required": "", "attr": "半角カナ", "max": 40},
    {"no": 9, "name": "特別徴収義務者の所在地", "required": "", "attr": "半角カナ", "max": 50},
    {"no": 10, "name": "ダミー", "required": "", "attr": "半角", "max": 3},
  ],
  data: [
    {"no": 1, "name": "データ区分", "required": "○", "attr": "数字", "max": 1, "fixed": "3"},
    {"no": 2, "name": "市区町村コード", "required": "○", "attr": "数字", "max": 6},
    {"no": 3, "name": "納付月分", "required": "○", "attr": "数字", "max": 4},
    {"no": 4, "name": "指定番号", "required": "", "attr": "半角", "max": 15},
    {"no": 5, "name": "給与税額（件数）", "required": "○", "attr": "半角", "max": 5},
    {"no": 6, "name": "給与税額（金額）", "required": "○", "attr": "半角", "max": 9},
    {"no": 7, "name": "督促手数料（金額）", "required": "○", "attr": "半角", "max": 9},
    {"no": 8, "name": "延滞金（金額）", "required": "○", "attr": "数字", "max": 9},
    {"no": 9, "name": "合計税額（件数）", "required": "○", "attr": "数字", "max": 5},
    {"no": 10, "name": "合計税額（金額）", "required": "○", "attr": "数字", "max": 9},
    {"no": 11, "name": "備考", "required": "", "attr": "全角", "max": 20},
    {"no": 12, "name": "ダミー", "required": "", "attr": "半角", "max": 8},
  ],
  trailer: [
    {"no": 1, "name": "データ区分", "required": "○", "attr": "数字", "max": 1, "fixed": "8"},
    {"no": 2, "name": "給与税額合計（件数）", "required": "○", "attr": "数字", "max": 7},
    {"no": 3, "name": "給与税額合計（金額）", "required": "○", "attr": "数字", "max": 11},
    {"no": 4, "name": "退職税額合計（件数）", "required": "", "attr": "数字", "max": 7},
    {"no": 5, "name": "退職税額合計（金額）", "required": "", "attr": "数字", "max": 11},
    {"no": 6, "name": "合計税額（件数）", "required": "※１", "attr": "数字", "max": 7},
    {"no": 7, "name": "合計税額（金額）", "required": "※１", "attr": "数字", "max": 11},
    {"no": 8, "name": "ダミー", "required": "", "attr": "半角", "max": 65},
  ],
  end: [
    {"no": 1, "name": "データ区分", "required": "○", "attr": "数字", "max": 1, "fixed": "9"},
    {"no": 2, "name": "ダミー", "required": "", "attr": "半角", "max": 119},
  ],
};
