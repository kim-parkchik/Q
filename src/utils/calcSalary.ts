/**
 * calcSalary.ts — 給与計算エンジン（2026年度版）
 *
 * 残業計算の法的根拠:
 *  - 1日8時間超 → 法定外残業（割増25%必須）
 *  - 週40時間超 → 法定外残業（割増25%必須）
 *  - 所定時間超〜8時間 → 法定内残業（割増義務なし、基本単価のみ）
 *  - 上記どちらかで月60時間超の分 → 割増50%必須
 */
import dayjs from 'dayjs';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import { applyRounding } from './payrollUtils';
import { 
  parseToDayjs, 
  getNightMinutesInPeriod, 
  getWeekKey
} from './timeUtils';
import * as Master from '../constants';

// プラグインの有効化
dayjs.extend(isSameOrAfter);

export interface SalaryExtras {
  allowanceName: string;
  allowanceAmount: number;
  residentTax: number;
  prefecture: string;
  dependents: number;
  customItems: { name: string; amount: number; type: 'earning' | 'deduction' }[];
}

export interface SalaryResult {
  workDays: number;
  totalWorkHours: number;
  totalOvertimeHours: number;     // 法定外残業時間合計（週40h超含む）
  totalNightHours: number;
  totalStatutoryOvertimeHours: number; // 法定内残業時間（所定超〜8h）
  standardPremiumHours: number; // ★追加：標準割増（25%）の対象時間
  highPremiumHours: number;     // ★追加：高率割増（50%）の対象時間
  basePay: number;
  absenceDeduction: number;
  statutoryOvertimePay: number;   // 法定内残業代（割増なし）
  standardOvertimePay: number;
  highOvertimePay: number;
  nightPay: number;
  commutePay: number;
  allowanceAmount: number;
  customEarnings: number;
  totalEarnings: number;
  healthInsurance: number;
  nursingInsurance: number;
  welfarePension: number;
  empInsurance: number;
  incomeTax: number;
  residentTax: number;
  customDeductions: number;
  totalDeductions: number;
  netPay: number;
  isNursingCareTarget: boolean;
  hyojunHoshu: number;
}

export const PREFECTURES = Object.keys(Master.INSURANCE_2026.KENPO_RATES);

export const getHyojunHoshu = (monthly: number): number => {
  for (const [lo, hi, std] of Master.INSURANCE_2026.HYOJUN_TABLE) {
    if (monthly >= lo && monthly < hi) return std;
  }
  return Master.INSURANCE_2026.HYOJUN_TABLE[Master.INSURANCE_2026.HYOJUN_TABLE.length - 1][2];
};

const getGensenTax = (taxBase: number, dependents: number): number => {
  const dep = Math.min(Math.max(0, dependents), 7);
  if (taxBase >= 1000000) {
    const over = taxBase - 1000000;
    const base = 43180 + Math.floor(over * 0.45);
    const ded  = [0,2110,4140,6180,8210,10250,12280,14320][dep];
    return Math.max(0, base - ded);
  }
  for (const row of Master.TAX_2026.GENSEN_TAX_TABLE) {
    const [lo, hi, ...taxes] = row;
    if (taxBase >= lo && taxBase < hi) return taxes[dep] ?? 0;
  }
  return 0;
};

// 介護保険対象判定
export const checkNursingCare = (birthday: string, year: number, month: number): boolean => {
  if (!birthday) return false;
  
  const birthDate = dayjs(birthday);
  const targetDate = dayjs(new Date(year, month - 1, 1));
  
  // 40歳に達する月の初日
  const reach40 = birthDate.add(Master.INSURANCE_2026.NURSING_CARE_START_AGE, 'year').startOf('month');
  // 65歳に達する月の初日
  const reach65 = birthDate.add(Master.INSURANCE_2026.NURSING_CARE_END_AGE, 'year').startOf('month');

  return targetDate.isSameOrAfter(reach40) && targetDate.isBefore(reach65);
};

/* --- 外部から呼び出すメインロジック --- */

/**
 * 総労働時間と深夜時間を同時に計算する
 */
