/**
 * 協会けんぽ「健康保険・厚生年金保険の保険料額表」のデータの形
 * 実際のデータは kenpoTable20XX.ts（Excel から自動生成）
 */
export interface YearMonth {
  year: number;
  month: number;
}

export interface KenpoGrade {
  /** 健康保険の等級 */
  grade: number;
  /** 厚生年金の等級（範囲外は null） */
  pensionGrade: number | null;
  /** 標準報酬月額 */
  standard: number;
  /** 報酬月額（以上） */
  from: number;
  /** 報酬月額（未満）。最上位は Infinity */
  to: number;
}

export interface KenpoTable {
  title: string;
  effectiveFrom: YearMonth;
  careRate: number;
  pensionRate: number;
  childSupportRate: number | null;
  childSupportFrom: YearMonth | null;
  childCareContributionRate: number;
  healthRates: Record<string, number>;
  grades: KenpoGrade[];
  pensionMinStandard: number;
  pensionMaxStandard: number;
}
