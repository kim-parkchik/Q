/**
 * 定時決定（算定基礎届）：4〜6月に支払った報酬から、9月分からの標準報酬月額を決める
 *
 * ■ 対象になる人：7月1日に被保険者である人。ただし次の人は算定基礎届を出さない
 *   ・6月1日以後に資格を取得（入社）した人
 *   ・6月30日以前に退職した人
 *   ・7〜9月に随時改定（月額変更届）で標準報酬月額が変わる人
 * ■ 決め方：4・5・6月に支払った報酬のうち、支払基礎日数が17日以上の月の平均を報酬月額とし、等級表に当てはめる
 *   ・短時間就労者（パートなど）：17日以上の月がなければ、15日以上17日未満の月で平均する
 *   ・特定適用事業所の短時間労働者：11日以上の月で平均する
 *   ・使える月がなければ、従前の標準報酬月額のまま
 *   ・途中入社で、日割りのため1か月分の給与が支払われていない月は、日数に関係なく除く（修正平均）
 * ■ 支払基礎日数：時給制・日給制は出勤日数（有給休暇の日・有給の特別休暇の日も含む）、月給制は給与の計算期間の暦日数
 *   （月給制で欠勤した日の分を引いた月は、所定労働日数から欠勤日数を引いた日数。無給の特別休暇（1日）で引いた日も欠勤と同じく引く。
 *    所定労働日数は、給与を確定したときに会社カレンダーから数えて残した計算期間の日数。
 *    欠勤控除をしない完全月給制なら、欠勤があっても暦日数）
 * ■ 決まった標準報酬月額は、9月分から翌年8月分まで使う
 * 出典：日本年金機構 https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/20121017.html （定時決定）
 *       https://www.nenkin.go.jp/service/kounen/info/jireishokai/henreisantei.html （途中入社の月・短時間就労者・短時間労働者）
 *       https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/20150515-02.html （支払基礎日数：出勤日数・暦日数）
 *       日本年金機構「算定基礎届の記入・提出ガイドブック（令和8年度）」（4）支払基礎日数とは（2026-11-07 に確認）
 *       https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/20121017.files/santei.guide.book.pdf
 *       （月給制は暦日数。ただし、欠勤日数分だけ給料が差し引かれる場合は、就業規則、給与規程等に基づき事業所が定めた日数から、
 *        欠勤日数を控除した日数。Q では「事業所が定めた日数」を、計算期間の所定労働日数（会社カレンダー）とする）
 * ※ 平均額は1円未満を切り捨てて表示する。等級表の境目は整数の金額で「〇円以上」なので、切り捨てても等級は変わらない。
 */

import { checkSocialInsEnrolled, prescribedWorkDays } from './calcSalary';
import { getPeriodForPayMonth, type PayrollGroupForPeriod } from './payrollPeriod';
import { getStandardRemuneration, remunerationHistoryOf } from './standardRemuneration';
import { staffAsOf } from './staffHistory';
import { isSpecialLeaveWorkType, SPECIAL_LEAVE_FULL, specialLeaveOfRow } from './specialLeave';
import { parseLeavePeriods } from './leaveExemption';
import { leaveOn } from './leaveOfAbsence';

/** general: 一般 / part: 短時間就労者（パートなど） / short: 特定適用事業所の短時間労働者 */
export type SanteiWorkerKind = 'general' | 'part' | 'short';

export const SANTEI_WORKER_KIND_LABELS: Record<SanteiWorkerKind, string> = {
  general: '一般',
  part: '短時間就労者（パート）',
  short: '短時間労働者（特定適用事業所）',
};

export interface SanteiMonth {
  /** 支払った月（4・5・6） */
  month: number;
  /** 支払基礎日数（その月に給与を支払っていなければ null） */
  days: number | null;
  /** 支払った報酬（通勤手当を含む。賞与は含めない。その月に給与を支払っていなければ null） */
  amount: number | null;
  /** 途中入社で、1か月分の給与が支払われていない月 */
  partialJoin: boolean;
}

/** normal: 基準の日数以上の月で平均 / part15: 15日以上17日未満の月で平均 / keep: 従前のまま */
export type SanteiMethod = 'normal' | 'part15' | 'keep';

export interface SanteiResult {
  /** 平均に使った月 */
  usedMonths: number[];
  /** 使った月の報酬の合計 */
  total: number;
  /** 平均額（1円未満切り捨て）。使える月がなければ null */
  average: number | null;
  method: SanteiMethod;
  /** 決まった標準報酬月額 */
  standard: number;
  /** 決まった等級（健康保険）。従前のままで等級表にない額なら null */
  grade: number | null;
}

