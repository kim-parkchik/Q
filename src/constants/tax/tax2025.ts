/**
 * 2025年分（令和7年分） 源泉徴収税額マスター
 *
 * 参照元: 国税庁「令和7年分 源泉徴収税額表」（月額表・日額表の丙欄・賞与の算出率の表）
 *   URL: https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2024/02.htm
 *         国税庁「令和3年～令和7年分 月額表の甲欄を適用する給与等に対する税額の電算機計算の特例について」
 *   URL: https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2022/data/denshi_10.pdf
 *
 * 適用期間: 2025年1月1日 〜 2025年12月31日
 * （国税庁のページによると、令和2年1月以後「税額」は改正されていないため、2020〜2024年分にもこの表を使う）
 *
 * 内容:
 * 1. 月額表（monthlyTable2025.ts）と、電算機計算の特例（densanki2025.ts。月額表の代わりに使える計算式）
 * 2. 賞与に対する源泉徴収税額の算出率の表（bonusTaxTable2025.ts）
 * 3. 日額表の丙欄（dailyHeiTable2025.ts）
 * どれも国税庁の Excel・PDF から自動生成（tax-tables/README.md）。
 * ※ 通勤手当の非課税限度額は constants/tax/commuteLimits.ts（国税庁の資料から自動生成。給与を支払う年月で選ぶ）
 */

import { MONTHLY_TABLE_2025 } from './monthlyTable2025';
import { BONUS_TAX_TABLE_2025 } from './bonusTaxTable2025';
import { DAILY_HEI_TABLE_2025 } from './dailyHeiTable2025';
import { DENSANKI_2025 } from './densanki2025';

export const MASTER_YEAR = 2025;
export const MASTER_MONTH = 1;

export const TAX_2025 = {
  MASTER_YEAR,
  MASTER_MONTH,
  /**
   * 月額表の甲欄の「電算機計算の特例」（令和3年〜令和7年分。国税庁の PDF から自動生成）
   * 計算の流れは令和8年分（tax2026.ts）と同じ。違うのは、給与所得控除の最低額と基礎控除の額。
   * ※ この PDF には「令和2年分以前の給与等には使用できません」とあるが、Q は2020年分にもこの式を使っている
   *   （令和2年分の電算機計算の特例の資料は、まだ入れていない）
   */
  DENSANKI: DENSANKI_2025,
  /** 月額表（国税庁のExcelから自動生成） */
  MONTHLY_TABLE: MONTHLY_TABLE_2025,
  /** 賞与に対する源泉徴収税額の算出率の表（国税庁のExcelから自動生成） */
  BONUS_TABLE: BONUS_TAX_TABLE_2025,
  /** 日額表の丙欄（国税庁のExcelから自動生成） */
  DAILY_HEI_TABLE: DAILY_HEI_TABLE_2025,
};