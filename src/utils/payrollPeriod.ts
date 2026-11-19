/**
 * 給与の計算期間（勤怠を集計する期間）
 *
 * 勤怠画面と給与明細で同じ期間を使うため、ここにまとめる。
 * 給与規定グループの「締日」と「当月払い／翌月払い」から、支給月の勤怠期間を決める。
 */
import dayjs from "dayjs";

export interface PayrollPeriod {
  startStr: string;
  endStr: string;
  displayRange: string;
}

/** 給与規定グループのうち、期間の計算に使う項目 */
export interface PayrollGroupForPeriod {
  closing_day: number;    // 1~28, 99:末日
  is_next_month: number;  // 0:当月払い, 1:翌月払い
}

/**
 * 給与計算期間を算出する
 * @param year 対象年
 * @param month 対象月（労働月）
 * @param closingDay 締日 (1~28, 99:末日)
 */
export const getPayrollPeriod = (year: number, month: number, closingDay: number): PayrollPeriod => {
  let startDate: dayjs.Dayjs;
  let endDate: dayjs.Dayjs;

  // 1. 基準となる「その月の1日」を作成
  const baseDate = dayjs(`${year}-${month}-01`);

  if (closingDay === 99 || closingDay === 0) {
    // 【末日締め】
    // dayjsの機能でその月の最初と最後をズバリ取得
    startDate = baseDate.startOf('month');
    endDate = baseDate.endOf('month');
  } else {
    // 【指定日締め（例：15日）】
    // 終了日：その月の指定日
    endDate = dayjs(`${year}-${month}-${closingDay}`);
    // 開始日：前月の締日の翌日
    // 15日締めなら、先月の15日の「1日後」＝16日
    startDate = endDate.subtract(1, 'month').add(1, 'day');
  }

  return {
    startStr: startDate.format('YYYY-MM-DD'),
    endStr: endDate.format('YYYY-MM-DD'),
    displayRange: `${startDate.format('YYYY/MM/DD')} 〜 ${endDate.format('YYYY/MM/DD')}`
  };
};

/**
 * 支給年月と給与規定グループから、集計する勤怠の期間を求める
 * 例: 5月支給で翌月払いなら 4月の勤怠、当月払いなら 5月の勤怠
 */
export const getPeriodForPayMonth = (
  group: PayrollGroupForPeriod,
  payYear: number,
  payMonth: number
): PayrollPeriod => {
  const shiftAmount = Number(group.is_next_month) === 1 ? 1 : 0;
  const baseDate = dayjs(`${payYear}-${payMonth}-01`).subtract(shiftAmount, 'month');
  return getPayrollPeriod(baseDate.year(), baseDate.month() + 1, Number(group.closing_day));
};

/**
 * 確定した給与の賃金締切日（給与の計算期間の終わりの日）
 * ・確定したときに内訳（salary_results.ledger の periodEnd）に残した日。内訳を読めなければ、給与規定グループの締日から決める
 * ・雇用保険料の率と、年度更新で賃金を入れる保険年度は、この日がある月で決める（utils/calcSalary.ts の empInsRateMonthOf・utils/nendoKoshin.ts）
 */
export const salaryClosingDate = (
  ledger: unknown,
  group: PayrollGroupForPeriod | undefined,
  payYear: number,
  payMonth: number,
): string | null => {
  try {
    const l = typeof ledger === "string" && ledger ? JSON.parse(ledger) : null;
    if (l?.periodEnd && /^\d{4}-\d{2}-\d{2}$/.test(String(l.periodEnd))) return String(l.periodEnd);
  } catch {
    // 内訳を読めなければ締日から
  }
  return group ? getPeriodForPayMonth(group, payYear, payMonth).endStr : null;
};
