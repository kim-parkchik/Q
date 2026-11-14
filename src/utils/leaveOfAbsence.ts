/**
 * 休業・休職の日の、給与・勤怠・年次有給休暇の出勤率での扱い（社会保険料の免除は utils/leaveExemption.ts）
 *
 * 従業員の画面で、休業・休職の種類と期間を入れる（staff.leave_periods。JSON）。
 *   産前産後休業（労働基準法65条）・育児休業（産後パパ育休を含む。育児・介護休業法）・介護休業（育児・介護休業法）・
 *   業務上の負傷・疾病による休業（労働基準法76条・労災保険）・その他の休職・休業（私傷病の休職など。就業規則で決める）
 *
 * ■ 給与：休業の日は働いていないので、その日の分の賃金は払わない（ノーワーク・ノーペイ。休業中の収入は、出産手当金・
 *   育児休業給付・介護休業給付・休業補償給付・傷病手当金などで、会社の給与ではない）。一般的な給与ソフトと同じ形
 *   （クラウド型の給与ソフトでは、休職・休業の種別と期間を従業員ごとに登録し、給与の計算期間がすべて休業の月は
 *   支給項目を0円に、休業に入る月・復帰する月は「日割り計算控除」で日割りする）
 *   ・計算期間がまるごと休業の月（在籍した日がすべて休業の日か、休業の日のほかに所定労働日がない月）：
 *     月給・固定の支給項目・固定残業代・通勤手当（月額）を払わない
 *   ・期間の途中で休業が始まる・終わる月：月給と固定の支給項目を、休業していない日の分だけ日割りする
 *     （給与規定グループの「休業の月の日割り」：所定労働日数（初めの値）・暦日数・日割りしない。入社・退職の月と同じく、
 *     固定残業代・通勤手当・「変動」の項目は日割りしない）
 *   ・時給制・日給制は、働いた時間・日の分を払う（休業の日は勤怠がないので払わない）
 *   ・社会保険料：産休・育休は免除（utils/leaveExemption.ts）。介護休業などは免除がないので、給与がなくても引く。
 *     住民税も、いつもどおり引く（クラウド型の給与ソフトと同じ。差引支給額がマイナスになる月は、本人から受け取るなどする）
 *   ・雇用保険料・所得税は、払った給与で計算する（給与がなければ0円）
 * ■ 勤怠：休業の日を、勤怠の画面と出勤簿に「育児休業」などと出す。休業の日に働いた記録があれば知らせる
 * ■ 算定・月変の支払基礎日数（月給制）：給与を払わない休業の日は数えない（日割りした月は払った日数、まるごと休業の月は0日）
 * ■ 年次有給休暇の出勤率（労働基準法39条10項）：産前産後休業・育児休業・介護休業・業務上の負傷や疾病による休業の期間は、
 *   出勤したものとみなす。その他の休職は法律に決まりがないので、会社の決まり（全労働日から除く・欠勤と同じに数える）で数える
 */
import dayjs from 'dayjs';
import { isPrescribedWorkDay, type CalendarContext } from './annualWorkDays';
import { parseLeavePeriods, validateLeavePeriod, type LeavePeriod, type LeaveType } from './leaveExemption';

/** 休業・休職の種類の名前 */
export const LEAVE_TYPE_NAMES: Record<LeaveType, string> = {
  maternity: '産前産後休業',
  childcare: '育児休業',
  family_care: '介護休業',
  injury: '業務上の負傷・疾病による休業',
  other: 'その他の休職',
};

/** 勤怠の画面・出勤簿に出す短い名前 */
export const LEAVE_TYPE_SHORT_NAMES: Record<LeaveType, string> = {
  maternity: '産休',
  childcare: '育休',
  family_care: '介護休業',
  injury: '労災の休業',
  other: '休職',
};

/** 年次有給休暇の出勤率で、出勤したものとみなす休業（労働基準法39条10項） */
export const DEEMED_PRESENT_LEAVE_TYPES: ReadonlySet<LeaveType> = new Set<LeaveType>(['maternity', 'childcare', 'family_care', 'injury']);

/** 休業の月の日割り（給与規定グループの設定）：workdays: 所定労働日数で / calendar: 暦日数で / none: しない */
export type LeaveProrationMethod = 'workdays' | 'calendar' | 'none';

export const LEAVE_PRORATION_METHOD_LABELS: Record<LeaveProrationMethod, string> = {
  workdays: '所定労働日数で日割り',
  calendar: '暦日数で日割り',
  none: '日割りしない',
};

/** 設定がない・知らない値は「所定労働日数で日割り」 */
export const toLeaveProrationMethod = (value: unknown): LeaveProrationMethod =>
  (value === 'calendar' || value === 'none' ? value : 'workdays');

