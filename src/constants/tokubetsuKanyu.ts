/**
 * 労災保険の特別加入（第1種。中小事業主・家族従事者・役員など）の保険料算定基礎額
 *
 * ⚠️ このファイルは自動生成です。手で書き換えないでください。
 * 作り方  : python3 -I scripts/import_tokubetsu_kanyu.py nendo-koshin/source/yamagata-tebiki-2026.pdf src/constants/tokubetsuKanyu.ts
 * 元データ: 山形労働局「年度更新の手引き」（令和8年度）の「特別加入保険料算定基礎額表」
 *   source/yamagata-tebiki-2026.pdf（SHA-256 29f5e65c7e7c6173f39da7b42254a6ef5ca69c0b8ffd10378235ba76d9473fb9）
 *     https://jsite.mhlw.go.jp/yamagata-roudoukyoku/content/contents/002587832.pdf
 * 保険料算定基礎額は給付基礎日額 × 365日。年度の途中で加入・脱退した人は「特例による 1/12 の額」× 加入月数。
 * 特別加入者全員の算定基礎額を足して千円未満を切り捨て、労災保険率（1,000分の）をかけて1円未満を切り捨てる（記入例の
 * 「算定基礎額の計」5,748千円 × 9.5/1000 ＝ 54,606円 と合うことを確かめた）
 */

export interface TokubetsuRow {
  /** 給付基礎日額（円） */
  daily: number;
  /** 保険料算定基礎額（1年分。円） */
  yearly: number;
  /** 特例による 1/12 の額（年度の途中で加入・脱退した人の1か月分。円） */
  monthly: number;
}

export const TOKUBETSU_TABLE: TokubetsuRow[] = [
  { daily: 25000, yearly: 9125000, monthly: 760417 },
  { daily: 24000, yearly: 8760000, monthly: 730000 },
  { daily: 22000, yearly: 8030000, monthly: 669167 },
  { daily: 20000, yearly: 7300000, monthly: 608334 },
  { daily: 18000, yearly: 6570000, monthly: 547500 },
  { daily: 16000, yearly: 5840000, monthly: 486667 },
  { daily: 14000, yearly: 5110000, monthly: 425834 },
  { daily: 12000, yearly: 4380000, monthly: 365000 },
  { daily: 10000, yearly: 3650000, monthly: 304167 },
  { daily: 9000, yearly: 3285000, monthly: 273750 },
  { daily: 8000, yearly: 2920000, monthly: 243334 },
  { daily: 7000, yearly: 2555000, monthly: 212917 },
  { daily: 6000, yearly: 2190000, monthly: 182500 },
  { daily: 5000, yearly: 1825000, monthly: 152084 },
  { daily: 4000, yearly: 1460000, monthly: 121667 },
  { daily: 3500, yearly: 1277500, monthly: 106459 },
];
