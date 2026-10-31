/**
 * 給与計算エンジン（calculateSalary）のテスト
 * 実行方法: bun test
 *
 * 2026年6月（平日22日・土日8日、6月7日が日曜）の勤怠で、実務でよくあるケースを確認する。
 * 月給 300,000円・所定8時間の人の時間単価は 300,000 ÷ (22日 × 8時間) = 1,704.5454…円。
 */
import { describe, expect, test } from "bun:test";
import { calculateSalary, checkNursingCare, type SalaryExtras } from "./calcSalary";
import { calcPremium } from "./socialInsurance";
import { calcWithholdingTax } from "./incomeTax";
import { INSURANCE_2026 } from "../constants/insurance";

const LAW = "currency_law";
const company = { week_start_day: 0, round_overtime: "round", round_social_ins: LAW, round_emp_ins: LAW };
const extras = (o: Partial<SalaryExtras> = {}): SalaryExtras => ({
    allowanceName: "", allowanceAmount: 0, residentTax: 0, prefecture: "東京", dependents: 0, customItems: [], ...o,
});

/** 月給 300,000円・所定8時間・社保加入（標準報酬月額 300,000円）・36歳 */
const monthly = {
    wage_type: "monthly", base_wage: 300000, scheduled_work_hours: 8,
    commute_type: "none", commute_amount: 0, standard_remuneration: 300000, birthday: "1990-06-15",
};
/** 時給 1,200円・所定8時間・社保未加入 */
const hourly = {
    wage_type: "hourly", base_wage: 1200, scheduled_work_hours: 8,
    commute_type: "none", commute_amount: 0, standard_remuneration: 0, birthday: "1980-01-10",
};

const day = (date: string, hours: number, type = "normal", o: Record<string, unknown> = {}) =>
    ({ work_date: `2026-06-${date}`, work_hours: hours, night_hours: 0, work_type: type, ...o });
/** 6月8日(月)〜12日(金)に8時間ずつ */
const weekdays = (o: Record<string, unknown> = {}) => ["08", "09", "10", "11", "12"].map((d) => day(d, 8, "normal", o));

const calc = (staff: any, rows: any[], o: Partial<SalaryExtras> = {}, comp: any = company) =>
    calculateSalary(staff, rows, extras(o), 2026, 6, comp);

describe("社会保険の加入・未加入", () => {
    test("標準報酬月額が0（未加入・対象外）の人からは、健康保険・介護保険・支援金・厚生年金を引かない", () => {
        const rows = Array.from({ length: 12 }, (_, i) => day(String(i + 1).padStart(2, "0"), 4));
        const r = calc(hourly, rows);
        expect(r.totalEarnings).toBe(57600);
        expect(r.isSocialInsEnrolled).toBe(false);
        expect([r.healthInsurance, r.nursingInsurance, r.childSupport, r.welfarePension]).toEqual([0, 0, 0, 0]);
        // 雇用保険は加入しているので引く（57,600円 × 5/1000）
        expect(r.empInsurance).toBe(288);
    });
    test("社保規定が「未加入 / 適用除外」（NULL）なら、標準報酬月額があっても引かない", () => {
        const r = calc({ ...monthly, social_insurance_group_id: null }, []);
        expect(r.isSocialInsEnrolled).toBe(false);
        expect(r.healthInsurance + r.welfarePension + r.childSupport).toBe(0);
    });
    test("加入している人は、標準報酬月額から計算する（毎月の給与からは計算しない）", () => {
        const r = calc({ ...monthly, social_insurance_group_id: 1 }, []);
        expect(r.isSocialInsEnrolled).toBe(true);
        expect(r.healthInsurance).toBe(calcPremium(300000, INSURANCE_2026.KENPO_RATES["東京"][1], LAW));
        expect(r.welfarePension).toBe(27450); // 300,000 × 18.3% ÷ 2
        expect(r.childSupport).toBe(345);     // 300,000 × 0.23% ÷ 2
    });
});

describe("厚生年金の上限（2020年9月分から 62万円 → 65万円）", () => {
    test("標準報酬月額 65万円の人は、2020年8月分は62万円で、9月分から65万円で計算する", () => {
        const high = { ...monthly, base_wage: 700000, standard_remuneration: 650000 };
        expect(calculateSalary(high, [], extras(), 2020, 8, company).welfarePension).toBe(56730); // 620,000 × 18.3% ÷ 2
        expect(calculateSalary(high, [], extras(), 2020, 9, company).welfarePension).toBe(59475); // 650,000 × 18.3% ÷ 2
    });
});

