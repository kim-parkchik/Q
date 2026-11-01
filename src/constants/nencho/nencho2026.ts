/**
 * 令和8年分の年末調整の計算に使う表・計算式
 *
 * ⚠️ このファイルは自動生成です。手で書き換えないでください。
 * 元データ: 国税庁「年末調整のしかた」の PDF（nencho-tables/ フォルダ。入手元とハッシュは nencho-tables/README.md）
 * 出典    : 国税庁ホームページ（https://www.nta.go.jp/publication/pamph/gensen/nencho2026/01.htm）の「年末調整のしかた」を加工して作成
 *           （PDF の表と計算式を Q で使える形に変換したもので、国税庁が作成したものではありません）
 * 確認    : 給与所得控除後の給与等の金額の計算式で表の全1103行を作り、114.pdf の表の数字（3309個）と一致することを確認済み
 * 作り方  : python3 -I scripts/import_nencho_tables.py <PDFのフォルダ> <年> <このファイル>
 */
import type { NenchoMaster } from './nenchoTypes';

export const NENCHO_2026: NenchoMaster = {
  year: 2026,
  salaryLimit: 20000000,
  rounding: {
    from: 2200000,
    to: 6599999,
    step: 4000,
  },
  employmentIncome: [
    {
      from: 1,
      to: 740999,
      fixed: 0,
    },
    {
      from: 741000,
      to: 2190999,
      rate: 100,
      minus: 740000,
    },
    {
      from: 2191000,
      to: 2192999,
      fixed: 1451000,
    },
    {
      from: 2193000,
      to: 2195999,
      fixed: 1453000,
    },
    {
      from: 2196000,
      to: 2199999,
      fixed: 1456000,
    },
    {
      from: 2200000,
      to: 3599999,
      rate: 70,
      minus: 80000,
    },
    {
      from: 3600000,
      to: 6599999,
      rate: 80,
      minus: 440000,
    },
    {
      from: 6600000,
      to: 8499999,
      rate: 90,
      minus: 1100000,
    },
    {
      from: 8500000,
      to: 20000000,
      rate: 100,
      minus: 1950000,
    },
  ],
  incomeAdjustment: {
    threshold: 8500000,
    ratePercent: 10,
    max: 150000,
  },
  basic: [
    {
      upTo: 4890000,
      amount: 1040000,
    },
    {
      upTo: 6550000,
      amount: 670000,
    },
    {
      upTo: 23500000,
      amount: 620000,
    },
    {
      upTo: 24000000,
      amount: 480000,
    },
    {
      upTo: 24500000,
      amount: 320000,
    },
    {
      upTo: 25000000,
      amount: 160000,
    },
  ],
  spouse: {
    ownerBands: [9000000, 9500000, 10000000],
    spouseIncomeLimit: 620000,
    normal: [380000, 260000, 130000],
    elderly: [480000, 320000, 160000],
    special: [
      {
        over: 620000,
        upTo: 950000,
        amounts: [380000, 260000, 130000],
      },
      {
        over: 950000,
        upTo: 1000000,
        amounts: [360000, 240000, 120000],
      },
      {
        over: 1000000,
        upTo: 1050000,
        amounts: [310000, 210000, 110000],
      },
      {
        over: 1050000,
        upTo: 1100000,
        amounts: [260000, 180000, 90000],
      },
      {
        over: 1100000,
        upTo: 1150000,
        amounts: [210000, 140000, 70000],
      },
      {
        over: 1150000,
        upTo: 1200000,
        amounts: [160000, 110000, 60000],
      },
      {
        over: 1200000,
        upTo: 1250000,
        amounts: [110000, 80000, 40000],
      },
      {
        over: 1250000,
        upTo: 1300000,
        amounts: [60000, 40000, 20000],
      },
      {
        over: 1300000,
        upTo: 1330000,
        amounts: [30000, 20000, 10000],
      },
    ],
    specialIncomeLimit: 1330000,
  },
  specificRelative: [
    {
      over: 620000,
      upTo: 850000,
      amount: 630000,
    },
    {
      over: 850000,
      upTo: 900000,
      amount: 610000,
    },
    {
      over: 900000,
      upTo: 950000,
      amount: 510000,
    },
    {
      over: 950000,
      upTo: 1000000,
      amount: 410000,
    },
    {
      over: 1000000,
      upTo: 1050000,
      amount: 310000,
    },
    {
      over: 1050000,
      upTo: 1100000,
      amount: 210000,
    },
    {
      over: 1100000,
      upTo: 1150000,
      amount: 110000,
    },
    {
      over: 1150000,
      upTo: 1200000,
      amount: 60000,
    },
    {
      over: 1200000,
      upTo: 1230000,
      amount: 30000,
    },
  ],
  deductions: {
    dependentGeneral: 380000,
    dependentSpecific: 630000,
    dependentElderlyOther: 480000,
    dependentElderlyLivingTogether: 580000,
    disabilityGeneral: 270000,
    disabilitySpecial: 400000,
    disabilitySpecialLivingTogether: 750000,
    widow: 270000,
    singleParent: 350000,
    workingStudent: 270000,
  },
  lifeInsurance: {
    new: {
      brackets: [
        {
          upTo: 20000,
          divisor: 1,
          plus: 0,
        },
        {
          upTo: 40000,
          divisor: 2,
          plus: 10000,
        },
        {
          upTo: 80000,
          divisor: 4,
          plus: 20000,
        },
      ],
      max: 40000,
    },
    newYoung: {
      brackets: [
        {
          upTo: 30000,
          divisor: 1,
          plus: 0,
        },
        {
          upTo: 60000,
          divisor: 2,
          plus: 15000,
        },
        {
          upTo: 120000,
          divisor: 4,
          plus: 30000,
        },
      ],
      max: 60000,
    },
    old: {
      brackets: [
        {
          upTo: 25000,
          divisor: 1,
          plus: 0,
        },
        {
          upTo: 50000,
          divisor: 2,
          plus: 12500,
        },
        {
          upTo: 100000,
          divisor: 4,
          plus: 25000,
        },
      ],
      max: 50000,
    },
    generalMax: 40000,
    generalMaxYoung: 60000,
    pensionMax: 40000,
    totalMax: 120000,
  },
  earthquake: {
    earthquakeMax: 50000,
    totalMax: 50000,
    oldLongTerm: {
      brackets: [
        {
          upTo: 10000,
          divisor: 1,
          plus: 0,
        },
        {
          upTo: 20000,
          divisor: 2,
          plus: 5000,
        },
      ],
      max: 15000,
    },
  },
  taxRates: [
    {
      upTo: 1950000,
      rate: 5,
      minus: 0,
    },
    {
      upTo: 3300000,
      rate: 10,
      minus: 97500,
    },
    {
      upTo: 6950000,
      rate: 20,
      minus: 427500,
    },
    {
      upTo: 9000000,
      rate: 23,
      minus: 636000,
    },
    {
      upTo: 18000000,
      rate: 33,
      minus: 1536000,
    },
    {
      upTo: 18050000,
      rate: 40,
      minus: 2796000,
    },
  ],
  taxableLimit: 18050000,
  taxableRoundTo: 1000,
  reconstruction: {
    ratePercent: 102.1,
    roundTo: 100,
  },
};
