/**
 * 国税庁「給与所得の源泉徴収税額表（日額表）」の丙欄のデータの形
 * 実際のデータは dailyHeiTable20XX.ts（Excel から自動生成）
 * Q の給与は月ごとに払うので、日額表のうち丙欄（日雇賃金）だけを使う
 */
export interface DailyHeiTaxTable {
  title: string;
  /** [以上, 未満, 丙欄の税額]（最初の行の金額未満は0円） */
  rows: number[][];
  /** 表の最後の金額以上：base円に、amount円を超える金額 × rate% を加算 */
  high: { amount: number; base: number; rate: number }[];
}
