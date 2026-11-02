/**
 * 年間報酬の平均による保険者算定（定時決定）
 *
 * 4〜6月が例年の繁忙期（または閑散期）で、4〜6月の報酬の平均で決めると実態とずれる人は、
 * 事業主が申し立て、本人が同意すれば、前年7月〜当年6月の1年間の報酬の平均で標準報酬月額を決められる。
 *
 * ■ 要件（保発第4号 記1(4)）
 *   「当年4〜6月の報酬の月平均額から算出した標準報酬月額」と「前年7月〜当年6月の報酬の月平均額から算出した標準報酬月額」の
 *   間に2等級以上の差があり、その差が業務の性質上例年発生することが見込まれる
 *   （例年かどうかと本人の同意は Q では判断できないので、画面で選んでもらう。単年度だけの一時的な繁忙は対象外：Q&A Q2）
 * ■ 平均に入れる月（Q&A Q7・Q12・Q15）
 *   ・支払基礎日数が17日以上の月（特定適用事業所の短時間労働者は11日以上）
 *   ・パート・アルバイトで、4〜6月を15日以上17日未満の月で平均した人は、15日以上の月
 *   ・低額の休職給・ストライキの賃金カット・一時帰休の休業手当等を受けた月は除く（画面で報酬を空欄にしてもらう）
 *   ・月の途中に入社した月と、資格を取得する前の月は除く
 *   ・前年7月〜当年3月に、平均に入れる月が1か月以上いる（4〜5月に入社した人は対象にならない。入社1年未満でもよい）
 *   ・前年6月分以前の遅配分は除き、当年7月以後に回った分がある月は除く（Q13。画面で直してもらう）
 * ■ 対象にならない人
 *   ・4〜6月に平均に入れる月がなく、従前の標準報酬月額のままになる人（Q8）
 *   ・7〜9月に随時改定がある人（Q17。定時決定の対象からも外れている）
 * ■ 等級の差：上限・下限の等級は、表の外にもう1つ等級があるものとして数える（Q16。随時改定と同じ。zuiji.ts の extendedGrade）
 *   健康保険の等級で判定する。厚生年金の等級は健康保険の等級を上下で切ったものなので、厚生年金だけ2等級の差になることはなく、
 *   健康保険だけ2等級の差になるときは、厚生年金の標準報酬月額はどちらで決めても同じになる。
 *   （Q&A Q16 の厚生年金の金額は、上限が62万円だった令和2年8月までの等級表のもの）
 * ■ 手続き：算定基礎届の備考欄で「年間平均」とし、（様式1）申立書と（様式2）例年の状況・標準報酬月額の比較・被保険者の同意等を付ける。
 *   同意は毎年もらう（Q25）。申し立てなければ、通常の4〜6月の平均で決まる（Q18）。
 * 出典：厚生労働省 保発第4号（昭和36年1月26日）記1(4) https://www.mhlw.go.jp/web/t_doc?dataId=00tb1543&dataType=1&pageNo=1
 *       平成30年3月1日事務連絡 Q&A 別紙2（定時決定の場合） https://www.mhlw.go.jp/web/t_doc?dataId=00tc3243&dataType=1&pageNo=1
 *       日本年金機構 https://www.nenkin.go.jp/shinsei/kounen/tekiyo/hoshu/20141002.html （様式1・様式2）
 */
import { checkSocialInsEnrolled } from './calcSalary';
import { getPeriodForPayMonth, type PayrollGroupForPeriod } from './payrollPeriod';
import {
  lookupGrade, monthFigures,
  type AttendanceRecord, type SalaryRecord, type SanteiMonth, type SanteiResult, type SanteiWorkerKind,
} from './santei';
import { extendedGrade } from './zuiji';

/**
 * target: 2等級以上の差がある / small: 差が1等級以下 /
 * keep: 4〜6月に平均に入れる月がない（従前のまま） / no_earlier: 前年7月〜当年3月に平均に入れる月がない
 */
export type AnnualStatus = 'target' | 'small' | 'keep' | 'no_earlier';

export const ANNUAL_STATUS_LABELS: Record<AnnualStatus, string> = {
  target: '2等級以上の差があります',
  small: '差が1等級以下なので、年間平均にはできません',
  keep: '4〜6月に平均に入れる月がない（従前のまま）ので、年間平均にはできません',
  no_earlier: '前年7月〜当年3月に平均に入れる月がないので、年間平均にはできません',
};

