import { useState, useMemo, useEffect } from 'react';
import * as Master from '../../constants';
import { calculateSalary, loadCustomItems, loadWeekCarryOver, saveSalaryResult, toProrationMethod, toSocialInsCollection, type SalaryExtras } from '../../utils/calcSalary';
import { flatTaxReductionTotal, toTaxColumn } from '../../utils/incomeTax';
import { countPrescribedWorkDays, isPrescribedWorkDay, loadCalendarContext, type CalendarContext } from '../../utils/annualWorkDays';
import { baseWagePerHour, checkMinimumWage } from '../../utils/minimumWage';
import { hasWageChanges, staffAsOf } from '../../utils/staffHistory';
import { residentTaxFor } from '../../utils/residentTax';
import { writeLog } from '../../utils/logUtils';
import { ask } from '@tauri-apps/plugin-dialog';

// 型定義
interface UsePayStubProps {
  db: any;
  staff: any;
  attendanceData: any[];
  year: number;
  month: number;
  companySettings: any;
}

export function usePayStubModal({ db, staff: staffRecord, attendanceData, year, month, companySettings }: UsePayStubProps) {
  // 給与形態・基本給・扶養人数は、この月の分の履歴の値を使う（utils/staffHistory.ts）
  const staff = useMemo(() => staffAsOf(staffRecord, year, month), [staffRecord, year, month]);
  /** この月の分の給与を確定しているか（確定した結果があるか。確定していれば、勤怠の画面でその月の勤怠を変えられない） */
  const [isSaved, setIsSaved] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!db) return;
      try {
        const rows = await db.select(
          "SELECT COUNT(*) AS n FROM salary_results WHERE staff_id = ? AND target_year = ? AND target_month = ?",
          [staff.id, year, month]
        ) as { n: number }[];
        if (!cancelled) setIsSaved(Number(rows?.[0]?.n) > 0);
      } catch (e) {
        console.error("給与の確定の状況の読み込みエラー:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [db, staff.id, year, month]);
  const [extras, setExtras] = useState<SalaryExtras>({
    allowanceName: "役職手当",
    allowanceAmount: 0,
    residentTax: residentTaxFor(staff, year, month), // この月に支給する給与の分（年度ごとの額。utils/residentTax.ts）
    prefecture: Master.toKenpoPrefName(staff.prefecture) ?? "京都",
    dependents: Number(staff.dependents) || 0,
    customItems: [],
  });

  // ヘルパー関数: 時間のフォーマット
  const fmtH = (num: number) => {
    const h = Math.floor(num);
    const m = Math.round((num - h) * 60);
    return `${h}:${String(m).padStart(2, '0')}`;
  };

  // カスタム項目の読み込み
  useEffect(() => {
    const load = async () => {
      if (!db) return;
      try {
        const items = await loadCustomItems(db, staff.id);
        setExtras(p => ({ ...p, customItems: items }));
      } catch (e) {
        console.error("customItems 読み込みエラー:", e);
      }
    };
    load();
  }, [db, staff.id]);

  // 源泉所得税の計算方法と社会保険料の徴収（給与規定グループの設定）を読み込む
  // 翌月徴収で退職する月の給与は、当月払いのグループなら（この後に給与を払わないので）退職した月の分も引くのを初めの値にする
  useEffect(() => {
    const loadGroupSettings = async () => {
      if (!db) return;
      try {
        const rows = await db.select(
          "SELECT tax_calc_method, social_ins_collection, is_next_month, proration_method FROM payroll_groups WHERE id = ?",
          [staff.payroll_group_id || 1]
        ) as { tax_calc_method?: string; social_ins_collection?: string; is_next_month?: number; proration_method?: string }[];
        const method = rows?.[0]?.tax_calc_method === "densanki" ? "densanki" : "table";
        setExtras(p => ({
          ...p,
          taxMethod: method,
          socialInsCollection: toSocialInsCollection(rows?.[0]?.social_ins_collection),
          collectRetirementMonth: Number(rows?.[0]?.is_next_month) !== 1,
          prorationMethod: toProrationMethod(rows?.[0]?.proration_method),
        }));
      } catch (e) {
        console.error("給与規定グループの設定の読み込みエラー:", e);
      }
    };
    loadGroupSettings();
  }, [db, staff.payroll_group_id]);

  // 定額減税（令和6年6月〜）：その人の減税額の合計から、前の月までの確定済みの給与で差し引いた額を引いた残り
  // ※ 前の月の給与を確定してから次の月を確定すること（確定した額をもとに繰り越すため）
  const flatTaxTotal = flatTaxReductionTotal(staff.flat_tax_reduction_persons, staff.join_date, year, month, toTaxColumn(staff.tax_column));
  useEffect(() => {
    const loadFlatTaxReduction = async () => {
      if (!db || flatTaxTotal === 0) {
        setExtras(p => ({ ...p, flatTaxReductionRemaining: 0 }));
        return;
      }
      try {
        const rows = await db.select(
          "SELECT COALESCE(SUM(flat_tax_reduction), 0) AS used FROM salary_results WHERE staff_id = ? AND target_year = ? AND target_month < ?",
          [staff.id, year, month]
        ) as { used: number }[];
        const used = Number(rows?.[0]?.used) || 0;
        setExtras(p => ({ ...p, flatTaxReductionRemaining: Math.max(0, flatTaxTotal - used) }));
      } catch (e) {
        console.error("定額減税の読み込みエラー:", e);
      }
    };
    loadFlatTaxReduction();
  }, [db, staff.id, year, month, flatTaxTotal]);

  // 年末調整の過不足額：この月に支払う給与で精算すると決めた年末調整があれば、その過不足額を載せる
  // （精算する給与を決めていなければ、その年の12月に支払う給与で精算する）
  const [yearEndYear, setYearEndYear] = useState<number | null>(null);
  useEffect(() => {
    const loadYearEnd = async () => {
      if (!db) return;
      try {
        const rows = await db.select(
          `SELECT year, result FROM year_end_adjustments
           WHERE staff_id = ? AND COALESCE(settle_year, year) = ? AND COALESCE(settle_month, 12) = ?`,
          [staff.id, year, month]
        ) as { year: number; result: string | null }[];
        const row = rows?.[0];
        let difference = 0;
        try { difference = row?.result ? Number(JSON.parse(row.result).difference) || 0 : 0; } catch { difference = 0; }
        setYearEndYear(row ? Number(row.year) : null);
        setExtras(p => ({ ...p, yearEndSettlement: difference }));
      } catch (e) {
        console.error("年末調整の読み込みエラー:", e);
      }
    };
    loadYearEnd();
  }, [db, staff.id, year, month]);

  // 給与計算
  const salary = useMemo(
    () => calculateSalary(staff, attendanceData, extras, year, month, companySettings),
    [staff, attendanceData, extras, year, month, companySettings]
  );

  const wageLabel = staff.wage_type === "monthly" ? "月給制" : staff.wage_type === "daily" ? "日給制" : "時給制";
  // 給与項目は、計算した額（固定の支給項目は日割りした額）で出す
  const customEarningItems = salary.customEarningLines;
  const customDeductionItems = salary.customDeductionLines;
  // 1年間の所定労働日数（給与の計算期間の終わりの日の年。従業員画面と同じく、会社カレンダーから数える）
  // 残業代の時給（1年間における1か月平均所定労働時間で割る）と、最低賃金のチェックに使う
  // undefined：読み込み中（この間は確定しない） / null：読み込めなかった（その月の所定労働日数で計算する）
  // 給与の計算期間（給与一覧から開いたときは締日で区切った期間。わからなければその月の1日〜末日）
  const periodEnd: string = staff.periodEnd || `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
  const periodStart: string = staff.periodStart || `${year}-${String(month).padStart(2, '0')}-01`;
  const dailyHours = Number(staff.scheduled_work_hours) || 0;
  // 会社カレンダーから、1年間の所定労働日数と、計算期間の所定労働日数・そのうち在籍した日の所定労働日数（日割り）を数える
  const [calendarCtx, setCalendarCtx] = useState<CalendarContext | null>(null);
  useEffect(() => {
    let cancelled = false;
    setExtras(p => ({ ...p, annualWorkDays: undefined }));
    (async () => {
      if (!db) return;
      let days: number | null = null;
      let periodWorkDays: number | null = null;
      let employedWorkDays: number | null = null;
      let ctx: CalendarContext | null = null;
      try {
        ctx = await loadCalendarContext(db, staff);
        const y = periodEnd.slice(0, 4);
        days = countPrescribedWorkDays(ctx, `${y}-01-01`, `${y}-12-31`);
        periodWorkDays = countPrescribedWorkDays(ctx, periodStart, periodEnd);
        const from = staff.join_date && staff.join_date > periodStart ? staff.join_date : periodStart;
        const to = staff.retirement_date && staff.retirement_date < periodEnd ? staff.retirement_date : periodEnd;
        employedWorkDays = countPrescribedWorkDays(ctx, from, to);
      } catch (e) {
        console.error("会社カレンダー（所定労働日数）の読み込みエラー:", e);
      }
      if (!cancelled) {
        setCalendarCtx(ctx);
        setExtras(p => ({ ...p, annualWorkDays: days, period: { start: periodStart, end: periodEnd }, periodWorkDays, employedWorkDays }));
      }
    })();
    return () => { cancelled = true; };
  }, [db, staff.calendar_pattern_id, staff.work_days, staff.join_date, staff.retirement_date, periodStart, periodEnd]);

  // 週40時間の累計に足す、前の計算期間の日（計算期間の初めの日がある週のうち、初めの日より前の日）の確定した勤怠
  // undefined：読み込み中（この間は確定しない）
  const weekStartDay = Number(companySettings?.week_start_day ?? 0);
  useEffect(() => {
    let cancelled = false;
    setExtras(p => ({ ...p, weekCarryOver: undefined }));
    (async () => {
      if (!db) return;
      let rows: NonNullable<SalaryExtras['weekCarryOver']> = [];
      try {
        rows = await loadWeekCarryOver(db, staff.id, periodStart, weekStartDay);
      } catch (e) {
        console.error("前の計算期間の勤怠（週40時間）の読み込みエラー:", e);
      }
      if (!cancelled) setExtras(p => ({ ...p, weekCarryOver: rows }));
    })();
    return () => { cancelled = true; };
  }, [db, staff.id, periodStart, weekStartDay]);

  // 会社カレンダーで休みの日に「出勤」で入れて働いた日。「出勤」の日は所定労働日として計算する
  // （所定労働時間の分は月給・日給に入っているとみなし、週40時間を超えても割増分だけを払う）ので、所定休日の出勤なら「所定休日出勤」にする
  const workOnCalendarHolidays = useMemo(() => !calendarCtx || staff.wage_type === 'hourly' ? [] : attendanceData
    .filter(r => (r.work_type || 'normal') === 'normal' && (Number(r.work_hours) || 0) > 0
      && !isPrescribedWorkDay(new Date(`${r.work_date}T00:00:00`), calendarCtx))
    .map(r => String(r.work_date))
    .sort(), [attendanceData, calendarCtx, staff.wage_type]);

  // 最低賃金のチェック：基本給を時間あたりにして、給与の計算期間の終わりの日の最低賃金と比べる（詳しくは utils/minimumWage.ts）
  // 月給は「1年間における1月平均所定労働時間」で割る
  const monthlyAverageHours = extras.annualWorkDays ? extras.annualWorkDays * dailyHours / 12 : null;
  const minimumWageCheck = checkMinimumWage(
    Master.toKenpoPrefName(staff.prefecture),
    periodEnd,
    baseWagePerHour(staff.wage_type, Number(staff.base_wage) || 0, dailyHours, monthlyAverageHours)
  );

  // 勤怠を確定したときの時給・日給が、基本給の履歴のこの月の値と違う日の数（昇給などを履歴に入れている人だけ）
  // 給与は勤怠に残した時給・日給で計算するので、履歴の値で計算し直すなら勤怠を確定し直す
  const wageMismatchDays = staff.wage_type !== 'monthly' && hasWageChanges(staffRecord)
    ? attendanceData.filter(r => Number(r.actual_base_wage) > 0 && Number(r.actual_base_wage) !== Number(staff.base_wage)).length
    : 0;

  // 明細の注記に出す料率の年度（この給与から引いた社会保険料の月のもの。翌月徴収なら前月の分）
  const [insYear, insMonth] = (salary.socialInsMonths[0] ?? `${year}-${month}`).split('-').map(Number);
  const insMaster = Master.getInsuranceMaster(insYear, insMonth);
  // 雇用保険の料率は、支払った月のもの
  const empInsMaster = Master.getInsuranceMaster(year, month);
  // 料率・税額表が登録されていない年月を、近いもので計算しているときの注意
  const rateWarnings = [...new Set([...insMaster.WARNINGS, ...empInsMaster.WARNINGS, ...Master.getTaxMasterWarnings(year)])];

  // 行数計算ロジック
  const earningItemsCount = 1
    + (salary.absenceDeduction > 0 ? 1 : 0)
    + (salary.statutoryOvertimePay > 0 ? 1 : 0)
    + (salary.fixedOvertimeAllowance > 0
      ? 1 + (salary.fixedOvertimeExcess > 0 ? 1 : 0)
      : (salary.standardOvertimePay > 0 ? 1 : 0) + (salary.highOvertimePay > 0 ? 1 : 0))
    + (salary.holidayWorkPay > 0 ? 1 : 0)
    + (salary.paidLeavePay > 0 ? 1 : 0)
    + 1 + 1 + 1 + customEarningItems.length;
  const deductionItemsCount = 6 + (salary.childSupport > 0 ? 1 : 0) + customDeductionItems.length;
  const targetRows = Math.max(earningItemsCount, deductionItemsCount, 10);

  // 保存処理
  const handleSaveResult = async () => {
    if (!db || !staff) return;
    if (extras.annualWorkDays === undefined || extras.socialInsCollection === undefined || extras.prorationMethod === undefined
      || extras.weekCarryOver === undefined) {
      alert("給与規定グループの設定・1年間の所定労働日数・前の計算期間の勤怠（週40時間）を読み込んでいます。少し待ってから、もう一度確定してください。");
      return;
    }
    const result = await saveSalaryResult(db, staff.id, year, month, salary, staff);
    if (result.success) {
      setIsSaved(true);
      await writeLog(db, "INFO", "salary", `${staff.name}さん（${staff.id}）の${year}年${month}月分の給与を確定しました`);
      alert(`${staff.name}さん ${year}年${month}月分の給与を確定しました。\nこの月の勤怠は、確定を取り消すまで変えられません。`);
    } else {
      alert("保存に失敗しました: " + result.error);
    }
  };

  /**
   * 給与の確定を取り消す（確定した結果を消す）。取り消すと、この月の勤怠を直せるようになる（勤怠の画面のロックが外れる）
   * 確定した給与は、年末調整・源泉徴収票・算定基礎・月変・住民税の納入などの集計に使うので、直したら確定し直してもらう
   */
  const handleCancelResult = async () => {
    if (!db || !staff) return;
    const ok = await ask(
      `${staff.name}さんの${year}年${month}月分の給与の確定を取り消します。\n\n` +
      `取り消すと、この月の勤怠を直せるようになります。確定した給与は、年末調整・源泉徴収票・算定基礎・月変・住民税の納入などの集計から外れるので、直したら必ずもう一度確定してください。\n\n` +
      `よろしいですか？`,
      { title: "給与の確定を取り消す", kind: "warning" }
    );
    if (!ok) return;
    try {
      await db.execute(
        "DELETE FROM salary_results WHERE staff_id = ? AND target_year = ? AND target_month = ?",
        [staff.id, year, month]
      );
      setIsSaved(false);
      await writeLog(db, "INFO", "salary", `${staff.name}さん（${staff.id}）の${year}年${month}月分の給与の確定を取り消しました`);
      alert(`${staff.name}さん ${year}年${month}月分の給与の確定を取り消しました。勤怠を直したら、もう一度確定してください。`);
    } catch (e) {
      console.error("給与の確定の取り消しに失敗しました:", e);
      alert("確定を取り消せませんでした（確定したままです）: " + e);
    }
  };

  return {
    monthStaff: staff,
    wageMismatchDays,
    salary,
    extras,
    setExtras,
    isSaved,
    handleSaveResult,
    handleCancelResult,
    wageLabel,
    customEarningItems,
    customDeductionItems,
    earningItemsCount,
    deductionItemsCount,
    targetRows,
    insMaster,
    rateWarnings,
    empInsMaster,
    minimumWageCheck,
    workOnCalendarHolidays,
    yearEndYear,
    flatTaxTotal,
    fmtH
  };
}