// 1. 各年度のマスターオブジェクトをインポート
import { TAX_2020 } from './tax2020';
import { TAX_2025 } from './tax2025';
import { TAX_2026 } from './tax2026';
import { TAX_2027 } from './tax2027';

// 2. 他のファイルで使い回すための「共通の型」をここで定義（★追加）
export type TaxMasterType = typeof TAX_2026;

// 3. 衝突しないオブジェクト名でそのままエクスポート
export { TAX_2020, TAX_2025, TAX_2026, TAX_2027 };
export type { MonthlyTaxTable } from './monthlyTableTypes';
export type { BonusTaxRateTable } from './bonusTaxTableTypes';
export type { DailyHeiTaxTable } from './dailyTableTypes';
export type { DensankiTable, DensankiExample } from './densankiTypes';
export { FLAT_TAX_REDUCTION_2024 } from './flatTaxReduction';

/**
 * 給与を支払う年に合った源泉徴収のマスターを返す
 * （源泉所得税は「支払った日」の年の税額表を使う）
 * ・2020年分：月額表などは令和7年分と同じ。電算機計算の特例だけ令和2年分の資料（tax2020.ts）
 * ・2021〜2025年分：令和7年分（電算機計算の特例は令和3年～令和7年分）
 * ・2026年分：令和8年分
 * ・2027年分から：令和9年分（電算機計算の特例は「令和9年分以降」）
 */
export const getTaxMaster = (year: number): TaxMasterType =>
  year <= 2020 ? TAX_2020
    : year <= 2025 ? TAX_2025
      : year === 2026 ? TAX_2026
        : TAX_2027;

/**
 * 源泉徴収税額表が登録されている範囲
 * 令和7年分の表は、令和2年分から税額が変わっていない（国税庁の令和7年分 源泉徴収税額表のページ）ため、2020年分から使える。
 */
const TAX_TABLE_FIRST_YEAR = 2020;
const TAX_TABLE_LAST_YEAR = 2027;

/** 税額表が登録されていない年を、いちばん近い年の表で計算しているときの注意（画面に出す） */
export const getTaxMasterWarnings = (year: number): string[] => {
  if (year < TAX_TABLE_FIRST_YEAR) {
    return [`${year}年分の源泉徴収税額表が登録されていないため、${TAX_TABLE_FIRST_YEAR}年分の表で計算しています。`];
  }
  if (year > TAX_TABLE_LAST_YEAR) {
    return [`${year}年分の源泉徴収税額表がまだ登録されていないため、${TAX_TABLE_LAST_YEAR}年分の表で計算しています。`];
  }
  return [];
};
