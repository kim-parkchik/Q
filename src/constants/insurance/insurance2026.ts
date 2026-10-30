/**
 * 2026年度（令和8年度）の社会保険マスター（健康保険・介護保険・厚生年金）
 *
 * 協会けんぽ：令和8年3月分から（子ども・子育て支援金は令和8年4月分から）
 *   → kenpoTable2026.ts（協会けんぽの Excel から自動生成）
 * ※ 雇用保険料率は年度の途中で変わることがあるため laborInsuranceRates.ts にまとめている
 */
import { buildInsuranceMaster } from './buildInsuranceMaster';
import { KENPO_TABLE_2026 } from './kenpoTable2026';

export const INSURANCE_2026 = buildInsuranceMaster(KENPO_TABLE_2026);
