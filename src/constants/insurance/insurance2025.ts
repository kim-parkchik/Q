/**
 * 2025年度（令和7年度）の社会保険マスター
 *
 * ・健康保険・介護保険・厚生年金（協会けんぽ）：令和7年3月分から
 *     → kenpoTable2025.ts（協会けんぽの Excel から自動生成）
 * ・雇用保険：令和7年4月1日から令和8年3月31日まで
 *     出典: 厚生労働省「令和7年度の雇用保険料率について」 https://www.mhlw.go.jp/content/001401966.pdf
 */
import { buildInsuranceMaster } from './buildInsuranceMaster';
import { KENPO_TABLE_2025 } from './kenpoTable2025';

export const INSURANCE_2025 = buildInsuranceMaster(KENPO_TABLE_2025, {
  fiscalYear: 2025,
  source: "https://www.mhlw.go.jp/content/001401966.pdf",
  rates: {
    general:      [0.0055, 0.0145], // 一般の事業: 本人 5.5/1000、合計 14.5/1000
    agriculture:  [0.0065, 0.0165], // 農林水産・清酒製造: 本人 6.5/1000、合計 16.5/1000
    construction: [0.0065, 0.0175], // 建設の事業: 本人 6.5/1000、合計 17.5/1000
  },
});
