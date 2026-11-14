/**
 * 給与明細・勤怠の画面で使う、平均賃金を使う支給の材料（会社都合で休ませた日の休業手当・労災の待期の休業補償）
 * 確定した給与・勤怠から平均賃金を計算する（utils/averageWageStore.ts の loadAverageWagePay。決まりは utils/averageWage.ts）
 */
import { useEffect, useState } from "react";
import { shutdownDatesOf, type AverageWageAttendance, type AverageWagePay } from "../../utils/averageWage";
import { loadAverageWagePay, type AverageWageStaff } from "../../utils/averageWageStore";

/**
 * @returns undefined：読み込み中（給与明細は確定しない） / null：休業手当・休業補償の日がない（読み込めなかったときも null で、
 *          給与の計算が「平均賃金を読み込めていません」と知らせる）
 */
export function useAverageWagePay(
  db: any,
  staff: (AverageWageStaff & Record<string, any>) | null | undefined,
  period: { start: string; end: string } | null | undefined,
  rows: AverageWageAttendance[],
): AverageWagePay | null | undefined {
  const [value, setValue] = useState<AverageWagePay | null | undefined>(undefined);
  // 休業の日が変わったときだけ読み直す（勤怠の行の配列は、画面を描くたびに作り直されるので、日付で比べる）
  const shutdownKey = period ? shutdownDatesOf(rows, period).join(",") : "";
  useEffect(() => {
    let cancelled = false;
    setValue(undefined);
    if (!db || !staff || !period) return;
    loadAverageWagePay(db, staff, period, rows)
      .then((v) => { if (!cancelled) setValue(v); })
      .catch((e) => {
        console.error("平均賃金の読み込みエラー:", e);
        if (!cancelled) setValue(null);
      });
    return () => { cancelled = true; };
  }, [db, staff?.id, staff?.leave_periods, staff?.payroll_group_id, staff?.join_date, staff?.probation_end, staff?.wage_type, period?.start, period?.end, shutdownKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return value;
}
