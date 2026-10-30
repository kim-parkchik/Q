/**
 * 2025年度（令和7年度）の社会保険マスター（健康保険・介護保険・厚生年金）
 *
 * 協会けんぽ：令和7年3月分から
 *   → kenpoTable2025.ts（協会けんぽの Excel から自動生成）
 * ※ 雇用保険料率は年度の途中で変わることがあるため laborInsuranceRates.ts にまとめている
 */
import { buildInsuranceMaster } from './buildInsuranceMaster';
import { KENPO_TABLE_2025 } from './kenpoTable2025';

export const INSURANCE_2025 = buildInsuranceMaster(KENPO_TABLE_2025);