describe("介護保険（40歳に達した月の分から、65歳に達した月の前月分まで。年齢に達するのは誕生日の前日）", () => {
    test("1日生まれの人は、誕生月の前月から介護保険がかかる", () => {
        // 1986年4月1日生まれ → 2026年3月31日に40歳に達する
        expect(checkNursingCare("1986-04-01", 2026, 2)).toBe(false);
        expect(checkNursingCare("1986-04-01", 2026, 3)).toBe(true);
    });
    test("2日以降に生まれた人は、誕生月から介護保険がかかる", () => {
        // 1986年4月2日生まれ → 2026年4月1日に40歳に達する
        expect(checkNursingCare("1986-04-02", 2026, 3)).toBe(false);
        expect(checkNursingCare("1986-04-02", 2026, 4)).toBe(true);
    });
    test("65歳に達した日がある月の分からは、かからない", () => {
        // 1961年4月1日生まれ → 2026年3月31日に65歳に達する → 2月分まで
        expect(checkNursingCare("1961-04-01", 2026, 2)).toBe(true);
        expect(checkNursingCare("1961-04-01", 2026, 3)).toBe(false);
        // 1961年4月2日生まれ → 2026年4月1日に65歳に達する → 3月分まで
        expect(checkNursingCare("1961-04-02", 2026, 3)).toBe(true);
        expect(checkNursingCare("1961-04-02", 2026, 4)).toBe(false);
    });
    test("2月29日生まれの人は、2月から（うるう年でない年も）", () => {
        expect(checkNursingCare("1984-02-29", 2024, 1)).toBe(false);
        expect(checkNursingCare("1984-02-29", 2024, 2)).toBe(true);
        expect(checkNursingCare("1984-02-29", 2049, 1)).toBe(true);
        expect(checkNursingCare("1984-02-29", 2049, 2)).toBe(false);
    });
    test("生年月日が空なら、かからない", () => {
        expect(checkNursingCare("", 2026, 6)).toBe(false);
    });
    test("給与計算：1986年7月1日生まれの人は、2026年6月分の給与から介護保険料を引く", () => {
        const r = calc({ ...monthly, birthday: "1986-07-01" }, []);
        const careRate = INSURANCE_2026.KENPO_RATES["東京"][1] + INSURANCE_2026.KENPO_CARE_RATE[1];
        expect(r.nursingInsurance).toBeGreaterThan(0);
        expect(r.nursingInsurance).toBe(calcPremium(300000, careRate, LAW) - r.healthInsurance);
        expect(calc({ ...monthly, birthday: "1986-07-02" }, []).nursingInsurance).toBe(0);
    });
});

describe("雇用保険", () => {
    test("「雇用保険加入」を外した人（役員など）からは引かない", () => {
        const r = calc({ ...monthly, is_executive: 1, is_employment_ins_eligible: 0 }, []);
        expect(r.isEmploymentInsEnrolled).toBe(false);
        expect(r.empInsurance).toBe(0);
    });
    test("従業員に区分がなければ会社の区分を使う（建設の事業: 本人 6/1000）", () => {
        const r = calc(monthly, [], {}, { ...company, default_emp_ins_type: "construction" });
        expect(r.empInsurance).toBe(1800);
    });
    test("年度の途中で料率が変わった月から新しい料率（2022年9月分 3/1000 → 10月分 5/1000）", () => {
        expect(calculateSalary(monthly, [], extras(), 2022, 9, company).empInsurance).toBe(900);
        expect(calculateSalary(monthly, [], extras(), 2022, 10, company).empInsurance).toBe(1500);
    });
    test("2020年3月分までの雇用保険料率は登録していない（4月からの料率で計算し、注意を出す）", () => {
        expect(calculateSalary(monthly, [], extras(), 2020, 3, company).empInsurance).toBe(900); // 300,000 × 3/1000
    });
    test("従業員の区分は会社の区分より優先する", () => {
        const r = calc({ ...monthly, employment_insurance_type: "general" }, [], {}, { ...company, default_emp_ins_type: "construction" });
        expect(r.empInsurance).toBe(1500);
    });
});

