/**
 * 年度ごとの社会保険マスターを組み立てる
 *
 * 協会けんぽの料率・標準報酬月額表は Excel から自動生成したデータ（kenpoTable20XX.ts）を使い、
 * 計算プログラムが使いやすい形（[本人負担, 合計] の組など）に変換する。
 */
import type { KenpoTable } from './kenpoTableTypes';

/** 雇用保険料率 [本人負担, 合計]（小数。0.005 = 5/1000） */
export interface LaborInsuranceRates {
  general: [number, number];
  agriculture: [number, number];
  construction: [number, number];
}

const half = (rate: number) => Number((rate / 2).toFixed(4));

export const buildInsuranceMaster = (
  kenpo: KenpoTable,
  labor: { rates: LaborInsuranceRates; fiscalYear: number; source: string }
) => {
  const KENPO_RATES: Record<string, [number, number]> = Object.fromEntries(
    Object.entries(kenpo.healthRates).map(([pref, rate]) => [pref, [half(rate), rate]])
  );
  const HYOJUN_TABLE: [number, number, number][] = kenpo.grades.map((g) => [g.from, g.to, g.standard]);
  const maxGrade = kenpo.grades[kenpo.grades.length - 1];

  return {
    /** 協会けんぽの料率の年度（3月分から） */
    MASTER_YEAR: kenpo.effectiveFrom.year,
    MASTER_MONTH: kenpo.effectiveFrom.month,
    /** 元データ（Excel から自動生成） */
    KENPO_TABLE: kenpo,
    /** 都道府県別 健康保険料率 [本人負担%, 合計%]（介護保険に該当しない場合） */
    KENPO_RATES,
    /** 介護保険料率 [本人負担%, 合計%] */
    KENPO_CARE_RATE: [half(kenpo.careRate), kenpo.careRate] as [number, number],
    /** 厚生年金保険料率 [本人負担%, 合計%] */
    PENSION_RATE: [half(kenpo.pensionRate), kenpo.pensionRate] as [number, number],
    /** 子ども・子育て支援金率 [本人負担%, 合計%]（制度がない年度は null） */
    CHILD_SUPPORT_RATE: kenpo.childSupportRate
      ? ([half(kenpo.childSupportRate), kenpo.childSupportRate] as [number, number])
      : null,
    CHILD_SUPPORT_FROM: kenpo.childSupportFrom,
    /** 子ども・子育て拠出金率（%・事業主のみ） */
    CHILD_ALLOWANCE_RATE: kenpo.childCareContributionRate,
    /** 雇用保険料率（4月から翌3月までの年度） */
    LABOR_INSURANCE_RATES: labor.rates,
    LABOR_FISCAL_YEAR: labor.fiscalYear,
    LABOR_SOURCE: labor.source,
    /** 標準報酬月額の上限・下限 */
    PENSION_MIN_HYOJUN: kenpo.pensionMinStandard,
    PENSION_MAX_HYOJUN: kenpo.pensionMaxStandard,
    KENPO_MAX_HYOJUN: maxGrade.standard,
    /** 健康保険 標準賞与額の年度累計上限額（4月〜翌3月） */
    HEALTH_INS_ANNUAL_LIMIT: 5730000,
    /** 厚生年金保険 標準賞与額の1回あたりの上限額 */
    PENSION_INS_SINGLE_LIMIT: 1500000,
    /** 介護保険第2号被保険者の年齢 */
    NURSING_CARE_START_AGE: 40,
    NURSING_CARE_END_AGE: 65,
    /** 標準報酬月額表 [報酬月額(以上), 報酬月額(未満), 標準報酬月額] */
    HYOJUN_TABLE,
    /** 画面の選択肢 */
    HYOJUN_OPTIONS: kenpo.grades.map((g) => ({
      label: `${g.grade}級：${g.standard.toLocaleString()}円`,
      value: g.standard,
    })),
  };
};

export type InsuranceMasterType = ReturnType<typeof buildInsuranceMaster>;
