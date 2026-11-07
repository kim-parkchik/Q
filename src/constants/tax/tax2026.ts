/**
 * 2026年分（令和8年分） 源泉徴収税額マスター
 *
 * 参照元: 国税庁「令和8年分 源泉徴収税額表」（月額表・日額表の丙欄・賞与の算出率の表）
 *   URL: https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/01.htm
 *         国税庁「令和8年分 月額表の甲欄を適用する給与等に対する税額の電算機計算の特例について」
 *   URL: https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/data/denshi_01.pdf
 *
 * 適用期間: 2026年1月1日 〜 2026年12月31日
 * (※令和7年度税制改正（基礎控除の見直し等）により、令和7年分から税額が変わっている)
 *
 * 内容:
 * 1. 月額表（monthlyTable2026.ts）と、電算機計算の特例（densanki2026.ts。月額表の代わりに使える計算式）
 * 2. 賞与に対する源泉徴収税額の算出率の表（bonusTaxTable2026.ts）
 * 3. 日額表の丙欄（dailyHeiTable2026.ts）
 * どれも国税庁の Excel・PDF から自動生成（tax-tables/README.md）。
 * ※ 通勤手当の非課税限度額は constants/tax/commuteLimits.ts（国税庁の資料から自動生成。給与を支払う年月で選ぶ）
 */

import { MONTHLY_TABLE_2026 } from './monthlyTable2026';
import { BONUS_TAX_TABLE_2026 } from './bonusTaxTable2026';
import { DAILY_HEI_TABLE_2026 } from './dailyHeiTable2026';
import { DENSANKI_2026 } from './densanki2026';

export const MASTER_YEAR = 2026;
export const MASTER_MONTH = 1;

export const TAX_2026 = {
  MASTER_YEAR,
  MASTER_MONTH,
  /**
   * 月額表の甲欄の「電算機計算の特例」（国税庁の PDF から自動生成）
   * 月額表の代わりに、この式で税額を計算することが認められている（計算は utils/incomeTax.ts の calcMonthlyWithholdingTax）
   *   1. 給与所得控除の額を求める（第1表。1円未満切り上げ）
   *   2. 課税給与所得金額 B = A − 給与所得控除 − 配偶者控除・扶養控除等 × 人数（第2表） − 基礎控除（第3表）
   *   3. 税額 = B × 税率 − 控除額（第4表。10円未満四捨五入。税率は復興特別所得税を含んだ値）
   */
  DENSANKI: DENSANKI_2026,
  /** 月額表（国税庁のExcelから自動生成） */
  MONTHLY_TABLE: MONTHLY_TABLE_2026,
  /** 賞与に対する源泉徴収税額の算出率の表（国税庁のExcelから自動生成） */
  BONUS_TABLE: BONUS_TAX_TABLE_2026,
  /** 日額表の丙欄（国税庁のExcelから自動生成） */
  DAILY_HEI_TABLE: DAILY_HEI_TABLE_2026,
};