/** 等級表（[報酬月額 以上, 未満, 標準報酬月額]）で、報酬月額に当たる等級と標準報酬月額を求める */
export const lookupGrade = (table: [number, number, number][], amount: number): { grade: number; standard: number } => {
  const index = table.findIndex(([from, to]) => amount >= from && amount < to);
  const i = index >= 0 ? index : amount < table[0][0] ? 0 : table.length - 1;
  return { grade: i + 1, standard: table[i][2] };
};

/** 標準報酬月額が等級表の何等級か（ない額なら null） */
export const gradeOfStandard = (table: [number, number, number][], standard: number): number | null => {
  const index = table.findIndex(([, , std]) => std === standard);
  return index >= 0 ? index + 1 : null;
};

/**
 * 4〜6月の報酬から、標準報酬月額を決める
 * @param previous 従前の標準報酬月額（使える月がないときはこのまま）
 * @param table    9月分から使う等級表
 */
export const decideTeiji = (
  months: SanteiMonth[],
  kind: SanteiWorkerKind,
  previous: number,
  table: [number, number, number][],
): SanteiResult => {
  const paid = months.filter((m) => m.amount !== null && m.days !== null && !m.partialJoin);
  const minDays = kind === 'short' ? 11 : 17;
  let used = paid.filter((m) => m.days! >= minDays);
  let method: SanteiMethod = 'normal';
  if (used.length === 0 && kind === 'part') {
    used = paid.filter((m) => m.days! >= 15);
    method = 'part15';
  }
  if (used.length === 0) {
    return { usedMonths: [], total: 0, average: null, method: 'keep', standard: previous, grade: gradeOfStandard(table, previous) };
  }
  const total = used.reduce((sum, m) => sum + m.amount!, 0);
  const average = Math.floor(total / used.length);
  const { grade, standard } = lookupGrade(table, average);
  return { usedMonths: used.map((m) => m.month), total, average, method, standard, grade };
};

/**
 * 支払基礎日数
 * ・時給制・日給制：出勤日数（働いた時間がある日と、有給休暇の日・有給の特別休暇の日・会社都合で休ませて休業手当を払った日）
 * ・月給制：給与の計算期間の暦日数。欠勤控除をした月は、所定労働日数 − 欠勤日数（無給の特別休暇（1日）の日も引く。
 *   半日の日は、残りの半日の給与を払っているので引かない）
 *   （欠勤控除をしない完全月給制なら、欠勤があっても暦日数）
 *   休業・休職の日がある月（utils/leaveOfAbsence.ts）：給与を払わない休業の日は数えず、月給を払った日数（日割りの日数。
 *   まるごと休業の月は0日。確定したときに残した leave_paid_days）から、欠勤控除をした日を引く
 * @param rows             給与の計算期間の確定済み勤怠
 * @param prescribedDays   計算期間の所定労働日数（確定した給与に残した、会社カレンダーから数えた日数）
 * @param absenceDeducted  欠勤控除（無給の特別休暇の控除を含む）をしたか（確定した給与に額を残していないときは undefined。
 *                         欠勤があれば、したとみなす）
 * @param leavePaidDays    休業の日がある月に、月給を払った日数（確定した給与の leave_paid_days。休業の日がない・日割りしない月は null）
 */
export const paymentBasisDays = (
  wageType: string,
  period: { startStr: string; endStr: string },
  rows: { work_date: string; work_type?: string; work_hours?: number | string; leave_paid?: number | string | null }[],
  prescribedDays: number,
  absenceDeducted?: boolean,
  leavePaidDays?: number | null,
): number => {
  if (wageType === 'monthly') {
    const absent = rows.filter((r) => r.work_type === 'absent' || (r.work_type === SPECIAL_LEAVE_FULL && !specialLeaveOfRow(r).paid)).length;
    if (leavePaidDays !== null && leavePaidDays !== undefined) {
      return absent > 0 && absenceDeducted !== false ? Math.max(0, leavePaidDays - absent) : Math.max(0, leavePaidDays);
    }
    if (absent > 0 && absenceDeducted !== false) return Math.max(0, prescribedDays - absent);
    const start = new Date(`${period.startStr}T00:00:00`);
    const end = new Date(`${period.endStr}T00:00:00`);
    return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  }
  const days = new Set(
    rows
      .filter((r) => (Number(r.work_hours) || 0) > 0 || r.work_type === 'paid_full' || r.work_type === 'paid_half'
        || (isSpecialLeaveWorkType(r.work_type) && specialLeaveOfRow(r).paid)
        // 会社都合で休ませた日は、休業手当（報酬）を払うので数える
        || r.work_type === 'company_leave')
      .map((r) => r.work_date),
  );
  return days.size;
};

