/**
 * 健康保険・厚生年金保険の届書の電子申請用ファイル（CSV形式届書ファイル。年金事務所提出）の形
 *
 * このファイルは scripts/import_shaho_format.py が、厚生労働省・日本年金機構の仕様書の PDF から作ったものです（手で直さない）。
 * 仕様書：「CSV形式届書作成仕様書（電子申請）・電子媒体届書作成仕様書（CD/DVD仕様書）（健康保険・厚生年金保険適用関係届書）」
 * 令和8年10月（第17.0版）。入手元と SHA-256 は shaho-format/README.md
 */

/** 仕様書の版 */
export const SHAHO_SPEC_VERSION = "令和8年10月（第17.0版）";
/** 年金事務所に出す CSV 形式届書ファイルの名前（3.1.1） */
export const SHAHO_FILE_NAME = "SHFD0006.CSV";
/** 事業所識別符号・データ識別符号（表3.3-1） */
export const SHAHO_OFFICE_MARK = "[kanri]";
export const SHAHO_DATA_MARK = "[data]";
/** 代表届書コード（表4.1.1-1） */
export const SHAHO_REPRESENTATIVE_CODE = "22223";
/** 事業所情報数（表4.3.1-1。事業所が出すとき） */
export const SHAHO_OFFICE_COUNT = "001";
/** 賞与支払届・70歳以上被用者賞与支払届の様式コード（表4.9.1-1） */
export const SHAHO_BONUS_FORM_CODE = "2265700";

/**
 * 項目の決まり（第4章の項目説明）
 * kinds：種別（数字・英字・カナ・漢字。「-」は省略する項目）／min・max：文字数（min が 0 なら省略できる）／
 * only：この文字数だけ（「0,12」は 0 文字（省略）か 12 文字）／alt：漢字で書けないときにカナなどで書くときの決まり
 */
export interface ShahoField {
  name: string;
  kinds: string[];
  min: number;
  max: number;
  only?: number[];
  alt?: ShahoField;
}

/** 媒体管理レコード（年金事務所提出。図4.1.1-1・表4.1.1-1） */
export const SHAHO_MEDIA_FIELDS: ShahoField[] = [
  {"name": "都道府県コード", "kinds": ["数字"], "min": 2, "max": 2},
  {"name": "郡市区符号", "kinds": ["数字"], "min": 2, "max": 2},
  {"name": "事業所記号", "kinds": ["数字", "英字", "カナ"], "min": 1, "max": 4},
  {"name": "媒体通番", "kinds": ["数字"], "min": 3, "max": 3},
  {"name": "作成年月日", "kinds": ["数字"], "min": 8, "max": 8},
  {"name": "代表届書コード", "kinds": ["数字"], "min": 5, "max": 5},
];

/** 事業所数情報の事業所情報数（表4.3.1-1） */
export const SHAHO_OFFICE_COUNT_FIELD: ShahoField = {"name": "事業所情報数", "kinds": ["数字"], "min": 1, "max": 3};

/** 事業所情報（年金事務所提出。図4.3.2.1-1・表4.3.2.1-1） */
export const SHAHO_OFFICE_FIELDS: ShahoField[] = [
  {"name": "都道府県コード", "kinds": ["数字"], "min": 2, "max": 2},
  {"name": "郡市区符号", "kinds": ["数字"], "min": 2, "max": 2},
  {"name": "事業所記号", "kinds": ["数字", "英字", "カナ"], "min": 1, "max": 4},
  {"name": "事業所番号", "kinds": ["数字"], "min": 1, "max": 5},
  {"name": "親番号(郵便番号)", "kinds": ["数字"], "min": 3, "max": 3},
  {"name": "子番号(郵便番号)", "kinds": ["数字"], "min": 4, "max": 4},
  {"name": "事業所所在地", "kinds": ["漢字"], "min": 1, "max": 37, "alt": {"name": "カナで書くとき", "kinds": ["数字", "英字", "カナ"], "min": 1, "max": 75}},
  {"name": "事業所名称", "kinds": ["漢字"], "min": 1, "max": 25, "alt": {"name": "カナで書くとき", "kinds": ["カナ"], "min": 1, "max": 50}},
  {"name": "事業主氏名", "kinds": ["漢字"], "min": 1, "max": 12, "alt": {"name": "カナで書くとき", "kinds": ["カナ"], "min": 1, "max": 25}},
  {"name": "局番1(電話番号)", "kinds": ["数字"], "min": 2, "max": 5},
  {"name": "局番2(電話番号)", "kinds": ["数字"], "min": 1, "max": 4},
  {"name": "局番3(電話番号)", "kinds": ["数字"], "min": 4, "max": 5},
];

