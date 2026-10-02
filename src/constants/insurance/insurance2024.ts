/**
 * 2024年度（令和6年度） 協会けんぽ料率マスター
 * 参照元: https://www.kyoukaikenpo.or.jp/assets/r6ippan3.xlsx
 * 適用: 2024年3月分（4月納付分）〜 2025年2月分
 */

export const MASTER_YEAR = 2024;
export const MASTER_MONTH = 3; 

// --- 1. 公式データ: 介護保険料率 (令和6年度は 1.82%) ---
export const KENPO_CARE_RATE_TOTAL = 1.82; // 総料率
export const KENPO_CARE_RATE_EE = 0.91;    // 本人負担(EE)

// --- 2. 公式データ: 健康保険料率 (介護保険第2号被保険者に「該当する場合」の総料率) ---
// r6ippan3.xlsx の数値を転記
const OFFICIAL_RAW_RATES: Record<string, number> = {
  "北海道": 10.35, "青森": 9.94, "岩手": 9.76, "宮城": 10.15, "秋田": 10.05,
  "山形": 9.93, "福島": 10.04, "茨城": 10.02, "栃木": 9.98, "群馬": 9.95,
  "埼玉": 9.97, "千葉": 9.97, "東京": 10.00, "神奈川": 10.02, "新潟": 9.77,
  "富山": 9.65, "石川": 9.91, "福井": 9.58, "山梨": 10.03, "長野": 9.78,
  "静岡": 9.85, "愛知": 9.96, "三重": 10.08, "滋賀": 9.99, "京都": 10.22,
  "大阪": 10.30, "兵庫": 10.28, "奈良": 10.26, "和歌山": 10.24, "鳥取": 10.08,
  "島根": 10.11, "岡山": 10.19, "広島": 10.14, "山口": 10.16, "徳島": 10.19,
  "香川": 10.17, "愛媛": 10.12, "高知": 10.27, "福岡": 10.33, "佐賀": 10.33,
  "長崎": 10.22, "熊本": 10.20, "大分": 10.18, "宮崎": 10.20, "鹿児島": 10.22,
  "沖縄": 10.12,
};

// --- 3. 計算用データ: 純粋な健康保険料率 ---
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

// --- 5. 厚生年金 ---
export const PENSION_RATE: [number, number] = [9.15, 18.30];

// --- 6. 雇用保険 (令和6年度) ---
export const LABOR_INSURANCE_RATES = {
  general: [0.006, 0.0155],      
  agriculture: [0.007, 0.0175],  
  construction: [0.007, 0.0185], 
};

export type EmpInsType = keyof typeof LABOR_INSURANCE_RATES;

// --- 7. 事業主負担金 ---
export const CHILD_ALLOWANCE_RATE = 0.31; 

// --- 8. 上限・下限 ---
export const PENSION_MIN_HYOJUN = 88000;
export const PENSION_MAX_HYOJUN = 650000; 
export const KENPO_MAX_HYOJUN = 1390000; // ※注意: 2024年度はまだ50級(139万)が上限でした

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
  [1355000, Infinity, 1390000],
];

export const HYOJUN_OPTIONS = HYOJUN_TABLE.map(([, , std], index) => ({
  label: `${index + 1}級：${std.toLocaleString()}円`,
  value: std
}));

export const INSURANCE_2024 = {
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