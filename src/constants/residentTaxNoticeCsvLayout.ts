/**
 * eLTAX で受け取る特別徴収税額通知（特別徴収義務者用）の CSV の項目（23項目。1行に1人。項目名の行はない）
 *
 * ⚠️ このファイルは自動生成です。手で書き換えないでください。
 * 元データ: 地方税共同機構「特別徴収税額通知（総務省通知形式CSV)」の Excel（処分通知等（税額通知）CSVレイアウト仕様書(総務省通知形式)　平成29年1月1日～.xlsx。SHA-256 819ba33c04657b24cbd242a0200cddca825e92be20fd49c68a68aabed92ea0ee）
 * 出典    : 地方税共同機構「仕様書・様式集」 処分通知等（税額通知）CSVレイアウト仕様書（総務省通知形式）（https://www.lta.go.jp/documents/00084）
 * 作り方  : python3 -I scripts/import_tokucho_notice_layout.py <Excel> <このファイル>
 * 中身    : no 項目の番号 / name CSV項目名称 / attr 文字属性（数字・半角・全角・半角カナ）/ max 文字数
 */

export interface ResidentTaxNoticeCsvField {
  no: number;
  name: string;
  attr: "数字" | "半角" | "全角" | "半角カナ";
  max: number;
}

export const RESIDENT_TAX_NOTICE_CSV_FIELDS: ResidentTaxNoticeCsvField[] = [
  {"no": 1, "name": "指定番号", "attr": "半角", "max": 12},
  {"no": 2, "name": "宛名番号", "attr": "半角", "max": 11},
  {"no": 3, "name": "市町村コード", "attr": "数字", "max": 6},
  {"no": 4, "name": "受給者番号", "attr": "半角", "max": 25},
  {"no": 5, "name": "納税義務者－住所", "attr": "全角", "max": 60},
  {"no": 6, "name": "納税義務者－漢字氏名", "attr": "全角", "max": 30},
  {"no": 7, "name": "納税義務者－カナ氏名", "attr": "半角カナ", "max": 60},
  {"no": 8, "name": "納税義務者－個人番号", "attr": "数字", "max": 12},
  {"no": 9, "name": "特別徴収税額（年税額）", "attr": "数字", "max": 9},
  {"no": 10, "name": "特別徴収税額（月割額）－６月分", "attr": "数字", "max": 8},
  {"no": 11, "name": "特別徴収税額（月割額）－７月分", "attr": "数字", "max": 8},
  {"no": 12, "name": "特別徴収税額（月割額）－８月分", "attr": "数字", "max": 8},
  {"no": 13, "name": "特別徴収税額（月割額）－９月分", "attr": "数字", "max": 8},
  {"no": 14, "name": "特別徴収税額（月割額）－１０月分", "attr": "数字", "max": 8},
  {"no": 15, "name": "特別徴収税額（月割額）－１１月分", "attr": "数字", "max": 8},
  {"no": 16, "name": "特別徴収税額（月割額）－１２月分", "attr": "数字", "max": 8},
  {"no": 17, "name": "特別徴収税額（月割額）－１月分", "attr": "数字", "max": 8},
  {"no": 18, "name": "特別徴収税額（月割額）－２月分", "attr": "数字", "max": 8},
  {"no": 19, "name": "特別徴収税額（月割額）－３月分", "attr": "数字", "max": 8},
  {"no": 20, "name": "特別徴収税額（月割額）－４月分", "attr": "数字", "max": 8},
  {"no": 21, "name": "特別徴収税額（月割額）－５月分", "attr": "数字", "max": 8},
  {"no": 22, "name": "変更月", "attr": "数字", "max": 2},
  {"no": 23, "name": "摘要", "attr": "全角", "max": 40},
];
