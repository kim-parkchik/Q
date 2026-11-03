/**
 * 固定残業代の時間の目安：固定残業代が時間外労働の何時間分の割増賃金に当たるか、設定した時間分の割増賃金はいくらか
 *
 * ■ 時給は、給与計算（utils/calcSalary.ts）の「残業代の時給」と同じ：
 *   （月給 ＋ 残業代の時給に入れる手当）÷ 1年間における1か月平均所定労働時間（労働基準法施行規則19条1項4号・7号、21条）
 * ■ 割増率は、時間外労働 25%、1か月60時間を超えた分は 50%（労働基準法37条1項。constants/labor.ts）
 * ■ 目安なので、1円未満の端数の処理や、日ごとの60時間の数え方は入れない。給与明細で入れる役職手当も入れない
 */
import { OVERTIME_PREMIUM_LIMIT_HOURS, OVERTIME_PREMIUM_RATE, OVERTIME_RATE } from "../constants/labor";

/** 残業代の時給（月平均所定労働時間がなければ 0） */
export const overtimeHourlyRateOf = (monthlyWage: number, allowances: number, monthlyAverageHours: number): number =>
  monthlyAverageHours > 0 && Number.isFinite(monthlyAverageHours) ? (Math.max(0, monthlyWage) + Math.max(0, allowances)) / monthlyAverageHours : 0;

/** 時間外労働 hours 時間分の割増賃金（60時間を超えた分は50%） */
export const overtimePayFor = (hours: number, hourlyRate: number): number =>
  hourlyRate * (OVERTIME_RATE * Math.min(hours, OVERTIME_PREMIUM_LIMIT_HOURS) + OVERTIME_PREMIUM_RATE * Math.max(0, hours - OVERTIME_PREMIUM_LIMIT_HOURS));

/** 固定残業代が、時間外労働の何時間分の割増賃金に当たるか（時給が分からなければ null） */
export const fixedOvertimeCoverageHours = (amount: number, hourlyRate: number): number | null => {
  if (!(hourlyRate > 0) || !Number.isFinite(hourlyRate)) return null;
  const upToLimit = overtimePayFor(OVERTIME_PREMIUM_LIMIT_HOURS, hourlyRate);
  return amount <= upToLimit
    ? amount / (hourlyRate * OVERTIME_RATE)
    : OVERTIME_PREMIUM_LIMIT_HOURS + (amount - upToLimit) / (hourlyRate * OVERTIME_PREMIUM_RATE);
};
