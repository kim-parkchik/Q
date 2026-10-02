/**
 * 社会保険マスター（年度別）
 */
import { INSURANCE_2025 } from './insurance2025';
import { INSURANCE_2026 } from './insurance2026';
import type { InsuranceMasterType } from './buildInsuranceMaster';

export type { InsuranceMasterType } from './buildInsuranceMaster';
export type { KenpoTable, KenpoGrade, YearMonth } from './kenpoTableTypes';
export type EmpInsType = keyof typeof INSURANCE_2026.LABOR_INSURANCE_RATES;

export { INSURANCE_2025, INSURANCE_2026 };

const ALL = [INSURANCE_2025, INSURANCE_2026]; // 古い順

/**
 * 保険料の対象月に合ったマスターを返す
 *
 * ・健康保険・介護保険・厚生年金：協会けんぽは「3月分」から新しい料率（3〜翌2月）
 * ・雇用保険：「4月1日」から新しい料率（4〜翌3月）
 * そのため 3月分は「健康保険は新年度・雇用保険は前年度」の組み合わせになる。
 *
 * ※ Q では、給与の支給年月をそのまま保険料の対象月として扱う（当月徴収）。
 *   翌月徴収の会社に対応するには、会社設定で1か月ずらす仕組みが必要（今後の課題）。
 * ※ 用意している年度より前・後の月は、いちばん近い年度のデータを使う。
 */
export const getInsuranceMaster = (year: number, month: number): InsuranceMasterType => {
  const pick = (fy: number) =>
    ALL.reduce((best, m) => (m.MASTER_YEAR <= fy ? m : best), ALL[0]);
  const kenpoFY = month >= 3 ? year : year - 1;
  const laborFY = month >= 4 ? year : year - 1;
  const kenpo = pick(kenpoFY);
  const labor = pick(laborFY);
  if (kenpo === labor) return kenpo;
  return {
    ...kenpo,
    LABOR_INSURANCE_RATES: labor.LABOR_INSURANCE_RATES,
    LABOR_FISCAL_YEAR: labor.LABOR_FISCAL_YEAR,
    LABOR_SOURCE: labor.LABOR_SOURCE,
  };
};

/** 子ども・子育て支援金を徴収する月かどうか */
export const isChildSupportMonth = (m: InsuranceMasterType, year: number, month: number): boolean => {
  if (!m.CHILD_SUPPORT_RATE || !m.CHILD_SUPPORT_FROM) return false;
  return year * 12 + month >= m.CHILD_SUPPORT_FROM.year * 12 + m.CHILD_SUPPORT_FROM.month;
};
