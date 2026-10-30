/**
 * 社会保険マスター
 *
 * 料率は「何年何月分から」で切り替える（年度の途中で変わることもあるため）。
 * ・健康保険・介護保険・厚生年金：協会けんぽの保険料額表ごとに、使い始める月（effectiveFrom）がある。
 *   ふつうは3月分から（3月〜翌2月）。年度の途中で表が変わったときは、その月からの表を KENPO_MASTERS に足せばよい
 * ・雇用保険：laborInsuranceRates.ts の一覧。ふつうは4月から（4月〜翌3月）だが、令和4年度は10月にも変わった
 * どちらも「その月までに始まっている最後のもの」を使う。そのため3月分は「健康保険は新年度・雇用保険は前年度」の組み合わせになる。
 *
 * ※ Q では、給与の支給年月をそのまま保険料の対象月として扱う（当月徴収）。
 *   翌月徴収の会社に対応するには、会社設定で1か月ずらす仕組みが必要（今後の課題）。
 * ※ 登録している範囲より前・後の月は、いちばん近い料率で計算し、WARNINGS に注意を入れる。
 */
import { INSURANCE_2022 } from './insurance2022';
import { INSURANCE_2023 } from './insurance2023';
import { INSURANCE_2024 } from './insurance2024';
import { INSURANCE_2025 } from './insurance2025';
import { INSURANCE_2026 } from './insurance2026';
import type { KenpoMasterType } from './buildInsuranceMaster';
import type { YearMonth } from './kenpoTableTypes';
import { LABOR_INSURANCE_PERIODS, type LaborInsuranceRates } from './laborInsuranceRates';

export type { KenpoMasterType } from './buildInsuranceMaster';
export type { KenpoTable, KenpoGrade, YearMonth } from './kenpoTableTypes';
export type { EmpInsType, LaborInsuranceRates, LaborInsurancePeriod } from './laborInsuranceRates';
export { LABOR_INSURANCE_PERIODS } from './laborInsuranceRates';

export { INSURANCE_2022, INSURANCE_2023, INSURANCE_2024, INSURANCE_2025, INSURANCE_2026 };

/** 協会けんぽの保険料額表（使い始める月の古い順） */
const KENPO_MASTERS = [INSURANCE_2022, INSURANCE_2023, INSURANCE_2024, INSURANCE_2025, INSURANCE_2026];

/** その月に使う社会保険マスター（健康保険・介護保険・厚生年金 ＋ 雇用保険） */
export type InsuranceMasterType = KenpoMasterType & {
  /** 雇用保険料率 */
  LABOR_INSURANCE_RATES: LaborInsuranceRates;
  /** この雇用保険料率を使い始めた月 */
  LABOR_FROM: YearMonth;
  /** 雇用保険料率の出典 */
  LABOR_SOURCE: string;
  /** 料率が登録されていない月を、いちばん近い料率で計算しているときの注意（画面に出す） */
  WARNINGS: string[];
};

const toIndex = ({ year, month }: YearMonth) => year * 12 + (month - 1);
const label = ({ year, month }: YearMonth) => `${year}年${month}月分`;

/**
 * 古い順の一覧から、その月までに始まっている最後のものを選ぶ。
 * まだ始まっていなければ最初のものを使い、注意を返す。
 * 最後のものも、その年度（firstMonth 月〜翌年 firstMonth-1 月）を過ぎていたら注意を返す。
 * @param firstMonth 年度の始まりの月（協会けんぽは3、雇用保険は4）
 */
const pickByMonth = <T>(
  list: T[],
  fromOf: (item: T) => YearMonth,
  target: YearMonth,
  firstMonth: number,
  what: string
): { item: T; warning: string | null } => {
  const t = toIndex(target);
  const started = list.filter((item) => toIndex(fromOf(item)) <= t);
  if (started.length === 0) {
    const first = list[0];
    return {
      item: first,
      warning: `${label(target)}の${what}が登録されていないため、${label(fromOf(first))}からの料率で計算しています。`,
    };
  }
  const item = started[started.length - 1];
  const from = fromOf(item);
  const fiscalYear = from.month >= firstMonth ? from.year : from.year - 1;
  const lastOfYear = toIndex({ year: fiscalYear + 1, month: firstMonth }) - 1;
  const isLatest = item === list[list.length - 1];
  return {
    item,
    warning: isLatest && t > lastOfYear
      ? `${label(target)}の${what}がまだ登録されていないため、${label(from)}からの料率で計算しています。`
      : null,
  };
};

/** 保険料の対象月に合ったマスターを返す */
export const getInsuranceMaster = (year: number, month: number): InsuranceMasterType => {
  const target = { year, month };
  const kenpo = pickByMonth(KENPO_MASTERS, (m) => ({ year: m.MASTER_YEAR, month: m.MASTER_MONTH }), target, 3, "健康保険・介護保険・厚生年金の料率");
  const labor = pickByMonth(LABOR_INSURANCE_PERIODS, (p) => p.from, target, 4, "雇用保険料率");
  return {
    ...kenpo.item,
    LABOR_INSURANCE_RATES: labor.item.rates,
    LABOR_FROM: labor.item.from,
    LABOR_SOURCE: labor.item.source,
    WARNINGS: [kenpo.warning, labor.warning].filter((w): w is string => w !== null),
  };
};

/** 子ども・子育て支援金を徴収する月かどうか */
export const isChildSupportMonth = (m: KenpoMasterType, year: number, month: number): boolean => {
  if (!m.CHILD_SUPPORT_RATE || !m.CHILD_SUPPORT_FROM) return false;
  return year * 12 + month >= m.CHILD_SUPPORT_FROM.year * 12 + m.CHILD_SUPPORT_FROM.month;
};
