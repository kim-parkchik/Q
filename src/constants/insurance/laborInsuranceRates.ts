/**
 * 雇用保険料率の一覧（古い順）
 *
 * このファイルは scripts/import_employment_insurance_rates.py で、厚生労働省「令和○年度の雇用保険料率について」の PDF から作る
 * （手で書き換えない。作り方は insurance-tables/README.md）。PDF は「雇用保険料率について」のページ（https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000108634.html）にある:
 *   insurance-tables/source/koyou-ryouritsu-r03.pdf（https://www.mhlw.go.jp/content/000739455.pdf）SHA-256 c7798b41124f41711ee1e06b5f118b8dbd9812be118d27ba8aa3c60933268bf0
 *   insurance-tables/source/koyou-ryouritsu-r04.pdf（https://www.mhlw.go.jp/content/000921550.pdf）SHA-256 e0a7859939540a272415a69ff6dc6e965d1182a133f8ddb3b3447a78c033d267
 *   insurance-tables/source/koyou-ryouritsu-r05.pdf（https://www.mhlw.go.jp/content/001050206.pdf）SHA-256 194c4e6384e47e43bf1110bb1e849e5bc542e6ee1b4a783d27b7e142e01430ee
 *   insurance-tables/source/koyou-ryouritsu-r06.pdf（https://www.mhlw.go.jp/content/001211914.pdf）SHA-256 51792c90abc698e377875868df3aa35873fbcecf6d952b31a62ffe52a5d18a27
 *   insurance-tables/source/koyou-ryouritsu-r07.pdf（https://www.mhlw.go.jp/content/001401966.pdf）SHA-256 eda8a16a77c762247b7e7412c86f9f6accc33830620e2d8de047308cfca4022b
 *   insurance-tables/source/koyou-ryouritsu-r08.pdf（https://www.mhlw.go.jp/content/001692566.pdf）SHA-256 69ca914736d051ffa067464756500c2a8cf597186e9cf091b54512a68d3b1be9
 *
 * 料率は「何年何月から」で切り替える。通常は4月1日から翌3月31日までの年度ごとに決まるが、
 * 令和4年度のように年度の途中（10月）で変わることもあるので、変わった月ごとに1行ずつ並べる。
 * 給与計算では、その月までに始まっている最後の行を使う（index.ts の getInsuranceMaster）。
 * 各年度の PDF の表（上の段）の率を使い、下の段（前の年度の率）は、前の年度の PDF の率と同じことを確かめた。
 * 令和2年度は、令和3年度の PDF の下の段の率。
 * ※ 令和2年3月までは、4月1日に64歳以上の人の保険料が免除されていた（Q はこの免除に対応していないので、ここより前は作らない）
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
  /** 出典（厚生労働省の PDF） */
  source: string;
}

export const LABOR_INSURANCE_PERIODS: LaborInsurancePeriod[] = [
  {
    // 令和2年4月〜令和3年3月（「令和3年度の雇用保険料率について」の表の下の段）
    from: { year: 2020, month: 4 },
    source: "https://www.mhlw.go.jp/content/000739455.pdf",
    rates: {
      general:      [0.003, 0.009], // 一般の事業: 本人 3/1000、合計 9/1000
      agriculture:  [0.004, 0.011], // 農林水産・清酒製造: 本人 4/1000、合計 11/1000
      construction: [0.004, 0.012], // 建設の事業: 本人 4/1000、合計 12/1000
    },
  },
  {
    // 令和3年4月〜令和4年3月（「令和3年度の雇用保険料率について」の表）
    from: { year: 2021, month: 4 },
    source: "https://www.mhlw.go.jp/content/000739455.pdf",
    rates: {
      general:      [0.003, 0.009], // 一般の事業: 本人 3/1000、合計 9/1000
      agriculture:  [0.004, 0.011], // 農林水産・清酒製造: 本人 4/1000、合計 11/1000
      construction: [0.004, 0.012], // 建設の事業: 本人 4/1000、合計 12/1000
    },
  },
  {
    // 令和4年4月〜令和4年9月（「令和4年度雇用保険料率のご案内」の「○令和4年4月1日 ~ 令和4年9月30日」の表）
    from: { year: 2022, month: 4 },
    source: "https://www.mhlw.go.jp/content/000921550.pdf",
    rates: {
      general:      [0.003, 0.0095], // 一般の事業: 本人 3/1000、合計 9.5/1000
      agriculture:  [0.004, 0.0115], // 農林水産・清酒製造: 本人 4/1000、合計 11.5/1000
      construction: [0.004, 0.0125], // 建設の事業: 本人 4/1000、合計 12.5/1000
    },
  },
  {
    // 令和4年10月〜令和5年3月（「令和4年度雇用保険料率のご案内」の「○令和4年10月1日 ~ 令和5年3月31日」の表）
    from: { year: 2022, month: 10 },
    source: "https://www.mhlw.go.jp/content/000921550.pdf",
    rates: {
      general:      [0.005, 0.0135], // 一般の事業: 本人 5/1000、合計 13.5/1000
      agriculture:  [0.006, 0.0155], // 農林水産・清酒製造: 本人 6/1000、合計 15.5/1000
      construction: [0.006, 0.0165], // 建設の事業: 本人 6/1000、合計 16.5/1000
    },
  },
  {
    // 令和5年4月〜令和6年3月（「令和5年度雇用保険料率のご案内」の表）
    from: { year: 2023, month: 4 },
    source: "https://www.mhlw.go.jp/content/001050206.pdf",
    rates: {
      general:      [0.006, 0.0155], // 一般の事業: 本人 6/1000、合計 15.5/1000
      agriculture:  [0.007, 0.0175], // 農林水産・清酒製造: 本人 7/1000、合計 17.5/1000
      construction: [0.007, 0.0185], // 建設の事業: 本人 7/1000、合計 18.5/1000
    },
  },
  {
    // 令和6年4月〜令和7年3月（「令和6年度の雇用保険料率について」の表）
    from: { year: 2024, month: 4 },
    source: "https://www.mhlw.go.jp/content/001211914.pdf",
    rates: {
      general:      [0.006, 0.0155], // 一般の事業: 本人 6/1000、合計 15.5/1000
      agriculture:  [0.007, 0.0175], // 農林水産・清酒製造: 本人 7/1000、合計 17.5/1000
      construction: [0.007, 0.0185], // 建設の事業: 本人 7/1000、合計 18.5/1000
    },
  },
  {
    // 令和7年4月〜令和8年3月（「令和7(2025)年度 雇用保険料率のご案内」の表）
    from: { year: 2025, month: 4 },
    source: "https://www.mhlw.go.jp/content/001401966.pdf",
    rates: {
      general:      [0.0055, 0.0145], // 一般の事業: 本人 5.5/1000、合計 14.5/1000
      agriculture:  [0.0065, 0.0165], // 農林水産・清酒製造: 本人 6.5/1000、合計 16.5/1000
      construction: [0.0065, 0.0175], // 建設の事業: 本人 6.5/1000、合計 17.5/1000
    },
  },
  {
    // 令和8年4月〜令和9年3月（「令和8(2026)年度 雇用保険料率のご案内」の表）
    from: { year: 2026, month: 4 },
    source: "https://www.mhlw.go.jp/content/001692566.pdf",
    rates: {
      general:      [0.005, 0.0135], // 一般の事業: 本人 5/1000、合計 13.5/1000
      agriculture:  [0.006, 0.0155], // 農林水産・清酒製造: 本人 6/1000、合計 15.5/1000
      construction: [0.006, 0.0165], // 建設の事業: 本人 6/1000、合計 16.5/1000
    },
  },
];