/**
 * 定時決定の対象かどうか（対象でなければ、その理由）
 * @param enrolledInJuly 7月1日に健康保険・厚生年金に加入しているか
 * @param hasRevisionInJulyToSeptember 7〜9月分から随時改定・休業終了時改定で変わる履歴があるか
 */
export const santeiExclusionReason = (
  staff: { join_date?: string | null; retirement_date?: string | null },
  year: number,
  enrolledInJuly: boolean,
  hasRevisionInJulyToSeptember: boolean,
): string | null => {
  if (!enrolledInJuly) return '7月1日に社会保険に加入していない';
  if (staff.join_date && staff.join_date >= `${year}-06-01`) return '6月1日以後に入社した';
  if (staff.retirement_date && staff.retirement_date <= `${year}-06-30`) return '6月30日以前に退職した';
  if (hasRevisionInJulyToSeptember) return '7〜9月分から随時改定（月変）で変わる';
  return null;
};

/** 4〜6月に支払った報酬で決める */
export const SANTEI_MONTHS = [4, 5, 6];

/** 算定基礎の画面の1人分（区分・登録するかは画面で選ぶ） */
export interface SanteiInput {
  staff: any;
  /** 対象でなければ、その理由 */
  exclusion: string | null;
  /** 従前の標準報酬月額（8月分の値） */
  previous: number;
  months: SanteiMonth[];
  /** 4〜6月のうち、入社後なのに給与を確定していない月 */
  unfinalizedMonths: number[];
  /** すでに登録した、この年の9月分からの定時決定の標準報酬月額 */
  registered: number | null;
}

/** 確定した給与（支払った年月ごと） */
export interface SalaryRecord {
  staff_id: string;
  target_year: number;
  target_month: number;
  total_earnings: number;
  /** 確定したときの基本給（時給制は時給） */
  applied_base_wage?: number | null;
  /** 確定したときの固定残業代（なしは 0。わからないときは null） */
  fixed_overtime_allowance?: number | null;
  /** 支給合計のうち非固定的賃金（残業代・休日や深夜の手当・変動の支給項目。わからないときは null） */
  non_fixed_earnings?: number | null;
  /** 確定したときの欠勤控除の額（会社ファイルの形式 v8 より前に確定した給与は null） */
  absence_deduction?: number | null;
  /** 確定したときの無給の特別休暇の控除の額（会社ファイルの形式 v11 より前に確定した給与は null） */
  unpaid_leave_deduction?: number | null;
  /** 確定したときの計算期間の所定労働日数（会社カレンダーから数えたもの。わからないときは null） */
  prescribed_work_days?: number | null;
  /** 休業の日がある月に、月給を払った日数（日割りの日数。まるごと休業の月は 0。休業の日がない・日割りしない月・会社ファイルの形式 v19 より前は null） */
  leave_paid_days?: number | null;
  /** 支給合計のうち、賃金・報酬でない額（労災の待期の休業補償。報酬から除く。utils/averageWage.ts） */
  non_remuneration?: number | null;
}

/** 確定した勤怠（支払基礎日数を数えるのに使う項目） */
export interface AttendanceRecord {
  staff_id: string;
  work_date: string;
  work_type?: string;
  work_hours?: number | string;
  /** 特別休暇が有給か（確定したときの設定。utils/specialLeave.ts） */
  leave_paid?: number | null;
}

/**
 * その月に支払った給与の、支払基礎日数・報酬・途中入社かどうか
 * @returns figures: 確定した給与がなければ days・amount は null / unfinalized: 入社後なのに給与を確定していない
 */
