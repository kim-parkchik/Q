/**
 * 2025年分（令和7年分） 源泉徴収税額マスター
 * 
 * 参照元: 国税庁「令和3年〜令和7年分 月額表の甲欄を適用する給与等に対する税額の電算機計算の特例」（DENSANKI）
 *   URL: https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2022/data/denshi_10.pdf
 *         国税庁「令和7年分 源泉徴収税額表」（月額表・日額表の丙欄・賞与の算出率の表）
 *   URL: https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2024/02.htm
 *
 * 適用期間: 2025年1月1日 〜 2025年12月31日
 * （国税庁のページによると、令和2年1月以後「税額」は改正されていないため、2020〜2024年分にもこの表を使う）
 *
 * 内容:
 * 1. 月額表（monthlyTable2025.ts）と、電算機計算の特例（月額表の代わりに使える計算式）
 * 2. 賞与に対する源泉徴収税額の算出率の表（bonusTaxTable2025.ts）
 * 3. 日額表の丙欄（dailyHeiTable2025.ts）
 * ※ 通勤手当の非課税限度額は constants/tax/commuteLimits.ts（国税庁の資料から自動生成。給与を支払う年月で選ぶ）
 */

import { MONTHLY_TABLE_2025 } from './monthlyTable2025';
import { BONUS_TAX_TABLE_2025 } from './bonusTaxTable2025';
import { DAILY_HEI_TABLE_2025 } from './dailyHeiTable2025';

export const MASTER_YEAR = 2025;
export const MASTER_MONTH = 1;

/**
 * 月額表の甲欄の「電算機計算の特例」（令和3年〜令和7年分）
 * 計算の流れは tax2026.ts の DENSANKI と同じ。令和8年分との違いは
 * 給与所得控除の最低額（45,834円）と、基礎控除の額（40,000円）。
 */
export const DENSANKI = {
  /** 別表第一：給与所得控除 [Aの上限(以下), 率, 加算額]（率が0なら定額） */
  EMPLOYMENT_DEDUCTION: [
    [135416, 0, 45834],
    [149999, 0.40, -8333],
    [299999, 0.30, 6667],
    [549999, 0.20, 36667],
    [708330, 0.10, 91667],
    [Infinity, 0, 162500],
  ] as [number, number, number][],
  /** 別表第二：配偶者（特別）控除・扶養控除（1人あたり） */
  DEPENDENT_DEDUCTION: 31667,
  /** 別表第三：基礎控除 [Aの上限(以下), 控除額] */
  BASIC_DEDUCTION: [
    [2162499, 40000],
    [2204166, 26667],
    [2245833, 13334],
    [Infinity, 0],
  ] as [number, number][],
  /** 別表第四：税額の算式 [Bの上限(以下), 税率(%), 控除額] */
  TAX_RATES: [
    [162500, 5.105, 0],
    [275000, 10.210, 8296],
    [579166, 20.420, 36374],
    [750000, 23.483, 54113],
    [1500000, 33.693, 130688],
    [3333333, 40.840, 237893],
    [Infinity, 45.945, 408061],
  ] as [number, number, number][],
};

export const TAX_2025 = {
  MASTER_YEAR,
  MASTER_MONTH,
  DENSANKI,
  /** 月額表（国税庁のExcelから自動生成） */
  MONTHLY_TABLE: MONTHLY_TABLE_2025,
  /** 賞与に対する源泉徴収税額の算出率の表（国税庁のExcelから自動生成） */
  BONUS_TABLE: BONUS_TAX_TABLE_2025,
  /** 日額表の丙欄（国税庁のExcelから自動生成） */
  DAILY_HEI_TABLE: DAILY_HEI_TABLE_2025,
};