export const calcDetailedDiff = (inT: string, outT: string, bStart: string, bEnd: string, outV?: string, returnV?: string) => {
  const isValidTime = (t?: string) => t && t !== "" && t !== "--:--" && t.length >= 5;

  if (!isValidTime(inT) || !isValidTime(outT)) {
    return { total: NaN, night: NaN };
  }

  const start = parseToDayjs(inT);
  let end = parseToDayjs(outT);
  
  // 深夜02:00 〜 06:00 のような場合、end は start より後なのでそのまま。
  // 22:00 〜 02:00 のような場合のみ、end を翌日にする。
  if (end.isBefore(start)) {
    end = end.add(1, 'day');
  }

  let totalMin = end.diff(start, 'minute');
  // この nightMin の計算に修正した getNightMinutesInPeriod を使う
  let nightMin = getNightMinutesInPeriod(start, end);

  // 休憩時間の控除
  const deduct = (sStr?: string, eStr?: string) => {
    // 1. バリデーション
    if (!isValidTime(sStr) || !isValidTime(eStr)) return;

    // 2. Dayjsオブジェクトに変換（変数名を引数と明確に分ける）
    const ds = parseToDayjs(sStr!);
    let de = parseToDayjs(eStr!);

    // 3. 日またぎ補正（休憩終了が開始より前なら翌日扱い）
    if (de.isBefore(ds)) {
      de = de.add(1, 'day');
    }

    // 4. 計算と減算
    const diffMin = de.diff(ds, 'minute');
    totalMin -= diffMin;
    nightMin -= getNightMinutesInPeriod(ds, de);
  };

  deduct(bStart, bEnd);
  deduct(outV, returnV);

  return {
    total: Math.round((totalMin / 60) * 1000) / 1000,
    night: Math.round((nightMin / 60) * 1000) / 1000
  };
};

/**
 * 給与計算結果をDBに保存する（確定処理）
 */
export const saveSalaryResult = async (
  db: any, 
  staffId: string, 
  year: number, 
  month: number, 
  result: SalaryResult,
  staffMaster: any // その時の基本給などのスナップショット用
) => {
  const sql = `
    INSERT INTO salary_results (
      staff_id, target_year, target_month,
      applied_base_wage, applied_dependents,
      total_work_hours, total_overtime_hours, total_night_hours,
      standard_overtime_hours, high_overtime_hours,
      standard_overtime_pay, high_overtime_pay, statutory_overtime_pay,
      total_earnings, taxable_amount,
      health_insurance, nursing_insurance, welfare_pension, emp_insurance,
      social_ins_total, income_tax, resident_tax, net_pay
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(staff_id, target_year, target_month) DO UPDATE SET
      applied_base_wage = excluded.applied_base_wage,
      applied_dependents = excluded.applied_dependents,
      total_work_hours = excluded.total_work_hours,
      total_overtime_hours = excluded.total_overtime_hours,
      standard_overtime_hours = excluded.standard_overtime_hours,
      high_overtime_hours = excluded.high_overtime_hours,
      total_earnings = excluded.total_earnings,
      net_pay = excluded.net_pay,
      processed_at = DATETIME('now', 'localtime');
  `;

  const params = [
    staffId, year, month,
    staffMaster.base_wage, staffMaster.dependents,
    result.totalWorkHours, result.totalOvertimeHours, result.totalNightHours,
    result.standardPremiumHours, result.highPremiumHours,
    result.standardOvertimePay, result.highOvertimePay, result.statutoryOvertimePay,
    result.totalEarnings, (result.totalEarnings - result.commutePay), // 課税対象額（通勤費除く）
    result.healthInsurance, result.nursingInsurance, result.welfarePension, result.empInsurance,
    (result.healthInsurance + result.nursingInsurance + result.welfarePension + result.empInsurance),
    result.incomeTax, result.residentTax, result.netPay
  ];

  try {
    // db.run ではなく db.execute を使います
    await db.execute(sql, params); 
    return { success: true };
  } catch (error) {
    console.error("Failed to save salary result:", error);
    return { success: false, error };
  }
};

