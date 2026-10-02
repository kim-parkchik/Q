/**
 * 2025年度（令和7年度） 協会けんぽ料率マスター
 * 参照元: https://www.kyoukaikenpo.or.jp/assets/r7ippan3.xlsx
 * 適用: 2025年3月分（4月納付分）〜 2026年2月分
 */

export const MASTER_YEAR = 2025;
export const MASTER_MONTH = 3; 

// --- 1. 公式データ: 介護保険料率 (令和7年度は 1.60%) ---
export const KENPO_CARE_RATE_TOTAL = 1.60; // 総料率
export const KENPO_CARE_RATE_EE = 0.80;    // 本人負担(EE)

// --- 2. 公式データ: 健康保険料率 (介護保険第2号被保険者に「該当する場合」の総料率) ---
// r7ippan3.xlsx の数値を転記
const OFFICIAL_RAW_RATES: Record<string, number> = {
  "北海道": 10.12, "青森": 9.77, "岩手": 9.55, "宮城": 9.91, "秋田": 9.83,
  "山形": 9.71, "福島": 9.87, "茨城": 9.87, "栃木": 9.81, "群馬": 9.80,
  "埼玉": 9.81, "千葉": 9.81, "東京": 9.83, "神奈川": 9.85, "新潟": 9.61,
  "富山": 9.48, "石川": 9.74, "福井": 9.43, "山梨": 9.88, "長野": 9.61,
  "静岡": 9.66, "愛知": 9.78, "三重": 9.90, "滋賀": 9.80, "京都": 10.02,
  "大阪": 10.12, "兵庫": 10.10, "奈良": 10.07, "和歌山": 10.06, "鳥取": 9.91,
  "島根": 9.95, "岡山": 10.01, "広島": 9.98, "山口": 9.99, "徳島": 10.02,
  "香川": 10.00, "愛媛": 9.95, "高知": 10.10, "福岡": 10.14, "佐賀": 10.14,
  "長崎": 10.05, "熊本": 10.04, "大分": 10.02, "宮崎": 10.04, "鹿児島": 10.06,
  "沖縄": 9.97,
};

// --- 3. 計算用データ: 介護保険料を差し引いた「純粋な健康保険料率」を自動生成 ---
export const KENPO_RATES: Record<string, [number, number]> = Object.entries(OFFICIAL_RAW_RATES).reduce(
  (acc, [pref, totalRate]) => {
    const pureTotal = Number((totalRate - KENPO_CARE_RATE_TOTAL).toFixed(2)); 
    const pureEE = Number((pureTotal / 2).toFixed(3)); 
    acc[pref] = [pureEE, pureTotal];
    return acc;
  },
  {} as Record<string, [number, number]>
);

// --- 4. 介護保険 ---
export const KENPO_CARE_RATE: [number, number] = [KENPO_CARE_RATE_EE, KENPO_CARE_RATE_TOTAL];

// --- 5. 厚生年金 (2025年も変わらず) ---
export const PENSION_RATE: [number, number] = [9.15, 18.30];

// --- 6. 雇用保険 (2025年度の料率) ---
export const LABOR_INSURANCE_RATES = {
  general: [0.006, 0.0155],      
  agriculture: [0.007, 0.0175],  
  construction: [0.007, 0.0185], 
};

export type EmpInsType = keyof typeof LABOR_INSURANCE_RATES;

// --- 7. 事業主のみが負担する拠出金 ---
export const CHILD_ALLOWANCE_RATE = 0.31; 

// --- 8. 上限・下限 (2025年も同じ) ---
export const PENSION_MIN_HYOJUN = 88000;
export const PENSION_MAX_HYOJUN = 650000; 
export const KENPO_MAX_HYOJUN = 1450000; 

export const HEALTH_INS_ANNUAL_LIMIT = 5730000;
export const PENSION_INS_SINGLE_LIMIT = 1500000;

export const NURSING_CARE_START_AGE = 40;
export const NURSING_CARE_END_AGE = 65;

// 標準報酬月額 等級表
export const HYOJUN_TABLE: [number, number, number][] = [
  [0,63000,58000],[63000,73000,68000],[73000,83000,78000],[83000,93000,88000],
  [93000,101000,98000],[101000,107000,104000],[107000,114000,110000],
  [114000,122000,118000],[122000,130000,126000],[130000,138000,134000],
  [138000,146000,142000],[146000,155000,150000],[155000,165000,160000],
  [165000,175000,170000],[175000,185000,180000],[185000,195000,190000],
  [195000,210000,200000],[210000,230000,220000],[230000,250000,240000],
  [250000,270000,260000],[270000,290000,280000],[290000,310000,300000],
  [310000,330000,320000],[330000,350000,340000],[350000,370000,360000],
  [370000,395000,380000],[395000,425000,410000],[425000,455000,440000],
  [455000,485000,470000],[485000,515000,500000],[515000,545000,530000],
  [545000,575000,560000],[575000,605000,590000],[605000,635000,620000],
  [635000,665000,650000],[665000,695000,680000],[695000,730000,710000],
  [730000,770000,750000],[770000,810000,790000],[810000,855000,830000],
  [855000,905000,880000],[905000,955000,930000],[955000,1005000,980000],
  [1005000,1055000,1030000],[1055000,1115000,1090000],[1115000,1175000,1150000],
  [1175000, 1235000, 1210000],[1235000, 1295000, 1270000],[1295000, 1355000, 1330000],
  [1355000, 1415000, 1390000],
  [1415000, Infinity, 1450000],
];

export const HYOJUN_OPTIONS = HYOJUN_TABLE.map(([, , std], index) => ({
  label: `${index + 1}級：${std.toLocaleString()}円`,
  value: std
}));

export const INSURANCE_2025 = {
  MASTER_YEAR,
  MASTER_MONTH,
  KENPO_RATES,
  KENPO_CARE_RATE,
  PENSION_RATE,
  LABOR_INSURANCE_RATES,
  CHILD_ALLOWANCE_RATE,
  PENSION_MIN_HYOJUN,
  PENSION_MAX_HYOJUN,
  KENPO_MAX_HYOJUN,
  HEALTH_INS_ANNUAL_LIMIT,
  PENSION_INS_SINGLE_LIMIT,
  NURSING_CARE_START_AGE,
  NURSING_CARE_END_AGE,
  HYOJUN_TABLE,
  HYOJUN_OPTIONS
};