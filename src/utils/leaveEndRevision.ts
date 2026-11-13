/**
 * 産前産後休業終了時改定・育児休業等終了時改定（終了時報酬月額変更届）
 *
 * 産休・育休を終えた人の給与が、短時間勤務などで下がった（上がった）ときに、随時改定に当たらなくても、
 * 本人の申出で標準報酬月額を改定できる。
 *
 * ■ 対象になる人
 *   ・育児休業等：終了日に3歳未満の子を養育している被保険者（厚生年金保険法23条の2・健康保険法43条の2）
 *   ・産前産後休業：終了日に、その産休に係る子を養育している被保険者（厚生年金保険法23条の3・健康保険法43条の3）
 *   ・本人から事業主に申出があったときだけ（届け出るかは本人が決める）
 *   ・次のときは改定できない：育児休業等の終了日の翌日に産前産後休業を始めた／産前産後休業の終了日の翌日に育児休業等を始めた
 * ■ 決め方
 *   ・終了日の翌日が属する月以後3か月（その事業所で続けて使用された期間に限る）に受けた報酬のうち、
 *     支払基礎日数が17日以上（特定適用事業所の短時間労働者は11日以上）の月の平均を報酬月額にする
 *   ・短時間就労者（パート）は、3か月とも17日未満なら、15日以上17日未満の月の平均にする
 *   ・使える月が1か月もなければ改定できない
 *   ・従前の標準報酬月額と1等級以上の差があれば、4か月目の分から改定する（随時改定と違い、1等級の差でもよい）
 *   ・改定した標準報酬月額は、1〜6月に改定したらその年の8月分まで、7〜12月に改定したら翌年の8月分まで使う
 *     （その後は定時決定で決まる。Q の履歴では、次の行が登録されるまで使い続ける）
 * 出典：日本年金機構「育児休業等終了時報酬月額変更届の提出」https://www.nenkin.go.jp/service/kounen/hokenryo/menjo/ikuji-menjo/20150407.html
 *       日本年金機構「産前産後休業終了時報酬月額変更届の提出」https://www.nenkin.go.jp/service/kounen/hokenryo/menjo/sankyu-menjo/20140327-01.html
 *       厚生年金保険法23条の2・23条の3（e-Gov法令検索 https://laws.e-gov.go.jp/law/329AC0000000115）
 *
 * Q では、従業員画面に入れた産休・育休の期間（leave_periods）のうち、終了日の翌日がその年にあるものを候補にする。
 * 役員の育休は候補にしない（役員はふつう労働者に当たらず、育児・介護休業法の育児休業等を取れない。utils/leaveExemption.ts）。
 * 同じ種類の休業が終了日の翌日から続くとき（育休の延長を別の期間で入れたときなど）は、続けた休業の終わりで判定する。
 * 等級は健康保険の等級で判定する。
 */
import dayjs from 'dayjs';
import type { PayrollGroupForPeriod } from './payrollPeriod';
import { exemptLeavePeriodsOf, type ExemptLeavePeriod, type ExemptLeaveType } from './leaveExemption';
import {
  gradeOfStandard, groupOf, lookupGrade, monthFigures,
  type AttendanceRecord, type SalaryRecord, type SanteiWorkerKind,
} from './santei';
import { getStandardRemuneration, remunerationHistoryOf } from './standardRemuneration';
import { addMonths, type ZuijiMonth } from './zuiji';

export const LEAVE_TYPE_LABELS: Record<ExemptLeaveType, string> = {
  maternity: '産前産後休業',
  childcare: '育児休業等',
};

/**
 * target: 改定できる / same: 等級が変わらない / days: 支払基礎日数が足りる月がない /
 * pending: 給与を確定していない月がある / not_enrolled: 社会保険に入っていない / followed: 翌日から次の休業を始めた
 */
export type LeaveEndStatus = 'target' | 'same' | 'days' | 'pending' | 'not_enrolled' | 'followed';

export const LEAVE_END_STATUS_LABELS: Record<LeaveEndStatus, string> = {
  target: '改定できる（1等級以上の差がある）',
  same: '対象外（等級が変わらない）',
  days: '対象外（支払基礎日数が足りる月がない）',
  pending: '3か月分の給与がまだ確定していない',
  not_enrolled: '社会保険に入っていない',
  followed: '対象外（終了日の翌日から次の休業を始めた）',
};

export interface LeaveEndJudgement {
  status: LeaveEndStatus;
  /** 平均に使った月（何番目の月か。0〜2） */
  usedIndexes: number[];
  /** normal: 基準の日数以上の月で平均 / part15: 15日以上17日未満の月で平均 */
  method: 'normal' | 'part15' | null;
  /** 平均（1円未満切り捨て） */
  average: number | null;
  grade: number | null;
  standard: number | null;
  previousGrade: number | null;
  /** 等級の差（改定後 − 従前） */
  gradeDiff: number | null;
}

/**
 * 終了日の翌日が属する月から3か月の報酬で、改定できるかを判定する
 * @param months 3か月（続けて使用されなくなった月は入れない）
 * @param previous 従前の標準報酬月額
 * @param table 改定する月（4か月目）の等級表
 */