export const monthFigures = (
  staff: any,
  year: number,
  month: number,
  group: PayrollGroupForPeriod | undefined,
  salaries: SalaryRecord[],
  attendance: AttendanceRecord[],
): { figures: SanteiMonth; unfinalized: boolean; baseWage: number | null } => {
  const period = group ? getPeriodForPayMonth(group, year, month) : null;
  const salary = salaries.find((s) =>
    String(s.staff_id) === String(staff.id) && Number(s.target_year) === year && Number(s.target_month) === month);
  if (!salary || !period) {
    // 計算期間が終わる前に入社している（給与があるはずの）月だけ、未確定として知らせる
    const unfinalized = !!period && (!staff.join_date || staff.join_date <= period.endStr);
    return { figures: { month, days: null, amount: null, partialJoin: false }, unfinalized, baseWage: null };
  }
  // 休業・休職の日の勤怠は、働いた時間がある日だけを使う（給与の計算と同じ。欠勤・公休の記録は使わない。utils/leaveOfAbsence.ts）
  const leaves = parseLeavePeriods(staff.leave_periods);
  const rows = attendance.filter((a) =>
    String(a.staff_id) === String(staff.id) && a.work_date >= period.startStr && a.work_date <= period.endStr
    && (!leaveOn(leaves, a.work_date) || (Number(a.work_hours) || 0) > 0));
  // 欠勤控除をした月の「所定労働日数」は、確定したときに会社カレンダーから数えて残した日数
  // （残していない前の給与は、その月の土日を除いた日数）。欠勤控除をしたかも、確定したときの額で見る
  const prescribedDays = salary.prescribed_work_days === null || salary.prescribed_work_days === undefined
    ? prescribedWorkDays(staff, year, month)
    : Number(salary.prescribed_work_days);
  const known = [salary.absence_deduction, salary.unpaid_leave_deduction].filter((v) => v !== null && v !== undefined);
  const absenceDeducted = known.length === 0 ? undefined : known.some((v) => Number(v) > 0);
  return {
    figures: {
      month,
      // 給与形態は、その月の分の履歴の値（utils/staffHistory.ts）
      days: paymentBasisDays(staffAsOf(staff, year, month).wage_type, period, rows, prescribedDays, absenceDeducted, salary.leave_paid_days),
      // 報酬：支給合計から、報酬でない額（労災の待期の休業補償）を除く
      amount: (Number(salary.total_earnings) || 0) - (Number(salary.non_remuneration) || 0),
      // 給与の計算期間の途中で入社した月は、日割りで1か月分の給与が支払われていない
      partialJoin: !!staff.join_date && staff.join_date > period.startStr && staff.join_date <= period.endStr,
    },
    unfinalized: false,
    baseWage: salary.applied_base_wage === null || salary.applied_base_wage === undefined ? null : Number(salary.applied_base_wage),
  };
};

/** 従業員の給与規定グループ（なければ最初のグループ） */
export const groupOf = <G extends PayrollGroupForPeriod & { id: number }>(staff: any, groups: G[]): G | undefined =>
  groups.find((g) => g.id === (staff.payroll_group_id || 1)) ?? groups[0];

/**
 * 従業員・確定した給与・確定した勤怠から、算定基礎の1人ずつの値を作る
 * @param groups     給与規定グループ（締日・当月払い／翌月払い）
 * @param salaries   確定した給与（その年の4〜6月に支払ったものを含む）
 * @param attendance 確定した勤怠（4〜6月に支払う給与の計算期間を含むもの）
 */
export const buildSanteiInputs = (
  staffList: any[],
  year: number,
  groups: (PayrollGroupForPeriod & { id: number })[],
  salaries: SalaryRecord[],
  attendance: AttendanceRecord[],
): SanteiInput[] => {
  const inputs: SanteiInput[] = [];
  for (const staff of staffList) {
    // その年の4月より前に辞めた人は出さない
    if (staff.retirement_date && staff.retirement_date < `${year}-04-01`) continue;
    const history = remunerationHistoryOf(staff);
    const hasRevision = history.some((e) =>
      (e.reason === 'zuiji' || e.reason === 'kyugyo') && e.from >= `${year}-07` && e.from <= `${year}-09`);
    const exclusion = santeiExclusionReason(staff, year, checkSocialInsEnrolled(staff, year, 7), hasRevision);
    const group = groupOf(staff, groups);
    const figures = SANTEI_MONTHS.map((month) => monthFigures(staff, year, month, group, salaries, attendance));
    const registered = history.find((e) => e.from === `${year}-09` && e.reason === 'teiji');
    inputs.push({
      staff, exclusion, previous: getStandardRemuneration(staff, year, 8),
      months: figures.map((f) => f.figures),
      unfinalizedMonths: figures.filter((f) => f.unfinalized).map((f) => f.figures.month),
      registered: registered ? registered.amount : null,
    });
  }
  return inputs;
};
