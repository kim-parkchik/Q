/**
 * 随時改定（月額変更届）：固定的賃金が変わり、報酬が大きく変わった人の標準報酬月額を、4か月目の分から改定する
 *
 * ■ 次の3つにすべて当てはまると、変動月から数えて4か月目の分から改定する
 *   (1) 昇給・降給などで固定的賃金（基本給・時給の単価・固定の手当など）が変わった
 *   (2) 変動月（変わった固定的賃金を初めて支払った月）から3か月の報酬の平均で求めた標準報酬月額と、
 *       従前の標準報酬月額との間に2等級以上の差がある
 *   (3) 3か月とも支払基礎日数が17日以上（特定適用事業所の短時間労働者は11日以上）
 * ■ 固定的賃金が上がったのに平均が下がった（またはその逆の）ときは、2等級以上の差があっても対象にならない
 * ■ 等級表の上限・下限にまたがるときは、1等級差でも対象になる
 *   （表の外に、もう1つ同じ幅の等級があるものとして2等級の差を数える。
 *     健康保険なら、50等級の人は報酬月額1,415千円以上、1等級の人は53千円未満を、表の外の等級として扱う）
 * 出典：日本年金機構 https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/20150515-02.html
 *
 * Q では、確定した給与の基本給（時給制は時給）が前の月と変わった月を、変動月の候補として探す。
 * 手当や通勤手当の変更、給与体系の変更（時給→月給など）は見つけられないので、画面で変動月を指定してもらう。
 * 等級は健康保険の等級で判定する（厚生年金の上限・下限の決まりは、健康保険の2等級の差と同じ結果になる）。
 */
import { checkSocialInsEnrolled } from './calcSalary';
import type { PayrollGroupForPeriod } from './payrollPeriod';
import {
  gradeOfStandard, groupOf, lookupGrade, monthFigures,
  type AttendanceRecord, type SalaryRecord, type SanteiMonth,
} from './santei';
import { getStandardRemuneration, remunerationHistoryOf } from './standardRemuneration';

/** up: 固定的賃金が上がった / down: 下がった */
export type ZuijiDirection = 'up' | 'down';

/**
 * target: 随時改定の対象 / small: 差が1等級以下 / direction: 固定的賃金と平均の上がり下がりが逆 /
 * days: 支払基礎日数が足りない月がある / pending: 給与を確定していない月がある / not_enrolled: 社会保険に入っていない
 */
export type ZuijiStatus = 'target' | 'small' | 'direction' | 'days' | 'pending' | 'not_enrolled';

export const ZUIJI_STATUS_LABELS: Record<ZuijiStatus, string> = {
  target: '随時改定の対象',
  small: '対象外（差が1等級以下）',
  direction: '対象外（固定的賃金と平均の上がり下がりが逆）',
  days: '対象外（支払基礎日数が足りない月がある）',
  pending: '3か月分の給与がまだ確定していない',
  not_enrolled: '社会保険に入っていない',
};

export interface ZuijiJudgement {
  status: ZuijiStatus;
  /** 3か月の平均（1円未満切り捨て） */
  average: number | null;
  /** 平均が当たる等級と標準報酬月額 */
  grade: number | null;
  standard: number | null;
  previousGrade: number | null;
  /** 表の外の等級も数えた等級の差（新 − 従前） */
  gradeDiff: number | null;
  /** 上限・下限の等級で、従前を決めたときの報酬月額によっては1等級差でも対象になるときの注意 */
  boundaryNote: string | null;
}

/** 表の上限の等級の上・下限の等級の下に、同じ幅の等級がもう1つあるとしたときの境目 */
const outerBounds = (table: [number, number, number][]) => {
  const n = table.length;
  return {
    upper: table[n - 1][0] + (table[n - 1][0] - table[n - 2][0]),
    lower: table[0][1] - (table[1][1] - table[1][0]),
  };
};

/** 表の外の等級も数えた等級（上限を超える幅なら 表の等級数＋1、下限より下の幅なら 0） */
export const extendedGrade = (table: [number, number, number][], amount: number): number => {
  const { upper, lower } = outerBounds(table);
  if (amount >= upper) return table.length + 1;
  if (amount < lower) return 0;
  return lookupGrade(table, amount).grade;
};

/**
 * 変動月から3か月の報酬で、随時改定の対象かを判定する
 * @param short 特定適用事業所の短時間労働者（支払基礎日数は11日以上）
 */
