/**
 * 2026年度（令和8年度）の社会保険マスター
 *
 * ・健康保険・介護保険・厚生年金（協会けんぽ）：令和8年3月分から
 *     → kenpoTable2026.ts（協会けんぽの Excel から自動生成）
 * ・子ども・子育て支援金：令和8年4月分から（新設。健康保険と一緒に徴収し、本人と会社で折半）
 * ・雇用保険：令和8年4月1日から令和9年3月31日まで
 *     出典: 厚生労働省「令和8年度の雇用保険料率について」 https://www.mhlw.go.jp/content/001692566.pdf
 */
import { buildInsuranceMaster } from './buildInsuranceMaster';
import { KENPO_TABLE_2026 } from './kenpoTable2026';

export const INSURANCE_2026 = buildInsuranceMaster(KENPO_TABLE_2026, {
  fiscalYear: 2026,
  source: "https://www.mhlw.go.jp/content/001692566.pdf",
  rates: {
    general:      [0.005, 0.0135], // 一般の事業: 本人 5/1000、合計 13.5/1000
    agriculture:  [0.006, 0.0155], // 農林水産・清酒製造: 本人 6/1000、合計 15.5/1000
    construction: [0.006, 0.0165], // 建設の事業: 本人 6/1000、合計 16.5/1000
  },
});
