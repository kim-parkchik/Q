/**
 * calcSalary.ts — 給与計算エンジン（2026年度版）
 */
import { applyRounding } from './utils';
import * as Master from './constants/salaryMaster2026';


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
    totalOvertimeHours: number;
    totalNightHours: number;
    basePay: number;
    absenceDeduction: number;
    overtime25Pay: number;
    overtime50Pay: number;
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

// ═══════════════════════════════════════════════════════════
// 4. 介護保険 対象判定（40歳以上65歳未満）
// ═══════════════════════════════════════════════════════════
export const checkNursingCare = (birthday: string, year: number, month: number): boolean => {
    if (!birthday) return false;
    const b = new Date(birthday);
    const reach40 = new Date(b.getFullYear() + 40, b.getMonth(), b.getDate() - 1);
    const reach65 = new Date(b.getFullYear() + 65, b.getMonth(), b.getDate() - 1);
    const target  = new Date(year, month - 1, 1);
    return (
        target >= new Date(reach40.getFullYear(), reach40.getMonth(), 1) &&
        target <  new Date(reach65.getFullYear(), reach65.getMonth(), 1)
    );
};

// ═══════════════════════════════════════════════════════════
// 5. メイン: calculateSalary
// ═══════════════════════════════════════════════════════════
export const calculateSalary = (
    staff: any,
    attendanceData: any[],
    extras: SalaryExtras,
    targetYear: number,
    targetMonth: number,
    companySettings: any, // 👈 引数に追加
): SalaryResult => {

    // ── 勤怠集計 ──────────────────────────────────────────────
    const workDays = attendanceData.length;
    let totalWorkHours = 0, totalNightHours = 0, totalOvertimeHours = 0;
    let basePay = 0, overtime25Pay = 0, overtime50Pay = 0, nightPay = 0;
    let absenceDeduction = 0;

    if (staff.wage_type === 'monthly') {
        // ── 1. 基本給を固定（ループの外で1回だけ！） ──
        const monthlyWage = Number(staff.base_wage) || 0;
        basePay = monthlyWage; 

        // ── 2. 単価計算（残業代と欠勤控除のためだけに計算） ──
        const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
        let weekends = 0;
        for (let d = 1; d <= daysInMonth; d++) {
            const dow = new Date(targetYear, targetMonth - 1, d).getDay();
            if (dow === 0 || dow === 6) weekends++;
        }
        
        // 所定日数（設定があればそれ、なければ平日の数）
        const prescribedDays  = Number(staff.monthly_work_days) || (daysInMonth - weekends);
        const scheduledHours = Number(staff.scheduled_work_hours) || Master.OVERTIME_THRESHOLD_DAILY;
        
        // 時給単価 = 月給 / (所定日数 * 1日の所定時間)
        const hourlyRate = (prescribedDays > 0 && scheduledHours > 0) 
            ? monthlyWage / (prescribedDays * scheduledHours) 
            : 0;

        // ── 3. 欠勤控除の計算（月給制の大事な「引き算」） ──
        const absentDays = Math.max(0, prescribedDays - workDays);
        absenceDeduction = absentDays > 0
            ? Math.floor((monthlyWage / prescribedDays) * absentDays)
            : 0;

        // ── 4. 勤怠ループ（ここでは「足し算」のための集計だけする） ──
        attendanceData.forEach(row => {
            const h = Number(row.work_hours) || 0;
            const n = Number(row.night_hours) || 0;
            
            totalWorkHours += h; 
            totalNightHours += n;

            // 残業代の「足し算」
            const dayOvertime = Math.max(0, h - scheduledHours);
            if (dayOvertime > 0) {
                const canFitInBasic = Math.max(0, Math.min(dayOvertime, Master.OVERTIME_PREMIUM_THRESHOLD - totalOvertimeHours));
                const overPremiumThreshold = Math.max(0, dayOvertime - canFitInBasic);
                
                overtime25Pay += hourlyRate * Master.OVERTIME_RATE * canFitInBasic;
                overtime50Pay += hourlyRate * Master.OVERTIME_PREMIUM_RATE * overPremiumThreshold;
                totalOvertimeHours += dayOvertime;
            }

            // 深夜手当の「足し算」
            if (n > 0) {
                nightPay += hourlyRate * Master.NIGHT_SHIFT_RATE * n;
            }
        });

        // 🟢 【重要】このブロック内では `basePay += ...` という加算は一切行わない！

    } else {
        // --- 時給制のロジック ---
        attendanceData.forEach(row => {
            const h = Number(row.work_hours) || 0;
            const n = Number(row.night_hours) || 0;
            const wage = Number(row.actual_base_wage) || Number(staff.base_wage) || 0;

            totalWorkHours += h;
            totalNightHours += n;

            // 時給制の場合は、ここで「時間 × 時給」を積み上げる
            basePay += wage * h;

            const dayOvertime = Math.max(0, h - Master.OVERTIME_THRESHOLD_DAILY);
            if (dayOvertime > 0) {
                const canFitInBasic = Math.max(0, Math.min(dayOvertime, Master.OVERTIME_PREMIUM_THRESHOLD - totalOvertimeHours));
                const overPremiumThreshold = Math.max(0, dayOvertime - canFitInBasic);
                overtime25Pay += wage * (Master.OVERTIME_RATE - 1) * canFitInBasic; // 割増分のみ
                overtime50Pay += wage * (Master.OVERTIME_PREMIUM_RATE - 1) * overPremiumThreshold;    // 割増分のみ
                totalOvertimeHours += dayOvertime;
            }
            if (n > 0) {
                nightPay += wage * Master.NIGHT_SHIFT_RATE * n;
            }
        });
    }

    // ── 通勤手当・任意手当 ──────────────────────────────────────
    const commutePay = staff.commute_type === 'daily'   ? (Number(staff.commute_amount) || 0) * workDays
                    : staff.commute_type === 'monthly' ? (Number(staff.commute_amount) || 0) : 0;
    const allowanceAmount = Number(extras.allowanceAmount) || 0;

    // ── カスタム項目の集計 ─────────────────────────────────────
    const customItems = extras.customItems ?? [];
    const customEarnings   = customItems.filter(i => i.type === 'earning')  .reduce((s, i) => s + i.amount, 0);
    const customDeductions = customItems.filter(i => i.type === 'deduction').reduce((s, i) => s + i.amount, 0);

    // ── 支給合計の計算 ──────────────────────────────────────────────
    // 残業代・深夜手当などの「割増賃金」の合計に対して設定を適用
    const premiums = overtime25Pay + overtime50Pay + nightPay;
    const roundedPremiums = applyRounding(premiums, companySettings.round_overtime || 'round');

    // 支給合計 = 基本給(満額) - 欠勤控除 + 割増賃金 + 諸手当
    const totalEarnings = Math.floor(basePay) 
                        - absenceDeduction // ★ ここで初めて引く
                        + roundedPremiums 
                        + commutePay 
                        + allowanceAmount 
                        + customEarnings;

    // ── 社会保険料（標準報酬月額ベース） ────────────────────────
    const dbHyojun = Number(staff.standard_remuneration) || 0;
    let hyojunHoshu: number;

    if (dbHyojun > 0) {
        hyojunHoshu = dbHyojun;
    } else {
        // 標準報酬月額を判定するための報酬額（ここは法的に「円未満切り捨て」が一般的）
        const reportable = Math.floor(basePay + overtime25Pay + overtime50Pay + nightPay + commutePay);
        hyojunHoshu = getHyojunHoshu(reportable);
    }

    const rates = Master.KENPO_RATES[extras.prefecture] ?? Master.KENPO_RATES["東京"];
    const nursingTarget = checkNursingCare(staff.birthday || '', targetYear, targetMonth);

    const healthRate  = nursingTarget ? rates[1] : rates[0];
    const nursingRate = nursingTarget ? (rates[1] - rates[0]) : 0;
  
    // 社会保険料の端数設定（デフォルトは切り捨て）
    const sInsType = companySettings.round_social_ins || 'floor';

    const healthHyojun = Math.min(hyojunHoshu, Master.KENPO_MAX_HYOJUN);
    const healthTotal      = applyRounding(healthHyojun * healthRate  / 100, sInsType);
    const nursingInsurance = applyRounding(healthHyojun * nursingRate / 100, sInsType);
    const healthInsurance  = healthTotal - nursingInsurance;

    const pensionHyojun = Math.max(Master.PENSION_MIN_HYOJUN, Math.min(hyojunHoshu, Master.PENSION_MAX_HYOJUN));
    const welfarePension = applyRounding(pensionHyojun * Master.PENSION_RATE / 100, sInsType);
  
    // 雇用保険（雇用保険用の端数設定を適用：デフォルトは四捨五入）
    const empInsurance = applyRounding(
        totalEarnings * Master.EMP_INS_RATE, 
        companySettings.round_emp_ins || 'round'
    );

    // ── 税金・控除合計 ─────────────────────────────────────
    const socialTotal = healthInsurance + nursingInsurance + welfarePension + empInsurance;
    const incomeTax   = getGensenTax(Math.max(0, totalEarnings - socialTotal), Number(extras.dependents) || 0);

    const residentTax     = Number(extras.residentTax) || 0;
    const totalDeductions = healthInsurance + nursingInsurance + welfarePension
                            + empInsurance + incomeTax + residentTax + customDeductions;

    return {
        workDays, totalWorkHours, totalOvertimeHours, totalNightHours,
        // 返却値の端数も整えておく
        basePay: Math.floor(basePay), 
        absenceDeduction,
        overtime25Pay: Math.floor(overtime25Pay),
        overtime50Pay: Math.floor(overtime50Pay),
        nightPay: Math.floor(nightPay),
        commutePay, allowanceAmount, customEarnings, totalEarnings,
        healthInsurance, nursingInsurance, welfarePension,
        empInsurance, incomeTax, residentTax, customDeductions,
        totalDeductions, netPay: totalEarnings - totalDeductions,
        isNursingCareTarget: nursingTarget, hyojunHoshu,
    };
};