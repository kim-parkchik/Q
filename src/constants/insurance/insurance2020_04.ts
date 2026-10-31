/**
 * 2020年度（令和2年度）・4〜8月分の社会保険マスター（健康保険・介護保険・厚生年金）
 *
 * 協会けんぽ：令和2年4月分から8月分まで（子ども・子育て拠出金率 0.34% → 0.36%）
 *   → kenpoTable2020_04.ts（協会けんぽの Excel から自動生成）
 * ※ 雇用保険料率は年度の途中で変わることがあるため laborInsuranceRates.ts にまとめている
 */
import { buildInsuranceMaster } from './buildInsuranceMaster';
import { KENPO_TABLE_2020_04 } from './kenpoTable2020_04';

export const INSURANCE_2020_04 = buildInsuranceMaster(KENPO_TABLE_2020_04);
