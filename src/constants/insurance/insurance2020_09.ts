/**
 * 2020年度（令和2年度）・9月分からの社会保険マスター（健康保険・介護保険・厚生年金）
 *
 * 協会けんぽ：令和2年9月分から（厚生年金の標準報酬月額の上限が 62万円 → 65万円、第32級を追加）
 *   → kenpoTable2020_09.ts（協会けんぽの Excel から自動生成）
 * ※ 雇用保険料率は年度の途中で変わることがあるため laborInsuranceRates.ts にまとめている
 */
import { buildInsuranceMaster } from './buildInsuranceMaster';
import { KENPO_TABLE_2020_09 } from './kenpoTable2020_09';

export const INSURANCE_2020_09 = buildInsuranceMaster(KENPO_TABLE_2020_09);