export const judgeLeaveEnd = (
  months: { days: number | null; amount: number | null }[],
  kind: SanteiWorkerKind,
  previous: number,
  table: [number, number, number][],
  followed = false,
): LeaveEndJudgement => {
  const previousGrade = gradeOfStandard(table, previous);
  const empty = { usedIndexes: [], method: null, average: null, grade: null, standard: null, previousGrade, gradeDiff: null };
  if (followed) return { status: 'followed', ...empty };
  if (previous <= 0 || previousGrade === null) return { status: 'not_enrolled', ...empty };
  if (months.length === 0 || months.some((m) => m.amount === null || m.days === null)) return { status: 'pending', ...empty };

  const minDays = kind === 'short' ? 11 : 17;
  let usedIndexes = months.map((m, i) => (m.days! >= minDays ? i : -1)).filter((i) => i >= 0);
  let method: 'normal' | 'part15' = 'normal';
  if (usedIndexes.length === 0 && kind === 'part') {
    usedIndexes = months.map((m, i) => (m.days! >= 15 ? i : -1)).filter((i) => i >= 0);
    method = 'part15';
  }
  if (usedIndexes.length === 0) return { status: 'days', ...empty };

  const average = Math.floor(usedIndexes.reduce((sum, i) => sum + months[i].amount!, 0) / usedIndexes.length);
  const { grade, standard } = lookupGrade(table, average);
  const gradeDiff = grade - previousGrade;
  return { status: gradeDiff === 0 ? 'same' : 'target', usedIndexes, method, average, grade, standard, previousGrade, gradeDiff };
};

export interface LeaveEndCandidate {
  staff: any;
  leave: ExemptLeavePeriod;
  /** 終了日の翌日（YYYY-MM-DD） */
  nextDay: string;
  /** 終了日の翌日が属する月（3か月の最初の月） */
  year: number;
  month: number;
  /** 3か月（続けて使用されなくなった月は入れない） */
  months: ZuijiMonth[];
  /** 従前の標準報酬月額（3か月目の分の値） */
  previous: number;
  /** 改定する月（4か月目。YYYY-MM） */
  revisionFrom: string;
  /** 終了日の翌日から次の休業を始めたので改定できないときの説明 */
  followedBy: string | null;
  /** すでに登録した、この改定の標準報酬月額 */
  registered: number | null;
}

const nextDayOf = (date: string) => dayjs(date).add(1, 'day').format('YYYY-MM-DD');

/**
 * その年に終了日の翌日がある産休・育休を、終了時改定の候補として集める
 * @param salaries その年の1月から、次の年の2月までに支払った給与（12月が最初の月なら翌年2月まで見るため）
 */
export const findLeaveEndCandidates = (
  staffList: any[],
  year: number,
  groups: (PayrollGroupForPeriod & { id: number })[],
  salaries: SalaryRecord[],
  attendance: AttendanceRecord[],
): LeaveEndCandidate[] => {
  const result: LeaveEndCandidate[] = [];
  for (const staff of staffList) {
    // 役員の育児休業等は、育児・介護休業法の育児休業等ではないので入れない（育児休業等終了時改定もできない）
    const leaves = exemptLeavePeriodsOf(staff).sort((a, b) => a.start.localeCompare(b.start));
    for (const leave of leaves) {
      if (!leave.end) continue;
      const nextDay = nextDayOf(leave.end);
      const following = leaves.find((l) => l !== leave && l.start === nextDay);
      // 同じ種類の休業が翌日から続くなら、続けた休業の終わりで判定する
      if (following && following.type === leave.type) continue;
      // 休業中に退職した人は対象にならない
      if (staff.retirement_date && staff.retirement_date < nextDay) continue;
      const [y, m] = nextDay.split('-').map(Number);
      if (y !== year) continue;

      const followedBy = !following ? null
        : leave.type === 'childcare'
          ? '育児休業等の終了日の翌日に産前産後休業を始めたので、育児休業等終了時改定はできません（厚生年金保険法23条の2 ただし書）'
          : '産前産後休業の終了日の翌日に育児休業等を始めたので、産前産後休業終了時改定はできません（厚生年金保険法23条の3 ただし書）';

      const group = groupOf(staff, groups);
      const retiredYm = staff.retirement_date ? staff.retirement_date.slice(0, 7) : null;
      const months: ZuijiMonth[] = [0, 1, 2]
        .map((k) => addMonths(y, m, k))
        // 続けて使用された期間に限る（退職した月の後は入れない）
        .filter((ym) => !retiredYm || `${ym.year}-${String(ym.month).padStart(2, '0')}` <= retiredYm)
        .map((ym) => ({ ...monthFigures(staff, ym.year, ym.month, group, salaries, attendance).figures, year: ym.year }));
      const third = addMonths(y, m, 2);
      const revision = addMonths(y, m, 3);
      const revisionFrom = `${revision.year}-${String(revision.month).padStart(2, '0')}`;
      const registered = remunerationHistoryOf(staff).find((e) => e.from === revisionFrom && e.reason === 'kyugyo');
      result.push({
        staff, leave, nextDay, year: y, month: m, months,
        previous: getStandardRemuneration(staff, third.year, third.month),
        revisionFrom, followedBy,
        registered: registered ? registered.amount : null,
      });
    }
  }
  return result.sort((a, b) => a.nextDay.localeCompare(b.nextDay) || String(a.staff.id).localeCompare(String(b.staff.id)));
};
