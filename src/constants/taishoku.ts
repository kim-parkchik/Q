/**
 * 退職手当等（退職金）に対する所得税（源泉徴収税額）と住民税（特別徴収税額）の計算に使う数値
 *
 * ⚠️ このファイルは自動生成です。手で書き換えないでください。
 * 作り方  : python3 -I scripts/import_taishoku_tables.py taishoku-tables src/constants/taishoku.ts（入手元は taishoku-tables/README.md）
 * 元データ:
 *   shotokuzei-30.xml（SHA-256 c7f2b45fc7b469dbf7fc3cfe82f7d7572e5ed52171e4aef62ff6d842e12f1b5c）
 *     https://laws.e-gov.go.jp/api/1/articles;lawId=340AC0000000033;article=30
 *   shotokuzei-rei-69.xml（SHA-256 3969cba1c5c3c383b28fa9ccff329bbb74793a1f91e4e44304bb447984d3720d）
 *     https://laws.e-gov.go.jp/api/1/articles;lawId=340CO0000000096;article=69
 *   chihouzei-50-4.xml（SHA-256 f6a087566264aecd522fe3321c1d66811ca13a042d7ea1a45d400c88b2031700）
 *     https://laws.e-gov.go.jp/api/1/articles;lawId=325AC0000000226;article=50_4
 *   chihouzei-328-3.xml（SHA-256 3985d8771601778478d00d16b72e9a9a1cf7d60ad6d15a51ffec278ff7647471）
 *     https://laws.e-gov.go.jp/api/1/articles;lawId=325AC0000000226;article=328_3
 *   source/zeigakuhyo2026-18.pdf（SHA-256 897dcc15c50c63cd5d5a2477b05097b8af946e137a0f4430585a210b38d67651）
 *     https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/data/18.pdf
 *   source/zeigakuhyo2027-18.pdf（SHA-256 2d5228a70e85d38212b56d096e4e6104fc84fb9adeeb669114115df0f9b38427）
 *     https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2027/data/18.pdf
 *   source/tebiki2026-03.pdf（SHA-256 b53451729d3e1c3bf333467f39d1061f12b596bfade549f4e66cb4ab16660a87）
 *     https://www.nta.go.jp/publication/pamph/hotei/tebiki2026/PDF/03.pdf
 */

/** 退職所得控除額（所得税法30条3項・6項） */
export const TAISHOKU_DEDUCTION = {
  /** 勤続年数が yearsThreshold 年以下：perYear 円 × 勤続年数 */
  perYear: 400000,
  yearsThreshold: 20,
  /** yearsThreshold 年を超える：base 円 ＋ perYearOver 円 ×（勤続年数 − yearsThreshold 年） */
  base: 8000000,
  perYearOver: 700000,
  /** 計算した額がこれに満たないときは、この額（6項2号） */
  minimum: 800000,
  /** 障害者になったことに直接基因して退職したときに加える額（6項3号） */
  disability: 1000000,
} as const;

/** 退職所得の金額（所得税法30条2項・4項・5項） */
export const TAISHOKU_INCOME = {
  /** 収入金額から退職所得控除額を引いた残額にかける割合（[分子, 分母]。特定役員退職手当等にはかけない） */
  half: [1, 2] as [number, number],
  /** 短期退職手当等：短期勤続年数（役員等以外の者としての勤続年数）が years 年以下。残額が threshold 円以下なら half、
   *  超えるなら base 円 ＋（収入金額 −（threshold 円 ＋ 退職所得控除額）） */
  short: { years: 5, threshold: 3000000, base: 1500000 },
  /** 特定役員退職手当等：役員等勤続年数がこの年数以下 */
  officerYears: 5,
} as const;

/** 勤続年数の1年未満の端数は1年にする（所得税法施行令69条2項） */
export const TAISHOKU_ROUND_UP_YEARS = true;

/** 住民税の分離課税に係る所得割の税率（[分子, 分母]。市町村民税：地方税法328条の3、道府県民税：50条の4） */
export const TAISHOKU_LOCAL_RATES = {
  city: [6, 100] as [number, number],
  pref: [4, 100] as [number, number],
} as const;

/** 「退職所得の受給に関する申告書」の提出がないとき：支払金額にかける率（[分子, 分母]。100 分の 20.42。
 *  所得税 20％ に速算表の「×102.1％」をかけた率であることを確かめた） */
export const TAISHOKU_NO_DECLARATION_RATE = [2042, 10000] as [number, number];

export interface TaishokuBracket {
  /** 課税退職所得金額がこの額以下（最後の行は null） */
  upTo: number | null;
  /** 所得税率（％） */
  rate: number;
  /** 控除額（円） */
  deduction: number;
}

export interface TaishokuQuickTable {
  year: number;
  title: string;
  source: string;
  /** 税額 ＝（課税退職所得金額 × 税率 − 控除額）× multiplier（[分子, 分母]。102.1％）。1円未満の端数は切り捨て */
  multiplier: [number, number];
  brackets: TaishokuBracket[];
}

/** 退職所得の源泉徴収税額の速算表（年分ごと） */
export const TAISHOKU_QUICK_TABLES: TaishokuQuickTable[] = [
  {
    year: 2026,
    title: "退職所得の源泉徴収税額の速算表（令和8年分）",
    source: "https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/data/18.pdf",
    multiplier: [1021, 1000],
    brackets: [
      { upTo: 1950000, rate: 5, deduction: 0 },
      { upTo: 3300000, rate: 10, deduction: 97500 },
      { upTo: 6950000, rate: 20, deduction: 427500 },
      { upTo: 9000000, rate: 23, deduction: 636000 },
      { upTo: 18000000, rate: 33, deduction: 1536000 },
      { upTo: 40000000, rate: 40, deduction: 2796000 },
      { upTo: null, rate: 45, deduction: 4796000 },
    ],
  },
  {
    year: 2027,
    title: "退職所得の源泉徴収税額の速算表（令和9年分）",
    source: "https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2027/data/18.pdf",
    multiplier: [1021, 1000],
    brackets: [
      { upTo: 1950000, rate: 5, deduction: 0 },
      { upTo: 3300000, rate: 10, deduction: 97500 },
      { upTo: 6950000, rate: 20, deduction: 427500 },
      { upTo: 9000000, rate: 23, deduction: 636000 },
      { upTo: 18000000, rate: 33, deduction: 1536000 },
      { upTo: 40000000, rate: 40, deduction: 2796000 },
      { upTo: null, rate: 45, deduction: 4796000 },
    ],
  },
];
