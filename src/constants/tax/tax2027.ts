/**
 * 2027年分（令和9年分） 源泉徴収税額マスター
 *
 * 参照元: 国税庁「令和9年分 源泉徴収税額表」（月額表・日額表の丙欄・賞与の算出率の表）
 *   URL: https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2027/01.htm
 *         国税庁「令和9年分以降 月額表の甲欄を適用する給与等に対する税額の電算機計算の特例について」
 *   URL: https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2027/data/denshi_01.pdf
 *
 * 適用期間: 2027年1月1日 〜
 * (※令和8年度税制改正（所得税の基礎控除の引上げ等）により、税額が変わっている。国税庁のページより)
 * (※令和9年1月1日以後に生ずる所得からは、所得税の1%の防衛特別所得税を併せて源泉徴収し、復興特別所得税は1.1%になる。
 *   合わせた率は2.1%で、令和8年分までの復興特別所得税（2.1%）と変わらないので、源泉徴収税額の計算方法は変わらない。
 *   この表の税額は、所得税・防衛特別所得税・復興特別所得税の合計額。1枚の所得税徴収高計算書（納付書）で納付する。
 *   出典：国税庁「源泉所得税の改正のあらまし」（令和8年4月）5・8ページ https://www.nta.go.jp/publication/pamph/gensen/2026kaisei.pdf)
 *
 * 内容:
 * 1. 月額表（monthlyTable2027.ts）と、電算機計算の特例（densanki2027.ts。月額表の代わりに使える計算式）
 * 2. 賞与に対する源泉徴収税額の算出率の表（bonusTaxTable2027.ts）
 * 3. 日額表の丙欄（dailyHeiTable2027.ts）
 * どれも国税庁の Excel・PDF から自動生成（tax-tables/README.md）。
 * ※ 通勤手当の非課税限度額は constants/tax/commuteLimits.ts（国税庁の資料から自動生成。給与を支払う年月で選ぶ）
 */

import { MONTHLY_TABLE_2027 } from './monthlyTable2027';
import { BONUS_TAX_TABLE_2027 } from './bonusTaxTable2027';
import { DAILY_HEI_TABLE_2027 } from './dailyHeiTable2027';
import { DENSANKI_2027 } from './densanki2027';

export const MASTER_YEAR = 2027;
export const MASTER_MONTH = 1;

export const TAX_2027 = {
  MASTER_YEAR,
  MASTER_MONTH,
  /**
   * 月額表の甲欄の「電算機計算の特例」（令和9年分以降。国税庁の PDF から自動生成）
   * 計算の流れは令和8年分（tax2026.ts）と同じ。違うのは、給与所得控除の最低額と基礎控除の額。
   */
  DENSANKI: DENSANKI_2027,
  /** 月額表（国税庁のExcelから自動生成） */
  MONTHLY_TABLE: MONTHLY_TABLE_2027,
  /** 賞与に対する源泉徴収税額の算出率の表（国税庁のExcelから自動生成） */
  BONUS_TABLE: BONUS_TAX_TABLE_2027,
  /** 日額表の丙欄（国税庁のExcelから自動生成） */
  DAILY_HEI_TABLE: DAILY_HEI_TABLE_2027,
};