describe("通勤手当は非課税限度額まで所得税の対象外", () => {
    test("通勤手当3万円は所得税の計算に入れない", () => {
        const r = calc({ ...monthly, commute_type: "monthly", commute_amount: 30000 }, []);
        const social = r.healthInsurance + r.nursingInsurance + r.childSupport + r.welfarePension + r.empInsurance;
        expect(r.totalEarnings).toBe(330000);
        expect(r.nonTaxableCommute).toBe(30000);
        expect(r.taxableAmount).toBe(300000);
        expect(r.incomeTax).toBe(calcWithholdingTax(300000 - social, 0, 2026, "table"));
    });
    test("月15万円を超えた分は課税される", () => {
        const r = calc({ ...monthly, commute_type: "monthly", commute_amount: 200000 }, []);
        expect(r.nonTaxableCommute).toBe(150000);
        expect(r.taxableAmount).toBe(350000);
    });
});

describe("法定休日・所定休日の出勤", () => {
    test("月給：法定休日（日曜）に8時間働くと 1.35倍", () => {
        const r = calc(monthly, [day("07", 8, "statutory_holiday")]);
        expect(r.holidayWorkHours).toBe(8);
        expect(r.holidayWorkPay).toBe(18409); // 1,704.54… × 1.35 × 8
        expect(r.statutoryOvertimePay + r.standardOvertimePay).toBe(0);
        expect(r.totalEarnings).toBe(318409);
    });
    test("時給：法定休日に8時間働くと、時給分に35%の割増を足す", () => {
        const r = calc(hourly, [day("07", 8, "statutory_holiday")]);
        expect(r.basePay).toBe(9600);
        expect(r.holidayWorkPay).toBe(3360); // 1,200 × 0.35 × 8
        expect(r.totalEarnings).toBe(12960);
    });
    test("月給：所定休日（土曜）の出勤は、週40時間以内なら法定内残業（1.0倍）", () => {
        const r = calc(monthly, [day("13", 8, "holiday_work")]);
        expect(r.statutoryOvertimePay).toBe(13636);
        expect(r.standardOvertimePay).toBe(0);
    });
    test("法定休日の労働時間は週40時間に数えない（日曜8時間＋平日5日×8時間は残業なし）", () => {
        const r = calc(monthly, [day("07", 8, "statutory_holiday"), ...weekdays()]);
        expect(r.standardPremiumHours).toBe(0);
        expect(r.standardOvertimePay).toBe(0);
        expect(r.holidayWorkPay).toBe(18409);
    });
});

describe("週40時間を超えた残業", () => {
    test("月給：平日5日×8時間＋土曜8時間なら、土曜の8時間だけが 1.25倍（二重に払わない）", () => {
        const r = calc(monthly, [...weekdays(), day("13", 8, "holiday_work")]);
        expect(r.standardPremiumHours).toBe(8);
        expect(r.standardOvertimePay).toBe(17045); // 1,704.54… × 1.25 × 8
        expect(r.statutoryOvertimePay).toBe(0);
        expect(r.totalEarnings).toBe(317045);
    });
    test("時給：40時間に達した後の日（土曜）の時給で割増を払う", () => {
        const r = calc(hourly, [...weekdays({ actual_base_wage: 1200 }), day("13", 8, "holiday_work", { actual_base_wage: 1500 })]);
        expect(r.standardPremiumHours).toBe(8);
        expect(r.standardOvertimePay).toBe(3000); // 1,500 × 0.25 × 8（月曜の時給 1,200円ではない）
    });
    test("1日8時間を超えた分は日の残業として数え、週の累計には8時間までを足す", () => {
        // 月曜10時間（日の残業2時間）＋火〜金8時間＋土曜4時間（週の残業4時間）＝ 残業6時間
        const rows = [day("08", 10), ...["09", "10", "11", "12"].map((d) => day(d, 8)), day("13", 4, "holiday_work")];
        const r = calc(monthly, rows);
        expect(r.standardPremiumHours).toBe(6);
        expect(r.statutoryOvertimePay).toBe(0);
    });
});