/** 前年7月〜当年3月の1か月分 */
export type AnnualMonth = SanteiMonth & {
  year: number;
  /** 社会保険に入っていない月・入社する前の月（平均に入れない） */
  notInsured: boolean;
  /** 入社後なのに給与を確定していない */
  unfinalized: boolean;
};

export interface AnnualResult {
  status: AnnualStatus;
  /** 平均に入れる支払基礎日数（17日・15日・11日） */
  minDays: number;
  /** 平均に使った月（YYYY-MM） */
  usedMonths: string[];
  /** 使った月の報酬の合計 */
  total: number;
  /** 前年7月〜当年6月の平均（1円未満切り捨て） */
  average: number | null;
  /** 平均から求めた標準報酬月額と等級（健康保険） */
  standard: number | null;
  grade: number | null;
  /** 表の外の等級も数えた等級の差（年間平均 − 4〜6月の平均） */
  gradeDiff: number | null;
}

export const ymOf = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;

/** 年間平均で、4〜6月のほかに使う月（前年7月〜当年3月） */
export const earlierMonthsOf = (year: number): { year: number; month: number }[] => [
  ...[7, 8, 9, 10, 11, 12].map((month) => ({ year: year - 1, month })),
  ...[1, 2, 3].map((month) => ({ year, month })),
];

/**
 * 前年7月〜当年3月に支払った給与の、支払基礎日数・報酬（数え方は 4〜6月と同じ。santei.ts の monthFigures）
 * @param salaries   確定した給与（前年7月〜当年3月に支払ったものを含む）
 * @param attendance 確定した勤怠（その給与の計算期間を含むもの）
 */
export const buildAnnualEarlierMonths = (
  staff: any,
  year: number,
  group: PayrollGroupForPeriod | undefined,
  salaries: SalaryRecord[],
  attendance: AttendanceRecord[],
): AnnualMonth[] =>
  earlierMonthsOf(year).map(({ year: y, month }) => {
    const { figures, unfinalized } = monthFigures(staff, y, month, group, salaries, attendance);
    const period = group ? getPeriodForPayMonth(group, y, month) : null;
    const beforeJoin = !!staff.join_date && !!period && period.endStr < staff.join_date;
    return { ...figures, year: y, notInsured: beforeJoin || !checkSocialInsEnrolled(staff, y, month), unfinalized };
  });

/**
 * 4〜6月の平均（ordinary）と、前年7月〜当年6月の平均を比べる
 * @param earlier  前年7月〜当年3月
 * @param months   当年4〜6月（ordinary を決めたのと同じもの）
 * @param ordinary 4〜6月の平均で決めた結果（santei.ts の decideTeiji）
 * @param table    9月分から使う等級表
 */
export const decideTeijiAnnual = (
  year: number,
  earlier: AnnualMonth[],
  months: SanteiMonth[],
  kind: SanteiWorkerKind,
  ordinary: SanteiResult,
  table: [number, number, number][],
): AnnualResult => {
  const minDays = kind === 'short' ? 11 : ordinary.method === 'part15' ? 15 : 17;
  const empty = { minDays, usedMonths: [], total: 0, average: null, standard: null, grade: null, gradeDiff: null };
  if (ordinary.method === 'keep' || ordinary.average === null) return { status: 'keep', ...empty };

  const usedEarlier = earlier.filter((m) =>
    m.amount !== null && m.days !== null && !m.partialJoin && !m.notInsured && m.days >= minDays);
  if (usedEarlier.length === 0) return { status: 'no_earlier', ...empty };

  // 4〜6月は、4〜6月の平均に使った月と同じ（日数の基準が同じなので）
  const usedAprJun = months.filter((m) => ordinary.usedMonths.includes(m.month));
  const total = [...usedEarlier, ...usedAprJun].reduce((sum, m) => sum + m.amount!, 0);
  const count = usedEarlier.length + usedAprJun.length;
  const average = Math.floor(total / count);
  const { grade, standard } = lookupGrade(table, average);
  const gradeDiff = extendedGrade(table, average) - extendedGrade(table, ordinary.average);
  return {
    status: Math.abs(gradeDiff) >= 2 ? 'target' : 'small',
    minDays,
    usedMonths: [...usedEarlier.map((m) => ymOf(m.year, m.month)), ...usedAprJun.map((m) => ymOf(year, m.month))],
    total, average, standard, grade, gradeDiff,
  };
};
