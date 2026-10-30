/**
 * 2024年度（令和6年度）の社会保険マスター
 *
 * ・健康保険・介護保険・厚生年金（協会けんぽ）：令和6年3月分から
 *     → kenpoTable2024.ts（協会けんぽの Excel から自動生成）
 * ・雇用保険：令和6年4月1日から令和7年3月31日まで（令和5年度と同率）
 *     出典: 厚生労働省「令和6年度の雇用保険料率について」 https://www.mhlw.go.jp/content/001211914.pdf
 */
import { buildInsuranceMaster } from './buildInsuranceMaster';
import { KENPO_TABLE_2024 } from './kenpoTable2024';

export const INSURANCE_2024 = buildInsuranceMaster(KENPO_TABLE_2024, {
  fiscalYear: 2024,
  source: "https://www.mhlw.go.jp/content/001211914.pdf",
  rates: {
    general:      [0.006, 0.0155], // 一般の事業: 本人 6/1000、合計 15.5/1000
    agriculture:  [0.007, 0.0175], // 農林水産・清酒製造: 本人 7/1000、合計 17.5/1000
    construction: [0.007, 0.0185], // 建設の事業: 本人 7/1000、合計 18.5/1000
  },
});
