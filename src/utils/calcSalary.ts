/**
 * calcSalary.ts — 給与計算エンジン（2026年度版）
 *
 * 残業計算の法的根拠:
 *  - 1日8時間超 → 法定外残業（割増25%必須）
 *  - 週40時間超 → 法定外残業（割増25%必須）
 *  - 所定時間超〜8時間 → 法定内残業（割増義務なし、基本単価のみ）
 *  - 上記どちらかで月60時間超の分 → 割増50%必須
 */
import { applyRounding } from './payrollUtils';
import * as Master from '../constants/salaryMaster2026';


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

export const PREFECTURES = Object.keys(Master.KENPO_RATES);

export const getHyojunHoshu = (monthly: number): number => {
    for (const [lo, hi, std] of Master.HYOJUN_TABLE) {
        if (monthly >= lo && monthly < hi) return std;
    }
    return Master.HYOJUN_TABLE[Master.HYOJUN_TABLE.length - 1][2];
};

const getGensenTax = (taxBase: number, dependents: number): number => {
    const dep = Math.min(Math.max(0, dependents), 7);
    if (taxBase >= 1000000) {
        const over = taxBase - 1000000;
        const base = 43180 + Math.floor(over * 0.45);
        const ded  = [0,2110,4140,6180,8210,10250,12280,14320][dep];
        return Math.max(0, base - ded);
    }
    for (const row of Master.GENSEN_TAX_TABLE) {
        const [lo, hi, ...taxes] = row;
        if (taxBase >= lo && taxBase < hi) return taxes[dep] ?? 0;
    }
    return 0;
};

export const checkNursingCare = (birthday: string, year: number, month: number): boolean => {
    if (!birthday) return false;
    const b = new Date(birthday);
    const reach40 = new Date(b.getFullYear() + Master.NURSING_CARE_START_AGE, b.getMonth(), b.getDate() - 1);
    const reach65 = new Date(b.getFullYear() + Master.NURSING_CARE_END_AGE, b.getMonth(), b.getDate() - 1);
    const target  = new Date(year, month - 1, 1);
    return (
        target >= new Date(reach40.getFullYear(), reach40.getMonth(), 1) &&
        target <  new Date(reach65.getFullYear(), reach65.getMonth(), 1)
    );
};

/* --- ヘルパー関数（内部のみで使用） --- */

const parseTimeToMinutes = (t: string): number => {
    if (!t || t.length < 5) return 0;
    const [h, m] = t.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return 0;
    return h * 60 + m;
};

const calcNightMinutes = (start: number, end: number): number => {
    const nightStart = 22 * 60; // 22:00
    const nightEnd = 29 * 60;   // 翌5:00
    const overlapStart = Math.max(start, nightStart);
    const overlapEnd = Math.min(end, nightEnd);
    return Math.max(0, overlapEnd - overlapStart);
};

/* --- 外部から呼び出すメインロジック --- */

/**
 * 総労働時間と深夜時間を同時に計算する（詳細版）
 */
export const calcDetailedDiff = (inT: string, outT: string, bStart: string, bEnd: string, outV?: string, returnV?: string) => {
    if (!inT || inT.length < 5 || !outT || outT.length < 5) {
        return { total: "0.000", night: "0.000" };
    }

    let start = parseTimeToMinutes(inT);
    let end = parseTimeToMinutes(outT);
    
    // 日跨ぎ対応：退勤の方が出勤より前なら翌日とみなす
    if (end < start) end += 24 * 60;

    let totalMin = end - start;
    let nightMin = calcNightMinutes(start, end);

    const deduct = (s?: string, e?: string) => {
        if (!s || s.length < 5 || !e || e.length < 5) return;
        let bs = parseTimeToMinutes(s);
        let be = parseTimeToMinutes(e);
        if (be < bs) be += 24 * 60;
        
        totalMin -= (be - bs);
        nightMin -= calcNightMinutes(bs, be);
    };

    deduct(bStart, bEnd);
    deduct(outV, returnV);

    return {
        total: (Math.max(0, totalMin) / 60).toFixed(3),
        night: (Math.max(0, nightMin) / 60).toFixed(3)
    };
};

/**
 * 従来の calcDiff（後方互換性のため残す）
 */
export const calcDiff = (inT: string, outT: string, bStart: string, bEnd: string, outV?: string, returnV?: string): string => {
    // 内部で calcDetailedDiff を呼び出して total だけを返す
    return calcDetailedDiff(inT, outT, bStart, bEnd, outV, returnV).total;
};