/** その日の休業（なければ null。重なっていれば、先に入れたもの） */
export const leaveOn = (leaves: LeavePeriod[], date: string): LeavePeriod | null =>
  leaves.find((p) => !validateLeavePeriod(p) && date >= p.start && (!p.end || date <= p.end)) ?? null;

const fmt = (d: dayjs.Dayjs) => d.format('YYYY-MM-DD');
const eachDate = (from: string, to: string, fn: (date: string) => void) => {
  for (let d = dayjs(from); !d.isAfter(dayjs(to), 'day'); d = d.add(1, 'day')) fn(fmt(d));
};

/** 給与の計算期間のうち、在籍した日（入社日から退職日まで）。在籍した日がなければ null */
export const employedRangeOf = (
  staff: { join_date?: string | null; retirement_date?: string | null } | null | undefined,
  period: { start: string; end: string },
): { from: string; to: string } | null => {
  const from = staff?.join_date && staff.join_date > period.start ? staff.join_date : period.start;
  const to = staff?.retirement_date && staff.retirement_date < period.end ? staff.retirement_date : period.end;
  return from <= to ? { from, to } : null;
};

/** 給与の計算期間の休業 */
export interface PeriodLeave {
  /** 在籍した日のうち、休業の日（YYYY-MM-DD） */
  dates: string[];
  /** 休業の種類（出てきた順） */
  types: LeaveType[];
  /** 計算期間の暦日数 */
  periodDays: number;
  /** 在籍した暦日数 */
  employedDays: number;
  /** 在籍した日が、まるごと休業か */
  allDays: boolean;
}

/** 給与の計算期間の休業（休業の日がなければ null） */
export const periodLeaveOf = (staff: any, period: { start: string; end: string } | null | undefined): PeriodLeave | null => {
  if (!period?.start || !period.end) return null;
  const leaves = parseLeavePeriods(staff?.leave_periods);
  if (leaves.length === 0) return null;
  const range = employedRangeOf(staff, period);
  if (!range) return null;
  const dates: string[] = [];
  const types: LeaveType[] = [];
  let employedDays = 0;
  eachDate(range.from, range.to, (date) => {
    employedDays++;
    const leave = leaveOn(leaves, date);
    if (!leave) return;
    dates.push(date);
    if (!types.includes(leave.type)) types.push(leave.type);
  });
  if (dates.length === 0) return null;
  const periodDays = dayjs(period.end).diff(dayjs(period.start), 'day') + 1;
  return { dates, types, periodDays, employedDays, allDays: dates.length === employedDays };
};

/** 計算期間のうち、在籍していて休業していない日の所定労働日数（会社カレンダーで数える。休業の月の日割りに使う） */
export const countNonLeaveWorkDays = (ctx: CalendarContext, staff: any, period: { start: string; end: string }): number => {
  const range = employedRangeOf(staff, period);
  if (!range) return 0;
  const leaves = parseLeavePeriods(staff?.leave_periods);
  let count = 0;
  eachDate(range.from, range.to, (date) => {
    if (!leaveOn(leaves, date) && isPrescribedWorkDay(new Date(`${date}T00:00:00`), ctx)) count++;
  });
  return count;
};

/** 日付ごとの休業（勤怠の画面・出勤簿に出す。休業の日だけ） */
export const leaveByDate = (staff: any, dates: string[]): Record<string, LeavePeriod> => {
  const leaves = parseLeavePeriods(staff?.leave_periods);
  const result: Record<string, LeavePeriod> = {};
  if (leaves.length === 0) return result;
  for (const date of dates) {
    const leave = leaveOn(leaves, date);
    if (leave) result[date] = leave;
  }
  return result;
};

/** 休業の名前と期間（例：「育児休業（2026-05-20〜2027-03-31）」。終了日が未定なら「〜」まで） */
export const describeLeave = (leave: LeavePeriod): string => `${LEAVE_TYPE_NAMES[leave.type]}（${leave.start}〜${leave.end}）`;

/** 勤怠の行に、働いた記録があるか（働いた時間・時間有給・時間単位の特別休暇・有給の休暇の区分） */
export const hasWorkRecord = (row: { work_type?: string | null; work_hours?: unknown; paid_leave_hours?: unknown; special_leave_hours?: unknown }): boolean =>
  (Number(row.work_hours) || 0) > 0 || (Number(row.paid_leave_hours) || 0) > 0 || (Number(row.special_leave_hours) || 0) > 0
  || ['paid_full', 'paid_half', 'special', 'special_half'].includes(String(row.work_type || ''));
