/**
 * eLTAX に取り込む給与所得者異動届出書の CSV の項目（68項目。この順に、カンマで区切って1行に1枚の届出書）
 *
 * ⚠️ このファイルは自動生成です。手で書き換えないでください。
 * 元データ: 地方税共同機構「給与所得者異動届出書 CSVファイルレイアウト」の Excel（給与所得者異動届出書CSVレイアウト仕様書　令和3年4月1日～.xlsx。SHA-256 55593390fc20eaf8e4d29e3434b9f6f28c8d02e93288c817e027aadbd1e29d8d）
 * 出典    : 地方税共同機構「仕様書・様式集」 給与所得者異動届出書CSVレイアウト仕様書 令和3年4月1日～（https://www.lta.go.jp/documents/05122）
 * 作り方  : python3 -I scripts/import_idou_csv_layout.py <Excel> <このファイル>
 * 中身    : no 項目の番号 / group まとまり（「特別徴収継続の場合」など）/ name CSV項目名称 /
 *           required 必須（○：いつも必須。△：条件によって必須。空：任意）/
 *           when 書く条件（年度が「1：現年度」「3：両年度」で、徴収の方法が特別徴収継続（tokucho）・一括徴収（ikkatsu）・
 *           普通徴収（futsu）のときと、年度が「2：新年度」のとき（newYear）。表で空の列は「特徴継続」の列と同じ）/
 *           type 型 / attr 文字属性（数字・半角・全角）/ max 文字数 / codeId コードID / codes コードと意味（「データの意味」から）
 */

export interface IdouCsvField {
  no: number;
  group: string;
  name: string;
  required: "○" | "△" | "";
  when: { tokucho: string; ikkatsu: string; futsu: string; newYear: string };
  type?: string;
  attr: "数字" | "半角" | "全角";
  max: number;
  codeId?: string;
  codes?: { code: string; label: string }[];
}

export const IDOU_CSV_TITLE = "給与所得者異動届出書 CSVファイルレイアウト";

/** 1番「ファイルの種類」に書く値 */
export const IDOU_FILE_KIND = "L01";

/** 元号の数字（生年月日・期間・年月日の「元号」の項目） */
export const IDOU_ERA_CODES: Record<string, string> = {"昭和": "1", "大正": "2", "明治": "3", "平成": "4", "令和": "5"};

/** 全角の項目で使えない文字（e-Tax で使えない文字） */
export const IDOU_NG_ZENKAKU: string[] = ["℃", "Å", "⌒", "★", "☆", "♀", "♂", "♪", "♭", "♯"];

/** 半角の項目で使えない文字（CSV の区切りに使うため） */
export const IDOU_NG_HANKAKU: string[] = [",", "@"];

