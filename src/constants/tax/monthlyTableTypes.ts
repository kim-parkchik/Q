/**
 * 国税庁「給与所得の源泉徴収税額表（月額表）」のデータの形
 * 実際のデータは monthlyTable20XX.ts（Excel から自動生成）
 */
export interface MonthlyTaxTable {
  title: string;
  /** この金額未満は甲欄0円 */
  zeroBelow: number;
  /** [以上, 未満, 甲0人, 1人, 2人, 3人, 4人, 5人, 6人, 7人, 乙] */
  rows: number[][];
  /** 高額部分（甲欄）：amount円の税額 kou[人数] に、amount円を超える金額 × rate% を加算 */
  highAnchors: { amount: number; kou: number[]; rate: number }[];
  /** 高額部分（乙欄）：base円に、amount円を超える金額 × rate% を加算 */
  otsuHigh: { amount: number; base: number; rate: number }[];
  /** 乙欄：表の最初の金額未満は、給与 × この率% */
  otsuLowRate: number | null;
  /** 扶養親族等が7人を超える場合、1人ごとに差し引く額 */
  perExtraDependent: number;
}