describe("月60時間超の割増（中小企業は2023年3月まで25%）", () => {
    const sme = { ...company, is_small_business: 1 };
    /** 2023年3月の平日13日に13時間ずつ（1日5時間の残業 × 13日 = 65時間） */
    const march = ["01", "02", "03", "06", "07", "08", "09", "10", "13", "14", "15", "16", "17"]
        .map((d) => ({ work_date: `2023-03-${d}`, work_hours: 13, night_hours: 0, work_type: "normal" }));
    /** 2023年4月3日(月)・4日(火)に13時間ずつ（残業10時間） */
    const april = ["03", "04"].map((d) => ({ work_date: `2023-04-${d}`, work_hours: 13, night_hours: 0, work_type: "normal" }));

    test("大企業（チェックなし）：2023年3月でも60時間を超えた5時間は50%", () => {
        const r = calculateSalary(hourly, march, extras(), 2023, 3, company);
        expect([r.standardPremiumHours, r.highPremiumHours, r.deferredHighPremiumHours]).toEqual([60, 5, 0]);
        expect(r.standardOvertimePay).toBe(18000); // 1,200 × 0.25 × 60
        expect(r.highOvertimePay).toBe(3000);      // 1,200 × 0.50 × 5
    });
    test("中小企業：2023年3月に働いた分は、60時間を超えても25%", () => {
        const r = calculateSalary(hourly, march, extras(), 2023, 3, sme);
        expect([r.standardPremiumHours, r.highPremiumHours, r.deferredHighPremiumHours]).toEqual([65, 0, 5]);
        expect(r.standardOvertimePay).toBe(19500); // 1,200 × 0.25 × 65
        expect(r.highOvertimePay).toBe(0);
    });
    test("中小企業・月給：2023年3月は60時間超も1.25倍", () => {
        const r = calculateSalary(monthly, march, extras(), 2023, 3, sme);
        expect(r.highPremiumHours).toBe(0);
        expect(r.highOvertimePay).toBe(0);
        expect(r.standardPremiumHours).toBe(65);
    });
    test("中小企業：2023年4月以降に働いた分は50%", () => {
        // 2023年4月の平日14日に13時間ずつ（残業70時間）
        const rows = ["03", "04", "05", "06", "07", "10", "11", "12", "13", "14", "17", "18", "19", "20"]
            .map((d) => ({ work_date: `2023-04-${d}`, work_hours: 13, night_hours: 0, work_type: "normal" }));
        const r = calculateSalary(hourly, rows, extras(), 2023, 4, sme);
        expect([r.standardPremiumHours, r.highPremiumHours, r.deferredHighPremiumHours]).toEqual([60, 10, 0]);
    });
    test("中小企業：3月と4月をまたぐ期間は、3月分も60時間に数え、4月に働いた分だけ50%", () => {
        // 3月に65時間（60時間超の5時間は猶予で25%）、4月の10時間は60時間を超えているので50%
        const r = calculateSalary(hourly, [...march, ...april], extras(), 2023, 4, sme);
        expect([r.standardPremiumHours, r.highPremiumHours, r.deferredHighPremiumHours]).toEqual([65, 10, 5]);
        expect(r.highOvertimePay).toBe(6000); // 1,200 × 0.50 × 10
    });
});

describe("有給休暇", () => {
    test("時給：全休（有給）は所定労働時間分の時給を払う", () => {
        const r = calc(hourly, [day("01", 0, "paid_full")]);
        expect(r.paidLeaveHours).toBe(8);
        expect(r.paidLeavePay).toBe(9600);
        expect(r.totalEarnings).toBe(9600);
    });
    test("時給：半休の日は、働いた時間＋半日分", () => {
        const r = calc(hourly, [day("01", 4, "paid_half")]);
        expect(r.basePay).toBe(4800);
        expect(r.paidLeavePay).toBe(4800);
    });
    test("時給：時間単位の有給（2時間）も払う", () => {
        const r = calc(hourly, [day("01", 6, "normal", { paid_leave_hours: 2 })]);
        expect(r.basePay).toBe(7200);
        expect(r.paidLeavePay).toBe(2400);
    });
    test("月給：半休の日に残りの半日（4時間）働いても残業にならない", () => {
        const r = calc(monthly, [day("01", 4, "paid_half")]);
        expect(r.totalStatutoryOvertimeHours).toBe(0);
        expect(r.totalEarnings).toBe(300000);
    });
    test("月給：半休の日に5時間働くと、1時間が法定内残業", () => {
        const r = calc(monthly, [day("01", 5, "paid_half")]);
        expect(r.totalStatutoryOvertimeHours).toBe(1);
        expect(r.totalEarnings).toBe(301705); // 300,000 + 1,704.54…（四捨五入）
    });
});

describe("出勤日数と日額の通勤手当", () => {
    const daily = { ...hourly, commute_type: "daily", commute_amount: 500 };
    test("公休の日は出勤日数に数えない", () => {
        const r = calc(daily, [day("06", 0, "holiday"), day("07", 0, "holiday")]);
        expect(r.workDays).toBe(0);
        expect(r.commutePay).toBe(0);
    });
    test("働いた日だけを数える（出勤2日＋公休1日 → 2日分）", () => {
        const r = calc(daily, [day("01", 8), day("02", 8), day("06", 0, "holiday")]);
        expect(r.workDays).toBe(2);
        expect(r.commutePay).toBe(1000);
    });
});