export const IDOU_CSV_FIELDS: IdouCsvField[] = [
  {"no": 1, "group": "", "name": "ファイルの種類", "required": "○", "when": {"tokucho": "必須", "ikkatsu": "必須", "futsu": "必須", "newYear": "必須"}, "attr": "半角", "max": 3},
  {"no": 2, "group": "", "name": "年度", "required": "○", "when": {"tokucho": "必須", "ikkatsu": "必須", "futsu": "必須", "newYear": "必須"}, "attr": "数字", "max": 1, "codeId": "CC6680", "codes": [{"code": "1", "label": "現年度"}, {"code": "2", "label": "新年度"}, {"code": "3", "label": "両年度"}]},
  {"no": 3, "group": "", "name": "給与支払者－特別徴収義務者指定番号", "required": "△", "when": {"tokucho": "必須", "ikkatsu": "必須", "futsu": "必須", "newYear": "任意"}, "attr": "半角", "max": 12},
  {"no": 4, "group": "", "name": "給与支払者－宛名番号", "required": "", "when": {"tokucho": "任意", "ikkatsu": "任意", "futsu": "任意", "newYear": "任意"}, "attr": "半角", "max": 11},
  {"no": 5, "group": "", "name": "給与所得者－フリガナ", "required": "○", "when": {"tokucho": "必須", "ikkatsu": "必須", "futsu": "必須", "newYear": "必須"}, "attr": "全角", "max": 60},
  {"no": 6, "group": "", "name": "給与所得者－氏名", "required": "○", "when": {"tokucho": "必須", "ikkatsu": "必須", "futsu": "必須", "newYear": "必須"}, "attr": "全角", "max": 30},
  {"no": 7, "group": "", "name": "給与所得者の生年月日－元号", "required": "○", "when": {"tokucho": "必須", "ikkatsu": "必須", "futsu": "必須", "newYear": "必須"}, "attr": "数字", "max": 1},
  {"no": 8, "group": "", "name": "給与所得者の生年月日－年", "required": "○", "when": {"tokucho": "必須", "ikkatsu": "必須", "futsu": "必須", "newYear": "必須"}, "attr": "数字", "max": 2},
  {"no": 9, "group": "", "name": "給与所得者の生年月日－月", "required": "○", "when": {"tokucho": "必須", "ikkatsu": "必須", "futsu": "必須", "newYear": "必須"}, "attr": "数字", "max": 2},
  {"no": 10, "group": "", "name": "給与所得者の生年月日－日", "required": "○", "when": {"tokucho": "必須", "ikkatsu": "必須", "futsu": "必須", "newYear": "必須"}, "attr": "数字", "max": 2},
  {"no": 11, "group": "", "name": "給与所得者－個人番号", "required": "", "when": {"tokucho": "任意", "ikkatsu": "任意", "futsu": "任意", "newYear": "任意"}, "attr": "数字", "max": 12},
  {"no": 12, "group": "", "name": "給与所得者－受給者番号", "required": "", "when": {"tokucho": "任意", "ikkatsu": "任意", "futsu": "任意", "newYear": "任意"}, "attr": "半角", "max": 25},
  {"no": 13, "group": "", "name": "給与所得者－１月１日現在の住所", "required": "", "when": {"tokucho": "任意", "ikkatsu": "任意", "futsu": "任意", "newYear": "任意"}, "attr": "全角", "max": 60},
  {"no": 14, "group": "", "name": "給与所得者－異動後の住所", "required": "○", "when": {"tokucho": "必須", "ikkatsu": "必須", "futsu": "必須", "newYear": "必須"}, "attr": "全角", "max": 60},
  {"no": 15, "group": "", "name": "特別徴収税額（年税額）", "required": "△", "when": {"tokucho": "必須", "ikkatsu": "必須", "futsu": "必須", "newYear": "設定不可"}, "attr": "数字", "max": 10},
  {"no": 16, "group": "", "name": "徴収済期間－自（元号）", "required": "△", "when": {"tokucho": "徴収済額が1円以上の場合は必須0円の場合は任意", "ikkatsu": "徴収済額が1円以上の場合は必須0円の場合は任意", "futsu": "徴収済額が1円以上の場合は必須0円の場合は任意", "newYear": "設定不可"}, "attr": "数字", "max": 1},
  {"no": 17, "group": "", "name": "徴収済期間－自（年）", "required": "△", "when": {"tokucho": "徴収済額が1円以上の場合は必須0円の場合は任意", "ikkatsu": "徴収済額が1円以上の場合は必須0円の場合は任意", "futsu": "徴収済額が1円以上の場合は必須0円の場合は任意", "newYear": "設定不可"}, "attr": "数字", "max": 2},
  {"no": 18, "group": "", "name": "徴収済期間－自（月）", "required": "△", "when": {"tokucho": "徴収済額が1円以上の場合は必須0円の場合は任意", "ikkatsu": "徴収済額が1円以上の場合は必須0円の場合は任意", "futsu": "徴収済額が1円以上の場合は必須0円の場合は任意", "newYear": "設定不可"}, "attr": "数字", "max": 2},
  {"no": 19, "group": "", "name": "徴収済期間－至（元号）", "required": "△", "when": {"tokucho": "徴収済額が1円以上の場合は必須0円の場合は任意", "ikkatsu": "徴収済額が1円以上の場合は必須0円の場合は任意", "futsu": "徴収済額が1円以上の場合は必須0円の場合は任意", "newYear": "設定不可"}, "attr": "数字", "max": 1},
  {"no": 20, "group": "", "name": "徴収済期間－至（年）", "required": "△", "when": {"tokucho": "徴収済額が1円以上の場合は必須0円の場合は任意", "ikkatsu": "徴収済額が1円以上の場合は必須0円の場合は任意", "futsu": "徴収済額が1円以上の場合は必須0円の場合は任意", "newYear": "設定不可"}, "attr": "数字", "max": 2},
  {"no": 21, "group": "", "name": "徴収済期間－至（月）", "required": "△", "when": {"tokucho": "徴収済額が1円以上の場合は必須0円の場合は任意", "ikkatsu": "徴収済額が1円以上の場合は必須0円の場合は任意", "futsu": "徴収済額が1円以上の場合は必須0円の場合は任意", "newYear": "設定不可"}, "attr": "数字", "max": 2},
  {"no": 22, "group": "", "name": "徴収済額", "required": "△", "when": {"tokucho": "必須", "ikkatsu": "必須", "futsu": "必須", "newYear": "設定不可"}, "attr": "数字", "max": 10},
  {"no": 23, "group": "", "name": "未徴収期間－自（元号）", "required": "△", "when": {"tokucho": "未徴収税額が1円以上の場合は必須0円の場合は任意", "ikkatsu": "未徴収税額が1円以上の場合は必須0円の場合は任意", "futsu": "未徴収税額が1円以上の場合は必須0円の場合は任意", "newYear": "設定不可"}, "attr": "数字", "max": 1},
  {"no": 24, "group": "", "name": "未徴収期間－自（年）", "required": "△", "when": {"tokucho": "未徴収税額が1円以上の場合は必須0円の場合は任意", "ikkatsu": "未徴収税額が1円以上の場合は必須0円の場合は任意", "futsu": "未徴収税額が1円以上の場合は必須0円の場合は任意", "newYear": "設定不可"}, "attr": "数字", "max": 2},
  {"no": 25, "group": "", "name": "未徴収期間－自（月）", "required": "△", "when": {"tokucho": "未徴収税額が1円以上の場合は必須0円の場合は任意", "ikkatsu": "未徴収税額が1円以上の場合は必須0円の場合は任意", "futsu": "未徴収税額が1円以上の場合は必須0円の場合は任意", "newYear": "設定不可"}, "attr": "数字", "max": 2},
  {"no": 26, "group": "", "name": "未徴収期間－至（元号）", "required": "△", "when": {"tokucho": "未徴収税額が1円以上の場合は必須0円の場合は任意", "ikkatsu": "未徴収税額が1円以上の場合は必須0円の場合は任意", "futsu": "未徴収税額が1円以上の場合は必須0円の場合は任意", "newYear": "設定不可"}, "attr": "数字", "max": 1},
  {"no": 27, "group": "", "name": "未徴収期間－至（年）", "required": "△", "when": {"tokucho": "未徴収税額が1円以上の場合は必須0円の場合は任意", "ikkatsu": "未徴収税額が1円以上の場合は必須0円の場合は任意", "futsu": "未徴収税額が1円以上の場合は必須0円の場合は任意", "newYear": "設定不可"}, "attr": "数字", "max": 2},
  {"no": 28, "group": "", "name": "未徴収期間－至（月）", "required": "△", "when": {"tokucho": "未徴収税額が1円以上の場合は必須0円の場合は任意", "ikkatsu": "未徴収税額が1円以上の場合は必須0円の場合は任意", "futsu": "未徴収税額が1円以上の場合は必須0円の場合は任意", "newYear": "設定不可"}, "attr": "数字", "max": 2},
  {"no": 29, "group": "", "name": "未徴収税額", "required": "", "when": {"tokucho": "任意", "ikkatsu": "任意", "futsu": "任意", "newYear": "設定不可"}, "attr": "数字", "max": 10},
  {"no": 30, "group": "", "name": "異動年月日－元号", "required": "○", "when": {"tokucho": "必須", "ikkatsu": "必須", "futsu": "必須", "newYear": "必須"}, "attr": "数字", "max": 1},
  {"no": 31, "group": "", "name": "異動年月日－年", "required": "○", "when": {"tokucho": "必須", "ikkatsu": "必須", "futsu": "必須", "newYear": "必須"}, "attr": "数字", "max": 2},
  {"no": 32, "group": "", "name": "異動年月日－月", "required": "○", "when": {"tokucho": "必須", "ikkatsu": "必須", "futsu": "必須", "newYear": "必須"}, "attr": "数字", "max": 2},
  {"no": 33, "group": "", "name": "異動年月日－日", "required": "○", "when": {"tokucho": "必須", "ikkatsu": "必須", "futsu": "必須", "newYear": "必須"}, "attr": "数字", "max": 2},
  {"no": 34, "group": "", "name": "異動の事由", "required": "○", "when": {"tokucho": "必須", "ikkatsu": "必須", "futsu": "必須", "newYear": "必須"}, "attr": "数字", "max": 1, "codeId": "CC6700", "codes": [{"code": "1", "label": "退職"}, {"code": "2", "label": "転勤"}, {"code": "3", "label": "休職・長欠"}, {"code": "4", "label": "死亡"}, {"code": "5", "label": "支払少額・不定期"}, {"code": "6", "label": "合併・解散"}, {"code": "7", "label": "その他"}]},
  {"no": 35, "group": "", "name": "異動の事由－事由理由", "required": "△", "when": {"tokucho": "異動の事由が7の場合は必須7以外の場合は設定不可", "ikkatsu": "異動の事由が7の場合は必須7以外の場合は設定不可", "futsu": "異動の事由が7の場合は必須7以外の場合は設定不可", "newYear": "異動の事由が7の場合は必須7以外の場合は設定不可"}, "attr": "全角", "max": 10},
  {"no": 36, "group": "", "name": "異動後の未徴収税額の徴収方法", "required": "△", "when": {"tokucho": "必須", "ikkatsu": "必須", "futsu": "必須", "newYear": "設定不可"}, "attr": "数字", "max": 1, "codeId": "CC6310", "codes": [{"code": "1", "label": "特別徴収継続"}, {"code": "2", "label": "一括徴収"}, {"code": "3", "label": "普通徴収（本人納付）"}]},
  {"no": 37, "group": "特別徴収継続の場合", "name": "新しい勤務先の特別徴収義務者指定番号", "required": "△", "when": {"tokucho": "新しい勤務先の特別徴収義務者指定番号（新規）が0の場合は必須1の場合は設定不可", "ikkatsu": "設定不可", "futsu": "設定不可", "newYear": "任意"}, "attr": "半角", "max": 12},
  {"no": 38, "group": "特別徴収継続の場合", "name": "新しい勤務先の特別徴収義務者指定番号（新規）", "required": "△", "when": {"tokucho": "必須", "ikkatsu": "設定不可", "futsu": "設定不可", "newYear": "任意"}, "attr": "数字", "max": 1, "codeId": "CC6690", "codes": [{"code": "0", "label": "提出先市町村から特別徴収義務者指定番号を指定されている"}, {"code": "1", "label": "指定されたことがない"}]},
  {"no": 39, "group": "特別徴収継続の場合", "name": "新しい勤務先の法人番号", "required": "", "when": {"tokucho": "任意", "ikkatsu": "設定不可", "futsu": "設定不可", "newYear": "任意"}, "attr": "数字", "max": 13},
  {"no": 40, "group": "特別徴収継続の場合", "name": "新しい勤務先の所在地の郵便番号", "required": "", "when": {"tokucho": "任意", "ikkatsu": "設定不可", "futsu": "設定不可", "newYear": "任意"}, "attr": "数字", "max": 7, "type": "zipcode"},
  {"no": 41, "group": "特別徴収継続の場合", "name": "新しい勤務先の所在地", "required": "△", "when": {"tokucho": "必須", "ikkatsu": "設定不可", "futsu": "設定不可", "newYear": "任意"}, "attr": "全角", "max": 80},
  {"no": 42, "group": "特別徴収継続の場合", "name": "新しい勤務先の氏名又は名称（フリガナ）", "required": "△", "when": {"tokucho": "必須", "ikkatsu": "設定不可", "futsu": "設定不可", "newYear": "任意"}, "attr": "全角", "max": 60},
  {"no": 43, "group": "特別徴収継続の場合", "name": "新しい勤務先の氏名又は名称", "required": "△", "when": {"tokucho": "必須", "ikkatsu": "設定不可", "futsu": "設定不可", "newYear": "任意"}, "attr": "全角", "max": 30},
  {"no": 44, "group": "特別徴収継続の場合", "name": "担当者連絡先の所属", "required": "△", "when": {"tokucho": "必須", "ikkatsu": "設定不可", "futsu": "設定不可", "newYear": "任意"}, "attr": "全角", "max": 20},
  {"no": 45, "group": "特別徴収継続の場合", "name": "担当者連絡先の氏名", "required": "△", "when": {"tokucho": "必須", "ikkatsu": "設定不可", "futsu": "設定不可", "newYear": "任意"}, "attr": "全角", "max": 40},
  {"no": 46, "group": "特別徴収継続の場合", "name": "担当者連絡先の電話", "required": "△", "when": {"tokucho": "必須", "ikkatsu": "設定不可", "futsu": "設定不可", "newYear": "任意"}, "attr": "半角", "max": 20, "type": "tel-number"},
  {"no": 47, "group": "特別徴収継続の場合", "name": "担当者連絡先の電話（内線）", "required": "", "when": {"tokucho": "任意", "ikkatsu": "設定不可", "futsu": "設定不可", "newYear": "任意"}, "attr": "数字", "max": 10},
  {"no": 48, "group": "特別徴収継続の場合", "name": "月割額", "required": "△", "when": {"tokucho": "必須", "ikkatsu": "設定不可", "futsu": "設定不可", "newYear": "設定不可"}, "attr": "数字", "max": 10},
  {"no": 49, "group": "特別徴収継続の場合", "name": "納入開始月", "required": "△", "when": {"tokucho": "必須", "ikkatsu": "設定不可", "futsu": "設定不可", "newYear": "設定不可"}, "attr": "数字", "max": 2},
  {"no": 50, "group": "特別徴収継続の場合", "name": "受給者番号", "required": "", "when": {"tokucho": "任意", "ikkatsu": "設定不可", "futsu": "設定不可", "newYear": "任意"}, "attr": "半角", "max": 25},
  {"no": 51, "group": "特別徴収継続の場合", "name": "納入書の要否", "required": "△", "when": {"tokucho": "新しい勤務先の特別徴収義務者指定番号（新規）が1の場合は必須0の場合は設定不可", "ikkatsu": "設定不可", "futsu": "設定不可", "newYear": "任意"}, "attr": "数字", "max": 1, "codeId": "CC6350", "codes": [{"code": "1", "label": "必要"}, {"code": "2", "label": "不要"}]},
  {"no": 52, "group": "一括徴収の場合", "name": "一括徴収の理由", "required": "△", "when": {"tokucho": "設定不可", "ikkatsu": "必須", "futsu": "設定不可", "newYear": "設定不可"}, "attr": "数字", "max": 1, "codeId": "CC6330", "codes": [{"code": "1", "label": "申出あり"}, {"code": "2", "label": "希望無し"}]},
  {"no": 53, "group": "一括徴収の場合", "name": "理由１－元号", "required": "△", "when": {"tokucho": "設定不可", "ikkatsu": "一括徴収の理由が1の場合は必須2の場合は設定不可", "futsu": "設定不可", "newYear": "設定不可"}, "attr": "数字", "max": 1},
  {"no": 54, "group": "一括徴収の場合", "name": "理由１－年", "required": "△", "when": {"tokucho": "設定不可", "ikkatsu": "一括徴収の理由が1の場合は必須2の場合は設定不可", "futsu": "設定不可", "newYear": "設定不可"}, "attr": "数字", "max": 2},
  {"no": 55, "group": "一括徴収の場合", "name": "理由２－元号", "required": "△", "when": {"tokucho": "設定不可", "ikkatsu": "一括徴収の理由が2の場合は必須1の場合は設定不可", "futsu": "設定不可", "newYear": "設定不可"}, "attr": "数字", "max": 1},
  {"no": 56, "group": "一括徴収の場合", "name": "理由２－年", "required": "△", "when": {"tokucho": "設定不可", "ikkatsu": "一括徴収の理由が2の場合は必須1の場合は設定不可", "futsu": "設定不可", "newYear": "設定不可"}, "attr": "数字", "max": 2},
  {"no": 57, "group": "一括徴収の場合", "name": "徴収予定月日－元号", "required": "△", "when": {"tokucho": "設定不可", "ikkatsu": "必須", "futsu": "設定不可", "newYear": "設定不可"}, "attr": "数字", "max": 1},
  {"no": 58, "group": "一括徴収の場合", "name": "徴収予定月日－年", "required": "△", "when": {"tokucho": "設定不可", "ikkatsu": "必須", "futsu": "設定不可", "newYear": "設定不可"}, "attr": "数字", "max": 2},
  {"no": 59, "group": "一括徴収の場合", "name": "徴収予定月日－月", "required": "△", "when": {"tokucho": "設定不可", "ikkatsu": "必須", "futsu": "設定不可", "newYear": "設定不可"}, "attr": "数字", "max": 2},
  {"no": 60, "group": "一括徴収の場合", "name": "徴収予定月日－日", "required": "△", "when": {"tokucho": "設定不可", "ikkatsu": "必須", "futsu": "設定不可", "newYear": "設定不可"}, "attr": "数字", "max": 2},
  {"no": 61, "group": "一括徴収の場合", "name": "徴収予定額", "required": "", "when": {"tokucho": "設定不可", "ikkatsu": "任意", "futsu": "設定不可", "newYear": "設定不可"}, "attr": "数字", "max": 10},
  {"no": 62, "group": "一括徴収の場合", "name": "納入月", "required": "△", "when": {"tokucho": "設定不可", "ikkatsu": "必須", "futsu": "設定不可", "newYear": "設定不可"}, "attr": "数字", "max": 2},
  {"no": 63, "group": "普通徴収の場合", "name": "普通徴収の理由", "required": "△", "when": {"tokucho": "設定不可", "ikkatsu": "設定不可", "futsu": "必須", "newYear": "設定不可"}, "attr": "数字", "max": 1, "codeId": "CC6320", "codes": [{"code": "1", "label": "一括徴収希望なし"}, {"code": "2", "label": "未徴収税額以下"}, {"code": "3", "label": "死亡退職"}]},
  {"no": 64, "group": "普通徴収の場合", "name": "理由１－元号", "required": "△", "when": {"tokucho": "設定不可", "ikkatsu": "設定不可", "futsu": "普通徴収の理由が1の場合は必須1以外の場合は設定不可", "newYear": "設定不可"}, "attr": "数字", "max": 1},
  {"no": 65, "group": "普通徴収の場合", "name": "理由１－年", "required": "△", "when": {"tokucho": "設定不可", "ikkatsu": "設定不可", "futsu": "普通徴収の理由が1の場合は必須1以外の場合は設定不可", "newYear": "設定不可"}, "attr": "数字", "max": 2},
  {"no": 66, "group": "普通徴収の場合", "name": "理由２－元号", "required": "△", "when": {"tokucho": "設定不可", "ikkatsu": "設定不可", "futsu": "普通徴収の理由が2の場合は必須2以外の場合は設定不可", "newYear": "設定不可"}, "attr": "数字", "max": 1},
  {"no": 67, "group": "普通徴収の場合", "name": "理由２－年", "required": "△", "when": {"tokucho": "設定不可", "ikkatsu": "設定不可", "futsu": "普通徴収の理由が2の場合は必須2以外の場合は設定不可", "newYear": "設定不可"}, "attr": "数字", "max": 2},
  {"no": 68, "group": "普通徴収の場合", "name": "提出先市町村コード", "required": "○", "when": {"tokucho": "必須", "ikkatsu": "必須", "futsu": "必須", "newYear": "必須"}, "attr": "数字", "max": 6},
];
