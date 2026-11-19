/**
 * 固定残業代の時間の目安：固定残業代が時間外労働の何時間分の割増賃金に当たるか、設定した時間分の割増賃金はいくらか
 *
 * ■ 時給は、給与計算（utils/calcSalary.ts）の「残業代の時給」と同じ：
 *   （月給 ＋ 残業代の時給に入れる手当）÷ 1年間における1か月平均所定労働時間（労働基準法施行規則19条1項4号・7号、21条）
 * ■ 割増率は、給与規定グループの割増率（utils/premiumRates.ts。入れていなければ法律の率：時間外労働 25%、1か月60時間を超えた分は 50%。
 *   1か月45時間（限度時間）を超えた分の率を高く決めていれば、その率）
 * ■ 目安なので、1円未満の端数の処理や、日ごとの60時間の数え方・1年の限度時間は入れない。給与明細で入れる役職手当も入れない
 */
import { LEGAL_PREMIUM_RATES, overtimeSegments, type PremiumRates } from "./premiumRates";

/** 残業代の時給（月平均所定労働時間がなければ 0） */
export const overtimeHourlyRateOf = (monthlyWage: number, allowances: number, monthlyAverageHours: number): number =>
  monthlyAverageHours > 0 && Number.isFinite(monthlyAverageHours) ? (Math.max(0, monthlyWage) + Math.max(0, allowances)) / monthlyAverageHours : 0;

/** その月の時間外労働を段（月45時間・60時間）に分けたもの（所定労働時間の外の時間として、1.0倍 ＋ 割増率で払う） */
const segmentsOf = (hours: number, rates: PremiumRates) =>
  overtimeSegments({ hours, within: 0, monthSoFar: 0, yearSoFar: null, workDate: "9999-12-31", isSmallBusiness: false, rates });

/** 時間外労働 hours 時間分の割増賃金（給与規定グループの率。60時間を超えた分は50%など） */
export const overtimePayFor = (hours: number, hourlyRate: number, rates: PremiumRates = LEGAL_PREMIUM_RATES): number =>
  segmentsOf(hours, rates).reduce((s, seg) => s + hourlyRate * (1 + seg.rate / 100) * seg.hours, 0);

/** 固定残業代が、時間外労働の何時間分の割増賃金に当たるか（時給が分からなければ null） */
export const fixedOvertimeCoverageHours = (amount: number, hourlyRate: number, rates: PremiumRates = LEGAL_PREMIUM_RATES): number | null => {
  if (!(hourlyRate > 0) || !Number.isFinite(hourlyRate)) return null;
  // 段ごとに、その段をまるごと払える額かを見て、足りなくなった段の中で時間を割り戻す（最後の段は終わりがないので、十分長くとる）
  let left = Math.max(0, amount);
  let hours = 0;
  for (const seg of segmentsOf(10000, rates)) {
    const perHour = hourlyRate * (1 + seg.rate / 100);
    const full = perHour * seg.hours;
    if (left <= full) return hours + left / perHour;
    left -= full;
    hours += seg.hours;
  }
  return hours;
};
