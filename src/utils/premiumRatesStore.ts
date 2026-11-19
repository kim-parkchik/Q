/**
 * 残業代の割増率に使う、会社ファイルから読むもの（給与明細・勤怠の画面で使う。計算は utils/premiumRates.ts）
 * ・36協定の年（起算日から1年）のうち、この給与の計算期間より前の時間外労働：確定した給与の内訳（賃金台帳）の「時間外労働時間数」を、
 *   36協定の画面（src/features/attendance/Kyotei36Manager.tsx）と同じく、賃金締切日がその年に入る給与で足す
 */
import dayjs from "dayjs";
import { parseKyotei36Settings } from "./kyotei36";
import { parseLedger } from "./legalBooks";
import { sumYearOvertime, type OvertimeMonth } from "./premiumRates";

/**
 * 36協定の年のうち、この給与の計算期間より前の時間外労働の時間（拠点の36協定に起算日がなければ null）
 * @param kyotei36Json 会社の36協定（company.kyotei36）
 * @param periodEnd この給与の賃金締切日（計算期間の終わりの日）
 */
export const loadOvertimeYearBefore = async (
  db: any, staffId: string | number, branchId: unknown, kyotei36Json: unknown, periodEnd: string,
): Promise<number | null> => {
  const k = parseKyotei36Settings(kyotei36Json)[String(Number(branchId) || 1)];
  if (!k?.startDate || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) return null;
  const rows = (await db.select(
    "SELECT target_year, target_month, ledger, total_overtime_hours FROM salary_results WHERE staff_id = ?",
    [staffId],
  )) as { target_year: number; target_month: number; ledger: string | null; total_overtime_hours: number | null }[];
  const months: OvertimeMonth[] = (rows ?? []).map((r) => {
    const l = parseLedger(r.ledger);
    const ym = `${r.target_year}-${String(r.target_month).padStart(2, "0")}`;
    return {
      periodEnd: l?.periodEnd ?? dayjs(`${ym}-01`).endOf("month").format("YYYY-MM-DD"),
      overtimeHours: l ? l.overtimeHours : Number(r.total_overtime_hours) || 0,
    };
  });
  return sumYearOvertime(months, k.startDate, periodEnd);
};