/** 賞与支払届・70歳以上被用者賞与支払届データレコード（年金事務所提出。図4.9.1-1・表4.9.1-1） */
export const SHAHO_BONUS_FIELDS: ShahoField[] = [
  {"name": "様式コード", "kinds": ["数字"], "min": 7, "max": 7},
  {"name": "都道府県コード", "kinds": ["数字"], "min": 2, "max": 2},
  {"name": "郡市区符号", "kinds": ["数字"], "min": 2, "max": 2},
  {"name": "事業所記号", "kinds": ["数字", "英字", "カナ"], "min": 1, "max": 4},
  {"name": "被保険者整理番号", "kinds": ["数字"], "min": 0, "max": 6},
  {"name": "被保険者氏名(カナ)", "kinds": ["カナ"], "min": 1, "max": 25},
  {"name": "被保険者氏名(漢字)", "kinds": ["漢字"], "min": 0, "max": 12},
  {"name": "元号(生年月日)", "kinds": ["数字"], "min": 1, "max": 1},
  {"name": "年月日(生年月日)", "kinds": ["数字"], "min": 6, "max": 6},
  {"name": "元号(賞与支払年月日)", "kinds": ["数字"], "min": 1, "max": 1},
  {"name": "年月日(賞与支払年月日)", "kinds": ["数字"], "min": 6, "max": 6},
  {"name": "通貨によるものの額", "kinds": ["数字"], "min": 1, "max": 7},
  {"name": "現物によるものの額", "kinds": ["数字"], "min": 1, "max": 7},
  {"name": "合計(賞与額)", "kinds": ["数字"], "min": 1, "max": 7},
  {"name": "個人番号", "kinds": ["数字"], "min": 0, "max": 12, "only": [0, 12]},
  {"name": "課所符号(年番)", "kinds": ["数字"], "min": 0, "max": 4, "only": [0, 4]},
  {"name": "一連番号(年番)", "kinds": ["数字"], "min": 0, "max": 6, "only": [0, 6]},
  {"name": "備考欄項目1", "kinds": ["数字"], "min": 0, "max": 1, "only": [0, 1]},
  {"name": "備考欄項目2", "kinds": ["数字"], "min": 0, "max": 1, "only": [0, 1]},
  {"name": "備考欄項目3", "kinds": ["数字"], "min": 0, "max": 2, "only": [0, 2]},
  {"name": "70歳以上被用者届のみ提出", "kinds": ["数字"], "min": 0, "max": 1, "only": [0, 1]},
];

/** 元号のコード（生年月日・賞与支払年月日。表4.9.1-1） */
export const SHAHO_BIRTH_ERA_CODES: Record<string, string> = {"明治": "1", "大正": "3", "昭和": "5", "平成": "7", "令和": "9"};
export const SHAHO_PAY_ERA_CODES: Record<string, string> = {"平成": "7", "令和": "9"};

/** 都道府県コード（参考資料3。都道府県名 → コード。全国地方公共団体コードとは違う） */
export const SHAHO_PREFECTURE_CODES: Record<string, string> = {"北海道": "01", "青森県": "02", "岩手県": "03", "宮城県": "04", "秋田県": "05", "山形県": "06", "福島県": "07", "茨城県": "08", "栃木県": "09", "群馬県": "10", "埼玉県": "11", "千葉県": "12", "東京都": "21", "神奈川県": "31", "新潟県": "32", "富山県": "33", "石川県": "34", "福井県": "35", "山梨県": "36", "長野県": "37", "岐阜県": "38", "静岡県": "39", "大阪府": "41", "兵庫県": "42", "愛知県": "51", "三重県": "52", "滋賀県": "53", "京都府": "54", "奈良県": "55", "和歌山県": "56", "鳥取県": "57", "島根県": "58", "岡山県": "59", "広島県": "60", "山口県": "61", "徳島県": "71", "香川県": "72", "愛媛県": "73", "高知県": "74", "福岡県": "75", "佐賀県": "76", "長崎県": "77", "熊本県": "78", "大分県": "79", "宮崎県": "80", "鹿児島県": "81", "沖縄県": "82"};

/** 1バイト文字で項目に書ける字（表3.4-2。数字・英字・半角カナ・ハイフン・スペース。カンマと括弧は区切り・識別符号だけに使う） */
export const SHAHO_SINGLE_BYTE_CHARS = " -0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝﾞﾟ";

/**
 * 2バイト文字で使えるシフトJISのコードの範囲（表3.4-3 の「使用可能コード範囲」）
 * 下2桁が 7F・FD〜3F、上2桁が A0〜DF のコードは使えない（表3.4-3 の注）
 */
export const SHAHO_DOUBLE_BYTE_RANGES: [number, number][] = [[0x8140, 0x8140], [0x8141, 0x8164], [0x8165, 0x817A], [0x817B, 0x818A], [0x818B, 0x8193], [0x8194, 0x819E], [0x819F, 0x81AC], [0x824F, 0x8258], [0x8260, 0x8279], [0x8281, 0x829A], [0x829F, 0x82F1], [0x8340, 0x8396], [0x839F, 0x83B6], [0x83BF, 0x83D6], [0x8440, 0x8460], [0x8470, 0x8491], [0x889F, 0x9872], [0x989F, 0xEAA4]];
