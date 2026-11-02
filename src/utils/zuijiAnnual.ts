/**
 * 年間報酬の平均による保険者算定（随時改定）
 *
 * 例年特定の時期に残業などが多い（少ない）人は、固定的賃金が変わった時期と重なると、3か月の平均で改定すると実態とずれる。
 * そのときは、事業主が申し立て、本人が同意すれば、年間の平均で改定できる（平成30年10月以後の随時改定から）。
 *
 * ■ 年間平均額 ＝ 変動月から3か月の固定的賃金の月平均額 ＋ 変動月前の9か月と変動月から3か月（12か月）の非固定的賃金の月平均額
 * ■ 要件（保発第4号 記2(4)イ・ウ、記2(5)）
 *   (1) 通常の随時改定に当たる（3か月の平均（A）と従前の標準報酬月額に2等級以上の差があり、3か月とも支払基礎日数が足りている）
 *   (2) A から算出した標準報酬月額と、年間平均額（B）から算出した標準報酬月額との間に2等級以上の差がある
 *   (3) その差が業務の性質上例年発生することが見込まれる（例年かどうかと本人の同意は Q では判断できないので、画面で選んでもらう）
 *   → B から算出した標準報酬月額と従前の等級に1等級以上の差があれば、B で改定する。
 *     ただし、昇給なのに B の等級が従前と同じか下回る（降給なのに同じか上回る）ときは、改定しない（従前のまま）
 * ■ 平均に入れる月（Q&A 別紙1 Q7・Q8・Q11）
 *   ・支払基礎日数が17日以上の月（特定適用事業所の短時間労働者は11日以上）
 *   ・低額の休職給・ストライキの賃金カット・一時帰休の休業手当等を受けた月、月の途中に入社した月、資格を取得する前の月は除く
 *   ・変動月前の9か月に、平均に入れる月が1か月以上いる（入社1年未満でもよい）
 *   ・非固定的賃金の月平均額は、平均に入れる月の非固定的賃金の合計 ÷ その月数
 * ■ 対象にならないもの：単年度だけの特別な昇給、一時的な繁忙と昇給の重なり、転居による通勤手当の変更（Q2）、
 *   産休・育休の終了時改定（Q2）、一時帰休の低額な休業手当による随時改定（Q14）
 * ■ 等級の差：上限・下限の等級は、表の外にもう1つ等級があるものとして数える（Q15。zuiji.ts の extendedGrade）
 *   健康保険の等級で判定する（理由は santeiAnnual.ts と同じ）
 * ■ 1円未満：固定的賃金・非固定的賃金のそれぞれの月平均額を切り捨ててから足す（通知に書かれていないので Q の決め方）
 * ■ 固定的賃金と非固定的賃金の分け方は、給与を確定したときに残した額（salary_results.non_fixed_earnings）を初めの値にする。
 *   名称でなく実態で判断するものなので画面で直せる。その額がない月（DB v13 より前に確定した給与）は入れてもらう
 * 出典：厚生労働省 保発第4号 記2(4)(5) https://www.mhlw.go.jp/web/t_doc?dataId=00tb1543&dataType=1&pageNo=1
 *       平成30年3月1日 保保発0301第1号・年管管発0301第4号 https://www.mhlw.go.jp/web/t_doc?dataId=00tc3223&dataType=1&pageNo=1
 *       平成30年3月1日事務連絡 Q&A 別紙1（随時改定の場合） https://www.mhlw.go.jp/web/t_doc?dataId=00tc3243&dataType=1&pageNo=1
 *       日本年金機構 https://www.nenkin.go.jp/shinsei/kounen/tekiyo/hoshu/20180910.html （様式1・様式2）
 */
import type { PayrollGroupForPeriod } from './payrollPeriod';
import { lookupGrade, type AttendanceRecord, type SalaryRecord } from './santei';
import { annualMonthFigures, ymOf, type AnnualMonth } from './santeiAnnual';
import { addMonths, extendedGrade, type ZuijiDirection, type ZuijiJudgement } from './zuiji';

/** 年間平均に使う1か月分（非固定的賃金がわからない月は null） */
export type ZuijiAnnualMonth = AnnualMonth & { nonFixed: number | null };

/**
 * target: 年間平均で改定できる / keep: 年間平均で申し立てると改定しない（従前のまま） / small: 3か月の平均との差が1等級以下 /
 * not_zuiji: 通常の随時改定に当たらない / no_earlier: 変動月前の9か月に平均に入れる月がない / split_missing: 非固定的賃金がわからない月がある
 */
export type ZuijiAnnualStatus = 'target' | 'keep' | 'small' | 'not_zuiji' | 'no_earlier' | 'split_missing';

export const ZUIJI_ANNUAL_STATUS_LABELS: Record<ZuijiAnnualStatus, string> = {
  target: '3か月の平均と2等級以上の差があります。年間平均で申し立てると、この額で改定します',
  keep: '3か月の平均と2等級以上の差がありますが、年間平均の等級が従前を超えないので、申し立てると改定しません（従前のまま）',
  small: '3か月の平均との差が1等級以下なので、年間平均にはできません',
  not_zuiji: '通常の随時改定に当たらないので、年間平均にはできません',
  no_earlier: '変動月の前の9か月に平均に入れる月がないので、年間平均にはできません',
  split_missing: '非固定的賃金がわからない月があります（この機能を入れる前に確定した給与）。12か月を開いて入れてください',
};