/**
 * 小数の時間を「〇時間〇分」の形式に変換する
 * 例: 4.5 -> "4時間30分"
 * 例: 10.667 -> "10時間40分"
 */
export const formatHours = (decimalHours: number): string => {
  // 1. そもそも数値じゃない、または NaN の場合は「0分」と返す
  if (typeof decimalHours !== 'number' || isNaN(decimalHours) || decimalHours <= 0) {
    return "0分";
  }
  
  try {
    const h = Math.floor(decimalHours);
    const m = Math.round((decimalHours - h) * 60);
    
    if (h === 0) return `${m}分`;
    if (m === 0) return `${h}時間`;
    return `${h}時間${m}分`;
  } catch (e) {
    // 万が一ここでエラーが起きても全体を落とさない
    return "計算中...";
  }
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

/**
 * 週番号を返す（週の開始曜日を指定可能）
 * weekStartDay: 0=日曜, 1=月曜, ..., 6=土曜
 */
const getWeekKey = (dateStr: string, weekStartDay: number): string => {
    const d = new Date(dateStr);
    const dow = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    // 週の開始日曜から何日目か（0〜6）
    const daysFromStart = (dow - weekStartDay + 7) % 7;
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - daysFromStart);
    return weekStart.toISOString().split('T')[0]; // 週の最初の日をキーに
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
    const workDays = attendanceData.length;
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
        const monthlyWage = Number(staff.base_wage) || 0;
        basePay = monthlyWage;

        const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
        let weekends = 0;
        for (let d = 1; d <= daysInMonth; d++) {
            const dow = new Date(targetYear, targetMonth - 1, d).getDay();
            if (dow === 0 || dow === 6) weekends++;
        }
        const prescribedDays = Number(staff.monthly_work_days) || (daysInMonth - weekends);
        const hourlyRate = (prescribedDays > 0 && scheduledHours > 0)
            ? monthlyWage / (prescribedDays * scheduledHours)
            : 0;

        // 欠勤控除
        const absentDays = Math.max(0, prescribedDays - workDays);
        absenceDeduction = absentDays > 0
            ? Math.floor((monthlyWage / prescribedDays) * absentDays)
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
    const premiums = standardOvertimePay + highOvertimePay + nightPay;
    const roundedPremiums = applyRounding(premiums, companySettings?.round_overtime || 'round');
    const roundedStatutory = applyRounding(statutoryOvertimePay, companySettings?.round_overtime || 'round');

    const totalEarnings = Math.floor(basePay)
                        - absenceDeduction
                        + roundedStatutory   // 法定内残業代
                        + roundedPremiums    // 法定外割増
                        + commutePay
                        + allowanceAmount
                        + customEarnings;

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
    const prefRates = Master.KENPO_RATES[extras.prefecture] ?? Master.KENPO_RATES["京都"];
    const sInsType = companySettings?.round_social_ins || 'floor';

    // 健康保険（介護なし/ありをインデックスで切り替え）
    // [0]が介護なし本人, [1]が介護なし総額, [2]が介護あり本人, [3]が介護あり総額
    const healthInsRate = prefRates[0] ?? 0; 
    
    const healthInsurance = applyRounding(
        (Math.min(hyojunHoshu, Master.KENPO_MAX_HYOJUN) * healthInsRate) / 100, 
        sInsType
    );

    // 介護保険料（nursingTarget が true の時だけ計算）
    let nursingInsurance = 0;
    if (nursingTarget) {
        // Master.KENPO_CARE_RATE[0] (0.80) を使用
        const careRate = Master.KENPO_CARE_RATE[0] ?? 0;
        nursingInsurance = applyRounding(
            (Math.min(hyojunHoshu, Master.KENPO_MAX_HYOJUN) * careRate) / 100, 
            sInsType
        );
    }

    // 厚生年金
    // [0]が本人分, [1]が総額
    const pensionHyojun = Math.max(Master.PENSION_MIN_HYOJUN, Math.min(hyojunHoshu, Master.PENSION_MAX_HYOJUN));
    const welfarePension = applyRounding((pensionHyojun * Master.PENSION_RATE[0]) / 100, sInsType);

    // 雇用保険
    // [0]が本人分, [1]が総額
    // staff.employment_insurance_type (文字列) を取得。未設定なら 'general'
    const empInsKey = (staff.employment_insurance_type as Master.EmpInsType) || 'general';
    // マスターデータから該当する業種の配列を取得
    // 万が一、変な文字列が入っていても 'general' を参照するようにガード
    const empRates = Master.LABOR_INSURANCE_RATES[empInsKey] || Master.LABOR_INSURANCE_RATES.general;
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
