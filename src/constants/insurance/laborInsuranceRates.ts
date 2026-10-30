/**
 * 雇用保険料率の一覧（古い順）
 *
 * 料率は「何年何月から」で切り替える。通常は4月1日から翌3月31日までの年度ごとに決まるが、
 * 令和4年度のように年度の途中（10月）で変わることもあるので、変わった月ごとに1行ずつ並べる。
 * 給与計算では、その月までに始まっている最後の行を使う（index.ts の getInsuranceMaster）。
 *
 * ■ 新しい料率を追加するとき
 *   厚生労働省「雇用保険料率について」 https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000108634.html
 *   の発表資料を確認し、末尾に「使い始める年月・料率・出典URL」を足す。
 *   ※ 数字を手やAIで書き写すときは、必ず出典の資料と見比べること。
 */
import type { YearMonth } from './kenpoTableTypes';

/** 雇用保険料率 [本人負担, 合計]（小数。0.005 = 5/1000） */
export interface LaborInsuranceRates {
  general: [number, number];
  agriculture: [number, number];
  construction: [number, number];
}

export type EmpInsType = keyof LaborInsuranceRates;

export interface LaborInsurancePeriod {
  /** この月の分から使う */
  from: YearMonth;
  rates: LaborInsuranceRates;
  /** 出典（厚生労働省の発表資料） */
  source: string;
}

export const LABOR_INSURANCE_PERIODS: LaborInsurancePeriod[] = [
  {
    // 令和3年4月〜令和4年3月（「令和4年度の雇用保険料率について」の表の下段「３年度」）
    from: { year: 2021, month: 4 },
    source: "https://www.mhlw.go.jp/content/000921550.pdf",
    rates: {
      general:      [0.003, 0.009],  // 一般の事業: 本人 3/1000、合計 9/1000
      agriculture:  [0.004, 0.011],  // 農林水産・清酒製造: 本人 4/1000、合計 11/1000
      construction: [0.004, 0.012],  // 建設の事業: 本人 4/1000、合計 12/1000
    },
  },
  {
    // 令和4年4月〜9月（事業主負担だけが変わった）
    from: { year: 2022, month: 4 },
    source: "https://www.mhlw.go.jp/content/000921550.pdf",
    rates: {
      general:      [0.003, 0.0095], // 一般の事業: 本人 3/1000、合計 9.5/1000
      agriculture:  [0.004, 0.0115], // 農林水産・清酒製造: 本人 4/1000、合計 11.5/1000
      construction: [0.004, 0.0125], // 建設の事業: 本人 4/1000、合計 12.5/1000
    },
  },
  {
    // 令和4年10月〜令和5年3月（年度の途中で、本人負担も変わった）
    from: { year: 2022, month: 10 },
    source: "https://www.mhlw.go.jp/content/000921550.pdf",
    rates: {
      general:      [0.005, 0.0135], // 一般の事業: 本人 5/1000、合計 13.5/1000
      agriculture:  [0.006, 0.0155], // 農林水産・清酒製造: 本人 6/1000、合計 15.5/1000
      construction: [0.006, 0.0165], // 建設の事業: 本人 6/1000、合計 16.5/1000
    },
  },
  {
    // 令和5年4月〜令和6年3月（「令和6年度の雇用保険料率について」の表の下段「令和５年度」）
    from: { year: 2023, month: 4 },
    source: "https://www.mhlw.go.jp/content/001211914.pdf",
    rates: {
      general:      [0.006, 0.0155], // 一般の事業: 本人 6/1000、合計 15.5/1000
      agriculture:  [0.007, 0.0175], // 農林水産・清酒製造: 本人 7/1000、合計 17.5/1000
      construction: [0.007, 0.0185], // 建設の事業: 本人 7/1000、合計 18.5/1000
    },
  },
  {
    // 令和6年4月〜令和7年3月（令和5年度と同率）
    from: { year: 2024, month: 4 },
    source: "https://www.mhlw.go.jp/content/001211914.pdf",
    rates: {
      general:      [0.006, 0.0155], // 一般の事業: 本人 6/1000、合計 15.5/1000
      agriculture:  [0.007, 0.0175], // 農林水産・清酒製造: 本人 7/1000、合計 17.5/1000
      construction: [0.007, 0.0185], // 建設の事業: 本人 7/1000、合計 18.5/1000
    },
  },
  {
    // 令和7年4月〜令和8年3月
    from: { year: 2025, month: 4 },
    source: "https://www.mhlw.go.jp/content/001401966.pdf",
    rates: {
      general:      [0.0055, 0.0145], // 一般の事業: 本人 5.5/1000、合計 14.5/1000
      agriculture:  [0.0065, 0.0165], // 農林水産・清酒製造: 本人 6.5/1000、合計 16.5/1000
      construction: [0.0065, 0.0175], // 建設の事業: 本人 6.5/1000、合計 17.5/1000
    },
  },
  {
    // 令和8年4月〜令和9年3月
    from: { year: 2026, month: 4 },
    source: "https://www.mhlw.go.jp/content/001692566.pdf",
    rates: {
      general:      [0.005, 0.0135], // 一般の事業: 本人 5/1000、合計 13.5/1000
      agriculture:  [0.006, 0.0155], // 農林水産・清酒製造: 本人 6/1000、合計 15.5/1000
      construction: [0.006, 0.0165], // 建設の事業: 本人 6/1000、合計 16.5/1000
    },
  },
];
