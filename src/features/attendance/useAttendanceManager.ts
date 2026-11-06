import { useState, useEffect, useCallback, useMemo } from "react";
import dayjs from "dayjs";
import { generateAttendanceCSV, parseAttendanceCSV } from "../../utils/csvUtils";
import { calculateSalary, calcDetailedDiff, loadCustomItems, loadWeekCarryOver, toAbsenceDeductionMethod, toProrationMethod, toSocialInsCollection, type SalaryExtras } from "../../utils/calcSalary";
import { countPrescribedWorkDays, loadCalendarContext } from "../../utils/annualWorkDays";
import { staffAsOf } from "../../utils/staffHistory";
import * as Master from '../../constants';
import { useToast } from "../../components/Toast";
import { saveCsvFile } from "../../utils/fileSaveUtils";
import { useMessageDialog } from "../../components/MessageDialog";
import { getPeriodForPayMonth } from "../../utils/payrollPeriod";

/** 給与を確定した月の勤怠を変えようとしたときの知らせ */
export const CLOSED_MESSAGE =
  "この人のこの月（支給月）の給与は確定済みのため、勤怠を変えられません。\n" +
  "直すときは、給与明細で「確定を取り消す」をしてから勤怠を直し、給与を確定し直してください。";

export function useAttendanceManager({ db, staffList, targetYear, targetMonth }: any) {
  const toast = useToast();
  const dialog = useMessageDialog();
  const [activeTab, setActiveTab] = useState<"csv" | "individual">("individual");
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [monthlyWorkData, setMonthlyWorkData] = useState<Record<string, any>>({});
  const [companySettings, setCompanySettings] = useState<any>(null);
  const [branchPrefecture, setBranchPrefecture] = useState<string>("京都");
  const [remainingPaidLeave, setRemainingPaidLeave] = useState<number>(0);
  const [holidays, setHolidays] = useState<Record<string, string>>({});
  const [companyHolidays, setCompanyHolidays] = useState<Record<string, number>>({});
  const [activeFilters, setActiveFilters] = useState<string[]>(["active"]);
  const [currentGroup, setCurrentGroup] = useState<any>(null);
  const [isClosed, setIsClosed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // --- ヘルパー: 現在選択中のスタッフ情報を取得 ---
  // 給与形態・基本給・扶養人数は、選んでいる月（給与の支給月）の分の履歴の値にする（utils/staffHistory.ts）
  // 勤怠を確定すると、この時給・日給を勤怠に残す
  const selectedStaff = useMemo(() => {
    const s = staffList?.find((x: any) => String(x.id) === String(selectedStaffId));
    return s ? staffAsOf(s, targetYear, targetMonth) : undefined;
  }, [staffList, selectedStaffId, targetYear, targetMonth]);

  const loadPayrollGroup = useCallback(async (staffId: string) => {
    if (!db || !staffId) return null;
    const res = await db.select(
      `SELECT g.* FROM payroll_groups g
      JOIN staff s ON s.payroll_group_id = g.id
      WHERE s.id = ?`,
      [staffId]
    ) as any[];

    const group = res?.[0] || null;
    setCurrentGroup(group); // 状態として保持しておくとJSX側で「締日」を表示できる
    return group;
  }, [db]);

  // --- カレンダー・休日設定の読み込み ---
  const loadCalendarSettings = useCallback(async () => {
    if (!db) return;
    try {
      const resHolidays = await db.select("SELECT holiday_date, name FROM holiday_master") as any[];
      const hMap: Record<string, string> = {};
      resHolidays.forEach((h) => { hMap[h.holiday_date] = h.name; });
      setHolidays(hMap);

      if (selectedStaffId && selectedStaff) {
        const patternId = selectedStaff.calendar_pattern_id || 1;
        const resCompany = await db.select(
          "SELECT work_date, is_holiday FROM company_calendar WHERE pattern_id = ?",
          [patternId]
        ) as any[];
        const cMap: Record<string, number> = {};
        resCompany.forEach((c) => { cMap[c.work_date] = c.is_holiday; });
        setCompanyHolidays(cMap);
      }
    } catch (e) {
      console.error("Calendar settings load error:", e);
    }
  }, [db, selectedStaffId, selectedStaff]);

  const payrollPeriod = useMemo(() => {
    // closing_day がない、または currentGroup が取得できていない場合は処理しない
    if (!currentGroup?.closing_day) return null;

    // 翌月払いなら1か月前の勤怠（例: 5月支給・翌月払い → 4月の勤怠）を、締日で区切った期間
    return getPeriodForPayMonth(currentGroup, targetYear, targetMonth);
  }, [currentGroup, targetYear, targetMonth]);

  const dateList = useMemo(() => {
    if (!payrollPeriod) return [];

    const start = dayjs(payrollPeriod.startStr);
    const end = dayjs(payrollPeriod.endStr);

    const list: string[] = [];
    let d = start;

    while (d.isBefore(end) || d.isSame(end)) {
      list.push(d.format("YYYY-MM-DD"));
      d = d.add(1, "day");
    }

    return list;
  }, [payrollPeriod]);

  // --- 有給残日数の計算 ---
  const checkRemainingPaidLeave = useCallback(async () => {
    if (!db || !selectedStaffId) return;
    try {
      const today = new Date().toISOString().split("T")[0];
      const grants = await db.select(
        "SELECT SUM(days_granted) as total FROM paid_leave_grants WHERE staff_id = ? AND expiry_date >= ?",
        [selectedStaffId, today]
      ) as any[];
      
      const used = await db.select(`
        SELECT 
          SUM(CASE WHEN work_type = 'paid_full' THEN 1.0 WHEN work_type = 'paid_half' THEN 0.5 ELSE 0 END) as used_days,
          SUM(paid_leave_hours) as used_hours
        FROM attendance WHERE staff_id = ?`,
        [selectedStaffId]
      ) as any[];

      const totalGranted = grants[0]?.total || 0;
      const daysFromType = used[0]?.used_days || 0;
      const daysFromHours = (used[0]?.used_hours || 0) / 8;
      setRemainingPaidLeave(totalGranted - (daysFromType + daysFromHours));
    } catch (e) {
      console.error("Paid leave check error:", e);
    }
  }, [db, selectedStaffId]);

  // --- 勤怠データの読み込み ---
  const loadMonthlyData = useCallback(async () => {
    setMonthlyWorkData({});

    if (!db || !selectedStaffId || !payrollPeriod) return;

    setIsLoading(true);
    try {
      const { startStr, endStr } = payrollPeriod;
      const attendanceData = await db.select(
        "SELECT * FROM attendance WHERE staff_id = ? AND work_date BETWEEN ? AND ? ORDER BY work_date ASC",
        [selectedStaffId, startStr, endStr]
      ) as any[];

      const loaded: Record<string, any> = {};
      dateList.forEach(d => {
        loaded[d] = { 
          in: "", out: "", bStart: "", bEnd: "", outTime: "", returnTime: "", 
          is_finalized: 0, workType: "normal", paidHours: 0, memo: "",
          savedHours: 0, nightHours: 0, 
          // --- ここに初期値をすべて追加 ---
          csv_entry_time: "", 
          csv_exit_time: "",
          csv_break_start: "",
          csv_break_end: "",
          csv_out_time: "",
          csv_return_time: ""
        };
      });

      if (Array.isArray(attendanceData)) {
        attendanceData.forEach(row => {
          loaded[row.work_date] = { 
            in: row.entry_time || "", 
            out: row.exit_time || "", 
            bStart: row.break_start || "", 
            bEnd: row.break_end || "",
            outTime: row.out_time || "",
            returnTime: row.return_time || "",
            is_finalized: row.is_finalized || 0,
            finalized_at: row.finalized_at,
            savedHours: Number(row.work_hours) || 0,
            nightHours: Number(row.night_hours) || 0,
            workType: row.work_type || "normal", 
            paidHours: row.paid_leave_hours || 0, 
            memo: row.memo || "",
            // --- ここでDBから取得した値を反映させる ---
            csv_entry_time: row.csv_entry_time || "",
            csv_exit_time: row.csv_exit_time || "",
            csv_break_start: row.csv_break_start || "",
            csv_break_end: row.csv_break_end || "",
            csv_out_time: row.csv_out_time || "",
            csv_return_time: row.csv_return_time || ""
          };
        });
      }
      
      setMonthlyWorkData(loaded);

    } catch (e) {
      console.error("データ読み込みエラー:", e);
    } finally {
      setTimeout(() => setIsLoading(false), 50);
    }
  }, [db, selectedStaffId, payrollPeriod, dateList]);

  // --- 操作系 ---
  const handleCellChange = (date: string, field: string, value: any) => {
    if (monthlyWorkData[date][field] === value) return;
    setMonthlyWorkData(prev => ({
      ...prev,
      [date]: { 
        ...prev[date], 
        [field]: value, 
        isSaved: false 
      }
    }));
  };

  /**
   * 1日分の勤怠を確定して保存する
   * @param quiet true のときは失敗してもダイアログを出さない（一括保存で最後にまとめて知らせるため）
   * @returns 保存できたら true
   */
  const finalizeAttendance = async (date: string, quiet = false): Promise<boolean> => {
    if (await blockedByConfirmedSalary(quiet)) return false;
    if (!db || !selectedStaffId || !selectedStaff) return false;
    
    const row = monthlyWorkData[date];

    // --- 🆕 優先順位ロジックの適用 ---
    // 手入力があればそれを使い、なければCSV（打刻データ）を使う。
    // TimeInputPairから ":" が来ている場合は空とみなす。
    const getVal = (manual: string, csv: string) => 
      (manual && manual !== ":") ? manual : (csv || "");

    const effectiveIn = getVal(row.in, row.csv_entry_time);
    const effectiveOut = getVal(row.out, row.csv_exit_time);
    const effectiveBStart = getVal(row.bStart, row.csv_break_start);
    const effectiveBEnd = getVal(row.bEnd, row.csv_break_end);
    const effectiveOutTime = getVal(row.outTime, row.csv_out_time);
    const effectiveReturnTime = getVal(row.returnTime, row.csv_return_time);

    // 確定計算には「有効な値」を渡す
    const { total, night } = calcDetailedDiff(
      effectiveIn, effectiveOut, 
      effectiveBStart, effectiveBEnd, 
      effectiveOutTime, effectiveReturnTime
    );
    
    try {
      const isMonthly = selectedStaff.wage_type === "monthly";
      const now = dayjs().format('YYYY-MM-DD HH:mm');

      // 🆕 UPSERT (ON CONFLICT) を使って、確定した計算結果を保存
      // 他の列（csv_...系）を破壊せずに、確定に必要な列だけを更新します
      await db.execute(
        `INSERT INTO attendance (
          staff_id, work_date, entry_time, exit_time, 
          break_start, break_end, out_time, return_time, 
          work_hours, night_hours,
          actual_base_wage, overtime_rate, night_rate,
          work_type, paid_leave_hours, memo,
          is_finalized, finalized_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(staff_id, work_date) DO UPDATE SET
          entry_time = excluded.entry_time,
          exit_time = excluded.exit_time,
          break_start = excluded.break_start,
          break_end = excluded.break_end,
          out_time = excluded.out_time,
          return_time = excluded.return_time,
          work_hours = excluded.work_hours,
          night_hours = excluded.night_hours,
          actual_base_wage = excluded.actual_base_wage,
          work_type = excluded.work_type,
          paid_leave_hours = excluded.paid_leave_hours,
          memo = excluded.memo,
          is_finalized = excluded.is_finalized,
          finalized_at = excluded.finalized_at`,
        [
          selectedStaffId, date, row.in||"", row.out||"", 
          row.bStart||"", row.bEnd||"", row.outTime||"", row.returnTime||"", 
          total, night,
          isMonthly ? 0 : selectedStaff.base_wage, 
          Master.OVERTIME_RATE, Master.NIGHT_SHIFT_RATE,
          row.workType, Number(row.paidHours)||0, row.memo||"",
          1, now
        ]
      );

      // UI側の状態を更新
      setMonthlyWorkData(prev => ({ 
        ...prev, 
        [date]: { ...prev[date], is_finalized: 1, savedHours: total, nightHours: night, finalized_at: now } 
      }));
      await checkRemainingPaidLeave();
      return true;
    } catch (e) {
      console.error("勤怠の確定保存エラー:", e);
      if (!quiet) dialog.error(`${date} の勤怠を保存できませんでした。\n${e}`);
      return false;
    }
  };

    // --- 1日のデータをDBの状態に戻す（キャンセル処理） ---
  const unfinalizeAttendance = async (date: string) => {
    if (await blockedByConfirmedSalary()) return;
    if (!db || !selectedStaffId) return;

    try {
      // DBの is_finalized を 0 に戻す
      await db.execute(
        "UPDATE attendance SET is_finalized = 0 WHERE staff_id = ? AND work_date = ?",
        [selectedStaffId, date]
      );

      // UI側の状態を更新（編集可能にする）
      setMonthlyWorkData(prev => ({
        ...prev,
        [date]: { ...prev[date], is_finalized: 0 }
      }));
    } catch (e) {
      console.error(e);
      dialog.error(`${date} の確定を解除できませんでした。`);
    }
  };

  const saveAllMonthlyData = async () => {
    // 1. まず対象があるかチェック（この時点ではまだ Loading にしない）
    const targetDates = Object.keys(monthlyWorkData).filter(date => {
      const row = monthlyWorkData[date];
      // 「未確定」かつ「何かしら入力がある」ものを対象にする
      return row.is_finalized === 0 && (row.in || row.out || row.workType !== "normal");
    });
    
    if (targetDates.length === 0) {
      toast.info("保存が必要な入力はありません");
      return;
    }
    if (await blockedByConfirmedSalary()) return;

    // 2. 対象がある場合のみ Loading 開始
    if (isLoading) return; 
    setIsLoading(true);
    
    try {
      if (!db || !selectedStaffId) return;

      let okCount = 0;
      const failedDates: string[] = [];
      for (const date of targetDates) {
        if (await finalizeAttendance(date, true)) okCount++;
        else failedDates.push(date);
      }
      if (failedDates.length === 0) {
        toast.success(`${okCount}日分の勤怠を確定しました`);
      } else {
        dialog.error(`${failedDates.length}日分の保存に失敗しました（${okCount}日分は保存済み）。\n失敗した日: ${failedDates.join(", ")}`);
      }
    } catch (e) {
      dialog.error(`一括保存中にエラーが発生しました。\n${e}`);
    } finally {
      // 3. 成功しても失敗しても必ず Loading を解除
      setIsLoading(false);
    }
  };

  // --- 給与集計に使う、給与項目と所定労働日数（残業代の時給・日割り。給与明細と同じ読み方） ---
  const [customItems, setCustomItems] = useState<SalaryExtras['customItems']>([]);
  const [workDays, setWorkDays] = useState<{ annual: number | null; period: number | null; employed: number | null }>({ annual: null, period: null, employed: null });
  const periodStart = payrollPeriod?.startStr ?? "";
  const periodEnd = payrollPeriod?.endStr ?? "";
  useEffect(() => {
    let cancelled = false;
    setCustomItems([]);
    setWorkDays({ annual: null, period: null, employed: null });
    if (!db || !selectedStaff) return;
    (async () => {
      try {
        const [items, ctx] = await Promise.all([loadCustomItems(db, selectedStaff.id), loadCalendarContext(db, selectedStaff)]);
        if (cancelled) return;
        setCustomItems(items);
        const y = periodEnd ? periodEnd.slice(0, 4) : String(targetYear);
        const from = selectedStaff.join_date && selectedStaff.join_date > periodStart ? selectedStaff.join_date : periodStart;
        const to = selectedStaff.retirement_date && selectedStaff.retirement_date < periodEnd ? selectedStaff.retirement_date : periodEnd;
        setWorkDays({
          annual: countPrescribedWorkDays(ctx, `${y}-01-01`, `${y}-12-31`),
          period: periodStart ? countPrescribedWorkDays(ctx, periodStart, periodEnd) : null,
          employed: periodStart ? countPrescribedWorkDays(ctx, from, to) : null,
        });
      } catch (e) {
        console.error("給与項目・所定労働日数の読み込みエラー:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [db, selectedStaff, periodStart, periodEnd, targetYear]);

  // --- 週40時間の累計に足す、前の計算期間の日（計算期間の初めの日がある週のうち、初めの日より前の日）の確定した勤怠（給与明細と同じ） ---
  const [weekCarryOver, setWeekCarryOver] = useState<NonNullable<SalaryExtras['weekCarryOver']>>([]);
  const weekStartDay = Number(companySettings?.week_start_day ?? 0);
  useEffect(() => {
    let cancelled = false;
    setWeekCarryOver([]);
    if (!db || !selectedStaff || !periodStart) return;
    loadWeekCarryOver(db, selectedStaff.id, periodStart, weekStartDay)
      .then((rows) => { if (!cancelled) setWeekCarryOver(rows); })
      .catch((e) => console.error("前の計算期間の勤怠（週40時間）の読み込みエラー:", e));
    return () => { cancelled = true; };
  }, [db, selectedStaff, periodStart, weekStartDay]);

  // --- 給与集計 ---
  const calcResult = useMemo(() => {
    // 1. 初期値をエンジン側の戻り値の構造と合わせる
    const defaultResult = {
      totalWorkHours: 0,
      totalOvertimeHours: 0,
      totalNightHours: 0,
      highPremiumHours: 0,
      deferredHighPremiumHours: 0,
      basePay: 0,         // 🆕 これを追加
      absenceDeduction: 0,
      commutePay: 0,
      totalEarnings: 0,
    };

    if (!selectedStaff || !companySettings) {
      return defaultResult;
    }

    const attendanceRows = Object.entries(monthlyWorkData)
      .filter(([_, row]) => row.is_finalized === 1)
      .map(([date, row]) => ({
        work_date: date,
        work_hours: Number(row.savedHours) || 0,
        night_hours: Number(row.nightHours) || 0,
        actual_base_wage:
          selectedStaff?.wage_type !== "monthly"
            ? Number(selectedStaff.base_wage || 0)
            : 0,
        work_type: row.workType || "normal",
        is_late: Number(row.is_late) || 0,
        is_early: Number(row.is_early) || 0,
        paid_leave_hours: Number(row.paidHours) || 0,
      }));

    // 条件を緩めたのは正解です！
    if (!selectedStaff || !companySettings) {
      return defaultResult;
    }

    // エンジン（calculateSalary）を呼び出す
    const result = calculateSalary(
      selectedStaff, 
      attendanceRows, 
      { 
        allowanceName: "", 
        allowanceAmount: 0, 
        residentTax: 0, 
        prefecture: branchPrefecture, 
        dependents: Number(selectedStaff.dependents) || 0, 
        customItems,
        taxMethod: currentGroup?.tax_calc_method,
        annualWorkDays: workDays.annual,
        // 計算期間の途中で入社・退職した月給制の人の日割り（給与規定グループの設定）
        prorationMethod: toProrationMethod(currentGroup?.proration_method),
        // 月給制の人の欠勤控除（給与規定グループの設定。計算期間の所定労働日数か、1年間の月平均で割る）
        absenceDeductionMethod: toAbsenceDeductionMethod(currentGroup?.absence_deduction_method),
        period: periodStart ? { start: periodStart, end: periodEnd } : null,
        periodWorkDays: workDays.period,
        employedWorkDays: workDays.employed,
        // 週40時間の累計に、前の計算期間の日も足す
        weekCarryOver,
        // 社会保険料の徴収（給与規定グループの設定。翌月徴収の退職月は、当月払いなら退職した月の分も引く）
        socialInsCollection: toSocialInsCollection(currentGroup?.social_ins_collection),
        collectRetirementMonth: Number(currentGroup?.is_next_month) !== 1,
      }, 
      targetYear, 
      targetMonth, 
      companySettings
    );

    // 2. もしエンジンから basePay が返ってきていればそれを使う
    return result || defaultResult;
  }, [monthlyWorkData, selectedStaff, companySettings, branchPrefecture, targetYear, targetMonth, currentGroup, customItems, workDays, periodStart, periodEnd, weekCarryOver]);

  // --- スタッフフィルタ ---
  const filteredStaffList = useMemo(() => {
    return (staffList || []).filter((s: any) => activeFilters.includes(s.status || "active"));
  }, [staffList, activeFilters]);

  const toggleFilter = (val: string) => {
    setActiveFilters(prev => 
      prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]
    );
  };

  // --- この人のこの月（支給月）の給与を確定しているか ---
  // 確定した給与（salary_results）があれば、その計算期間の勤怠は変えられない（確定した給与と勤怠が食い違わないように）。
  // 直すときは、給与明細で「確定を取り消す」をしてから直し、確定し直す
  const isSalaryConfirmed = useCallback(async (): Promise<boolean> => {
    if (!db || !selectedStaffId || !targetYear || !targetMonth) return false;
    const res = await db.select(
      "SELECT COUNT(*) AS n FROM salary_results WHERE staff_id = ? AND target_year = ? AND target_month = ?",
      [selectedStaffId, targetYear, targetMonth]
    ) as any[];
    return Number(res?.[0]?.n) > 0;
  }, [db, selectedStaffId, targetYear, targetMonth]);

  const checkMonthStatus = useCallback(async () => {
    try {
      setIsClosed(await isSalaryConfirmed());
    } catch (e) {
      console.error("確定状況取得エラー:", e);
      // 確かめられないときは、変えられないようにする
      setIsClosed(true);
      dialog.error(`給与の確定の状況を読み込めなかったため、勤怠を変えられないようにしています。\n${e}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSalaryConfirmed]);

  /** 勤怠を変える前に、給与を確定していないかを表から確かめる（確定していれば知らせて true） */
  const blockedByConfirmedSalary = async (quiet = false): Promise<boolean> => {
    let confirmed = isClosed;
    if (!confirmed) {
      try {
        confirmed = await isSalaryConfirmed();
      } catch (e) {
        console.error("確定状況取得エラー:", e);
        confirmed = true;
      }
    }
    if (confirmed) {
      setIsClosed(true);
      if (!quiet) dialog.warning(CLOSED_MESSAGE);
    }
    return confirmed;
  };

  // --- 打刻ログのエクスポート ---
  const handleExportRawCSV = async () => {
    if (!db) return;
    const monthStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-`;
    try {
      const data = await db.select(`
        SELECT 
          staff_id, work_date, 
          csv_entry_time as entry_time, csv_exit_time as exit_time,
          csv_break_start as break_start, csv_break_end as break_end,
          csv_out_time as out_time, csv_return_time as return_time
        FROM attendance 
        WHERE work_date LIKE ?
        ORDER BY staff_id, work_date
      `, [`${monthStr}%`]) as any[];

      if (!data.length) return dialog.warning(`${targetYear}年${targetMonth}月の打刻ログはありません。`);
      const csvContent = generateAttendanceCSV(data);
      const saved = await saveCsvFile(csvContent, `打刻ログ_${targetYear}年${targetMonth}月.csv`);
      if (!saved) return; // 保存先の選択がキャンセルされた
      toast.success(`「${saved.name}」を保存しました（${data.length}件）`);
    } catch (e) {
      console.error(e);
      dialog.error("打刻ログの出力に失敗しました。");
    }
  };

  // --- 詳細データのエクスポート ---
  const handleExportFullCSV = async () => {
    if (!db || !payrollPeriod) return;
    const { startStr, endStr } = payrollPeriod;

    try {
      const data = await db.select(`
        SELECT a.*, s.name as staff_name 
        FROM attendance a
        JOIN staff s ON a.staff_id = s.id
        WHERE a.work_date BETWEEN ? AND ?
        ORDER BY a.staff_id, a.work_date
      `, [startStr, endStr]) as any[];

      if (!data.length) return dialog.warning("この計算期間の勤怠データはありません。");

      // CSVに確定状態の列を追加（その日の勤怠を確定したか）
      const csvData = data.map(row => ({
        ...row,
        "確定ステータス": Number(row.is_finalized) === 1 ? "確定済み" : "未確定"
      }));

      const statusLabel = data.every(row => Number(row.is_finalized) === 1) ? "" : "_【未確定あり】";
      const filename = `勤怠詳細_${targetYear}年${targetMonth}月支給分${statusLabel}.csv`;

      const csvContent = generateAttendanceCSV(csvData); 
      const saved = await saveCsvFile(csvContent, filename);
      if (!saved) return; // 保存先の選択がキャンセルされた
      toast.success(`「${saved.name}」を保存しました（${data.length}件）`);
    } catch (e) {
      console.error(e);
      dialog.error("詳細データの出力に失敗しました。");
    }
  };

  // --- CSVインポート ---
  const handleImportCSV = async () => {
    // 取り込むのは打刻の列（csv_…）だけで、確定した日は上書きしない（下の WHERE is_finalized = 0）。
    // 給与は確定した日の勤怠だけで計算し、給与を確定した月の日は確定できないので、確定した給与とは食い違わない
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';

    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const text = event.target?.result as string;
          // parseAttendanceCSV の中で trim 処理がされているか確認が必要ですが、
          // ここでは row から値を取り出す際に念のため trim() を検討します。
          const rows = parseAttendanceCSV(text);
          if (rows.length === 0) {
            dialog.warning("取り込めるデータがありませんでした。\nCSVの見出し行（スタッフID・日付・出勤・退勤 など）を確認してください。");
            return;
          }

          let imported = 0;        // 取り込めた行
          let skippedFinalized = 0; // 確定済みのため上書きしなかった行
          let skippedInvalid = 0;   // スタッフIDか日付が空の行
          for (const row of rows) {
            const sId = row["スタッフID"];
            const date = row["日付"];
            if (!sId || !date) { skippedInvalid++; continue; }

            // CSVの日本語ヘッダー名を指定して確実に取得
            const valEntry  = row["出勤"];
            const valExit   = row["退勤"];
            const valBStart = row["休憩始"];
            const valBEnd   = row["休憩終"];
            const valOut    = row["外出"];
            const valReturn = row["戻り"];

            const result = await db.execute(
              `INSERT INTO attendance (
                staff_id, work_date, 
                csv_entry_time, csv_exit_time, 
                csv_break_start, csv_break_end, 
                csv_out_time, csv_return_time,
                work_type, is_finalized
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'normal', 0)
              ON CONFLICT(staff_id, work_date) DO UPDATE SET
                csv_entry_time = excluded.csv_entry_time,
                csv_exit_time = excluded.csv_exit_time,
                csv_break_start = excluded.csv_break_start,
                csv_break_end = excluded.csv_break_end,
                csv_out_time = excluded.csv_out_time,
                csv_return_time = excluded.csv_return_time
              WHERE is_finalized = 0`,
              [sId, date, valEntry || "", valExit || "", valBStart || "", valBEnd || "", valOut || "", valReturn || ""]
            );
            // 確定済みの日は WHERE is_finalized = 0 で更新されないため、影響行数 0 になる
            if ((result?.rowsAffected ?? 1) > 0) imported++;
            else skippedFinalized++;
          }
          await loadMonthlyData(); 
          toast.success(`「${file.name}」から${imported}件を取り込みました`);
          if (skippedFinalized > 0) toast.info(`確定済みの${skippedFinalized}件は上書きしませんでした`);
          if (skippedInvalid > 0) toast.info(`スタッフIDか日付が空の${skippedInvalid}行は読み飛ばしました`);
        } catch (err) {
          console.error(err);
          dialog.error(`CSVの取り込み中にエラーが発生しました。\n${err}`);
        }
      };
      reader.readAsText(file, 'utf-8');
    };
    input.click();
  };

  // --- 会社設定と拠点の都道府県を読み込む（給与計算エンジンに必要） ---
  // ※ リファクタリング時に読み込み処理が抜けていたため復元
  const loadCompanyAndBranch = useCallback(async () => {
    if (!db) return;
    try {
      const configData = await db.select("SELECT * FROM company WHERE id = 1") as any[];
      if (configData?.length > 0) setCompanySettings(configData[0]);

      if (selectedStaff?.branch_id) {
        const branchData = await db.select(
          "SELECT prefecture FROM branches WHERE id = ?",
          [selectedStaff.branch_id]
        ) as any[];
        const pref = Master.toKenpoPrefName(branchData?.[0]?.prefecture);
        if (pref) {
          setBranchPrefecture(pref);
        } else {
          console.warn(`拠点の都道府県が未設定または不明です（${branchData?.[0]?.prefecture}）。京都の料率で仮計算します。`);
          setBranchPrefecture("京都");
        }
      }
    } catch (e) {
      console.error("Company/branch load error:", e);
    }
  }, [db, selectedStaff]);

  useEffect(() => {
    loadCompanyAndBranch();
  }, [loadCompanyAndBranch]);

  // --- 副次的な副作用 ---
  useEffect(() => {
    if (selectedStaffId) {
      setIsLoading(true); // 読み込み開始を明示
      loadPayrollGroup(selectedStaffId);
    }
  }, [selectedStaffId, loadPayrollGroup]);

  useEffect(() => {
    loadCalendarSettings();
  }, [loadCalendarSettings]);

  // これがメインのデータ読み込み
  useEffect(() => {
    loadMonthlyData();
  }, [loadMonthlyData]);

  useEffect(() => {
    checkRemainingPaidLeave();
  }, [selectedStaffId, checkRemainingPaidLeave]);

  useEffect(() => {
    checkMonthStatus();
  }, [checkMonthStatus]);

  return {
    activeTab, setActiveTab,
    selectedStaff, selectedStaffId, setSelectedStaffId,
    isLoading,
    isClosed,
    monthlyWorkData, setMonthlyWorkData, dateList, payrollPeriod,
    remainingPaidLeave,
    holidays,
    companyHolidays,
    activeFilters, setActiveFilters,
    filteredStaffList,
    toggleFilter,
    calcResult,

    handleCellChange,
    finalizeAttendance,
    saveAllMonthlyData,
    handleExportRawCSV,
    handleExportFullCSV,
    handleImportCSV,
    unfinalizeAttendance,
    loadMonthlyData,
    checkRemainingPaidLeave
  };
}