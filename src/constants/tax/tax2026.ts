/**
 * 2026年分（令和8年分） 源泉徴収税額マスター
 * 
 * 参照元: 国税庁「令和8年分 電算機計算の特例」（DENSANKI）
 *         国税庁「令和8年分 源泉徴収税額表」（月額表・日額表の丙欄・賞与の算出率の表）
 * URL: https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/01.htm
 *
 * 適用期間: 2026年1月1日 〜
 * (※令和7年度税制改正（基礎控除の見直し等）により、令和7年分から税額が変わっている)
 *
 * 内容:
 * 1. 月額表（monthlyTable2026.ts）と、電算機計算の特例（月額表の代わりに使える計算式）
 * 2. 賞与に対する源泉徴収税額の算出率の表（bonusTaxTable2026.ts）
 * 3. 日額表の丙欄（dailyHeiTable2026.ts）
 * ※ 通勤手当の非課税限度額は constants/tax/commuteLimits.ts（国税庁の資料から自動生成。給与を支払う年月で選ぶ）
 */

import { MONTHLY_TABLE_2026 } from './monthlyTable2026';
import { BONUS_TAX_TABLE_2026 } from './bonusTaxTable2026';
import { DAILY_HEI_TABLE_2026 } from './dailyHeiTable2026';

export const MASTER_YEAR = 2026;
export const MASTER_MONTH = 1;

/**
 * 月額表の甲欄の「電算機計算の特例」（令和8年分）
 *
 * 月額表の代わりに、この式で税額を計算することが国税庁により認められている。
 * 参照元: 国税庁「令和8年分 月額表の甲欄を適用する給与等に対する税額の電算機計算の特例について」
 * URL: https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/data/denshi_01.pdf
 *
 * 計算の流れ（A = 社会保険料等控除後の給与等の金額）
 *   1. 給与所得控除の額を求める（1円未満切り上げ）
 *   2. 課税給与所得金額 B = A − 給与所得控除 − 扶養控除等 × 人数 − 基礎控除
 *   3. 税額 = B × 税率 − 控除額（10円未満四捨五入）
 * ※税率は復興特別所得税（×102.1%）を含んだ値
 */
export const DENSANKI = {
  /** 別表第一：給与所得控除 [Aの上限(以下), 率, 加算額]（率が0なら定額） */
  EMPLOYMENT_DEDUCTION: [
    [158333, 0, 54167],
    [299999, 0.30, 6667],
    [549999, 0.20, 36667],
    [708330, 0.10, 91667],
    [Infinity, 0, 162500],
  ] as [number, number, number][],
  /** 別表第二：配偶者（特別）控除・扶養控除（1人あたり） */
  DEPENDENT_DEDUCTION: 31667,
  /** 別表第三：基礎控除 [Aの上限(以下), 控除額] */
  BASIC_DEDUCTION: [
    [2120833, 48334],
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

export const TAX_2026 = {
  MASTER_YEAR,
  MASTER_MONTH,
  DENSANKI,
  /** 月額表（国税庁のExcelから自動生成） */
  MONTHLY_TABLE: MONTHLY_TABLE_2026,
  /** 賞与に対する源泉徴収税額の算出率の表（国税庁のExcelから自動生成） */
  BONUS_TABLE: BONUS_TAX_TABLE_2026,
  /** 日額表の丙欄（国税庁のExcelから自動生成） */
  DAILY_HEI_TABLE: DAILY_HEI_TABLE_2026,
};