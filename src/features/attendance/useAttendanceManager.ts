import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import dayjs from "dayjs";
import { generateAttendanceCSV } from "../../utils/csvUtils";
import { calculateSalary, loadCustomItems, loadWeekCarryOver, toAbsenceDeductionMethod, toProrationMethod, toSocialInsCollection, toTardyDeductionMethod, type SalaryExtras } from "../../utils/calcSalary";
import { isFlexStaff, loadFlexCarryIn, parseFlexRule } from "../../utils/flexTime";
import { countPrescribedWorkDays, loadCalendarContext } from "../../utils/annualWorkDays";
import { countNonLeaveWorkDays, leaveByDate, toLeaveProrationMethod } from "../../utils/leaveOfAbsence";
import { staffAsOf } from "../../utils/staffHistory";
import * as Master from '../../constants';
import { useToast } from "../../components/Toast";
import { saveCsvFile } from "../../utils/fileSaveUtils";
import { useMessageDialog } from "../../components/MessageDialog";
import { getPeriodForPayMonth } from "../../utils/payrollPeriod";
import { breakShortage, calcDayHours, describeCombine, describeFixedBreak, fixedBreakRuleFor, leaveMinutesOf, recordedRestMinutes, specialLeaveMinutesOf, type DayTimes } from "../../utils/fixedBreak";
import { effectiveBreaks, parseBreaksJson, stringifyBreaks } from "../../utils/breaks";
import { branchPrefectureOf } from "../../utils/branchPrefecture";
import {
  collectLeaveTaken, formatLeaveMinutes, formatTakenAmount, hourlyLeaveByGrantYear, leaveHoursPerDay, loadPaidLeaveData, summarizePaidLeave,
  type AttendanceLeaveRow, type LeaveGrantRow, type ManualLeaveRecord,
} from "../../utils/paidLeave";
import { annualLeaveSettingsOf, fiveDayAlerts, fiveDaysOf } from "../../utils/annualLeaveOverview";
import {
  isSpecialLeaveWorkType, loadLeaveTypes, loadSpecialLeaveData, maxHourlyLeave, parseLeaveOption,
  summarizeSpecialLeave, type LeaveType, type SpecialLeaveDay, type SpecialLeaveGrantRow,
} from "../../utils/specialLeave";

/** 手入力があればそれを使い、なければ打刻（CSV）を使う。TimeInputPair から ":" が来ている場合は空とみなす */
const pick = (manual: string, csv: string) => (manual && manual !== ":") ? manual : (csv || "");

