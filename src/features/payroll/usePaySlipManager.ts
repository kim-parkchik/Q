import { useState, useEffect, useMemo } from "react";
import * as Master from "../../constants";
import { getPeriodForPayMonth } from "../../utils/payrollPeriod";

export function usePaySlipManager(db: any, staffList: any[], initialYear: number, initialMonth: number) {
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth);
  const [showModal, setShowModal] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<any | null>(null);
  const [attendanceData, setAttendanceData] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [allAttendance, setAllAttendance] = useState<any[]>([]);
  const [companySettings, setCompanySettings] = useState<any>(null);
  const [payrollGroups, setPayrollGroups] = useState<any[]>([]);

  // フィルタ状態
  const [showRetired, setShowRetired] = useState(false);
  const [onlyHasAttendance, setOnlyHasAttendance] = useState(false);

  // 従業員の給与規定グループで、この支給月に集計する勤怠の期間（勤怠画面と同じ）
  const getPeriodForStaff = (staff: any) => {
    const group = payrollGroups.find((g) => g.id === (staff.payroll_group_id || 1)) ?? payrollGroups.find((g) => g.id === 1);
    return group ? getPeriodForPayMonth(group, year, month) : null;
  };

  // データの一括取得
  useEffect(() => {
    const fetchMonthData = async () => {
      if (!db) return;

      try {
        const groups = await db.select("SELECT * FROM payroll_groups ORDER BY id ASC");
        setPayrollGroups(groups || []);

        // 確定済みの勤怠を、給与規定グループごとの計算期間で集計する
        const att: any[] = [];
        for (const group of groups || []) {
          const { startStr, endStr } = getPeriodForPayMonth(group, year, month);
          const rows = await db.select(
            `SELECT
                a.staff_id,
                SUM(CAST(a.work_hours AS REAL)) as total_h,
                cp.is_invalid as calendar_invalid
              FROM attendance a
              JOIN staff s ON a.staff_id = s.id
              LEFT JOIN calendar_patterns cp ON s.calendar_pattern_id = cp.id
              WHERE COALESCE(s.payroll_group_id, 1) = ?
                AND a.work_date BETWEEN ? AND ?
                AND a.is_finalized = 1
              GROUP BY a.staff_id`,
            [group.id, startStr, endStr]
          );
          att.push(...(rows || []));
        }
        setAllAttendance(att);

        // 支店データ
        const br = await db.select("SELECT * FROM branches ORDER BY id ASC");
        setBranches(br || []);

        // 会社設定
        const com = await db.select("SELECT * FROM company WHERE id = 1");
        if (com && com.length > 0) setCompanySettings(com[0]);
      } catch (err) {
          console.error("データの取得に失敗しました:", err);
      }
    };

    fetchMonthData();
  }, [db, year, month]);

  // スタッフのフィルタリング
  const filteredStaff = useMemo(() => {
    return staffList.filter((s) => {
      const hasAtt = allAttendance.some((a) => a.staff_id === s.id);
      const isRetired = !!s.retirement_date;
      if (!showRetired && isRetired) return false;
      if (onlyHasAttendance && !hasAtt) return false;
      return true;
    });
  }, [staffList, allAttendance, showRetired, onlyHasAttendance]);

  // 県名の整形（ヘルパー関数）
  const getPrefecture = (branchId: number): string => {
    const branch = branches.find((b) => b.id === branchId);
    const pref = Master.toKenpoPrefName(branch?.prefecture);
    if (!pref) console.warn(`拠点の都道府県が未設定または不明です（${branch?.prefecture}）。京都の料率で仮計算します。`);
    return pref ?? "京都";
  };

  // 個別スタッフデータのロード（モーダル用）
  const loadStaffData = async (staff: any) => {
    const period = getPeriodForStaff(staff);
    if (!period) {
      console.error("給与規定グループが見つからないため、勤怠の期間を決められません:", staff.payroll_group_id);
      return;
    }
    try {
      // 勤怠画面で確定した日だけを、締日で区切った期間で集計する
      const res = await db.select(
        "SELECT * FROM attendance WHERE staff_id = ? AND work_date BETWEEN ? AND ? AND is_finalized = 1",
        [staff.id, period.startStr, period.endStr]
      );
      setAttendanceData(res || []);
      setSelectedStaff({ ...staff, prefecture: getPrefecture(staff.branch_id || 1), periodLabel: period.displayRange });
      setShowModal(true);
    } catch (err) {
      console.error("勤怠詳細のロードに失敗しました:", err);
    }
  };

  // 画面（View）で必要なものをすべて返す
  return {
    year, setYear,
    month, setMonth,
    showModal, setShowModal,
    selectedStaff,
    attendanceData,
    branches,
    allAttendance,
    companySettings,
    showRetired, setShowRetired,
    onlyHasAttendance, setOnlyHasAttendance,
    filteredStaff,
    loadStaffData,
  };
}