export interface ZuijiAnnualResult {
  status: ZuijiAnnualStatus;
  /** 平均に入れる支払基礎日数（17日・11日） */
  minDays: number;
  /** 非固定的賃金の平均に使った月（YYYY-MM） */
  usedMonths: string[];
  /** 変動月から3か月の固定的賃金の合計と月平均額（1円未満切り捨て） */
  fixedTotal: number;
  fixedAverage: number | null;
  /** 12か月の非固定的賃金の合計と月平均額（1円未満切り捨て） */
  nonFixedTotal: number;
  nonFixedAverage: number | null;
  /** 年間平均額（固定的賃金の月平均額 ＋ 非固定的賃金の月平均額） */
  average: number | null;
  /** 年間平均額から求めた標準報酬月額と等級（健康保険） */
  standard: number | null;
  grade: number | null;
  /** 表の外の等級も数えた等級の差（年間平均額 − 3か月の平均） */
  gradeDiffFromOrdinary: number | null;
  /** 年間平均額の等級 − 従前の等級 */
  gradeDiffFromPrevious: number | null;
}

/** 変動月の前の9か月 */
export const monthsBeforeChange = (year: number, month: number) =>
  Array.from({ length: 9 }, (_, k) => addMonths(year, month, k - 9));

/**
 * 年間平均に使う12か月（変動月の前の9か月 ＋ 変動月から3か月）の、支払基礎日数・報酬・非固定的賃金
 * @param salaries 確定した給与（変動月の9か月前から、変動月から3か月目までに支払ったもの）
 */
export const buildZuijiAnnualMonths = (
  staff: any,
  year: number,
  month: number,
  group: PayrollGroupForPeriod | undefined,
  salaries: SalaryRecord[],
  attendance: AttendanceRecord[],
): ZuijiAnnualMonth[] => {
  const payMonths = [...monthsBeforeChange(year, month), ...[0, 1, 2].map((k) => addMonths(year, month, k))];
  return annualMonthFigures(staff, payMonths, group, salaries, attendance).map((m) => {
    const salary = salaries.find((s) =>
      String(s.staff_id) === String(staff.id) && Number(s.target_year) === m.year && Number(s.target_month) === m.month);
    const v = salary?.non_fixed_earnings;
    return { ...m, nonFixed: v === null || v === undefined ? null : Number(v) };
  });
};

/**
 * 通常の随時改定（3か月の平均）と、年間平均額を比べる
 * @param months   12か月（変動月の前の9か月 ＋ 変動月から3か月。変動月から3か月は通常の随時改定に使った値と同じもの）
 * @param ordinary 通常の随時改定の判定（zuiji.ts の judgeZuiji）
 * @param table    改定する月（変動月から4か月目）の等級表
 */
export const judgeZuijiAnnual = (
  months: ZuijiAnnualMonth[],
  short: boolean,
  direction: ZuijiDirection,
  ordinary: ZuijiJudgement,
  table: [number, number, number][],
): ZuijiAnnualResult => {
  const minDays = short ? 11 : 17;
  const empty = {
    minDays, usedMonths: [], fixedTotal: 0, fixedAverage: null, nonFixedTotal: 0, nonFixedAverage: null,
    average: null, standard: null, grade: null, gradeDiffFromOrdinary: null, gradeDiffFromPrevious: null,
  };
  if (ordinary.status !== 'target' || ordinary.average === null || ordinary.previousGrade === null) {
    return { status: 'not_zuiji', ...empty };
  }
  const before = months.slice(0, 9);
  const after = months.slice(9);
  const usable = (m: ZuijiAnnualMonth) =>
    m.amount !== null && m.days !== null && !m.partialJoin && !m.notInsured && m.days >= minDays;
  if (!before.some(usable)) return { status: 'no_earlier', ...empty };
  const used = months.filter(usable);
  if (used.some((m) => m.nonFixed === null) || after.some((m) => m.nonFixed === null)) {
    return { status: 'split_missing', ...empty };
  }

  // 非固定的賃金が報酬より多く入っていたら、報酬の額までにする（固定的賃金をマイナスにしない）
  const nonFixedOf = (m: ZuijiAnnualMonth) => Math.min(m.nonFixed!, m.amount ?? 0);
  const fixedTotal = after.reduce((sum, m) => sum + (m.amount ?? 0) - nonFixedOf(m), 0);
  const fixedAverage = Math.floor(fixedTotal / after.length);
  const nonFixedTotal = used.reduce((sum, m) => sum + nonFixedOf(m), 0);
  const nonFixedAverage = Math.floor(nonFixedTotal / used.length);
  const average = fixedAverage + nonFixedAverage;
  const { grade, standard } = lookupGrade(table, average);
  const gradeDiffFromOrdinary = extendedGrade(table, average) - extendedGrade(table, ordinary.average);
  const gradeDiffFromPrevious = grade - ordinary.previousGrade;
  const base = {
    minDays, usedMonths: used.map((m) => ymOf(m.year, m.month)),
    fixedTotal, fixedAverage, nonFixedTotal, nonFixedAverage, average, standard, grade, gradeDiffFromOrdinary, gradeDiffFromPrevious,
  };
  if (Math.abs(gradeDiffFromOrdinary) < 2) return { status: 'small', ...base };
  // 昇給なら従前より上、降給なら従前より下の等級のときだけ改定する（記2(5)ただし書）
  const revises = direction === 'up' ? gradeDiffFromPrevious > 0 : gradeDiffFromPrevious < 0;
  return { status: revises ? 'target' : 'keep', ...base };
};