export const calculateSalary = (
  staff: any,
  attendanceData: any[],
  extras: SalaryExtras,
  targetYear: number,
  targetMonth: number,
  companySettings: any,
): SalaryResult => {

  const weekStartDay: number = companySettings?.week_start_day ?? 0; // デフォルト日曜
  const scheduledHours = Number(staff.scheduled_work_hours) || 8;

  // ── 勤怠集計 ──────────────────────────────────────────────
  // ── 1. まず、確定データの中から「欠勤」と「全休」の日数を正確に把握する ──
  // これにより、workDays(出勤日) と absentDays(欠勤日) を明確に分けます
  const actualAbsentDays = attendanceData.filter(row => row.work_type === 'absent').length;
  const paidFullDays = attendanceData.filter(row => row.work_type === 'paid_full').length;
  
  // 出勤日数は、欠勤と全休（有給）を除いた純粋な稼働日とする
  const workDays = attendanceData.length - actualAbsentDays - paidFullDays;
  // const workDays = attendanceData.length;
  let totalWorkHours = 0, totalNightHours = 0;
  let basePay = 0, standardOvertimePay = 0, highOvertimePay = 0, nightPay = 0;
  let statutoryOvertimePay = 0; // 法定内残業代（割増なし）
  let absenceDeduction = 0;
  let totalOvertimeHours = 0;       // 法定外残業（割増対象）の累計
  let totalStatutoryOvertimeHours = 0; // 法定内残業の累計
  let standardPremiumHours = 0; // ★追加
  let highPremiumHours = 0;     // ★追加

  // ── 週40時間超チェック用：週ごとの実労働時間を集計 ─────────
  // 週キー → 実労働時間合計
  const weeklyHours: Record<string, number> = {};
  for (const row of attendanceData) {
    const wk = getWeekKey(row.work_date, weekStartDay);
    weeklyHours[wk] = (weeklyHours[wk] ?? 0) + (Number(row.work_hours) || 0);
  }
  // 週ごとに「40時間を超えた分」を法定外残業として事前計算
  // 週40h超の時間数（日8h未満でも発生しうる）
  const weeklyOvertimeMap: Record<string, number> = {};
  for (const [wk, hours] of Object.entries(weeklyHours)) {
    weeklyOvertimeMap[wk] = Math.max(0, hours - Master.LEGAL_WORK_HOURS_WEEKLY);
  }

  if (staff.wage_type === 'monthly') {
    // DBの「base_wage」と JSの「baseWage」の両方に対応させる
    const rawWage = staff.base_wage ?? staff.baseWage ?? 0;
    const monthlyWage = Number(rawWage);
    basePay = monthlyWage;

    const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
    let weekends = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(targetYear, targetMonth - 1, d).getDay();
      if (dow === 0 || dow === 6) weekends++;
    }
    
    // 所定労働日数の確定
    const prescribedDays = Number(staff.monthly_work_days) || (daysInMonth - weekends);
    
    // 時給単価の計算（残業代などのベース）
    const hourlyRate = (prescribedDays > 0 && scheduledHours > 0)
      ? monthlyWage / (prescribedDays * scheduledHours)
      : 0;

    // ── 【ここを修正】 欠勤控除 ──
    // 先ほど算出した actualAbsentDays を使ってダイレクトに計算
    absenceDeduction = actualAbsentDays > 0
      ? Math.floor((monthlyWage / prescribedDays) * actualAbsentDays)
      : 0;

    // 週40h超の残業時間を日付→週のマップで追跡
    // 各週で「すでに法定外としてカウントした時間」を管理
    const weeklyLegalOvertimeUsed: Record<string, number> = {};

    // 日付順にソートして処理（週40h超判定の正確性のため）
    const sorted = [...attendanceData].sort((a, b) => a.work_date.localeCompare(b.work_date));

    for (const row of sorted) {
      const h = Number(row.work_hours) || 0;
      const n = Number(row.night_hours) || 0;
      const type = row.work_type || 'normal';
      totalWorkHours += h;
      totalNightHours += n;

      if (type === 'statutory_holiday') {
        // ── 【法定休日】（日曜日など） ──────────────────────
        // 1. 休日出勤手当 (1.35倍) ※60h超のカウントには含めない
        standardOvertimePay += hourlyRate * Master.HOLIDAY_WORK_RATE * h;

        // 2. 休日深夜割増 (+0.25倍加算 = 計1.60倍)
        // すでに下の nightPay で 0.25 分が計算されるため、差分は不要
        // (もし1.6倍として別に管理したい場合はここで調整)

      } else {
        // ── 【平日 または 所定休日】（土曜日など） ──────────
        
        // 1. 法定外残業の判定（日8h超 または 週40h超）
        const legalOvertimeFromDay = Math.max(0, h - Master.LEGAL_WORK_HOURS_DAILY);
        const wk = getWeekKey(row.work_date, weekStartDay);
        const used = weeklyLegalOvertimeUsed[wk] ?? 0;
        const weekTotal = weeklyHours[wk] ?? 0;
        const weekOverflowFromDay = Math.max(0,
            Math.min(h, Math.max(0, weekTotal - Master.LEGAL_WORK_HOURS_WEEKLY)) - used
        );
        const weekOnlyOvertime = Math.max(0, weekOverflowFromDay - legalOvertimeFromDay);
        weeklyLegalOvertimeUsed[wk] = used + weekOnlyOvertime;

        const legalOvertimeToday = legalOvertimeFromDay + weekOnlyOvertime;

        // 2. 法定内残業（1.0倍）の計算
        const currentScheduled = (type === 'normal') ? scheduledHours : 0;
        const effectiveStatutoryOvertime = Math.max(0, h - currentScheduled - legalOvertimeToday);
        
        totalStatutoryOvertimeHours += effectiveStatutoryOvertime;
        statutoryOvertimePay += hourlyRate * effectiveStatutoryOvertime;

        // 3. 法定外残業代（1.25倍 / 1.5倍）の累積
        if (legalOvertimeToday > 0) {
          // 月60時間（Master.OVERTIME_PREMIUM_LIMIT_HOURS）を超えているか判定
          const canFitInStandard = Math.max(0, Master.OVERTIME_PREMIUM_LIMIT_HOURS - totalOvertimeHours);
          const standardHoursToday = Math.min(legalOvertimeToday, canFitInStandard);
          const highHoursToday = Math.max(0, legalOvertimeToday - standardHoursToday);

          // 1.25倍（または25%増）の計算
          standardOvertimePay += hourlyRate * Master.OVERTIME_RATE * standardHoursToday;
          // 1.50倍（または50%増）の計算
          highOvertimePay += hourlyRate * Master.OVERTIME_PREMIUM_RATE * highHoursToday;

          standardPremiumHours += standardHoursToday; 
          highPremiumHours += highHoursToday;
          totalOvertimeHours += legalOvertimeToday; // ここで60hカウントを蓄積
        }
      }

      // ── 【共通：深夜手当】 ────────────────────────────
      // 平日、所定休日、法定休日、いずれの場合も「深夜時間」があれば25%増(0.25)を加算
      // 法定休日の場合：1.35 + 0.25 = 1.60
      // 平日残業(60h内)の場合：1.25 + 0.25 = 1.50
      // 平日残業(60h超)の場合：1.50 + 0.25 = 1.75
      nightPay += hourlyRate * Master.NIGHT_SHIFT_RATE * n;
    }

  } else {
    // ── 時給制 ────────────────────────────────────────────
    const weeklyLegalOvertimeUsed: Record<string, number> = {};
    const sorted = [...attendanceData].sort((a, b) => a.work_date.localeCompare(b.work_date));

    for (const row of sorted) {
      const h = Number(row.work_hours) || 0;
      const n = Number(row.night_hours) || 0;
      const wage = Number(row.actual_base_wage) || Number(staff.base_wage) || 0;
      totalWorkHours += h;
      totalNightHours += n;

      basePay += wage * h;

      // 1日8h超
      const legalOvertimeFromDay = Math.max(0, h - Master.LEGAL_WORK_HOURS_DAILY);

      // 週40h超
      const wk = getWeekKey(row.work_date, weekStartDay);
      const used = weeklyLegalOvertimeUsed[wk] ?? 0;
      const weekTotal = weeklyHours[wk] ?? 0;
      const weekOverflowFromDay = Math.max(0,
        Math.min(h, Math.max(0, weekTotal - Master.LEGAL_WORK_HOURS_WEEKLY)) - used
      );
      const weekOnlyOvertime = Math.max(0, weekOverflowFromDay - legalOvertimeFromDay);
      weeklyLegalOvertimeUsed[wk] = used + weekOnlyOvertime;

      const legalOvertimeToday = legalOvertimeFromDay + weekOnlyOvertime;

      if (legalOvertimeToday > 0) {
        // ★ 1. 名前が被らないように「今日（その行）の時間」として計算
        const standardHoursToday = Math.max(0, Math.min(legalOvertimeToday, Master.OVERTIME_PREMIUM_LIMIT_HOURS - totalOvertimeHours));
        const highHoursToday = Math.max(0, legalOvertimeToday - standardHoursToday);

        // ★ 2. 金額を累積
        standardOvertimePay += wage * (Master.OVERTIME_RATE - 1) * standardHoursToday;
        highOvertimePay += wage * (Master.OVERTIME_PREMIUM_RATE - 1) * highHoursToday;

        // ★ 3. 外側の変数（合計時間）に足し込む
        standardPremiumHours += standardHoursToday; 
        highPremiumHours += highHoursToday;
        totalOvertimeHours += legalOvertimeToday;
      }
      nightPay += wage * Master.NIGHT_SHIFT_RATE * n;
    }
  }

  // ── 通勤手当・任意手当 ──────────────────────────────────────
  const commutePay = staff.commute_type === 'daily'   ? (Number(staff.commute_amount) || 0) * workDays
                  : staff.commute_type === 'monthly' ? (Number(staff.commute_amount) || 0) : 0;
  const allowanceAmount = Number(extras.allowanceAmount) || 0;

  const customItems = extras.customItems ?? [];
  const customEarnings   = customItems.filter(i => i.type === 'earning').reduce((s, i) => s + i.amount, 0);
  const customDeductions = customItems.filter(i => i.type === 'deduction').reduce((s, i) => s + i.amount, 0);

  // ── 支給合計 ──────────────────────────────────────────────
  // const premiums = standardOvertimePay + highOvertimePay + nightPay;
  // const roundedPremiums = applyRounding(premiums, companySettings?.round_overtime || 'round');
  // const roundedStatutory = applyRounding(statutoryOvertimePay, companySettings?.round_overtime || 'round');
  const premiums = (standardOvertimePay || 0) + (highOvertimePay || 0) + (nightPay || 0);
  const roundedPremiums = applyRounding(premiums, companySettings?.round_overtime || 'round');
  const roundedStatutory = applyRounding(statutoryOvertimePay || 0, companySettings?.round_overtime || 'round');

  // const totalEarnings = Math.floor(basePay)
  //                     - absenceDeduction
  //                     + roundedStatutory   // 法定内残業代
  //                     + roundedPremiums    // 法定外割増
  //                     + commutePay
  //                     + allowanceAmount
  //                     + customEarnings;

  const totalEarnings = Math.floor(basePay || 0)
                    - (absenceDeduction || 0)
                    + (roundedStatutory || 0)
                    + (roundedPremiums || 0)
                    + (commutePay || 0)
                    + (allowanceAmount || 0)
                    + (customEarnings || 0);
  // 念のためログを出して確認
  console.log("CHECK totalEarnings:", totalEarnings);

  // ── 社会保険料 ──────────────────────────────────────────────
  // 1. 標準報酬月額の確定
  const dbHyojun = Number(staff.standard_remuneration) || 0;
  let hyojunHoshu: number;
  if (dbHyojun > 0) {
    hyojunHoshu = dbHyojun;
  } else {
    const reportable = Math.floor(basePay + standardOvertimePay + highOvertimePay + nightPay + statutoryOvertimePay + commutePay);
    hyojunHoshu = getHyojunHoshu(reportable);
  }

  // 2. 料率の取得と計算
  const nursingTarget = checkNursingCare(staff.birthday || '', targetYear, targetMonth);
  const prefRates = Master.INSURANCE_2026.KENPO_RATES[extras.prefecture] ?? Master.INSURANCE_2026.KENPO_RATES["京都"];
  const sInsType = companySettings?.round_social_ins || 'floor';

  // 健康保険（介護なし/ありをインデックスで切り替え）
  // [0]が介護なし本人, [1]が介護なし総額, [2]が介護あり本人, [3]が介護あり総額
  const healthInsRate = prefRates[0] ?? 0; 
    
  const healthInsurance = applyRounding(
    (Math.min(hyojunHoshu, Master.INSURANCE_2026.KENPO_MAX_HYOJUN) * healthInsRate) / 100, 
    sInsType
  );

  // 介護保険料（nursingTarget が true の時だけ計算）
  let nursingInsurance = 0;
  if (nursingTarget) {
    // Master.KENPO_CARE_RATE[0] (0.80) を使用
    const careRate = Master.INSURANCE_2026.KENPO_CARE_RATE[0] ?? 0;
    nursingInsurance = applyRounding(
      (Math.min(hyojunHoshu, Master.INSURANCE_2026.KENPO_MAX_HYOJUN) * careRate) / 100, 
      sInsType
    );
  }

  // 厚生年金
  // [0]が本人分, [1]が総額
  const pensionHyojun = Math.max(Master.INSURANCE_2026.PENSION_MIN_HYOJUN, Math.min(hyojunHoshu, Master.INSURANCE_2026.PENSION_MAX_HYOJUN));
  const welfarePension = applyRounding((pensionHyojun * Master.INSURANCE_2026.PENSION_RATE[0]) / 100, sInsType);

  // 雇用保険
  // [0]が本人分, [1]が総額
  // staff.employment_insurance_type (文字列) を取得。未設定なら 'general'
  const empInsKey = (staff.employment_insurance_type as Master.EmpInsType) || 'general';
  // マスターデータから該当する業種の配列を取得
  // 万が一、変な文字列が入っていても 'general' を参照するようにガード
  const empRates = Master.INSURANCE_2026.LABOR_INSURANCE_RATES[empInsKey] || Master.INSURANCE_2026.LABOR_INSURANCE_RATES.general;
  // [0] が本人負担分
  const empInsRate = empRates[0];
  // 計算実行
  const empInsurance = applyRounding(
    totalEarnings * empInsRate, 
    companySettings?.round_emp_ins || 'round'
  );

  // ── 税金・最終計算 ──────────────────────────────────────────────
  const socialTotal = healthInsurance + nursingInsurance + welfarePension + empInsurance;
  const incomeTax = getGensenTax(Math.max(0, totalEarnings - socialTotal), Number(extras.dependents) || 0);
  const residentTax = Number(extras.residentTax) || 0;
  const totalDeductions = socialTotal + incomeTax + residentTax + customDeductions;


  return {
    // --- 勤怠データ ---
    workDays, 
    totalWorkHours, 
    totalOvertimeHours, 
    totalNightHours,
    totalStatutoryOvertimeHours,
    standardPremiumHours, 
    highPremiumHours,     

    // --- 支給額 (Earnings) ---
    basePay: Math.floor(basePay),
    absenceDeduction,
    statutoryOvertimePay: Math.floor(statutoryOvertimePay),
    standardOvertimePay: Math.floor(standardOvertimePay),
    highOvertimePay: Math.floor(highOvertimePay),
    nightPay: Math.floor(nightPay),
    commutePay, 
    allowanceAmount, 
    customEarnings, 
    totalEarnings,

    // --- 控除額 (Deductions) ---
    healthInsurance, 
    nursingInsurance, 
    welfarePension,
    empInsurance, 
    incomeTax, 
    residentTax, 
    customDeductions,
    totalDeductions,

    // --- 最終結果・その他情報 ---
    netPay: totalEarnings - totalDeductions,
    isNursingCareTarget: nursingTarget,
    hyojunHoshu,
  };
};
