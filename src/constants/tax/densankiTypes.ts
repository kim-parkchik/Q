/**
 * 国税庁「月額表の甲欄を適用する給与等に対する税額の電算機計算の特例について」のデータの形
 * 実際のデータは densanki20XX.ts（国税庁の PDF から自動生成）
 */
export interface DensankiTable {
  title: string;
  /** この資料を使える年（PDF の「令和○年分」。to が null は「令和○年分以降」で、終わりの年がない） */
  years: { from: number; to: number | null };
  /** 第1表：給与所得控除の額 [A の上限（以下）, 率, 加算額]（率が0なら定額。1円未満切り上げ。最後の行の上限は Infinity） */
  EMPLOYMENT_DEDUCTION: [number, number, number][];
  /** 第2表：配偶者（特別）控除の額・扶養控除の額（1人あたり） */
  DEPENDENT_DEDUCTION: number;
  /** 第3表：基礎控除の額 [A の上限（以下）, 控除額] */
  BASIC_DEDUCTION: [number, number][];
  /** 第4表：税額の算式 [課税給与所得金額 B の上限（以下）, 税率（%）, 控除額]（B × 税率 − 控除額。10円未満四捨五入） */
  TAX_RATES: [number, number, number][];
}

/** PDF の計算例（テストで、Q の計算が同じ税額になるかを確かめる） */
export interface DensankiExample {
  /** その月の社会保険料等控除後の給与等の金額 */
  amount: number;
  /** 扶養親族等の数（源泉控除対象配偶者を含む） */
  dependents: number;
  /** 月額表甲欄の税額 */
  tableTax: number;
  /** 特例計算による税額 */
  densankiTax: number;
}
