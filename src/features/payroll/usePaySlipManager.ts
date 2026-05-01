import { useState, useEffect, useMemo } from "react";

export function usePaySlipManager(db: any, staffList: any[], initialYear: number, initialMonth: number) {
    const [year, setYear] = useState(initialYear);
    const [month, setMonth] = useState(initialMonth);
    const [showModal, setShowModal] = useState(false);
    const [selectedStaff, setSelectedStaff] = useState<any | null>(null);
    const [attendanceData, setAttendanceData] = useState<any[]>([]);
    const [branches, setBranches] = useState<any[]>([]);
    const [allAttendance, setAllAttendance] = useState<any[]>([]);
    const [companySettings, setCompanySettings] = useState<any>(null);

    // フィルタ状態
    const [showRetired, setShowRetired] = useState(false);
    const [onlyHasAttendance, setOnlyHasAttendance] = useState(false);

    // データの一括取得
    useEffect(() => {
        const fetchMonthData = async () => {
            if (!db) return;
            const monthStr = String(month).padStart(2, '0');

            try {
                // 全勤怠データ
                const att = await db.select(
                    `SELECT 
                            a.staff_id, 
                            SUM(CAST(a.work_hours AS REAL)) as total_h,
                            cp.is_invalid as calendar_invalid
                        FROM attendance a
                        LEFT JOIN staff s ON a.staff_id = s.id
                        LEFT JOIN calendar_patterns cp ON s.calendar_pattern_id = cp.id
                        WHERE a.work_date LIKE ? 
                        GROUP BY a.staff_id`,
                    [`${year}-${monthStr}-%`]
                );
                setAllAttendance(att || []);

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
        if (!branch?.prefecture) return "京都";
        return branch.prefecture.replace(/[都道府県]$/, "");
    };

    // 個別スタッフデータのロード（モーダル用）
    const loadStaffData = async (staff: any) => {
        const monthStr = String(month).padStart(2, '0');
        try {
            const res = await db.select(
                "SELECT * FROM attendance WHERE staff_id = ? AND work_date LIKE ?",
                [staff.id, `${year}-${monthStr}-%`]
            );
            setAttendanceData(res || []);
            setSelectedStaff({ ...staff, prefecture: getPrefecture(staff.branch_id || 1) });
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