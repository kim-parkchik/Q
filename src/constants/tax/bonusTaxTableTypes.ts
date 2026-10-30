/**
 * 国税庁「賞与に対する源泉徴収税額の算出率の表」のデータの形
 * 実際のデータは bonusTaxTable20XX.ts（Excel から自動生成）
 *
 * 扶養親族等の数の列ごとに、率が変わる金額の区切りが違うため、列ごとに行を持つ。
 */
export interface BonusTaxRateTable {
  title: string;
  /** 甲欄：扶養親族等の数（0人, 1人, …, 7人以上）ごとに [前月の社会保険料等控除後の給与等の金額 以上(円), 未満(円), 率(%)] */
  kou: [number, number, number][][];
  /** 乙欄：[前月の社会保険料等控除後の給与等の金額 以上(円), 未満(円), 率(%)] */
  otsu: [number, number, number][];
}
