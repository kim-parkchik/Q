/**
 * 年次有給休暇の付与日数の表（このファイルは scripts/import_annual_leave_tables.py で作る。手で直さない）
 *
 * 出典：e-Gov 法令検索の条文データ（2026-11-13 に作成。元のファイルは annual-leave-tables/）
 *   ・労働基準法39条 https://laws.e-gov.go.jp/api/1/articles;lawId=322AC0000000049;article=39
 *   ・労働基準法施行規則24条の3 https://laws.e-gov.go.jp/api/1/articles;lawId=322M40000100023;article=24_3
 * 比例付与の表の日数は、すべて「通常の付与日数 × 週所定労働日数 ÷ 5.2（1日未満切り捨て）」と同じことを確かめてある。
 */

/** 雇入れの日から、はじめて付与するまでの月数（労働基準法39条1項） */
export const FIRST_GRANT_MONTHS = 6;

/** 付与の条件の出勤率（全労働日の8割以上。労働基準法39条1項） */
export const ATTENDANCE_RATE_REQUIRED = 0.8;

/**
 * 通常の付与日数（継続勤務期間 6か月・1年6か月・2年6か月・3年6か月・4年6か月・5年6か月・6年6か月以上 の順。
 * 労働基準法39条1項・2項）
 */
export const NORMAL_GRANT_DAYS: readonly number[] = [10, 11, 12, 14, 16, 18, 20];

/** 比例付与にならない、1週間の所定労働時間（この時間以上なら通常の付与。労働基準法施行規則24条の3第1項） */
export const PROPORTIONAL_WEEKLY_HOURS_LIMIT = 30;

/** 通常の労働者の1週間の所定労働日数（労働基準法施行規則24条の3第2項） */
export const NORMAL_WEEKLY_DAYS = 5.2;

/** 比例付与になる1週間の所定労働日数の上限・1年間の所定労働日数の上限（労働基準法施行規則24条の3第4項・5項） */
export const PROPORTIONAL_MAX_WEEKLY_DAYS = 4;
export const PROPORTIONAL_MAX_ANNUAL_DAYS = 216;

/** 比例付与の日数（労働基準法施行規則24条の3第3項の表。days は継続勤務期間の段の順） */
export const PROPORTIONAL_GRANT_DAYS: readonly { weeklyDays: number; annualDaysFrom: number; annualDaysTo: number; days: readonly number[] }[] = [
  { weeklyDays: 4, annualDaysFrom: 169, annualDaysTo: 216, days: [7, 8, 9, 10, 12, 13, 15] },
  { weeklyDays: 3, annualDaysFrom: 121, annualDaysTo: 168, days: [5, 6, 6, 8, 9, 10, 11] },
  { weeklyDays: 2, annualDaysFrom: 73, annualDaysTo: 120, days: [3, 4, 4, 5, 6, 6, 7] },
  { weeklyDays: 1, annualDaysFrom: 48, annualDaysTo: 72, days: [1, 2, 2, 2, 3, 3, 3] },
];

/** 年5日の時季指定の義務がある人：付与する日数がこの日数以上（労働基準法39条7項） */
export const OBLIGATION_MIN_GRANT_DAYS = 10;

/** 年5日の時季指定の日数（労働基準法39条7項） */
export const OBLIGATION_DAYS = 5;