/** その日の出勤・退勤・休憩の一覧（手入力が先）と「休憩なし」 */
export const effectiveTimesOf = (row: any): DayTimes => ({
  entry: pick(row.in, row.csv_entry_time),
  exit: pick(row.out, row.csv_exit_time),
  breaks: effectiveBreaks(row.breaks ?? null, row.csvBreaks ?? []),
  breakNone: !!row.breakNone,
});

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
  // 拠点の都道府県（健康保険料率に使う）。わからなければ空（京都などで仮に計算しない。この画面には社会保険料を出していない）
  const [branchPrefecture, setBranchPrefecture] = useState<string>("");
  // 有給の付与・確定した勤怠・前の記録（有給の残りを数える。有給の画面と同じ読み方）
  const [paidLeaveData, setPaidLeaveData] = useState<{
    staffId: string; grants: LeaveGrantRow[]; attendance: AttendanceLeaveRow[]; manual: ManualLeaveRecord[];
  } | null>(null);
  const paidLeaveSeq = useRef(0);
  // 会社独自の休暇（特別休暇）の種類と、その人の付与・確定した勤怠の特別休暇の日（utils/specialLeave.ts）
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [specialLeaveData, setSpecialLeaveData] = useState<{
    staffId: string; grants: SpecialLeaveGrantRow[]; days: SpecialLeaveDay[];
  } | null>(null);
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

  // --- 有給の残り（有給の画面と同じ数え方。給与と同じく、確定した日の勤怠で数える。utils/paidLeave.ts） ---
  const checkRemainingPaidLeave = useCallback(async () => {
    const seq = ++paidLeaveSeq.current;
    if (!db || !selectedStaffId) {
      setPaidLeaveData(null);
      return;
    }
    try {
      const [loaded, special, types] = await Promise.all([
        loadPaidLeaveData(db, selectedStaffId), loadSpecialLeaveData(db, selectedStaffId), loadLeaveTypes(db),
      ]);
      if (seq !== paidLeaveSeq.current) return; // 読み込み中にほかの人を選んだ
      setPaidLeaveData({ staffId: selectedStaffId, ...loaded });
      setSpecialLeaveData({ staffId: selectedStaffId, ...special });
      setLeaveTypes(types);
    } catch (e) {
      console.error("Paid leave check error:", e);
    }
  }, [db, selectedStaffId]);

  // 計算期間の終わりの日の時点の残りと、この期間に残りが足りない有給の日
  const paidLeave = useMemo(() => {
    if (!paidLeaveData || paidLeaveData.staffId !== selectedStaffId) return null;
    const { hours, assumed } = leaveHoursPerDay(selectedStaff?.scheduled_work_hours);
    const { taken } = collectLeaveTaken(paidLeaveData.attendance, paidLeaveData.manual);
    const asOf = payrollPeriod?.endStr ?? dayjs().format("YYYY-MM-DD");
    const summary = summarizePaidLeave(paidLeaveData.grants, taken, hours, asOf);
    const inPeriod = payrollPeriod
      ? summary.taken.filter(t => t.date >= payrollPeriod.startStr && t.date <= payrollPeriod.endStr)
      : [];
    // 時間単位の有給は1年に5日分まで（労働基準法39条4項）。この画面でまだ確定していない日の時間有給も入れて数える
    const unfinalized = Object.entries(monthlyWorkData)
      .filter(([, row]) => Number(row.is_finalized) !== 1 && (Number(row.paidHours) || 0) > 0)
      .map(([date, row]) => ({ date, hours: Number(row.paidHours) || 0 }));
    const hourlyYears = hourlyLeaveByGrantYear(paidLeaveData.grants, [...taken, ...unfinalized], hours, Master.ANNUAL_PAID_LEAVE_MAX_DAYS);
    const hourlyOver = hourlyYears
      .filter(y => y.over && payrollPeriod && y.from <= payrollPeriod.endStr && y.to >= payrollPeriod.startStr)
      .map(y => ({ from: y.from, to: y.to, taken: formatLeaveMinutes(y.minutes, hours), limit: formatLeaveMinutes(y.limitMinutes, hours), hours: y.minutes / 60, limitHours: y.limitMinutes / 60 }));
    // 年5日（付与日から1年。期間が重なるときは、まとめて按分。今日の時点で足りない期間と、過ぎて1年以内の足りなかった期間。utils/annualLeaveGrant.ts）
    const today = dayjs().format("YYYY-MM-DD");
    const fiveDay = fiveDayAlerts(fiveDaysOf(selectedStaff ?? {}, paidLeaveData.grants, taken, today, annualLeaveSettingsOf(companySettings)), today);
    return {
      hasGrants: summary.hasGrants,
      asOf,
      fiveDay,
      remainingText: formatLeaveMinutes(summary.remainingMinutes, hours),
      hoursAssumed: assumed,
      leaveInPeriod: inPeriod.length > 0,
      hourlyLeaveInPeriod: inPeriod.some(t => t.hours > 0) || unfinalized.some(t => t.date >= (payrollPeriod?.startStr ?? "") && t.date <= (payrollPeriod?.endStr ?? "")),
      /** 時間単位の有給が1年に5日分を超えた付与の年 */
      hourlyOver,
      shortages: inPeriod
        .filter(t => t.shortageMinutes > 0)
        .map(t => ({ date: t.date, amount: formatTakenAmount(t), shortage: formatLeaveMinutes(t.shortageMinutes, hours) })),
    };
  }, [paidLeaveData, selectedStaffId, selectedStaff, payrollPeriod, monthlyWorkData, companySettings]);

  // --- 特別休暇の残り（有給休暇管理の画面と同じ数え方。utils/specialLeave.ts）---
  // この画面の計算期間の日は、まだ確定していない日も入れて数える（確定する前に、残りが足りないことに気づけるように）
  const specialLeave = useMemo(() => {
    if (!specialLeaveData || specialLeaveData.staffId !== selectedStaffId || !payrollPeriod) return null;
    const shown = new Set(Object.keys(monthlyWorkData));
    const isLeaveRow = (row: any) => isSpecialLeaveWorkType(row.workType) || (Number(row.specialHours) || 0) > 0;
    const days: SpecialLeaveDay[] = [
      ...specialLeaveData.days.filter(d => !shown.has(d.work_date)),
      ...Object.entries(monthlyWorkData)
        .filter(([, row]) => isLeaveRow(row))
        .map(([date, row]) => ({ work_date: date, work_type: row.workType, leave_type_id: row.leaveTypeId, special_leave_hours: row.specialHours })),
    ];
    // 時間単位の休暇の1日分は、1日の所定労働時間（1時間に満たない端数は切り上げ。年次有給休暇の時間単位と同じ）
    const { hours } = leaveHoursPerDay(selectedStaff?.scheduled_work_hours);
    const asOf = payrollPeriod.endStr;
    const inPeriod = (date: string) => date >= payrollPeriod.startStr && date <= payrollPeriod.endStr;
    const summaries = leaveTypes
      .map(t => summarizeSpecialLeave(t, specialLeaveData.grants, days, asOf, hours))
      .filter(s => s.taken.some(t => inPeriod(t.date)) || (s.type.active && s.type.trackBalance && s.hasGrants));
    return {
      asOf,
      types: summaries.map(s => {
        const takenMinutes = s.taken.filter(t => inPeriod(t.date)).reduce((sum, t) => sum + t.minutes, 0);
        return {
          id: s.type.id,
          name: s.type.name,
          paid: s.type.paid,
          trackBalance: s.type.trackBalance,
          hasGrants: s.hasGrants,
          remainingText: formatLeaveMinutes(s.remainingMinutes, hours),
          /** この期間に取った日数・時間（「1日と3時間」。なければ ""） */
          takenInPeriod: takenMinutes > 0 ? formatLeaveMinutes(takenMinutes, hours) : "",
          /** この期間に、残りが足りない日 */
          shortages: s.shortages
            .filter(t => inPeriod(t.date))
            .map(t => ({ date: t.date, shortage: formatLeaveMinutes(t.shortageMinutes, hours) })),
        };
      }),
      /** 特別休暇・時間休なのに、休暇の種類がわからない日（種類を選んでいない・消した種類） */
      unknownDates: Object.entries(monthlyWorkData)
        .filter(([, row]) => isLeaveRow(row) && !leaveTypes.some(t => t.id === Number(row.leaveTypeId)))
        .map(([date]) => date),
    };
  }, [specialLeaveData, selectedStaffId, selectedStaff, payrollPeriod, monthlyWorkData, leaveTypes]);

  // --- 決まった休憩（給与規定グループの決まり。従業員の「決まった休憩を使う」を外した人は null。utils/fixedBreak.ts） ---
  const fixedBreakRule = useMemo(
    () => fixedBreakRuleFor(currentGroup?.fixed_break, selectedStaff?.fixed_break_apply),
    [currentGroup, selectedStaff]
  );

  /**
   * 日ごとの休憩：引く（引いた）決まった休憩、休憩を引かなかった理由、労働基準法34条の休憩に足りない分（分）
   * 確定した日は、確定したときの実働と、そのとき引いた決まった休憩で見る
   */
  const breakInfo = useMemo(() => {
    const info: Record<string, {
      autoBreak: string; notice: string; shortage: number; workMinutes: number; restMinutes: number;
      /** 時間有給にした中抜けの長さ（分） */
      leaveMinutes: number;
      /** 時間単位の特別休暇にした中抜けの長さ（分） */
      specialLeaveMinutes: number;
    }> = {};
    for (const date of dateList) {
      const row = monthlyWorkData[date];
      if (!row) continue;
      const times = effectiveTimesOf(row);
      if (Number(row.is_finalized) === 1) {
        const work = Math.round((Number(row.savedHours) || 0) * 60);
        const rest = recordedRestMinutes(times, row.autoBreak);
        info[date] = {
          autoBreak: row.autoBreak || "", notice: "", shortage: breakShortage(work, rest), workMinutes: work, restMinutes: rest,
          leaveMinutes: leaveMinutesOf(times), specialLeaveMinutes: specialLeaveMinutesOf(times),
        };
        continue;
      }
      const day = calcDayHours(times, fixedBreakRule);
      if (Number.isNaN(day.total)) {
        info[date] = {
          autoBreak: "", notice: "", shortage: 0, workMinutes: 0, restMinutes: 0,
          leaveMinutes: leaveMinutesOf(times), specialLeaveMinutes: specialLeaveMinutesOf(times),
        };
        continue;
      }
      const work = Math.round(day.total * 60);
      info[date] = {
        autoBreak: day.autoBreak, notice: day.notice, shortage: breakShortage(work, day.restMinutes), workMinutes: work,
        restMinutes: day.restMinutes, leaveMinutes: day.leaveMinutes, specialLeaveMinutes: day.specialLeaveMinutes,
      };
    }
    return info;
  }, [dateList, monthlyWorkData, fixedBreakRule]);

  /** 画面に出す、この人の決まった休憩（使わなければ null） */
  const fixedBreakText = fixedBreakRule ? describeFixedBreak(fixedBreakRule) : null;
  /** 決まった休憩と、入れた休憩との合わせ方（使わなければ null） */
  const fixedBreakCombineText = fixedBreakRule ? describeCombine(fixedBreakRule) : null;

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
          in: "", out: "",
          // 休憩の一覧：breaks は手入力（null なら打刻を使う）、csvBreaks は打刻（utils/breaks.ts）
          breaks: null, csvBreaks: [],
          is_finalized: 0, workType: "normal", leaveTypeId: null, leavePaid: null, specialHours: 0, paidHours: 0, memo: "",
          savedHours: 0, nightHours: 0, breakNone: false, autoBreak: "",
          csv_entry_time: "",
          csv_exit_time: "",
        };
      });

      if (Array.isArray(attendanceData)) {
        attendanceData.forEach(row => {
          loaded[row.work_date] = {
            in: row.entry_time || "",
            out: row.exit_time || "",
            breaks: parseBreaksJson(row.breaks),
            csvBreaks: parseBreaksJson(row.csv_breaks) ?? [],
            is_finalized: row.is_finalized || 0,
            finalized_at: row.finalized_at,
            savedHours: Number(row.work_hours) || 0,
            nightHours: Number(row.night_hours) || 0,
            workType: row.work_type || "normal", 
            // 特別休暇の種類と、確定したときの有給か（utils/specialLeave.ts）
            leaveTypeId: row.leave_type_id ?? null,
            leavePaid: row.leave_paid ?? null,
            specialHours: Number(row.special_leave_hours) || 0, // 時間単位の特別休暇の時間（時間休）
            paidHours: row.paid_leave_hours || 0, 
            memo: row.memo || "",
            breakNone: Number(row.break_none) === 1, // その日は休憩を取らなかった（決まった休憩を引かない）
            autoBreak: row.auto_break || "",          // 確定したときに引いた決まった休憩
            csv_entry_time: row.csv_entry_time || "",
            csv_exit_time: row.csv_exit_time || "",
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
  /** 勤怠の区分を変える（プルダウンの値。特別休暇は「special:3」のように休暇の種類も入っている） */
  const handleWorkTypeChange = (date: string, value: string) => {
    const { workType, leaveTypeId } = parseLeaveOption(value);
    setMonthlyWorkData(prev => {
      const row = prev[date];
      const special = isSpecialLeaveWorkType(workType);
      // 特別休暇（1日・半日）の日は時間休を入れない。特別休暇でない区分に戻したら、時間休の種類は残す
      const keepHours = !special && (Number(row.specialHours) || 0) > 0;
      return {
        ...prev,
        [date]: {
          ...row, workType,
          leaveTypeId: special ? leaveTypeId : keepHours && !isSpecialLeaveWorkType(row.workType) ? row.leaveTypeId : null,
          specialHours: special ? 0 : row.specialHours,
          isSaved: false,
        },
      };
    });
  };

  /** 時間休（時間単位の特別休暇）の種類を変える。特別休暇（1日・半日）の日は変えない */
  const handleHourlyLeaveTypeChange = (date: string, leaveTypeId: number | null) => {
    setMonthlyWorkData(prev => {
      const row = prev[date];
      if (isSpecialLeaveWorkType(row.workType)) return prev;
      return { ...prev, [date]: { ...row, leaveTypeId, isSaved: false } };
    });
  };

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

    // 特別休暇は、休暇の種類と、いまの設定で有給か無給かを残す（あとで設定を変えても、確定した日は変わらない）
    // 時間休（時間単位の特別休暇）も同じ。1日に入れられる特別休暇は1種類
    const isSpecial = isSpecialLeaveWorkType(row.workType);
    const specialHours = isSpecial ? 0 : Math.max(0, Number(row.specialHours) || 0);
    if (specialHours > 0) {
      const max = maxHourlyLeave(selectedStaff.scheduled_work_hours);
      if (!Number.isInteger(specialHours) || specialHours > max) {
        if (!quiet) dialog.warning(`${date} の時間休は、1時間単位で、1日の所定労働時間に満たない時間（${max}時間まで）にしてください。1日休むときは、区分で休暇を選んでください。`);
        return false;
      }
    }
    const leaveType = isSpecial || specialHours > 0 ? leaveTypes.find(t => t.id === Number(row.leaveTypeId)) : undefined;
    if ((isSpecial || specialHours > 0) && !leaveType) {
      if (!quiet) dialog.warning(`${date} の休暇の種類がわかりません。${isSpecial ? "区分" : "時間休"}で休暇を選び直してください。`);
      return false;
    }
    const leaveTypeId = leaveType ? leaveType.id : null;
    const leavePaid = leaveType ? (leaveType.paid ? 1 : 0) : null;

    // 手入力があればそれを使い、なければ打刻（CSV）を使う。休憩の一覧と、決まった休憩を引く（utils/fixedBreak.ts）
    const day = calcDayHours(effectiveTimesOf(row), fixedBreakRule);
    const { total, night } = day;
    
    try {
      const isMonthly = selectedStaff.wage_type === "monthly";
      const now = dayjs().format('YYYY-MM-DD HH:mm');

      // 🆕 UPSERT (ON CONFLICT) を使って、確定した計算結果を保存
      // 他の列（csv_...系）を破壊せずに、確定に必要な列だけを更新します
      await db.execute(
        `INSERT INTO attendance (
          staff_id, work_date, entry_time, exit_time,
          breaks,
          work_hours, night_hours,
          actual_base_wage, overtime_rate, night_rate,
          work_type, leave_type_id, leave_paid, special_leave_hours, paid_leave_hours, memo,
          is_finalized, finalized_at, break_none, auto_break
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(staff_id, work_date) DO UPDATE SET
          entry_time = excluded.entry_time,
          exit_time = excluded.exit_time,
          breaks = excluded.breaks,
          work_hours = excluded.work_hours,
          night_hours = excluded.night_hours,
          actual_base_wage = excluded.actual_base_wage,
          work_type = excluded.work_type,
          leave_type_id = excluded.leave_type_id,
          leave_paid = excluded.leave_paid,
          special_leave_hours = excluded.special_leave_hours,
          paid_leave_hours = excluded.paid_leave_hours,
          memo = excluded.memo,
          is_finalized = excluded.is_finalized,
          finalized_at = excluded.finalized_at,
          break_none = excluded.break_none,
          auto_break = excluded.auto_break`,
        [
          selectedStaffId, date, row.in||"", row.out||"",
          stringifyBreaks(row.breaks ?? null),
          total, night,
          isMonthly ? 0 : selectedStaff.base_wage, 
          Master.OVERTIME_RATE, Master.NIGHT_SHIFT_RATE,
          row.workType, leaveTypeId, leavePaid, specialHours, Number(row.paidHours)||0, row.memo||"",
          1, now, row.breakNone ? 1 : 0, day.autoBreak || null
        ]
      );

      // UI側の状態を更新
      setMonthlyWorkData(prev => ({ 
        ...prev, 
        [date]: { ...prev[date], is_finalized: 1, savedHours: total, nightHours: night, finalized_at: now, autoBreak: day.autoBreak, leaveTypeId, leavePaid, specialHours } 
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
        "UPDATE attendance SET is_finalized = 0, auto_break = NULL, leave_paid = NULL WHERE staff_id = ? AND work_date = ?",
        [selectedStaffId, date]
      );

      // UI側の状態を更新（編集可能にする）
      setMonthlyWorkData(prev => ({
        ...prev,
        [date]: { ...prev[date], is_finalized: 0, autoBreak: "", leavePaid: null }
      }));
      await checkRemainingPaidLeave();
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
  const [workDays, setWorkDays] = useState<{ annual: number | null; period: number | null; employed: number | null; nonLeave: number | null }>({ annual: null, period: null, employed: null, nonLeave: null });
  const periodStart = payrollPeriod?.startStr ?? "";
  const periodEnd = payrollPeriod?.endStr ?? "";
  useEffect(() => {
    let cancelled = false;
    setCustomItems([]);
    setWorkDays({ annual: null, period: null, employed: null, nonLeave: null });
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
          // 在籍していて休業していない日の所定労働日数（休業の月の日割り。utils/leaveOfAbsence.ts）
          nonLeave: periodStart ? countNonLeaveWorkDays(ctx, selectedStaff, { start: periodStart, end: periodEnd }) : null,
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

  // --- フレックスタイム制の人：前の月から繰り越した不足時間（前の月の確定した給与。給与明細と同じ読み方。utils/flexTime.ts） ---
  const [flexCarryIn, setFlexCarryIn] = useState(0);
  const flexStaff = !!selectedStaff && isFlexStaff(selectedStaff);
  useEffect(() => {
    let cancelled = false;
    setFlexCarryIn(0);
    if (!db || !selectedStaff || !flexStaff) return;
    loadFlexCarryIn(db, selectedStaff.id, targetYear, targetMonth)
      .then((carry) => { if (!cancelled) setFlexCarryIn(carry); })
      .catch((e) => console.error("前の月から繰り越したフレックスの不足時間の読み込みエラー:", e));
    return () => { cancelled = true; };
  }, [db, selectedStaff, flexStaff, targetYear, targetMonth]);

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
      tardyDeduction: 0,
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
        leave_paid: row.leavePaid ?? null,
        special_leave_hours: Number(row.specialHours) || 0,
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
        // 休業の月の日割り（給与規定グループの設定。初めは所定労働日数で日割り）
        leaveProrationMethod: toLeaveProrationMethod(currentGroup?.leave_proration_method),
        // 月給制の人の欠勤控除（給与規定グループの設定。計算期間の所定労働日数か、1年間の月平均で割る）
        absenceDeductionMethod: toAbsenceDeductionMethod(currentGroup?.absence_deduction_method),
        // 月給制・日給制の人の遅刻・早退・中抜けの控除（給与規定グループの設定。初めは引かない）
        tardyDeductionMethod: toTardyDeductionMethod(currentGroup?.tardy_deduction_method),
        period: periodStart ? { start: periodStart, end: periodEnd } : null,
        periodWorkDays: workDays.period,
        employedWorkDays: workDays.employed,
        nonLeaveWorkDays: workDays.nonLeave,
        // 週40時間の累計に、前の計算期間の日も足す
        weekCarryOver,
        // 社会保険料の徴収（給与規定グループの設定。翌月徴収の退職月は、当月払いなら退職した月の分も引く）
        socialInsCollection: toSocialInsCollection(currentGroup?.social_ins_collection),
        collectRetirementMonth: Number(currentGroup?.is_next_month) !== 1,
        // フレックスタイム制の決まりと、前の月から繰り越した不足時間（utils/flexTime.ts）
        flexRule: parseFlexRule(currentGroup?.flex_rule),
        flexCarryIn,
      }, 
      targetYear, 
      targetMonth, 
      companySettings
    );

    // 2. もしエンジンから basePay が返ってきていればそれを使う
    return result || defaultResult;
  }, [monthlyWorkData, selectedStaff, companySettings, branchPrefecture, targetYear, targetMonth, currentGroup, customItems, workDays, periodStart, periodEnd, weekCarryOver, flexCarryIn]);

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
        SELECT staff_id, work_date, csv_entry_time, csv_exit_time, csv_breaks
        FROM attendance
        WHERE work_date LIKE ?
        ORDER BY staff_id, work_date
      `, [`${monthStr}%`]) as any[];

      if (!data.length) return dialog.warning(`${targetYear}年${targetMonth}月の打刻ログはありません。`);
      const csvContent = generateAttendanceCSV(data, "raw");
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
        SELECT a.*, s.name as staff_name, lt.name AS leave_name
        FROM attendance a
        JOIN staff s ON a.staff_id = s.id
        LEFT JOIN leave_types lt ON lt.id = a.leave_type_id
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

      const csvContent = generateAttendanceCSV(csvData, "full");
      const saved = await saveCsvFile(csvContent, filename);
      if (!saved) return; // 保存先の選択がキャンセルされた
      toast.success(`「${saved.name}」を保存しました（${data.length}件）`);
    } catch (e) {
      console.error(e);
      dialog.error("詳細データの出力に失敗しました。");
    }
  };

  // CSV の取り込みは AttendanceImportButton.tsx（取り込む前に、まとめを出して確かめる）

  // --- 会社設定と拠点の都道府県を読み込む（給与計算エンジンに必要） ---
  // ※ リファクタリング時に読み込み処理が抜けていたため復元
  const loadCompanyAndBranch = useCallback(async () => {
    if (!db) return;
    try {
      const configData = await db.select("SELECT * FROM company WHERE id = 1") as any[];
      if (configData?.length > 0) setCompanySettings(configData[0]);

      if (selectedStaff) {
        // 拠点を選んでいない人は本店（給与明細と同じ）。前に選んでいた人の都道府県が残らないように、毎回決め直す
        const branchId = Number(selectedStaff.branch_id) || 1;
        const branchData = await db.select(
          "SELECT id, name, prefecture FROM branches WHERE id = ?",
          [branchId]
        ) as any[];
        setBranchPrefecture(branchPrefectureOf(branchData ?? [], branchId).prefecture ?? "");
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

  // 休業・休職の日（従業員の画面で入れた期間。勤怠の画面に「育休」などと出す。utils/leaveOfAbsence.ts）
  const leaveDays = useMemo(() => leaveByDate(selectedStaff, dateList), [selectedStaff, dateList]);

  return {
    activeTab, setActiveTab,
    selectedStaff, selectedStaffId, setSelectedStaffId,
    isLoading,
    isClosed,
    monthlyWorkData, setMonthlyWorkData, dateList, payrollPeriod,
    leaveDays,
    paidLeave,
    // 会社独自の休暇（特別休暇）の種類と、この人の残り
    leaveTypes,
    specialLeave,
    fixedBreakRule, fixedBreakText, fixedBreakCombineText, breakInfo,
    // 時間単位の有給を使う会社か（会社の設定。労使協定を結んでいるとき）
    hourlyLeaveEnabled: Number(companySettings?.hourly_leave) === 1,
    // 半日単位の有給（半休）を使う会社か（会社の設定。初めは使う）と、この期間に半休の日があるか
    halfDayLeaveEnabled: Number(companySettings?.half_day_leave ?? 1) !== 0,
    halfDayInPeriod: Object.values(monthlyWorkData).some((row: any) => row?.workType === "paid_half"),
    holidays,
    companyHolidays,
    activeFilters, setActiveFilters,
    filteredStaffList,
    toggleFilter,
    calcResult,

    handleCellChange,
    handleWorkTypeChange,
    handleHourlyLeaveTypeChange,
    finalizeAttendance,
    saveAllMonthlyData,
    handleExportRawCSV,
    handleExportFullCSV,
    unfinalizeAttendance,
    loadMonthlyData,
    checkRemainingPaidLeave
  };
}