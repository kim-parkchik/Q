/**
 * 2021年度（令和3年度）の社会保険マスター（健康保険・介護保険・厚生年金）
 *
 * 協会けんぽ：令和3年3月分から
 *   → kenpoTable2021.ts（協会けんぽの Excel から自動生成）
 * ※ 雇用保険料率は年度の途中で変わることがあるため laborInsuranceRates.ts にまとめている
 */
import { buildInsuranceMaster } from './buildInsuranceMaster';
import { KENPO_TABLE_2021 } from './kenpoTable2021';

export const INSURANCE_2021 = buildInsuranceMaster(KENPO_TABLE_2021);