export const judgeZuiji = (
  months: SanteiMonth[],
  short: boolean,
  previous: number,
  direction: ZuijiDirection,
  table: [number, number, number][],
): ZuijiJudgement => {
  const previousGrade = gradeOfStandard(table, previous);
  const empty = { average: null, grade: null, standard: null, previousGrade, gradeDiff: null, boundaryNote: null };
  if (previous <= 0 || previousGrade === null) return { status: 'not_enrolled', ...empty };
  if (months.some((m) => m.amount === null || m.days === null)) return { status: 'pending', ...empty };

  const average = Math.floor(months.reduce((sum, m) => sum + m.amount!, 0) / months.length);
  const { grade, standard } = lookupGrade(table, average);
  const gradeDiff = extendedGrade(table, average) - previousGrade;
  const base = { average, grade, standard, previousGrade, gradeDiff };

  if (months.some((m) => m.days! < (short ? 11 : 17))) return { status: 'days', ...base, boundaryNote: null };
  if (Math.abs(gradeDiff) < 2) {
    // 従前が上限・下限の等級だと、従前を決めたときの報酬月額が表の外の幅なら、1等級の差でも対象になる
    const { upper, lower } = outerBounds(table);
    const n = table.length;
    const boundaryNote =
      direction === 'down' && previousGrade === n && grade === n - 1
        ? `従前の標準報酬月額を決めたときの報酬月額が${upper.toLocaleString()}円以上なら、1等級の差でも対象になります`
        : direction === 'up' && previousGrade === 1 && grade === 2
          ? `従前の標準報酬月額を決めたときの報酬月額が${lower.toLocaleString()}円未満なら、1等級の差でも対象になります`
          : null;
    return { status: 'small', ...base, boundaryNote };
  }
  if ((direction === 'up' && gradeDiff < 0) || (direction === 'down' && gradeDiff > 0)) {
    return { status: 'direction', ...base, boundaryNote: null };
  }
  return { status: 'target', ...base, boundaryNote: null };
};

/** year年month月から k か月後の年月 */
export const addMonths = (year: number, month: number, k: number) => {
  const i = year * 12 + (month - 1) + k;
  return { year: Math.floor(i / 12), month: (i % 12) + 1 };
};

const ymOf = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;

export type ZuijiMonth = SanteiMonth & { year: number };

export interface ZuijiCandidate {
  staff: any;
  /** 変動月（変わった固定的賃金を初めて支払った月） */
  year: number;
  month: number;
  direction: ZuijiDirection;
  /** 確定した給与の基本給の変化（画面で変動月を指定したときは null） */
  baseWageBefore: number | null;
  baseWageAfter: number | null;
  /** 変動月から3か月 */
  months: ZuijiMonth[];
  /** 従前の標準報酬月額（変動月から3か月目の分の値） */
  previous: number;
  /** 改定する月（変動月から4か月目。YYYY-MM） */
  revisionFrom: string;
  /** すでに登録した、この改定の標準報酬月額 */
  registered: number | null;
}

/** 変動月を決めて、3か月分の数字・従前の標準報酬月額・改定する月を集める */
export const buildZuijiCandidate = (
  staff: any,
  year: number,
  month: number,
  direction: ZuijiDirection,
  groups: (PayrollGroupForPeriod & { id: number })[],
  salaries: SalaryRecord[],
  attendance: AttendanceRecord[],
  baseWages: { before: number | null; after: number | null } = { before: null, after: null },
): ZuijiCandidate => {
  const group = groupOf(staff, groups);
  const months = [0, 1, 2].map((k) => {
    const ym = addMonths(year, month, k);
    return { ...monthFigures(staff, ym.year, ym.month, group, salaries, attendance).figures, year: ym.year };
  });
  const third = addMonths(year, month, 2);
  const revision = addMonths(year, month, 3);
  const revisionFrom = ymOf(revision.year, revision.month);
  const registered = remunerationHistoryOf(staff).find((e) => e.from === revisionFrom && e.reason === 'zuiji');
  return {
    staff, year, month, direction,
    baseWageBefore: baseWages.before, baseWageAfter: baseWages.after,
    months,
    previous: getStandardRemuneration(staff, third.year, third.month),
    revisionFrom,
    registered: registered ? registered.amount : null,
  };
};

/**
 * その年に変動月がある候補を、確定した給与の基本給（時給制は時給）の変化から探す
 * @param salaries その年の前の年の12月から、次の年の2月までに支払った給与（3か月目まで見るため）
 */
export const findZuijiCandidates = (
  staffList: any[],
  year: number,
  groups: (PayrollGroupForPeriod & { id: number })[],
  salaries: SalaryRecord[],
  attendance: AttendanceRecord[],
): ZuijiCandidate[] => {
  const baseWageOf = (staff: any, y: number, m: number) => {
    const s = salaries.find((r) => String(r.staff_id) === String(staff.id) && Number(r.target_year) === y && Number(r.target_month) === m);
    const wage = s?.applied_base_wage;
    return wage === null || wage === undefined ? null : Number(wage);
  };
  const candidates: ZuijiCandidate[] = [];
  for (const staff of staffList) {
    for (let month = 1; month <= 12; month++) {
      const prev = addMonths(year, month, -1);
      const before = baseWageOf(staff, prev.year, prev.month);
      const after = baseWageOf(staff, year, month);
      if (before === null || after === null || before <= 0 || after <= 0 || before === after) continue;
      if (!checkSocialInsEnrolled(staff, year, month)) continue;
      candidates.push(buildZuijiCandidate(
        staff, year, month, after > before ? 'up' : 'down', groups, salaries, attendance, { before, after },
      ));
    }
  }
  return candidates;
};
