/**
 * 給与計算エンジン（calculateSalary）のテスト
 * 実行方法: bun test
 *
 * 2026年6月（平日22日・土日8日、6月7日が日曜）の勤怠で、実務でよくあるケースを確認する。
 * 月給 300,000円・所定8時間の人の時間単価は 300,000 ÷ (22日 × 8時間) = 1,704.5454…円。
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
    calculateSalary, saveSalaryResult, checkEmploymentInsEnrolled, checkInsuredMonth, checkInsuredOnBonusDate, checkNursingCare, checkSocialInsEnrolled,
    getInsuranceByAge, type SalaryExtras,
} from "./calcSalary";
import { calcPremium } from "./socialInsurance";
import { calcMonthlyOtsuTaxByTable, calcWithholdingTax } from "./incomeTax";
import { INSURANCE_2026 } from "../constants/insurance";
import { TAX_2026 } from "../constants/tax";
import { DB_SCHEMAS } from "../types/dbSchema";

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

// 日本年金機構「厚生年金保険は70歳（70歳の誕生日前日が属する月の前月まで）、健康保険は75歳まで（75歳誕生日当日が属する月の前月まで）」
// https://www.nenkin.go.jp/section/faq/kounen/jigyonushi/70hiyosha.html
describe("70歳の厚生年金・75歳の健康保険（資格を失った月の分から保険料はかからない）", () => {
    test("厚生年金：70歳の誕生日の前日がある月の前月分まで（1日生まれは誕生月の前々月分まで）", () => {
        // 1956年4月1日生まれ → 2026年3月31日に70歳に達する → 2月分まで
        expect(getInsuranceByAge("1956-04-01", 2026, 2).pension).toBe(true);
        expect(getInsuranceByAge("1956-04-01", 2026, 3).pension).toBe(false);
        // 1956年4月2日生まれ → 2026年4月1日に70歳に達する → 3月分まで
        expect(getInsuranceByAge("1956-04-02", 2026, 3).pension).toBe(true);
        expect(getInsuranceByAge("1956-04-02", 2026, 4).pension).toBe(false);
        // 70歳になっても、健康保険は続く
        expect(getInsuranceByAge("1956-04-01", 2026, 3).health).toBe(true);
    });
    test("健康保険：75歳の誕生日当日がある月の前月分まで（1日生まれも誕生月の前月分まで）", () => {
        // 1951年4月1日生まれ → 2026年4月1日に後期高齢者医療制度へ → 3月分まで
        expect(getInsuranceByAge("1951-04-01", 2026, 3).health).toBe(true);
        expect(getInsuranceByAge("1951-04-01", 2026, 4).health).toBe(false);
        // 1951年4月15日生まれも、4月分から
        expect(getInsuranceByAge("1951-04-15", 2026, 3).health).toBe(true);
        expect(getInsuranceByAge("1951-04-15", 2026, 4).health).toBe(false);
    });
    test("2月29日生まれは、うるう年でない年は3月1日が誕生日（70歳は2月28日に達する）", () => {
        // 1956年2月29日生まれ → 2026年2月28日に70歳に達する → 1月分まで
        expect(getInsuranceByAge("1956-02-29", 2026, 1).pension).toBe(true);
        expect(getInsuranceByAge("1956-02-29", 2026, 2).pension).toBe(false);
        // 1952年2月29日生まれ → 2027年3月1日に後期高齢者医療制度へ → 2月分まで
        expect(getInsuranceByAge("1952-02-29", 2027, 2).health).toBe(true);
        expect(getInsuranceByAge("1952-02-29", 2027, 3).health).toBe(false);
    });
    test("生年月日が空なら、健康保険・厚生年金ともかかる（介護保険はかからない）", () => {
        expect(getInsuranceByAge("", 2026, 6)).toEqual({ health: true, nursing: false, pension: true });
    });
    test("給与計算：1956年7月1日生まれの人は、2026年6月分から厚生年金を引かない（健康保険は引く）", () => {
        const r = calc({ ...monthly, birthday: "1956-07-01" }, []);
        expect(r.welfarePension).toBe(0);
        expect(r.isPensionAgeTarget).toBe(false);
        expect(r.healthInsurance).toBe(calcPremium(300000, INSURANCE_2026.KENPO_RATES["東京"][1], LAW));
        expect(r.childSupport).toBe(345);
        expect(calc({ ...monthly, birthday: "1956-07-02" }, []).welfarePension).toBe(27450);
    });
    test("給与計算：75歳の誕生月（2026年6月）の分からは、健康保険・介護保険・支援金・厚生年金のどれも引かない", () => {
        const r = calc({ ...monthly, birthday: "1951-06-20" }, []);
        expect([r.healthInsurance, r.nursingInsurance, r.childSupport, r.welfarePension]).toEqual([0, 0, 0, 0]);
        expect(r.isHealthInsAgeTarget).toBe(false);
        // 誕生月の前月までは健康保険を引く（厚生年金は70歳を過ぎているので引かない）
        const before = calc({ ...monthly, birthday: "1951-07-01" }, []);
        expect(before.healthInsurance).toBeGreaterThan(0);
        expect(before.welfarePension).toBe(0);
        // 雇用保険は年齢に関係なく引く
        expect(r.empInsurance).toBe(before.empInsurance);
    });
});

describe("入社月・退職月の社会保険料（資格取得日＝入社日、資格喪失日＝退職日の翌日）", () => {
    // 出典：日本年金機構 https://www.nenkin.go.jp/section/faq/kounen/hihokensha/20140902-01.html
    test("入社した月の分からかかる（月の途中で入社しても、その月の分がかかる）", () => {
        expect(checkInsuredMonth("2026-04-15", "", 2026, 3)).toBe(false);
        expect(checkInsuredMonth("2026-04-15", "", 2026, 4)).toBe(true);
        expect(checkInsuredMonth("2026-04-15", null, 2026, 5)).toBe(true);
    });
    test("月末に退職した人は、退職した月の分までかかる（3月31日退職 → 資格喪失日は4月1日）", () => {
        expect(checkInsuredMonth("2020-04-01", "2026-03-31", 2026, 3)).toBe(true);
        expect(checkInsuredMonth("2020-04-01", "2026-03-31", 2026, 4)).toBe(false);
    });
    test("月の途中で退職した人は、退職した月の分はかからない（資格喪失日がある月の前月分まで）", () => {
        expect(checkInsuredMonth("2020-04-01", "2026-03-15", 2026, 2)).toBe(true);
        expect(checkInsuredMonth("2020-04-01", "2026-03-15", 2026, 3)).toBe(false);
        // 3月30日退職 → 資格喪失日は3月31日（3月）
        expect(checkInsuredMonth("2020-04-01", "2026-03-30", 2026, 3)).toBe(false);
    });
    test("入社した月に退職した（同月得喪）ときは、その月の分がかかる", () => {
        expect(checkInsuredMonth("2026-04-10", "2026-04-20", 2026, 3)).toBe(false);
        expect(checkInsuredMonth("2026-04-10", "2026-04-20", 2026, 4)).toBe(true);
        expect(checkInsuredMonth("2026-04-10", "2026-04-20", 2026, 5)).toBe(false);
        // 3月31日入社・4月20日退職は同月得喪ではない（前月から続けて加入）→ 4月分はかからない
        expect(checkInsuredMonth("2026-03-31", "2026-04-20", 2026, 3)).toBe(true);
        expect(checkInsuredMonth("2026-03-31", "2026-04-20", 2026, 4)).toBe(false);
    });
    test("入社日・退職日が空なら、どの月もかかる", () => {
        expect(checkInsuredMonth("", "", 2026, 6)).toBe(true);
        expect(checkInsuredMonth(undefined, undefined, 2026, 6)).toBe(true);
    });
    // 出典：日本年金機構 https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/20141203.html 留意事項(6)
    test("賞与：入社日以後に支払った賞与にかかり、入社日より前に支払った賞与にはかからない", () => {
        expect(checkInsuredOnBonusDate("2026-06-01", "", "2026-06-10")).toBe(true);
        expect(checkInsuredOnBonusDate("2026-06-10", "", "2026-06-10")).toBe(true);
        expect(checkInsuredOnBonusDate("2026-06-15", "", "2026-06-10")).toBe(false);
    });
    test("賞与：退職した月に支払った賞与にはかからない（月末に退職する人を除く）", () => {
        expect(checkInsuredOnBonusDate("2020-04-01", "2026-06-20", "2026-06-10")).toBe(false);
        expect(checkInsuredOnBonusDate("2020-04-01", "2026-06-30", "2026-06-10")).toBe(true);
        expect(checkInsuredOnBonusDate("2020-04-01", "2026-07-15", "2026-06-10")).toBe(true);
    });
    test("賞与：同月得喪のときは、入社日から退職日までに支払った賞与にかかる", () => {
        expect(checkInsuredOnBonusDate("2026-06-01", "2026-06-20", "2026-06-10")).toBe(true);
        expect(checkInsuredOnBonusDate("2026-06-01", "2026-06-20", "2026-06-20")).toBe(true);
        expect(checkInsuredOnBonusDate("2026-06-01", "2026-06-20", "2026-06-25")).toBe(false);
    });
    test("給与計算：2026年6月15日退職の人は、6月分の社会保険料を引かない（雇用保険は引く）", () => {
        const r = calc({ ...monthly, join_date: "2020-04-01", retirement_date: "2026-06-15" }, []);
        expect([r.healthInsurance, r.nursingInsurance, r.childSupport, r.welfarePension]).toEqual([0, 0, 0, 0]);
        expect(r.isInsuredMonth).toBe(false);
        expect(r.empInsurance).toBe(calc(monthly, []).empInsurance);
    });
    test("給与計算：2026年6月30日退職・6月入社の人は、6月分の社会保険料を引く", () => {
        const full = calc(monthly, []);
        for (const dates of [
            { join_date: "2020-04-01", retirement_date: "2026-06-30" },
            { join_date: "2026-06-15", retirement_date: "" },
        ]) {
            const r = calc({ ...monthly, ...dates }, []);
            expect(r.isInsuredMonth).toBe(true);
            expect([r.healthInsurance, r.childSupport, r.welfarePension])
                .toEqual([full.healthInsurance, full.childSupport, full.welfarePension]);
        }
    });
});

describe("産休・育休中の社会保険料の免除（決まりは leaveExemption.test.ts）", () => {
    test("給与計算：育休で免除になる月（2026年6月）は、どの社会保険料も引かない（雇用保険は引く）", () => {
        const leave_periods = JSON.stringify([{ type: "childcare", start: "2026-05-20", end: "2027-03-31" }]);
        const r = calc({ ...monthly, birthday: "1980-06-15", leave_periods }, []);
        expect([r.healthInsurance, r.nursingInsurance, r.childSupport, r.welfarePension]).toEqual([0, 0, 0, 0]);
        expect(r.isLeaveExemptMonth).toBe(true);
        expect(r.empInsurance).toBe(calc(monthly, []).empInsurance);
    });
    test("給与計算：育休が終わった月（終了日の翌日がある月）からは、また引く", () => {
        const leave_periods = JSON.stringify([{ type: "childcare", start: "2025-08-01", end: "2026-06-10" }]);
        const r = calc({ ...monthly, leave_periods }, []);
        expect(r.isLeaveExemptMonth).toBe(false);
        expect(r.healthInsurance).toBe(calc(monthly, []).healthInsurance);
    });
});

describe("源泉所得税の乙欄", () => {
    test("給与計算：乙欄の人は、社会保険料等を引いた給与を月額表の乙欄に当てはめる", () => {
        const kou = calc(monthly, []);
        const r = calc({ ...monthly, tax_column: "otsu" }, []);
        const taxBase = r.totalEarnings - (r.healthInsurance + r.nursingInsurance + r.childSupport + r.welfarePension + r.empInsurance);
        expect(r.taxColumn).toBe("otsu");
        expect(r.incomeTax).toBe(calcMonthlyOtsuTaxByTable(taxBase, 0, TAX_2026.MONTHLY_TABLE));
        expect(r.incomeTax).toBeGreaterThan(kou.incomeTax);
        expect(kou.taxColumn).toBe("kou");
    });
    test("給与計算：乙欄の扶養人数は、従たる給与の申告書の人数として1人1,610円を引く", () => {
        const r0 = calc({ ...monthly, tax_column: "otsu" }, []);
        const r2 = calc({ ...monthly, tax_column: "otsu" }, [], { dependents: 2 });
        expect(r0.incomeTax - r2.incomeTax).toBe(3220);
    });
    test("給与計算：電算機計算の特例を選んでいても、乙欄は月額表で計算する", () => {
        const table = calc({ ...monthly, tax_column: "otsu" }, [], { taxMethod: "table" });
        const densanki = calc({ ...monthly, tax_column: "otsu" }, [], { taxMethod: "densanki" });
        expect(densanki.incomeTax).toBe(table.incomeTax);
    });
});

describe("標準報酬月額の履歴（決まりは standardRemuneration.test.ts）", () => {
    const standard_remuneration_history = JSON.stringify([
        { from: "", amount: 280000, reason: "shutoku" },
        { from: "2026-07", amount: 300000, reason: "zuiji" },
    ]);
    test("給与計算：その月の分の標準報酬月額で保険料を計算する（6月分は改定前の28万円）", () => {
        const r = calc({ ...monthly, standard_remuneration: 300000, standard_remuneration_history }, []);
        expect(r.hyojunHoshu).toBe(280000);
        expect(r.healthInsurance).toBe(calcPremium(280000, INSURANCE_2026.KENPO_RATES["東京"][1], LAW));
    });
    test("給与計算：改定した月の分からは新しい標準報酬月額（7月分は30万円）", () => {
        const r = calculateSalary({ ...monthly, standard_remuneration: 300000, standard_remuneration_history }, [], extras(), 2026, 7, company);
        expect(r.hyojunHoshu).toBe(300000);
    });
    test("その月の標準報酬月額が0（未加入）なら、その月の社会保険料は引かない", () => {
        const history = JSON.stringify([{ from: "", amount: 0, reason: "shutoku" }, { from: "2026-07", amount: 300000, reason: "shutoku" }]);
        const june = calc({ ...monthly, standard_remuneration: 300000, standard_remuneration_history: history }, []);
        expect(june.isSocialInsEnrolled).toBe(false);
        expect(june.healthInsurance).toBe(0);
    });
});

describe("年末調整の過不足額の精算（12月の給与で）", () => {
    test("還付は差引支給額に足し、徴収は引く。所得税・控除合計は変わらない", () => {
        const base = calc(monthly, []);
        const refund = calc(monthly, [], { yearEndSettlement: 115270 });
        const collect = calc(monthly, [], { yearEndSettlement: -5000 });
        expect(refund.yearEndSettlement).toBe(115270);
        expect(refund.netPay).toBe(base.netPay + 115270);
        expect(collect.netPay).toBe(base.netPay - 5000);
        expect([refund.incomeTax, refund.totalDeductions]).toEqual([base.incomeTax, base.totalDeductions]);
        expect(base.yearEndSettlement).toBe(0);
    });
    test("確定した給与の結果に、精算した過不足額が保存され、差引支給額に含まれる", async () => {
        const db = new Database(":memory:");
        for (const s of DB_SCHEMAS) db.exec(s);
        db.exec("INSERT INTO calendar_patterns (id, name) VALUES (1, '標準')");
        db.exec("INSERT INTO payroll_groups (id, name, closing_day, is_next_month, payment_day) VALUES (1, '全社', 99, 0, 25)");
        db.exec("INSERT INTO social_insurance_groups (id, name) VALUES (1, '協会けんぽ')");
        db.exec("INSERT INTO staff (id, name, base_wage) VALUES ('S001', '山田', 300000)");
        const asyncDb = { execute: async (sql: string, params: any[]) => db.prepare(sql).run(...params) };
        const r = calculateSalary(monthly, [], extras({ yearEndSettlement: 115270 }), 2026, 12, company);
        expect(await saveSalaryResult(asyncDb, "S001", 2026, 12, r, monthly)).toEqual({ success: true });
        expect(db.query("SELECT year_end_adjustment, net_pay FROM salary_results").get())
            .toEqual({ year_end_adjustment: 115270, net_pay: r.netPay });
    });
});

describe("社会保険・雇用保険に加入しているか（給与・賞与で同じ判定）", () => {
    test("標準報酬月額が0、または社保規定が「未加入 / 適用除外」なら、社会保険に加入していない", () => {
        expect(checkSocialInsEnrolled({ standard_remuneration: 300000 }, 2026, 6)).toBe(true);
        expect(checkSocialInsEnrolled({ standard_remuneration: 300000, social_insurance_group_id: 1 }, 2026, 6)).toBe(true);
        expect(checkSocialInsEnrolled({ standard_remuneration: 0, social_insurance_group_id: 1 }, 2026, 6)).toBe(false);
        expect(checkSocialInsEnrolled({ standard_remuneration: 300000, social_insurance_group_id: null }, 2026, 6)).toBe(false);
    });
    test("「雇用保険加入」を外した人（役員など）は、雇用保険に加入していない", () => {
        expect(checkEmploymentInsEnrolled({})).toBe(true);
        expect(checkEmploymentInsEnrolled({ is_employment_ins_eligible: 1 })).toBe(true);
        expect(checkEmploymentInsEnrolled({ is_employment_ins_eligible: 0 })).toBe(false);
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

describe("固定残業代（月給制。時間外労働の割増賃金に当てる）", () => {
    // 2026年6月の所定労働日は22日 → 時間単価 300,000 ÷ (22日 × 8時間) = 1,704.54…円
    const fixed = { ...monthly, fixed_overtime_hours: 14, fixed_overtime_allowance: 30000 };

    test("時間外労働がなくても、固定残業代を払う", () => {
        const r = calc(fixed, weekdays());
        expect(r.fixedOvertimeAllowance).toBe(30000);
        expect(r.fixedOvertimeHours).toBe(14);
        expect(r.fixedOvertimeExcess).toBe(0);
        expect(r.totalEarnings).toBe(330000);
    });
    test("時間外労働の割増賃金が固定残業代以下なら、固定残業代だけ（法定の計算額は表示用に残す）", () => {
        const r = calc(fixed, [...weekdays(), day("13", 8, "holiday_work")]); // 週40時間超が8時間
        expect(r.standardOvertimePay).toBe(17045); // 1,704.54… × 1.25 × 8
        expect(r.fixedOvertimeExcess).toBe(0);
        expect(r.totalEarnings).toBe(330000);
    });
    test("時間外労働の割増賃金が固定残業代を超えたら、差額を超過分として払う", () => {
        // 月〜水10時間（日の残業 2時間×3日）＋木金8時間＋土曜8時間（週の残業8時間）＝ 時間外労働14時間
        const rows = [day("08", 10), day("09", 10), day("10", 10), day("11", 8), day("12", 8), day("13", 8, "holiday_work")];
        const r = calc({ ...fixed, fixed_overtime_allowance: 20000 }, rows);
        expect(r.standardPremiumHours).toBe(14);
        // 1,704.54… × 1.25 × 14 = 29,829.54… → 29,830円（四捨五入）。固定残業代 20,000円との差額 9,830円
        expect(r.fixedOvertimeExcess).toBe(9830);
        expect(r.totalEarnings).toBe(300000 + 20000 + 9830);
        // 固定残業代がなければ、法定の計算額をそのまま払う（支給合計は同じ）
        expect(calc(monthly, rows).totalEarnings).toBe(329830);
    });
    test("法定内残業・休日労働・深夜労働の手当は、固定残業代とは別に払う", () => {
        const rows = [
            ...weekdays().map((r, i) => (i === 0 ? { ...r, night_hours: 2 } : r)), // 深夜2時間
            day("14", 8, "statutory_holiday"), // 法定休日の労働
        ];
        const seven = { ...monthly, scheduled_work_hours: 7 }; // 所定7時間なら、8時間働いた日は1時間が法定内残業
        const without = calc(seven, rows);
        const withFixed = calc({ ...seven, fixed_overtime_hours: 10, fixed_overtime_allowance: 25000 }, rows);
        expect(without.statutoryOvertimePay).toBeGreaterThan(0);
        expect(without.holidayWorkPay).toBeGreaterThan(0);
        expect(without.nightPay).toBeGreaterThan(0);
        expect(withFixed.totalEarnings - without.totalEarnings).toBe(25000);
    });
    test("時給制の人には、固定残業代の設定を使わない", () => {
        const r = calc({ ...hourly, fixed_overtime_hours: 10, fixed_overtime_allowance: 20000 }, weekdays({ actual_base_wage: 1200 }));
        expect(r.fixedOvertimeAllowance).toBe(0);
        expect(r.totalEarnings).toBe(calc(hourly, weekdays({ actual_base_wage: 1200 })).totalEarnings);
    });
});

describe("残業代の対象外（管理監督者など。労働基準法41条）", () => {
    // 平日5日×8時間（月曜は深夜2時間）＋土曜8時間（週40時間超）＋日曜の法定休日8時間
    const rows = [
        ...weekdays().map((r, i) => (i === 0 ? { ...r, night_hours: 2 } : r)),
        day("13", 8, "holiday_work"),
        day("14", 8, "statutory_holiday"),
    ];

    test("月給：時間外・休日労働の手当は払わず、深夜の割増賃金だけ払う（時間は記録に残す）", () => {
        const r = calc({ ...monthly, is_overtime_eligible: 0 }, rows);
        expect(r.isOvertimeEligible).toBe(false);
        expect([r.standardOvertimePay, r.highOvertimePay, r.holidayWorkPay, r.statutoryOvertimePay]).toEqual([0, 0, 0, 0]);
        expect(r.standardPremiumHours).toBe(8);
        expect(r.holidayWorkHours).toBe(8);
        expect(r.nightPay).toBe(852); // 1,704.54… × 0.25 × 2
        expect(r.totalEarnings).toBe(300000 + 852);
    });
    test("月給・所定7時間：法定内残業の手当も払わない", () => {
        const r = calc({ ...monthly, scheduled_work_hours: 7, is_overtime_eligible: 0 }, weekdays());
        expect(r.totalStatutoryOvertimeHours).toBe(5);
        expect(r.statutoryOvertimePay).toBe(0);
        expect(r.totalEarnings).toBe(300000);
    });
    test("時給：働いた時間の時給（1.0倍）と深夜の割増賃金は払い、時間外・休日の割増分は払わない", () => {
        const wage = (rs: any[]) => rs.map((r) => ({ ...r, actual_base_wage: 1200 }));
        const r = calc({ ...hourly, is_overtime_eligible: 0 }, wage(rows));
        expect(r.basePay).toBe(1200 * 56); // 7日 × 8時間
        expect([r.standardOvertimePay, r.holidayWorkPay]).toEqual([0, 0]);
        expect(r.nightPay).toBe(600); // 1,200 × 0.25 × 2
        expect(r.totalEarnings).toBe(1200 * 56 + 600);
    });
    test("設定がない（古いデータ）・チェックありの人は、今までどおり残業代の対象", () => {
        expect(calc(monthly, rows).isOvertimeEligible).toBe(true);
        expect(calc({ ...monthly, is_overtime_eligible: 1 }, rows).holidayWorkPay).toBeGreaterThan(0);
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
