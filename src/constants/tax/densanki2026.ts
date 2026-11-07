/**
 * 令和8年分 月額表の甲欄を適用する給与等に対する税額の電算機計算の特例について
 *
 * ⚠️ このファイルは自動生成です。手で書き換えないでください。
 * 元データ: 国税庁の PDF（tax-tables/ フォルダ。入手元とハッシュは tax-tables/README.md）
 * 出典    : 国税庁ホームページ（https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/data/denshi_01.pdf）を加工して作成
 *           （PDF の表を Q で使える形に変換したもので、国税庁が作成したものではありません）
 * 作り方  : python3 -I scripts/import_densanki.py <PDF> <年> <このファイル> <出典URL>
 * 確認    : 表が切れ目なく並び、PDF の計算例の「特例計算による税額」と同じになることを、作るときに確かめてある
 *
 * 計算のしかたは utils/incomeTax.ts の calcMonthlyWithholdingTax（A = その月の社会保険料等控除後の給与等の金額）
 */
import type { DensankiTable, DensankiExample } from './densankiTypes';

export const DENSANKI_2026: DensankiTable = {
  title: "令和8年分 月額表の甲欄を適用する給与等に対する税額の電算機計算の特例について",
  /** この資料を使える年（PDF の「令和○年分」。to が null は「以降」で、終わりの年がない） */
  years: { from: 2026, to: 2026 },
  /** 第1表：給与所得控除の額 [A の上限（以下）, 率, 加算額]（率が0なら定額。1円未満切り上げ） */
  EMPLOYMENT_DEDUCTION: [
    [158333, 0, 54167],
    [299999, 0.3, 6667],
    [549999, 0.2, 36667],
    [708330, 0.1, 91667],
    [Infinity, 0, 162500],
  ],
  /** 第2表：配偶者（特別）控除の額・扶養控除の額（1人あたり） */
  DEPENDENT_DEDUCTION: 31667,
  /** 第3表：基礎控除の額 [A の上限（以下）, 控除額] */
  BASIC_DEDUCTION: [
    [2120833, 48334],
    [2162499, 40000],
    [2204166, 26667],
    [2245833, 13334],
    [Infinity, 0],
  ],
  /** 第4表：税額の算式 [課税給与所得金額 B の上限（以下）, 税率（%）, 控除額]（B × 税率 − 控除額。10円未満四捨五入） */
  TAX_RATES: [
    [162500, 5.105, 0],
    [275000, 10.21, 8296],
    [579166, 20.42, 36374],
    [750000, 23.483, 54113],
    [1500000, 33.693, 130688],
    [3333333, 40.84, 237893],
    [Infinity, 45.945, 408061],
  ],
};

/**
 * PDF の「税額計算の特例により求めた税額と税額表による税額との差異」の計算例
 * dependents は扶養親族等の数（源泉控除対象配偶者を含む）、tableTax は月額表甲欄の税額、densankiTax は特例計算による税額
 */
export const DENSANKI_EXAMPLES_2026: DensankiExample[] = [
  { amount: 175000, dependents: 2, tableTax: 250, densankiTax: 210 },
  { amount: 446000, dependents: 8, tableTax: 1010, densankiTax: 940 },
  { amount: 775200, dependents: 3, tableTax: 59477, densankiTax: 59470 },
];
