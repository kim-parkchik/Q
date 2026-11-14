/**
 * 給与計算エンジン（calculateSalary）のテスト
 * 実行方法: bun test
 *
 * 2026年6月（平日22日・土日8日、6月7日が日曜）の勤怠で、実務でよくあるケースを確認する。
 * 月給 300,000円・所定8時間の人の時間単価は 300,000 ÷ (22日 × 8時間) = 1,704.5454…円
 * （1年間の所定労働日数を渡さないときは、その月の所定労働日数で割る。渡したときのテストは「残業代の時給」）。
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
    calculateSalary, loadCustomItems, saveSalaryResult, socialInsMonthsOf, prorate, prorationOf, checkEmploymentInsEnrolled, checkInsuredMonth, checkInsuredOnBonusDate, checkNursingCare, checkSocialInsEnrolled,
    getInsuranceByAge, splitByWeights, splitRoundedTotal, heiLimitDate, loadWeekCarryOver, weekCarryOverRange, type SalaryExtras,
} from "./calcSalary";
import { calcPremium } from "./socialInsurance";
import { calcDailyHeiTaxByTable, calcMonthlyOtsuTaxByTable, calcWithholdingTax } from "./incomeTax";
import { INSURANCE_2026 } from "../constants/insurance";
import { TAX_2026 } from "../constants/tax";
import { DB_SCHEMAS } from "../types/dbSchema";
import type { AverageWagePay } from "./averageWage";

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

describe("拠点の都道府県がわからないとき（健康保険料率は都道府県ごと。ほかの都道府県で仮に計算しない）", () => {
    test("健康保険料・介護保険料は計算せず（0円）、prefectureUnknown で知らせる。厚生年金・雇用保険はいつもどおり", () => {
        const older = { ...monthly, birthday: "1980-06-15" }; // 46歳（介護保険の対象）
        const known = calc(older, []);
        const r = calc(older, [], { prefecture: "" });
        expect(known.prefectureUnknown).toBe(false);
        expect(known.healthInsurance).toBeGreaterThan(0);
        expect(known.nursingInsurance).toBeGreaterThan(0);
        expect(r.prefectureUnknown).toBe(true);
        expect([r.healthInsurance, r.nursingInsurance]).toEqual([0, 0]);
        expect(r.welfarePension).toBe(known.welfarePension);
        expect(r.empInsurance).toBe(known.empInsurance);
        // 知らない書き方（東京都）も、わからないとして扱う（呼ぶ側で 東京 にしてから渡す）
        expect(calc(older, [], { prefecture: "東京都" }).prefectureUnknown).toBe(true);
    });
    test("健康保険料がかからない人（社会保険に入っていない）なら、都道府県がわからなくても知らせない", () => {
        expect(calc(hourly, [], { prefecture: "" }).prefectureUnknown).toBe(false);
    });
});

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

describe("健康保険組合・国民健康保険組合の人（会社設定の「社会保険規定」。utils/healthInsurer.ts）", () => {
    const unionInsurer = {
        id: 2, name: "確かめ健康保険組合", type: "union" as const,
        rates: [
            { from: "2025-04", health: 4.4, care: 0.8, childSupport: 0 },
            { from: "2026-04", health: 4.5, care: 0.8, childSupport: 0.115 },
        ],
    };
    const kokuhoInsurer = { id: 3, name: "確かめ建設国保", type: "kokuho" as const, rates: [] };
    const older = { ...monthly, birthday: "1980-06-15", social_insurance_group_id: 2 }; // 46歳（介護保険の対象）

    test("健康保険組合：組合の本人負担の料率で計算し、都道府県は使わない。厚生年金は全国で同じ料率", () => {
        const r = calc(older, [], { healthInsurer: unionInsurer, prefecture: "" });
        // 300,000 × 4.5% = 13,500、300,000 × (4.5% + 0.8%) − 13,500 = 2,400、300,000 × 0.115% = 345
        expect([r.healthInsurance, r.nursingInsurance, r.childSupport]).toEqual([13500, 2400, 345]);
        expect(r.welfarePension).toBe(27450);
        expect([r.prefectureUnknown, r.insurerRateMissing]).toEqual([false, false]);
        expect(r.insurer).toEqual({ type: "union", name: "確かめ健康保険組合" });
        expect(r.unionRate?.from).toBe("2026-04");
        // 協会けんぽの人は、いままでどおり（規定を渡さない・協会けんぽの規定）
        expect(calc(older, []).insurer).toEqual({ type: "kyokai", name: "" });
    });
    test("翌月徴収では、前の月の分の料率で計算する（2026年4月に払う給与は3月分の料率。支援金は4月分から）", () => {
        const next = calculateSalary(older, [], extras({ healthInsurer: unionInsurer, socialInsCollection: "next" }), 2026, 4, company);
        expect([next.healthInsurance, next.childSupport, next.unionRate?.from]).toEqual([13200, 0, "2025-04"]);
        const current = calculateSalary(older, [], extras({ healthInsurer: unionInsurer }), 2026, 4, company);
        expect([current.healthInsurance, current.childSupport]).toEqual([13500, 345]);
    });
    test("健康保険組合の、その月の分の料率がなければ、健康保険料・介護保険料を計算せず知らせる（確定できない）", () => {
        const later = { ...unionInsurer, rates: [{ from: "2026-07", health: 4.5, care: 0.8, childSupport: 0.115 }] };
        const r = calc(older, [], { healthInsurer: later });
        expect(r.insurerRateMissing).toBe(true);
        expect(r.prefectureUnknown).toBe(false);
        expect([r.healthInsurance, r.nursingInsurance, r.childSupport]).toEqual([0, 0, 0]);
        expect(r.welfarePension).toBe(27450);
    });
    test("国保組合：健康保険料・介護保険料・支援金はかけず、従業員ごとの月額を引く。厚生年金はかかり、所得税の計算でも社会保険料として引く", () => {
        const staff = { ...older, social_insurance_group_id: 3, kokuho_premium: 23000 };
        const r = calc(staff, [], { healthInsurer: kokuhoInsurer });
        expect([r.healthInsurance, r.nursingInsurance, r.childSupport]).toEqual([0, 0, 0]);
        expect(r.kokuhoPremium).toBe(23000);
        expect(r.welfarePension).toBe(27450);
        const social = r.welfarePension + r.empInsurance + 23000;
        expect(r.incomeTax).toBe(calcWithholdingTax(r.taxableAmount - social, 0, 2026, "table"));
        expect(r.totalDeductions).toBe(social + r.incomeTax);
        expect(r.netPay).toBe(r.totalEarnings - r.totalDeductions);
        expect(r.insurer).toEqual({ type: "kokuho", name: "確かめ建設国保" });
    });
    test("国保組合で厚生年金に入らない人（標準報酬月額 0）からも、国保組合の保険料は引く。入社前の月は引かない", () => {
        const staff = { ...hourly, social_insurance_group_id: 3, kokuho_premium: 18000 };
        const r = calc(staff, weekdays(), { healthInsurer: kokuhoInsurer });
        expect([r.kokuhoPremium, r.welfarePension, r.healthInsurance]).toEqual([18000, 0, 0]);
        expect(calc({ ...staff, join_date: "2026-07-01" }, weekdays(), { healthInsurer: kokuhoInsurer }).kokuhoPremium).toBe(0);
        // 国保組合ではない規定の人は、月額が残っていても引かない
        expect(calc({ ...staff, social_insurance_group_id: 1 }, weekdays()).kokuhoPremium).toBe(0);
    });
    test("確定した給与に、国保組合の保険料を残し、社会保険料の合計に入れる", async () => {
        const db = new Database(":memory:");
        for (const s of DB_SCHEMAS) db.exec(s);
        db.exec("INSERT INTO calendar_patterns (id, name) VALUES (1, '標準')");
        db.exec("INSERT INTO payroll_groups (id, name, closing_day, is_next_month, payment_day) VALUES (1, '全社', 99, 0, 25)");
        db.exec("INSERT INTO social_insurance_groups (id, name, type) VALUES (1, '協会けんぽ', 'kyokai'), (3, '確かめ建設国保', 'kokuho')");
        db.exec("INSERT INTO staff (id, name, base_wage, social_insurance_group_id, kokuho_premium) VALUES ('S001', '山田', 300000, 3, 23000)");
        const asyncDb = { execute: async (sql: string, params: any[]) => db.prepare(sql).run(...params) };
        const staff = { ...older, social_insurance_group_id: 3, kokuho_premium: 23000 };
        const r = calc(staff, [], { healthInsurer: kokuhoInsurer });
        expect(await saveSalaryResult(asyncDb, "S001", 2026, 6, r, staff)).toEqual({ success: true });
        expect(db.query("SELECT kokuho_premium AS k, health_insurance AS h, social_ins_total AS t FROM salary_results").get())
            .toEqual({ k: 23000, h: 0, t: r.welfarePension + r.empInsurance + 23000 });
    });
});

describe("社会保険料（本人負担分）の端数処理（協会けんぽの保険料額表：給与から引くときは50銭以下切り捨て・50銭超切り上げ。特約があればそれによる）", () => {
    // 子ども・子育て支援金：標準報酬月額 58,000円 × 0.23% ÷ 2 ＝ 66.7円
    const small = { ...monthly, standard_remuneration: 58000, social_insurance_group_id: 1 };
    test("会社の設定がなければ原則で計算する（66.7円 → 67円。いままでは切り捨てて66円）", () => {
        expect(calc(small, [], {}, { week_start_day: 0, round_overtime: "round" }).childSupport).toBe(67);
    });
    test("特約で「切り捨て」にしている会社は、切り捨てる", () => {
        expect(calc(small, [], {}, { ...company, round_social_ins: "floor" }).childSupport).toBe(66);
    });
    test("新しい会社ファイルの初めの値は、原則（currency_law）", () => {
        const db = new Database(":memory:");
        for (const s of DB_SCHEMAS) db.exec(s);
        db.exec("INSERT INTO company (id, name) VALUES (1, 'テスト株式会社')");
        expect(db.query("SELECT round_social_ins AS s, round_emp_ins AS e, round_overtime AS o FROM company").get())
            .toEqual({ s: "currency_law", e: "currency_law", o: "round" });
    });
});

describe("雇用保険料（本人負担分）の端数処理（厚生労働省「雇用保険被保険者からの雇用保険料の控除方法」：賃金から引くときは50銭以下切り捨て・50銭1厘以上切り上げ。特約があればそれによる）", () => {
    test("厚生労働省の例：賃金 255,935円 × 4/1,000 ＝ 1,023.74円 → 1,024円", () => {
        expect(calcPremium(255935, 0.4, LAW, 1)).toBe(1024);
    });
    test("会社の設定がなければ原則で計算する（2026年6月・一般の事業 5/1,000：300,100円 × 5/1,000 ＝ 1,500.5円 → 1,500円。いままでは四捨五入して1,501円）", () => {
        const pay = { ...monthly, base_wage: 300100, standard_remuneration: 0 };
        expect(calc(pay, [], {}, { week_start_day: 0, round_overtime: "round" }).empInsurance).toBe(1500);
        expect(calc(pay, [], {}, { ...company, round_emp_ins: "round" }).empInsurance).toBe(1501);
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
    test("給与計算：役員は、育休の期間を入れても保険料を引く（産休は免除する）", () => {
        // 役員はふつう労働者に当たらず、育児・介護休業法の育児休業等を取れないので、育児休業等の免除を受けられない（日本年金機構）
        const childcare = JSON.stringify([{ type: "childcare", start: "2026-05-20", end: "2027-03-31" }]);
        const r = calc({ ...monthly, is_executive: 1, leave_periods: childcare }, []);
        expect(r.isLeaveExemptMonth).toBe(false);
        expect([r.healthInsurance, r.childSupport, r.welfarePension])
            .toEqual([calc(monthly, []).healthInsurance, calc(monthly, []).childSupport, calc(monthly, []).welfarePension]);
        const maternity = JSON.stringify([{ type: "maternity", start: "2026-05-20", end: "2026-08-31" }]);
        const m = calc({ ...monthly, is_executive: 1, leave_periods: maternity }, []);
        expect(m.isLeaveExemptMonth).toBe(true);
        expect([m.healthInsurance, m.welfarePension]).toEqual([0, 0]);
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

describe("源泉所得税の丙欄（日雇賃金。働いた日ごとの給与に日額表の丙欄。所得税基本通達185-8）", () => {
    /** 時給 1,200円・社保未加入・雇用保険も未加入（日ごとの金額をそのまま確かめるため）・6月1日入社 */
    const hei = { ...hourly, tax_column: "hei", join_date: "2026-06-01", is_employment_ins_eligible: 0 };
    const H = TAX_2026.DAILY_HEI_TABLE;

    test("働いた日ごとの給与に丙欄を当てはめた税額の合計", () => {
        // 10時間の日：1,200 × 10 ＋ 2時間の割増 1,200 × 0.25 × 2 = 12,600円 → 101円
        // 5時間の日：6,000円 → 0円（平均の9,300円 × 2日でも0円だが、日ごとに計算する）
        const r = calc(hei, [day("08", 10), day("09", 5)]);
        expect(r.taxColumn).toBe("hei");
        expect(r.totalEarnings).toBe(18600);
        expect(r.heiDays).toEqual([
            { date: "2026-06-08", amount: 12600, tax: 101 },
            { date: "2026-06-09", amount: 6000, tax: 0 },
        ]);
        expect(r.incomeTax).toBe(101);
        expect(r.heiWarnings).toEqual([]);
    });
    test("社会保険料等・月額の手当のように日が決まらない額は、日ごとの支給額の割合で分ける", () => {
        // 8時間の日 9,600円・5時間の日 6,000円。手当 3,100円と雇用保険料を合わせた額を 9,600 : 6,000 で分ける
        const r = calc({ ...hei, is_employment_ins_eligible: 1 }, [day("08", 8), day("09", 5)], { allowanceAmount: 3100 });
        const taxBase = r.taxableAmount - r.empInsurance;
        expect(r.totalEarnings).toBe(18700);
        expect(r.empInsurance).toBeGreaterThan(0);
        expect(r.heiDays.reduce((s, d) => s + d.amount, 0)).toBe(taxBase);
        expect(r.heiDays[0].amount).toBe(Math.floor((taxBase * 9600) / 15600));
        for (const d of r.heiDays) expect(d.tax).toBe(calcDailyHeiTaxByTable(d.amount, H));
        expect(r.incomeTax).toBe(r.heiDays.reduce((s, d) => s + d.tax, 0));
    });
    test("日給制：その日の日給（と残業代）で分ける", () => {
        const daily = { ...hei, wage_type: "daily", base_wage: 12000 };
        const r = calc(daily, [day("08", 8, "normal", { actual_base_wage: 12000 }), day("09", 8, "normal", { actual_base_wage: 10000 })]);
        expect(r.heiDays.map((d) => d.amount)).toEqual([12000, 10000]);
        expect(r.incomeTax).toBe(calcDailyHeiTaxByTable(12000, H) + calcDailyHeiTaxByTable(10000, H));
    });
    test("扶養人数は使わない（確定結果の扶養人数も0）。年末調整・定額減税の月次減税の対象外は別のテスト", () => {
        const r0 = calc(hei, [day("08", 10)]);
        const r3 = calc(hei, [day("08", 10)], { dependents: 3 });
        expect(r3.incomeTax).toBe(r0.incomeTax);
        expect(r3.appliedDependents).toBe(0);
    });
    test("入社から2か月を超えて働いた日があれば注意を出す（その日からは甲欄か乙欄）", () => {
        // 4月8日入社：6月7日で2か月 → 6月8日から超える
        const over = calc({ ...hei, join_date: "2026-04-08" }, [day("08", 8), day("09", 8)]);
        expect(over.heiWarnings).toHaveLength(1);
        expect(over.heiWarnings[0]).toContain("2026-06-08以後");
        expect(over.heiWarnings[0]).toContain("2日");
        // 4月10日入社：6月10日から超えるので、8日・9日はまだ2か月以内
        expect(calc({ ...hei, join_date: "2026-04-10" }, [day("08", 8), day("09", 8)]).heiWarnings).toEqual([]);
        // 入社日がなければ確かめられない
        expect(calc({ ...hei, join_date: null }, [day("08", 8)]).heiWarnings[0]).toContain("入社日が入っていない");
    });
    test("2か月の満了：応当日がない月は、その月の末日に満了する（民法143条2項）", () => {
        expect(heiLimitDate("2026-04-10")).toBe("2026-06-10");
        expect(heiLimitDate("2026-01-31")).toBe("2026-03-31");
        expect(heiLimitDate("2025-12-31")).toBe("2026-03-01");
        expect(heiLimitDate("2026-12-30")).toBe("2027-03-01");
    });
    test("月給制の人には使えない（注意を出し、働いた日数で等分して計算する）", () => {
        const r = calc({ ...monthly, tax_column: "hei", join_date: "2026-06-01" }, weekdays());
        expect(r.heiWarnings[0]).toContain("月給制");
        expect(r.heiDays).toHaveLength(5);
        const taxBase = r.taxableAmount - (r.healthInsurance + r.nursingInsurance + r.childSupport + r.welfarePension + r.empInsurance);
        expect(r.heiDays.reduce((s, d) => s + d.amount, 0)).toBe(taxBase);
    });
    test("働いた日がなく支給だけあるときは、1日分として計算する", () => {
        const r = calc(hei, [], { allowanceAmount: 15000 });
        expect(r.heiDays).toEqual([{ date: null, amount: 15000, tax: calcDailyHeiTaxByTable(15000, H) }]);
        expect(r.heiWarnings.some((w) => w.includes("1日分"))).toBe(true);
    });
    test("splitByWeights：割合で分け、合計はもとの金額と同じ", () => {
        expect(splitByWeights(1000, [1, 1, 1])).toEqual([333, 333, 334]);
        expect(splitByWeights(18600, [12600, 6000])).toEqual([12600, 6000]);
        expect(splitByWeights(100, [])).toEqual([]);
        expect(splitByWeights(100, [0, 0])).toEqual([0, 0]);
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
    test("確定した結果の「その時の扶養人数」は、源泉所得税の計算に使った人数（給与明細で変えた人数）", async () => {
        const db = new Database(":memory:");
        for (const s of DB_SCHEMAS) db.exec(s);
        db.exec("INSERT INTO calendar_patterns (id, name) VALUES (1, '標準')");
        db.exec("INSERT INTO payroll_groups (id, name, closing_day, is_next_month, payment_day) VALUES (1, '全社', 99, 0, 25)");
        db.exec("INSERT INTO social_insurance_groups (id, name) VALUES (1, '協会けんぽ')");
        db.exec("INSERT INTO staff (id, name, base_wage, dependents) VALUES ('S001', '山田', 300000, 0)");
        const asyncDb = { execute: async (sql: string, params: any[]) => db.prepare(sql).run(...params) };
        const r = calculateSalary({ ...monthly, dependents: 0 }, [], extras({ dependents: 2 }), 2026, 6, company);
        expect(r.appliedDependents).toBe(2);
        await saveSalaryResult(asyncDb, "S001", 2026, 6, r, { ...monthly, dependents: 0 });
        expect(db.query("SELECT applied_dependents AS d, applied_base_wage AS w FROM salary_results").get()).toEqual({ d: 2, w: 300000 });
    });
});

describe("欠勤控除（月給制。給与規定グループで、計算期間の所定労働日数か1年間の月平均で割るか、しないかを選ぶ）", () => {
    // 2026年5月：祝日（5月4日〜6日）が平日に3日あり、会社カレンダーの所定労働日は18日（土日を除いた日数は21日）
    const mayWorkDays = ["01", "07", "08", "11", "12", "13", "14", "15", "18", "19", "20", "21", "22", "25", "26", "27", "28", "29"];
    const absentInMay = (dates: string[]) => dates.map((d) => ({ work_date: `2026-05-${d}`, work_hours: 0, night_hours: 0, work_type: "absent" }));
    const calcMay = (rows: any[], o: Partial<SalaryExtras> = {}) => calculateSalary(monthly, rows, extras(o), 2026, 5, company);

    test("計算期間の所定労働日数で割る（初めの設定）：5月に1日休むと 300,000 ÷ 18日 = 16,666円", () => {
        expect(mayWorkDays).toHaveLength(18);
        const r = calcMay(absentInMay(["11"]), { periodWorkDays: 18 });
        expect(r.absenceDeductionMethod).toBe("workdays");
        expect(r.absenceDays).toBe(1);
        expect(r.absenceDeduction).toBe(16666);
        expect(r.absenceDeductionDetail).toBe("月給 ¥300,000 × 欠勤 1日 ÷ 計算期間の所定労働日数 18日");
        expect(r.absenceDeductionNote).toBeNull();
        expect(r.periodWorkDays).toBe(18);
    });
    test("所定労働日をすべて休むと、月給をちょうど全額引く（いままでは土日を除いた21日で割り、257,142円しか引かなかった）", () => {
        const r = calcMay(absentInMay(mayWorkDays), { periodWorkDays: 18 });
        expect(r.absenceDeduction).toBe(300000);
        expect(r.totalEarnings).toBe(0);
    });
    test("1年間の月平均の所定労働日数で割る：300,000 × 12 ÷ 245日 = 14,693円（5月も6月も同じ）", () => {
        const o = { absenceDeductionMethod: "annual" as const, annualWorkDays: 245 };
        const r = calcMay(absentInMay(["11"]), { ...o, periodWorkDays: 18 });
        expect(r.absenceDeduction).toBe(14693);
        expect(r.absenceDeductionDetail).toBe("月給 ¥300,000 × 欠勤 1日 ÷ 1年間の月平均の所定労働日数（245日 ÷ 12）");
        expect(calc(monthly, [day("08", 0, "absent")], { ...o, periodWorkDays: 22 }).absenceDeduction).toBe(14693);
    });
    test("1年間の月平均で割って月給を超えるときは、基本給までにする（6月の所定労働日22日をすべて休む → 323,265円 → 300,000円）", () => {
        const june = ["01", "02", "03", "04", "05", "08", "09", "10", "11", "12", "15", "16", "17", "18", "19", "22", "23", "24", "25", "26", "29", "30"];
        const r = calc(monthly, june.map((d) => day(d, 0, "absent")), { absenceDeductionMethod: "annual", annualWorkDays: 245, periodWorkDays: 22 });
        expect(r.absenceDeduction).toBe(300000);
        expect(r.absenceDeductionDetail).toContain("＝ ¥323,265 → 基本給の ¥300,000 まで");
        expect(r.totalEarnings).toBe(0);
    });
    test("欠勤控除をしない（完全月給制）：欠勤があっても月給をそのまま払う", () => {
        const r = calcMay(absentInMay(["11", "12"]), { absenceDeductionMethod: "none", periodWorkDays: 18 });
        expect(r.absenceDeduction).toBe(0);
        expect(r.absenceDays).toBe(2);
        expect(r.totalEarnings).toBe(300000);
        expect(r.absenceDeductionDetail).toBe("欠勤 2日：欠勤控除をしない設定（完全月給制）なので、月給をそのまま支給します");
    });
    test("会社カレンダー・1年間の所定労働日数を読み込めていないときは、その月の土日を除いた日数で割り、知らせる", () => {
        const noCalendar = calc(monthly, [day("08", 0, "absent")]);
        expect(noCalendar.absenceDeduction).toBe(13636); // 300,000 ÷ 22日
        expect(noCalendar.absenceDeductionNote).toContain("会社カレンダーを読み込めていない");
        expect(noCalendar.periodWorkDays).toBeNull();
        const noAnnual = calc(monthly, [day("08", 0, "absent")], { absenceDeductionMethod: "annual", periodWorkDays: 22 });
        expect(noAnnual.absenceDeduction).toBe(13636);
        expect(noAnnual.absenceDeductionNote).toContain("1年間の所定労働日数がわからない");
        const noWorkDay = calc(monthly, [day("08", 0, "absent")], { periodWorkDays: 0 });
        expect(noWorkDay.absenceDeduction).toBe(0);
        expect(noWorkDay.absenceDeductionNote).toContain("所定労働日がない");
    });
    test("欠勤がなければ、計算式も注意も出さない。時給制・日給制の人は欠勤控除をしない（働いた分だけ払う）", () => {
        const r = calc(monthly, weekdays(), { periodWorkDays: 22 });
        expect([r.absenceDeduction, r.absenceDeductionDetail, r.absenceDeductionNote]).toEqual([0, null, null]);
        expect(calc(hourly, [day("08", 0, "absent")], { periodWorkDays: 22 }).absenceDeduction).toBe(0);
    });
    test("確定した結果に、欠勤控除の額と計算期間の所定労働日数を残す（算定・月変の支払基礎日数に使う）", async () => {
        const db = new Database(":memory:");
        for (const s of DB_SCHEMAS) db.exec(s);
        db.exec("INSERT INTO calendar_patterns (id, name) VALUES (1, '標準')");
        db.exec("INSERT INTO payroll_groups (id, name, closing_day, is_next_month, payment_day) VALUES (1, '全社', 99, 0, 25)");
        db.exec("INSERT INTO social_insurance_groups (id, name) VALUES (1, '協会けんぽ')");
        db.exec("INSERT INTO staff (id, name, base_wage) VALUES ('S001', '山田', 300000)");
        // 給与規定グループの欠勤控除の初めの値は「計算期間の所定労働日数で割る」
        expect(db.query("SELECT absence_deduction_method AS m FROM payroll_groups").get()).toEqual({ m: "workdays" });
        const asyncDb = { execute: async (sql: string, params: any[]) => db.prepare(sql).run(...params) };
        const r = calcMay(absentInMay(["11", "12"]), { periodWorkDays: 18 });
        expect(await saveSalaryResult(asyncDb, "S001", 2026, 5, r, monthly)).toEqual({ success: true });
        expect(db.query("SELECT absence_deduction AS a, prescribed_work_days AS p, total_earnings AS t FROM salary_results").get())
            .toEqual({ a: 33333, p: 18, t: 300000 - 33333 });
    });
});

describe("遅刻・早退・中抜けの控除（月給制・日給制。給与規定グループで選ぶ。初めは引かない。モデル就業規則第45条）", () => {
    /** 6月8日に6時間30分（所定8時間に1時間30分足りない） */
    const short = [day("08", 6.5)];
    test("初めは引かない：足りない時間と、引かないことだけを出す", () => {
        const r = calc(monthly, short, { periodWorkDays: 22, annualWorkDays: 245 });
        expect([r.tardyDeductionMethod, r.tardyDeduction, r.tardyHours]).toEqual(["none", 0, 1.5]);
        expect(r.tardyDeductionDetail).toBe("遅刻・早退・中抜け 1時間30分：引かない設定なので、月給をそのまま支給します");
        expect(r.totalEarnings).toBe(300000);
    });
    test("1か月平均所定労働時間で割る：300,000 × 1.5時間 ÷（245日 × 8時間 ÷ 12）＝ 2,755円（1円未満切り捨て）", () => {
        const r = calc(monthly, short, { tardyDeductionMethod: "annual", periodWorkDays: 22, annualWorkDays: 245 });
        expect(r.tardyDeduction).toBe(2755);
        expect(r.tardyDeductionDetail).toBe("月給 ¥300,000 × 遅刻・早退・中抜け 1時間30分 ÷ 1か月平均所定労働時間（245日 × 8時間 ÷ 12）");
        expect(r.totalEarnings).toBe(300000 - 2755);
    });
    test("計算期間の所定労働時間で割る：300,000 × 1.5時間 ÷（22日 × 8時間）＝ 2,556円", () => {
        const r = calc(monthly, short, { tardyDeductionMethod: "period", periodWorkDays: 22 });
        expect(r.tardyDeduction).toBe(2556);
        expect(r.tardyDeductionDetail).toBe("月給 ¥300,000 × 遅刻・早退・中抜け 1時間30分 ÷ 計算期間の所定労働時間（22日 × 8時間）");
    });
    test("時間有給にした時間は働いたものとして数える。半休の日は所定労働時間の半分に足りない時間。残業した日は引かない", () => {
        const o = { tardyDeductionMethod: "annual" as const, annualWorkDays: 245 };
        expect(calc(monthly, [day("08", 6, "normal", { paid_leave_hours: 2 })], o)).toMatchObject({ tardyDeduction: 0, tardyHours: 0, tardyDeductionDetail: null });
        expect(calc(monthly, [day("09", 3, "paid_half")], o)).toMatchObject({ tardyDeduction: 1836, tardyHours: 1 });
        expect(calc(monthly, [day("10", 9)], o)).toMatchObject({ tardyDeduction: 0, tardyHours: 0 });
    });
    test("働いた時間が0の出勤の日は引かずに知らせる（休んだ日なら「欠勤」にする）。時給制の人は引かない（働いた分だけ払う）", () => {
        const r = calc(monthly, [day("08", 0)], { tardyDeductionMethod: "annual", annualWorkDays: 245 });
        expect(r.tardyDeduction).toBe(0);
        expect(r.tardyDeductionNote).toContain("働いた時間が0の日が1日");
        expect(calc(hourly, short, { tardyDeductionMethod: "annual", annualWorkDays: 245 }).tardyDeduction).toBe(0);
    });
    test("日給制：日給 × 足りない時間 ÷ 1日の所定労働時間（12,000円・2時間足りない → 3,000円）", () => {
        const daily = { ...hourly, wage_type: "daily", base_wage: 12000 };
        const r = calc(daily, [day("08", 6), day("09", 8)], { tardyDeductionMethod: "period", periodWorkDays: 22 });
        expect(r.tardyDeduction).toBe(3000);
        expect(r.tardyDeductionDetail).toBe("日給 × 遅刻・早退・中抜け 2時間 ÷ 1日の所定労働時間 8時間（日ごとに計算して合計）");
        expect(r.totalEarnings).toBe(12000 * 2 - 3000);
        expect(calc(daily, [day("08", 6)]).tardyDeduction).toBe(0);
    });
    test("引く額は、その月の基本給（欠勤控除のあと）まで", () => {
        const rows = ["08", "09", "10"].map((d) => day(d, 1));
        const r = calc(monthly, [...rows, day("11", 0, "absent")], { tardyDeductionMethod: "period", periodWorkDays: 1 });
        expect(r.absenceDeduction).toBe(300000);
        expect(r.tardyDeduction).toBe(0);
        expect(r.tardyDeductionDetail).toContain("→ 基本給の残り ¥0 まで");
    });
    test("確定した結果に、遅刻・早退・中抜けの控除の額を残す", async () => {
        const db = new Database(":memory:");
        for (const s of DB_SCHEMAS) db.exec(s);
        db.exec("INSERT INTO staff (id, name, base_wage) VALUES ('S001', '山田', 300000)");
        expect(db.query("SELECT tardy_deduction_method AS m FROM payroll_groups").all()).toEqual([]);
        db.exec("INSERT INTO payroll_groups (id, name, closing_day, is_next_month, payment_day) VALUES (1, '全社', 99, 0, 25)");
        expect(db.query("SELECT tardy_deduction_method AS m FROM payroll_groups").get()).toEqual({ m: "none" });
        const asyncDb = { execute: async (sql: string, params: any[]) => db.prepare(sql).run(...params) };
        const r = calc(monthly, short, { tardyDeductionMethod: "annual", annualWorkDays: 245 });
        expect(await saveSalaryResult(asyncDb, "S001", 2026, 6, r, monthly)).toEqual({ success: true });
        expect(db.query("SELECT tardy_deduction AS d, total_earnings AS t FROM salary_results").get()).toEqual({ d: 2755, t: 300000 - 2755 });
    });
});

describe("特別休暇（夏季休暇などの会社独自の休暇。有給か無給かは種類ごと。確定したときの設定を leave_paid に残す）", () => {
    const daily = { ...hourly, wage_type: "daily", base_wage: 12000 };
    test("月給制の有給の休暇：引かない（月給をそのまま払う）", () => {
        const r = calc(monthly, [day("08", 0, "special", { leave_paid: 1 }), day("09", 4, "special_half", { leave_paid: 1 })], { periodWorkDays: 22 });
        expect(r).toMatchObject({ specialLeaveDays: 1.5, unpaidLeaveDays: 0, unpaidLeaveDeduction: 0, specialLeavePay: 0, totalEarnings: 300000 });
        expect(r.unpaidLeaveDeductionDetail).toBeNull();
    });
    test("月給制の無給の休暇：欠勤控除と同じ計算で引く（300,000 × 1.5日 ÷ 22日 ＝ 20,454円）", () => {
        const rows = [day("08", 0, "special", { leave_paid: 0 }), day("09", 4, "special_half", { leave_paid: 0 })];
        const r = calc(monthly, rows, { periodWorkDays: 22 });
        expect(r).toMatchObject({ unpaidLeaveDays: 1.5, unpaidLeaveDeduction: 20454, absenceDeduction: 0, absenceDays: 0, totalEarnings: 300000 - 20454 });
        expect(r.unpaidLeaveDeductionDetail).toBe("月給 ¥300,000 × 無給の休暇 1.5日 ÷ 計算期間の所定労働日数 22日");
        // 1年間の月平均で割る設定：300,000 × 1.5日 × 12 ÷ 245日 ＝ 22,040円
        expect(calc(monthly, rows, { absenceDeductionMethod: "annual", annualWorkDays: 245 }).unpaidLeaveDeduction).toBe(22040);
        // 欠勤控除をしない設定（完全月給制）なら、無給の休暇も引かない
        const none = calc(monthly, rows, { absenceDeductionMethod: "none", periodWorkDays: 22 });
        expect(none.unpaidLeaveDeduction).toBe(0);
        expect(none.unpaidLeaveDeductionDetail).toBe("無給の休暇 1.5日：欠勤控除をしない設定（完全月給制）なので、月給をそのまま支給します");
    });
    test("欠勤と無給の休暇は分けて引く。無給の休暇は、欠勤控除のあとの基本給まで", () => {
        const r = calc(monthly, [day("08", 0, "absent"), day("09", 0, "special", { leave_paid: 0 })], { periodWorkDays: 22 });
        expect([r.absenceDeduction, r.unpaidLeaveDeduction, r.totalEarnings]).toEqual([13636, 13636, 300000 - 27272]);
        const capped = calc(monthly, [day("08", 0, "absent"), day("09", 0, "special", { leave_paid: 0 })], { periodWorkDays: 1 });
        expect([capped.absenceDeduction, capped.unpaidLeaveDeduction]).toEqual([300000, 0]);
        expect(capped.unpaidLeaveDeductionDetail).toContain("→ 基本給の ¥0 まで");
    });
    test("半日の日は、所定労働時間の半分に足りない時間を遅刻・早退として数える", () => {
        const r = calc(monthly, [day("09", 3, "special_half", { leave_paid: 1 })], { tardyDeductionMethod: "annual", annualWorkDays: 245 });
        expect(r).toMatchObject({ tardyHours: 1, tardyDeduction: 1836 });
    });
    test("日給制：有給の休暇は日給の割合を払い、無給の休暇は払わない（半日の日は、働いた半日の日給を払う）", () => {
        const r = calc(daily, [
            day("08", 0, "special", { leave_paid: 1 }),
            day("09", 4, "special_half", { leave_paid: 1 }),
            day("10", 4, "special_half", { leave_paid: 0 }),
            day("11", 0, "special", { leave_paid: 0 }),
        ]);
        expect(r).toMatchObject({ basePay: 12000, dailyWageDays: 1, specialLeavePay: 18000, specialLeaveHours: 12, specialLeaveDays: 1.5, unpaidLeaveDays: 1.5, unpaidLeaveDeduction: 0 });
        expect(r.totalEarnings).toBe(30000);
    });
    test("時給制：有給の休暇は 時給 × 所定労働時間（半日は半分）を払う", () => {
        const r = calc(hourly, [
            day("08", 0, "special", { leave_paid: 1 }),
            day("09", 4, "special_half", { leave_paid: 1 }),
            day("10", 4, "special_half", { leave_paid: 0 }),
        ]);
        expect(r).toMatchObject({ basePay: 9600, specialLeavePay: 14400, specialLeaveHours: 12, totalEarnings: 24000 });
    });
    test("有給かがわからない日（leave_paid がない）は、払う額が少なくならないように有給として扱う", () => {
        expect(calc(hourly, [day("08", 0, "special")]).specialLeavePay).toBe(9600);
        expect(calc(monthly, [day("08", 0, "special")], { periodWorkDays: 22 }).unpaidLeaveDeduction).toBe(0);
    });
    test("時間単位（子の看護等休暇など）・月給制の無給の時間：遅刻・早退・中抜けの控除と同じ1時間あたりの額で引く（300,000 × 3時間 ÷（245日 × 8時間 ÷ 12）＝ 5,510円）", () => {
        const rows = [day("08", 5, "normal", { special_leave_hours: 3, leave_paid: 0 })];
        const r = calc(monthly, rows, { tardyDeductionMethod: "annual", annualWorkDays: 245 });
        expect(r).toMatchObject({ unpaidLeaveHours: 3, unpaidLeaveDeduction: 5510, tardyHours: 0, tardyDeduction: 0, totalEarnings: 300000 - 5510 });
        expect(r.unpaidLeaveDeductionDetail).toBe("月給 ¥300,000 × 無給の休暇 3時間 ÷ 1か月平均所定労働時間（245日 × 8時間 ÷ 12）");
        // 遅刻・早退・中抜けを引かない設定（初めの値）なら、無給の時間も引かない
        const none = calc(monthly, rows, { annualWorkDays: 245 });
        expect([none.unpaidLeaveDeduction, none.tardyDeduction, none.totalEarnings]).toEqual([0, 0, 300000]);
        expect(none.unpaidLeaveDeductionDetail).toBe("無給の休暇 3時間：給与規定グループで遅刻・早退・中抜けを引かない設定なので、月給をそのまま支給します");
        // 1日の無給の休暇と時間の無給の休暇は、合わせて「無給休暇控除」にする
        const both = calc(monthly, [...rows, day("09", 0, "special", { leave_paid: 0 })], { tardyDeductionMethod: "annual", annualWorkDays: 245, absenceDeductionMethod: "annual" });
        expect(both.unpaidLeaveDeduction).toBe(Math.floor(300000 * 12 / 245) + 5510);
        expect(both.unpaidLeaveDeductionDetail).toContain("／");
    });
    test("時間単位・有給の時間：月給制は引かず、時給制は 時給 × 時間、日給制は 日給 × 時間 ÷ 所定労働時間 を払う", () => {
        const paid = { special_leave_hours: 3, leave_paid: 1 };
        expect(calc(monthly, [day("08", 5, "normal", paid)], { tardyDeductionMethod: "annual", annualWorkDays: 245 }))
            .toMatchObject({ unpaidLeaveDeduction: 0, tardyDeduction: 0, totalEarnings: 300000 });
        expect(calc(hourly, [day("08", 5, "normal", paid)])).toMatchObject({ basePay: 6000, specialLeavePay: 3600, specialLeaveHours: 3, totalEarnings: 9600 });
        expect(calc(daily, [day("08", 5, "normal", paid)])).toMatchObject({ basePay: 7500, specialLeavePay: 4500, dailyWageDays: 0.625, totalEarnings: 12000 });
        // 無給なら、日給は働いた時間の割合だけ
        expect(calc(daily, [day("08", 5, "normal", { special_leave_hours: 3, leave_paid: 0 })])).toMatchObject({ basePay: 7500, specialLeavePay: 0, totalEarnings: 7500 });
    });
    test("時間単位の休暇の時間は、時間有給と同じく所定労働時間から引いて残業を数える（3時間休んで6時間働いたら、1時間は法定内残業）", () => {
        const r = calc(monthly, [day("08", 6, "normal", { special_leave_hours: 3, leave_paid: 1 })]);
        expect(r.totalStatutoryOvertimeHours).toBe(1);
    });
    test("確定した結果に、無給の休暇の控除の額を残す", async () => {
        const db = new Database(":memory:");
        for (const s of DB_SCHEMAS) db.exec(s);
        db.exec("INSERT INTO staff (id, name, base_wage) VALUES ('S001', '山田', 300000)");
        const asyncDb = { execute: async (sql: string, params: any[]) => db.prepare(sql).run(...params) };
        const r = calc(monthly, [day("08", 0, "special", { leave_paid: 0 })], { periodWorkDays: 22 });
        expect(await saveSalaryResult(asyncDb, "S001", 2026, 6, r, monthly)).toEqual({ success: true });
        expect(db.query("SELECT unpaid_leave_deduction AS d, total_earnings AS t FROM salary_results").get()).toEqual({ d: 13636, t: 300000 - 13636 });
    });
});

describe("フレックスタイム制（清算期間は計算期間の1か月。1日8時間・週40時間では数えず、合計で清算する。utils/flexTime.ts）", () => {
    const flexMonthly = { ...monthly, is_flex: 1 };
    const flexHourly = { ...hourly, is_flex: 1 };
    /** 6月1日から、その時間ずつ働いた日を n 日 */
    const june = (n: number, hours: number) => Array.from({ length: n }, (_, i) => day(String(i + 1).padStart(2, "0"), hours));
    const base = { period: { start: "2026-06-01", end: "2026-06-30" }, periodWorkDays: 22, employedWorkDays: 22, annualWorkDays: 245 };
    const fiveDay = { total: { mode: "workdays" as const }, limit: "fiveDay" as const, shortage: "deduct" as const };
    const fixed160 = { total: { mode: "fixed" as const, hours: 160 }, limit: "standard" as const, shortage: "deduct" as const };

    test("月給制：1日9時間でも日ごとの残業はなく、総枠（176時間）を超えた4時間だけ時間外（1,836.73…円 × 1.25 × 4時間 ＝ 9,184円）", () => {
        const r = calc(flexMonthly, june(20, 9), { ...base, flexRule: fiveDay });
        expect(r.flex).toMatchObject({ actualHours: 180, limitHours: 176, overtimeHours: 4, shortageHours: 0 });
        expect([r.totalOvertimeHours, r.standardOvertimePay, r.statutoryOvertimePay]).toEqual([4, 9184, 0]);
        expect(r.totalEarnings).toBe(300000 + 9184);
        // フレックスでない人は、日ごとの1時間ずつ（20時間）と、週40時間を超えた時間（土日も働いているので40時間）が残業になる
        expect(calc(monthly, june(20, 9), base).totalOvertimeHours).toBe(60);
    });
    test("月給制の不足時間：その月で清算するなら、月給 × 6時間 ÷ 1か月平均所定労働時間 ＝ 11,020円を引く。欠勤控除・遅刻早退控除は別に引かない", () => {
        const rows = [...june(19, 8), day("25", 2), day("26", 0, "absent"), day("29", 7)];
        const r = calc(flexMonthly, rows.slice(0, 20), { ...base, flexRule: fixed160, tardyDeductionMethod: "annual" });
        expect(r.flex).toMatchObject({ actualHours: 154, shortageHours: 6, deductHours: 6 });
        expect([r.flexShortageDeduction, r.absenceDeduction, r.tardyDeduction]).toEqual([11020, 0, 0]);
        expect(r.flexShortageDetail).toBe("月給 ¥300,000 × フレックスの不足時間 6時間 ÷ 1か月平均所定労働時間（245日 × 8時間 ÷ 12）");
        expect(r.totalEarnings).toBe(300000 - 11020);
        const withAbsent = calc(flexMonthly, rows.slice(0, 21), { ...base, flexRule: fixed160 });
        expect([withAbsent.absenceDeduction, withAbsent.absenceDays]).toEqual([0, 1]);
    });
    test("月給制の不足時間：次の月に繰り越すなら引かずに残し、次の月の総労働時間に足す", async () => {
        const rows = [...june(19, 8), day("25", 2)];
        const r = calc(flexMonthly, rows, { ...base, flexRule: { ...fixed160, shortage: "carry" } });
        expect([r.flexShortageDeduction, r.flexCarryOutHours, r.totalEarnings]).toEqual([0, 6, 300000]);
        const db = new Database(":memory:");
        for (const sql of DB_SCHEMAS) db.exec(sql);
        db.exec("INSERT INTO staff (id, name, base_wage) VALUES ('S001', '山田', 300000)");
        const asyncDb = { execute: async (sql: string, params: any[]) => db.prepare(sql).run(...params) };
        expect(await saveSalaryResult(asyncDb, "S001", 2026, 6, r, monthly)).toEqual({ success: true });
        expect(db.query("SELECT flex_carry_hours AS h FROM salary_results").get()).toEqual({ h: 6 });
        // 次の月：繰り越した6時間を足して166時間。166時間働けば足りる
        const next = calc(flexMonthly, [...june(20, 8), day("25", 6)], { ...base, flexRule: fixed160, flexCarryIn: 6 });
        expect(next.flex).toMatchObject({ requiredHours: 166, carryInHours: 6, shortageHours: 0, excessHours: 0 });
        // フレックスでない人の結果には、繰り越しを残さない
        const db2 = new Database(":memory:");
        for (const sql of DB_SCHEMAS) db2.exec(sql);
        db2.exec("INSERT INTO staff (id, name, base_wage) VALUES ('S001', '山田', 300000)");
        await saveSalaryResult({ execute: async (sql: string, params: any[]) => db2.prepare(sql).run(...params) }, "S001", 2026, 6, calc(monthly, rows, base), monthly);
        expect(db2.query("SELECT flex_carry_hours AS h FROM salary_results").get()).toEqual({ h: null });
    });
    test("総労働時間どおり働いても、総枠（171時間25分）を超えた4時間35分には割増分を払う（1,836.73…円 × 0.25 × 275分 ÷ 60 ＝ 2,104.59…円 → 2,105円）", () => {
        const r = calc(flexMonthly, june(22, 8), { ...base });
        expect(r.standardOvertimePay).toBe(2105);
        expect(r.totalEarnings).toBe(300000 + 2105);
    });
    test("総労働時間を超えて法定の総枠までの時間は、法定内（1.0倍）で払う（総労働時間160時間で168時間なら8時間）", () => {
        const r = calc(flexMonthly, [...june(21, 8)], { ...base, flexRule: fixed160 });
        expect(r.flex).toMatchObject({ excessHours: 8, innerHours: 8, overtimeHours: 0 });
        expect([r.totalStatutoryOvertimeHours, r.statutoryOvertimePay]).toEqual([8, Math.round(300000 / (245 * 8 / 12) * 8)]);
    });
    test("時給制：働いた時間の分を払い、法定の総枠（171時間25分）を超えた8時間35分の割増分（25%）だけを足す。不足時間は引かない", () => {
        const r = calc(flexHourly, june(20, 9), { ...base });
        expect(r.basePay).toBe(1200 * 180);
        expect(Math.round(r.flex!.overtimeHours * 60)).toBe(8 * 60 + 35);
        expect(r.standardOvertimePay).toBe(Math.round(1200 * 0.25 * (8 * 60 + 35) / 60));
        expect(r.totalEarnings).toBe(1200 * 180 + r.standardOvertimePay);
        const short = calc(flexHourly, june(10, 8), { ...base });
        expect([short.flexShortageDeduction, short.flexCarryOutHours, short.flex!.deductHours]).toEqual([0, 0, 0]);
    });
    test("法定休日の労働は、清算に入れず休日労働（35%増）として払う", () => {
        const r = calc(flexMonthly, [...june(22, 8), day("07", 8, "statutory_holiday")], { ...base, flexRule: fiveDay });
        expect(r.flex).toMatchObject({ actualHours: 176, overtimeHours: 0 });
        expect([r.holidayWorkHours, r.holidayWorkPay]).toEqual([8, Math.round(300000 / (245 * 8 / 12) * 1.35 * 8)]);
    });
    test("日給制の人は、まだフレックスタイム制で計算しない（日ごと・週ごとに残業を数える）", () => {
        const r = calc({ ...hourly, wage_type: "daily", base_wage: 12000, is_flex: 1 }, june(5, 9), base);
        expect(r.flex).toBeNull();
        expect(r.totalOvertimeHours).toBe(5);
    });
});

describe("給与明細の行を足すと、ちょうど支給合計になる（時間外・休日・深夜の手当ごとに、1か月の合計で端数を処理する。基発第150号）", () => {
    /** 給与明細の支給項目の行を足した額（固定残業代がある人は、時間外手当の代わりに固定残業代と超過分の行） */
    const lineSum = (r: ReturnType<typeof calc>) => r.basePay - r.absenceDeduction - r.unpaidLeaveDeduction - r.tardyDeduction - r.flexShortageDeduction + r.statutoryOvertimePay
        + (r.fixedOvertimeAllowance > 0 ? r.fixedOvertimeAllowance + r.fixedOvertimeExcess : r.standardOvertimePay + r.highOvertimePay)
        + r.holidayWorkPay + r.paidLeavePay + r.specialLeavePay + r.nightPay + r.commutePay + r.allowanceAmount + r.customEarnings;

    test("月給301,234円・9.3時間（深夜0.3時間）の日：時間外 2,781.28…円 → 2,781円、深夜 128.37…円 → 128円（いままでは2つを合わせて四捨五入し、合計が1円多かった）", () => {
        const r = calc({ ...monthly, base_wage: 301234 }, [day("08", 9.3, "normal", { night_hours: 0.3 })]);
        expect(r.standardOvertimePay).toBe(2781);
        expect(r.nightPay).toBe(128);
        expect(r.totalEarnings).toBe(301234 + 2781 + 128);
        expect(lineSum(r)).toBe(r.totalEarnings);
    });
    test("いろいろな勤務・給与形態でも、行の合計と支給合計が同じ", () => {
        const nights = { night_hours: 2.7 };
        const cases = [
            calc({ ...monthly, base_wage: 287654 }, [...weekdays({ work_hours: 10.4 }), day("13", 6.3, "holiday_work"), day("14", 7.7, "statutory_holiday", nights)]),
            calc({ ...monthly, base_wage: 312345, fixed_overtime_hours: 5, fixed_overtime_allowance: 10000 }, weekdays({ work_hours: 11.6, night_hours: 1.3 })),
            calc({ ...hourly, base_wage: 1163 }, weekdays({ work_hours: 9.45, night_hours: 0.55 }), { customItems: [{ name: "職務手当", amount: 12345, type: "earning" }] }),
            calc({ ...monthly, wage_type: "daily", base_wage: 11111 }, [...weekdays({ work_hours: 8.9 }), day("14", 5.25, "statutory_holiday", nights)]),
            // 特別休暇（有給・無給、1日・半日）がある月
            calc({ ...monthly, wage_type: "daily", base_wage: 11111 }, [day("08", 0, "special", { leave_paid: 1 }), day("09", 4.2, "special_half", { leave_paid: 1 }), day("10", 3.9, "special_half", { leave_paid: 0 })]),
            calc({ ...hourly, base_wage: 1163 }, [day("08", 0, "special", { leave_paid: 1 }), day("09", 4.35, "special_half", { leave_paid: 1 })]),
            calc({ ...monthly, base_wage: 287654 }, [...weekdays({ work_hours: 9.1 }), day("15", 0, "special", { leave_paid: 0 })], { periodWorkDays: 22 }),
            // フレックスタイム制（時間外・法定内・不足時間）
            calc({ ...monthly, base_wage: 287654, is_flex: 1 }, Array.from({ length: 21 }, (_, i) => day(String(i + 1).padStart(2, "0"), 8.7)),
                { period: { start: "2026-06-01", end: "2026-06-30" }, periodWorkDays: 22, annualWorkDays: 245, flexRule: { total: { mode: "fixed", hours: 165.5 }, limit: "standard", shortage: "deduct" } }),
            calc({ ...monthly, base_wage: 287654, is_flex: 1 }, Array.from({ length: 15 }, (_, i) => day(String(i + 1).padStart(2, "0"), 7.9)),
                { period: { start: "2026-06-01", end: "2026-06-30" }, periodWorkDays: 22, annualWorkDays: 245 }),
            calc({ ...hourly, base_wage: 1163, is_flex: 1 }, Array.from({ length: 22 }, (_, i) => day(String(i + 1).padStart(2, "0"), 8.45)),
                { period: { start: "2026-06-01", end: "2026-06-30" }, periodWorkDays: 22 }),
        ];
        for (const r of cases) expect(lineSum(r)).toBe(r.totalEarnings);
    });
    test("端数を処理した合計を、もとの額に近くなるように行に分ける（端数の大きい行に1円を足す）", () => {
        expect(splitRoundedTotal(134659, [127840.909, 6818.18])).toEqual([127841, 6818]);
        expect(splitRoundedTotal(3, [0.6, 0.7, 0.8])).toEqual([1, 1, 1]);
        expect(splitRoundedTotal(1, [0.6, 0.6])).toEqual([1, 0]);
        expect(splitRoundedTotal(500, [500, 0])).toEqual([500, 0]);
        expect(splitRoundedTotal(0, [])).toEqual([]);
    });
});

describe("計算期間の途中で入社・退職した人の日割り（会社の規程。モデル就業規則 第46条第2項は所定労働日数）", () => {
    const june = { start: "2026-06-01", end: "2026-06-30" };
    test("日割りしない設定・期間の途中でない人は、日割りしない", () => {
        expect(prorationOf({ join_date: "2026-06-16" }, "none", june, 22, 11).proration).toBeNull();
        expect(prorationOf({ join_date: "2026-06-01" }, "calendar", june, 22, 22).proration).toBeNull();
        expect(prorationOf({ join_date: "2020-04-01", retirement_date: "2026-06-30" }, "calendar", june, 22, 22).proration).toBeNull();
    });
    test("暦日数：在籍した暦日数 ÷ 計算期間の暦日数（6月16日入社 → 15日 ÷ 30日）", () => {
        expect(prorationOf({ join_date: "2026-06-16" }, "calendar", june, null, null).proration).toEqual({ method: "calendar", numerator: 15, denominator: 30 });
        expect(prorationOf({ join_date: "2020-04-01", retirement_date: "2026-06-10" }, "calendar", june, null, null).proration)
            .toEqual({ method: "calendar", numerator: 10, denominator: 30 });
        // 同じ期間に入社して退職した
        expect(prorationOf({ join_date: "2026-06-11", retirement_date: "2026-06-20" }, "calendar", june, null, null).proration?.numerator).toBe(10);
        // 20日締め（5月21日〜6月20日）の期間に6月1日入社 → 20日 ÷ 31日
        expect(prorationOf({ join_date: "2026-06-01" }, "calendar", { start: "2026-05-21", end: "2026-06-20" }, null, null).proration)
            .toEqual({ method: "calendar", numerator: 20, denominator: 31 });
    });
    test("所定労働日数：在籍した日の所定労働日数 ÷ 計算期間の所定労働日数（呼び出し側が会社カレンダーから数えた数）", () => {
        expect(prorationOf({ join_date: "2026-06-16" }, "workdays", june, 22, 11).proration).toEqual({ method: "workdays", numerator: 11, denominator: 22 });
        const missing = prorationOf({ join_date: "2026-06-16" }, "workdays", june, null, null);
        expect(missing.proration).toBeNull();
        expect(missing.note).toContain("会社カレンダー");
        expect(prorationOf({ join_date: "2026-06-16" }, "workdays", june, 0, 0).note).toContain("所定労働日がない");
    });
    test("日割りした額は1円未満を切り上げる", () => {
        expect(prorate(250000, { method: "calendar", numerator: 11, denominator: 30 })).toBe(91667); // 91,666.66…
        expect(prorate(300000, { method: "calendar", numerator: 15, denominator: 30 })).toBe(150000);
        expect(prorate(300000, null)).toBe(300000);
    });
    test("月給と「固定」の支給項目を日割りし、「変動」の項目・残業代の時給・欠勤控除は日割りする前の額で計算する", () => {
        const joined = { ...monthly, join_date: "2026-06-16" };
        const items = [
            { name: "役職手当", amount: 20000, type: "earning" as const, fixed: true },
            { name: "資格手当", amount: 5000, type: "earning" as const, fixed: false },
            { name: "社宅費", amount: 3000, type: "deduction" as const, fixed: true },
        ];
        const r = calc(joined, [day("17", 0, "absent")], { prorationMethod: "calendar", period: june, customItems: items, annualWorkDays: 245 });
        expect(r.proration).toEqual({ method: "calendar", numerator: 15, denominator: 30 });
        expect(r.basePay).toBe(150000);
        // avg は平均賃金での扱い（固定は月で決まる賃金、変動は日・時間で決まる賃金。utils/averageWage.ts）
        expect(r.customEarningLines).toEqual([{ name: "役職手当", amount: 10000, avg: "month" }, { name: "資格手当", amount: 5000, avg: "time" }]);
        expect(r.customDeductionLines).toEqual([{ name: "社宅費", amount: 3000 }]);
        expect(r.absenceDeduction).toBe(13636); // 300,000 ÷ 22日（日割りする前の月給）
        expect(r.overtimeHourlyRate).toBeCloseTo((300000 + 25000) / (245 * 8 / 12), 10);
        expect(r.totalEarnings).toBe(150000 - 13636 + 10000 + 5000);
    });
    test("時給制・日給制の人は基本給を日割りしない（固定の支給項目は日割りする）", () => {
        const r = calc({ ...hourly, join_date: "2026-06-16" }, [day("16", 8)], {
            prorationMethod: "calendar", period: june, customItems: [{ name: "役職手当", amount: 20000, type: "earning", fixed: true }],
        });
        expect(r.basePay).toBe(9600);
        expect(r.customEarnings).toBe(10000);
    });
});

describe("社会保険料の徴収月（当月徴収・翌月徴収。健康保険法167条・厚生年金保険法84条）", () => {
    const at = (staff: any, year: number, month: number, o: Partial<SalaryExtras> = {}) =>
        calculateSalary(staff, [], extras(o), year, month, company);
    const next = { socialInsCollection: "next" as const };
    const premiums = (r: ReturnType<typeof at>) => [r.healthInsurance, r.nursingInsurance, r.childSupport, r.welfarePension];

    test("翌月徴収は、前月の分の保険料を引く（1月の給与は前の年の12月分）", () => {
        expect(socialInsMonthsOf(monthly, 2026, 6, "next")).toEqual([{ year: 2026, month: 5 }]);
        expect(socialInsMonthsOf(monthly, 2026, 1, "next")).toEqual([{ year: 2025, month: 12 }]);
        expect(socialInsMonthsOf(monthly, 2026, 6, "current")).toEqual([{ year: 2026, month: 6 }]);
        expect(at(monthly, 2026, 6, next).socialInsMonths).toEqual(["2026-05"]);
    });
    test("料率は保険料の月のもの：翌月徴収の3月の給与は、2月分（前の年度の料率）で計算する", () => {
        const mar = at(monthly, 2026, 3, next);
        expect(premiums(mar)).toEqual(premiums(at(monthly, 2026, 2)));
        expect(mar.healthInsurance).not.toBe(at(monthly, 2026, 3).healthInsurance);
    });
    test("子ども・子育て支援金（4月分から）は、翌月徴収なら5月の給与から引く", () => {
        expect(at(monthly, 2026, 4).childSupport).toBeGreaterThan(0);
        expect(at(monthly, 2026, 4, next).childSupport).toBe(0);
        expect(at(monthly, 2026, 5, next).childSupport).toBe(at(monthly, 2026, 4).childSupport);
    });
    test("入社した月の給与からは引かず、次の月の給与から入社した月の分を引く", () => {
        const joined = { ...monthly, join_date: "2026-06-10" };
        expect(premiums(at(joined, 2026, 6, next))).toEqual([0, 0, 0, 0]);
        expect(premiums(at(joined, 2026, 7, next))).toEqual(premiums(at(joined, 2026, 6)));
    });
    test("月末に退職するときは、最後の給与から前月と退職した月の2か月分を引ける（使用されなくなった場合）", () => {
        const retiring = { ...monthly, retirement_date: "2026-06-30" };
        const one = at(retiring, 2026, 6, next);
        expect(one.retirementMonthCollectable).toBe(true);
        expect(one.socialInsMonths).toEqual(["2026-05"]);
        const two = at(retiring, 2026, 6, { ...next, collectRetirementMonth: true });
        expect(two.socialInsMonths).toEqual(["2026-05", "2026-06"]);
        expect(two.welfarePension).toBe(at(retiring, 2026, 5).welfarePension + at(retiring, 2026, 6).welfarePension);
        // 翌月払いで、翌月にも給与を払うなら、その給与で退職した月の分を引く
        expect(premiums(at(retiring, 2026, 7, next))).toEqual(premiums(at(retiring, 2026, 6)));
    });
    test("月の途中で退職したら、退職した月の分はかからないので、2か月分にはならない", () => {
        const midMonth = { ...monthly, retirement_date: "2026-06-15" };
        const r = at(midMonth, 2026, 6, { ...next, collectRetirementMonth: true });
        expect(r.retirementMonthCollectable).toBe(false);
        expect(r.socialInsMonths).toEqual(["2026-05"]);
        expect(premiums(at(midMonth, 2026, 7, next))).toEqual([0, 0, 0, 0]);
    });
    test("産休・育休の免除も保険料の月で決まる（5月分が免除なら、翌月徴収は6月の給与から引かない）", () => {
        const leave = { ...monthly, leave_periods: JSON.stringify([{ type: "maternity", start: "2026-05-01", end: "2026-05-31" }]) };
        expect(premiums(at(leave, 2026, 6, next))).toEqual([0, 0, 0, 0]);
        expect(at(leave, 2026, 6).healthInsurance).toBeGreaterThan(0);
    });
    test("雇用保険料は、徴収月に関係なく、その月に支払った賃金にかかる", () => {
        expect(at(monthly, 2026, 4, next).empInsurance).toBe(at(monthly, 2026, 4).empInsurance);
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
    test("マイカー通勤の人は、片道の距離の区分の額まで（2026年6月：片道12kmなら 7,300円。超えた分は課税）", () => {
        const car = { ...monthly, commute_type: "monthly", commute_amount: 10000, commute_setting: JSON.stringify({ method: "vehicle", distanceKm: 12 }) };
        const r = calc(car, []);
        expect(r.commuteMethod).toBe("vehicle");
        expect(r.commuteTaxFreeLimit).toBe(7300);
        expect(r.nonTaxableCommute).toBe(7300);
        expect(r.taxableAmount).toBe(300000 + 10000 - 7300);
    });
    test("マイカー通勤で片道2km未満の人は、通勤手当の全額に所得税がかかる", () => {
        const near = { ...monthly, commute_type: "monthly", commute_amount: 5000, commute_setting: JSON.stringify({ method: "vehicle", distanceKm: 1.5, parking: 3000 }) };
        const r = calc(near, []);
        expect(r.nonTaxableCommute).toBe(0);
        expect(r.taxableAmount).toBe(305000);
    });
    test("日額で払う人も、1か月の合計を限度額と比べる（片道12km：日額500円 × 20日 ＝ 10,000円のうち 7,300円）", () => {
        const days = Array.from({ length: 20 }, (_, i) => day(String(i + 1).padStart(2, "0"), 8));
        const r = calc({ ...hourly, commute_type: "daily", commute_amount: 500, commute_setting: JSON.stringify({ method: "vehicle", distanceKm: 12 }) }, days);
        expect(r.commutePay).toBe(10000);
        expect(r.nonTaxableCommute).toBe(7300);
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

// 所定労働時間の中の法定外残業は、通常の賃金（1.0倍）を月給・日給で払っているので、割増分だけを払う（同じ時間に通常の賃金を2回払わない）
// 計算期間をまたぐ週は、前の計算期間の日の時間も週40時間に数える（労働基準法32条・37条）
describe("週40時間（所定労働時間の中の時間外労働・計算期間をまたぐ週）", () => {
    /** 6月8日（月）〜13日（土）。水曜を所定休日にして、6日とも8時間働いた週（48時間。週40時間を超えるのは土曜の8時間） */
    const midWeekOff = () => [day("08", 8), day("09", 8), day("10", 8, "holiday_work"), day("11", 8), day("12", 8), day("13", 8)];
    /** 日給 9,600円・所定8時間（残業代の時給 1,200円）・社保未加入 */
    const daily = {
        wage_type: "daily", base_wage: 9600, scheduled_work_hours: 8,
        commute_type: "none", commute_amount: 0, standard_remuneration: 0, birthday: "1980-01-10",
    };
    /** 計算期間 6月10日（水）〜。6月8日（月）・9日（火）は前の計算期間 */
    const period = { start: "2026-06-10", end: "2026-07-09" };
    const fromWednesday = () => [day("10", 8), day("11", 8), day("12", 8), day("13", 8, "holiday_work")];

    test("月給：週の途中の所定休日に働いても、土曜に働いたときと支給合計は同じ（通常の賃金を2回払わない）", () => {
        const mid = calc(monthly, midWeekOff());
        // 水曜の8時間は所定の外で、週40時間以内 → 法定内残業 1.0倍：1,704.54… × 8 = 13,636.36…円
        expect(mid.statutoryOvertimePay).toBe(13636);
        // 土曜の8時間は所定の中で、週40時間を超える → 割増分だけ：1,704.54… × 0.25 × 8 = 3,409.09…円
        expect(mid.standardOvertimePay).toBe(3409);
        expect(mid.standardPremiumHours).toBe(8);
        expect(mid.overtimeWithinScheduleHours).toBe(8);
        const sat = calc(monthly, [...weekdays(), day("13", 8, "holiday_work")]);
        expect(sat.overtimeWithinScheduleHours).toBe(0);
        expect(mid.totalEarnings).toBe(sat.totalEarnings);
        expect(mid.totalEarnings).toBe(317045); // 300,000 ＋ 1,704.54… × 1.25 × 8
    });
    test("日給：週の途中の所定休日に働いても、二重に払わない", () => {
        // 月火木金土の5日分の日給 ＋ 水曜 1,200 × 8（法定内残業）＋ 土曜の割増分 1,200 × 0.25 × 8
        const r = calc(daily, midWeekOff().map((x) => ({ ...x, actual_base_wage: 9600 })));
        expect(r.basePay).toBe(48000);
        expect(r.statutoryOvertimePay).toBe(9600);
        expect(r.standardOvertimePay).toBe(2400);
        expect(r.overtimeWithinScheduleHours).toBe(8);
        // 土曜に所定休日出勤したとき（48,000 ＋ 1,200 × 1.25 × 8）と同じ
        expect(r.totalEarnings).toBe(60000);
    });
    test("時給：所定労働日の週40時間超は、手当の分も割増分だけ（時給の分は、これまでどおり割増分だけ）", () => {
        // 1年間 240日 × 8時間 ÷ 12 = 160時間。役職手当 16,000円 ÷ 160 = 100円
        // 月〜土の6日を「出勤」で8時間ずつ → 土曜の8時間は週40時間超で所定の中：(1,200 ＋ 100) × 0.25 × 8 = 2,600円
        const allowance = [{ name: "役職手当", amount: 16000, type: "earning" as const }];
        const sixDays = [...weekdays(), day("13", 8)];
        const r = calc(hourly, sixDays, { annualWorkDays: 240, customItems: allowance });
        expect(r.standardOvertimePay).toBe(2600);
        expect(r.overtimeWithinScheduleHours).toBe(8);
        expect(calc(hourly, sixDays).standardOvertimePay).toBe(2400); // 手当がなければ 1,200 × 0.25 × 8
    });
    test("所定労働時間が週40時間を超える人（1日7時間 × 6日）は、40時間を超えた2時間に割増分だけを払う", () => {
        const seven = { ...monthly, scheduled_work_hours: 7 };
        const r = calc(seven, ["08", "09", "10", "11", "12", "13"].map((d) => day(d, 7)));
        // 残業代の時給 300,000 ÷ (22日 × 7時間) = 1,948.05…円。土曜の2時間：1,948.05… × 0.25 × 2 = 974.02…円
        expect(r.standardPremiumHours).toBe(2);
        expect(r.overtimeWithinScheduleHours).toBe(2);
        expect(r.standardOvertimePay).toBe(974);
        expect(r.statutoryOvertimePay).toBe(0);
    });
    test("月60時間を超えた時間が所定労働時間の中なら、50%増の分だけを払う", () => {
        // 6月1日〜19日の平日15日に12時間ずつ（日の残業 4時間 × 15日 ＝ 60時間）。22日〜27日は水曜を所定休日にして6日とも8時間
        const long = ["01", "02", "03", "04", "05", "08", "09", "10", "11", "12", "15", "16", "17", "18", "19"].map((d) => day(d, 12));
        const week4 = [day("22", 8), day("23", 8), day("24", 8, "holiday_work"), day("25", 8), day("26", 8), day("27", 8)];
        const r = calc(monthly, [...long, ...week4]);
        const rate = r.overtimeHourlyRate;
        expect([r.standardPremiumHours, r.highPremiumHours, r.overtimeWithinScheduleHours]).toEqual([60, 8, 8]);
        const standard = rate * 1.25 * 60, high = rate * 0.5 * 8; // 127,840.90…円 と 6,818.18…円
        expect(r.highOvertimePay).toBe(Math.floor(high)); // 27日（土）：60時間を超え、所定の中の時間
        // 時間外労働の手当（25%・50%）は合わせて四捨五入し（134,659.09…円 → 134,659円）、端数の大きい25%の行に1円を足す
        expect(r.standardOvertimePay + r.highOvertimePay).toBe(Math.round(standard + high));
        expect(r.standardOvertimePay).toBe(Math.floor(standard) + 1);
        expect(r.statutoryOvertimePay).toBe(Math.floor(rate * 8));  // 24日（水）：所定の外で、週40時間以内
    });
    test("計算期間をまたぐ週は、前の計算期間の日の時間も週40時間に数える（その日の分は払わない）", () => {
        const r = calc(monthly, fromWednesday(), { period, weekCarryOver: [day("08", 8), day("09", 8)] });
        // 8日〜12日で40時間 → 13日（土）の8時間が週40時間超：1,704.54… × 1.25 × 8 = 17,045.45…円
        expect(r.standardPremiumHours).toBe(8);
        expect(r.standardOvertimePay).toBe(17045);
        expect(r.statutoryOvertimePay).toBe(0);
        expect(r.totalWorkHours).toBe(32);
        expect(r.weekCarryOver).toEqual({ from: "2026-06-07", to: "2026-06-09", hours: 16 });
        // 前の計算期間の日を渡さないと、週40時間を超えない（土曜は法定内残業 1.0倍：1,704.54… × 8）
        const without = calc(monthly, fromWednesday(), { period });
        expect(without.standardPremiumHours).toBe(0);
        expect(without.statutoryOvertimePay).toBe(13636);
        expect(without.weekCarryOver).toBeNull();
    });
    test("時給：前の計算期間の日も数えて、週40時間を超えた時間に割増を払う", () => {
        const r = calc(hourly, fromWednesday(), { period, weekCarryOver: [day("08", 8), day("09", 8)] });
        expect(r.basePay).toBe(1200 * 32);
        expect(r.standardOvertimePay).toBe(2400); // 1,200 × 0.25 × 8
    });
    test("前の計算期間の日のうち、ほかの週の日・計算期間の日・法定休日の労働は数えない", () => {
        const carry = [day("06", 8), day("07", 8, "statutory_holiday"), day("08", 8), day("10", 8)];
        const r = calc(monthly, fromWednesday(), { period, weekCarryOver: carry });
        expect(r.weekCarryOver).toEqual({ from: "2026-06-07", to: "2026-06-09", hours: 8 });
        expect(r.standardPremiumHours).toBe(0); // 8時間 ＋ 32時間 ＝ 40時間なので、週40時間を超えない
    });
    test("前の計算期間の日の範囲：計算期間の初めの日がある週のうち、初めの日より前の日", () => {
        expect(weekCarryOverRange("2026-12-01", 0)).toEqual({ from: "2026-11-29", to: "2026-11-30" }); // 12月1日は火曜
        expect(weekCarryOverRange("2026-11-01", 0)).toBeNull(); // 11月1日は日曜（週の最初の日）
        expect(weekCarryOverRange("2026-12-01", 1)).toEqual({ from: "2026-11-30", to: "2026-11-30" }); // 週の起算が月曜
        expect(weekCarryOverRange("", 0)).toBeNull();
    });
    test("前の計算期間の日の、確定した勤怠だけを読む", async () => {
        const db = new Database(":memory:");
        for (const s of DB_SCHEMAS) db.exec(s);
        db.exec("INSERT INTO staff (id, name, base_wage) VALUES ('S001', '山田', 300000), ('S002', '佐藤', 300000)");
        const add = db.prepare("INSERT INTO attendance (staff_id, work_date, work_hours, work_type, is_finalized) VALUES (?, ?, ?, ?, ?)");
        add.run("S001", "2026-11-28", 8, "normal", 1);       // 前の週
        add.run("S001", "2026-11-29", 5, "holiday_work", 1);
        add.run("S001", "2026-11-30", 8, "normal", 1);
        add.run("S001", "2026-12-01", 8, "normal", 1);       // 計算期間の日
        add.run("S002", "2026-11-30", 8, "normal", 1);       // ほかの人
        const asyncDb = { select: async (sql: string, params: any[]) => db.prepare(sql).all(...params) };
        const rows = await loadWeekCarryOver(asyncDb, "S001", "2026-12-01", 0);
        expect(rows.map((r) => [r.work_date, r.work_hours, r.work_type])).toEqual([
            ["2026-11-29", 5, "holiday_work"], ["2026-11-30", 8, "normal"],
        ]);
        db.exec("UPDATE attendance SET is_finalized = 0 WHERE work_date = '2026-11-29'");
        expect((await loadWeekCarryOver(asyncDb, "S001", "2026-12-01", 0)).map((r) => r.work_date)).toEqual(["2026-11-30"]);
        expect(await loadWeekCarryOver(asyncDb, "S001", "2026-11-01", 0)).toEqual([]); // 週の最初の日から始まる期間
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

describe("非固定的賃金（月変の年間平均に使う。日本年金機構 年金用語集「固定的賃金」「非固定的賃金」）", () => {
    // 月〜水10時間（日の残業 2時間×3日）＋木金8時間＋土曜8時間（週の残業8時間）＝ 時間外労働14時間
    const overtimeRows = [day("08", 10), day("09", 10), day("10", 10), day("11", 8), day("12", 8), day("13", 8, "holiday_work")];
    test("残業代は非固定的賃金、基本給は固定的賃金", () => {
        const r = calc(monthly, overtimeRows);
        expect(r.totalEarnings).toBe(329830);
        expect(r.nonFixedEarnings).toBe(29830);
        expect(calc(monthly, weekdays()).nonFixedEarnings).toBe(0);
    });
    test("固定残業代は固定的賃金、固定残業代を超えた超過分は非固定的賃金", () => {
        const r = calc({ ...monthly, fixed_overtime_hours: 14, fixed_overtime_allowance: 20000 }, overtimeRows);
        expect(r.nonFixedEarnings).toBe(9830);
    });
    test("法定内残業・休日労働・深夜労働の手当は非固定的賃金（固定残業代があっても）", () => {
        const rows = [...weekdays().map((r, i) => (i === 0 ? { ...r, night_hours: 2 } : r)), day("14", 8, "statutory_holiday")];
        const seven = { ...monthly, scheduled_work_hours: 7 };
        const without = calc(seven, rows);
        expect(without.nonFixedEarnings).toBe(without.totalEarnings - 300000);
        expect(calc({ ...seven, fixed_overtime_hours: 10, fixed_overtime_allowance: 25000 }, rows).nonFixedEarnings).toBe(without.nonFixedEarnings);
    });
    test("「変動（毎月入力）」の支給項目は非固定的賃金、「固定（毎月同額）」の項目と通勤手当は固定的賃金", () => {
        const r = calc({ ...monthly, commute_type: "monthly", commute_amount: 12000 }, weekdays(), {
            customItems: [
                { name: "住宅手当", amount: 10000, type: "earning", fixed: true },
                { name: "皆勤手当", amount: 5000, type: "earning", fixed: false },
                { name: "互助会費", amount: 1000, type: "deduction" },
            ],
        });
        expect(r.totalEarnings).toBe(300000 + 12000 + 10000 + 5000);
        expect(r.nonFixedEarnings).toBe(5000);
    });
    test("時給制の基本給（時給×時間）は固定的賃金", () => {
        expect(calc(hourly, weekdays({ actual_base_wage: 1200 })).nonFixedEarnings).toBe(0);
    });
    test("確定した結果に保存する", async () => {
        const db = new Database(":memory:");
        for (const s of DB_SCHEMAS) db.exec(s);
        db.exec("INSERT INTO staff (id, name, base_wage) VALUES ('S001', '山田', 300000)");
        const asyncDb = { execute: async (sql: string, params: any[]) => db.prepare(sql).run(...params) };
        await saveSalaryResult(asyncDb, "S001", 2026, 6, calc(monthly, overtimeRows), monthly);
        expect(db.query("SELECT non_fixed_earnings AS n FROM salary_results").get()).toEqual({ n: 29830 });
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

describe("残業代の時給（1年間における1か月平均所定労働時間で割る・手当も入れる。労基則19条・21条）", () => {
    // 1年間の所定労働日数 245日（年間休日120日）・所定8時間 → 1か月平均所定労働時間 245 × 8 ÷ 12 = 163.33…時間
    const annual = { annualWorkDays: 245 };
    const items = [
        { name: "役職手当", amount: 20000, type: "earning" as const },
        { name: "家族手当", amount: 10000, type: "earning" as const, inOvertimeBase: false },
        { name: "社宅費", amount: 5000, type: "deduction" as const },
    ];
    /** 6月15日(月)〜19日(金)に8時間ずつ */
    const week2 = () => ["15", "16", "17", "18", "19"].map((d) => day(d, 8));

    test("月給は、その月の所定労働日数ではなく、1年間における1か月平均所定労働時間で割る", () => {
        // 週40時間を超えた8時間：300,000 ÷ 163.33… = 1,836.73…円 × 1.25 × 8 = 18,367.34…円
        const r = calc(monthly, [...weekdays(), day("13", 8, "holiday_work")], annual);
        expect(r.overtimeBaseHoursIsAnnual).toBe(true);
        expect(r.overtimeBaseHours).toBeCloseTo(245 * 8 / 12, 10);
        expect(r.overtimeHourlyRate).toBeCloseTo(300000 / (245 * 8 / 12), 10);
        expect(r.standardOvertimePay).toBe(18367);
        expect(r.totalEarnings).toBe(318367);
    });
    test("1年間の所定労働日数がわからないときは、その月の所定労働時間で割る（22日 × 8時間 = 176時間）", () => {
        const r = calc(monthly, [...weekdays(), day("13", 8, "holiday_work")]);
        expect(r.overtimeBaseHoursIsAnnual).toBe(false);
        expect(r.overtimeBaseHours).toBe(176);
        expect(r.standardOvertimePay).toBe(17045); // 300,000 ÷ 176 × 1.25 × 8 = 17,045.45…
    });
    test("欠勤控除は、1年間の所定労働日数を渡しても、初めの設定（計算期間の所定労働日数）で割る", () => {
        const r = calc(monthly, [day("08", 0, "absent")], { ...annual, periodWorkDays: 22 });
        expect(r.absenceDeduction).toBe(13636); // 300,000 ÷ 22日
    });
    test("「残業代の時給に入れる」手当は月給に足して割る。外した手当（家族手当など）と控除項目は入れない", () => {
        // 法定休日の8時間：(300,000 ＋ 役職手当 20,000) ÷ 163.33… = 1,959.18…円 × 1.35 × 8 = 21,159.18…円
        const r = calc(monthly, [day("07", 8, "statutory_holiday")], { ...annual, customItems: items });
        expect(r.overtimeBaseAllowances).toBe(20000);
        expect(r.overtimeHourlyRate).toBeCloseTo(320000 / (245 * 8 / 12), 10);
        expect(r.holidayWorkPay).toBe(21159);
        expect(r.totalEarnings).toBe(300000 + 20000 + 10000 + 21159);
    });
    test("固定残業代と比べる法定の割増賃金も、手当を入れた時給で計算する", () => {
        // 時間外16時間：1,959.18…円 × 1.25 × 16 = 39,183.67…円 → 39,184円。固定残業代 30,000円との差 9,184円を払う
        const fixed = { ...monthly, fixed_overtime_hours: 14, fixed_overtime_allowance: 30000 };
        const rows = [...weekdays(), day("13", 8, "holiday_work"), ...week2(), day("20", 8, "holiday_work")];
        const r = calc(fixed, rows, { ...annual, customItems: items });
        expect(r.fixedOvertimeExcess).toBe(9184);
        expect(r.totalEarnings).toBe(300000 + 30000 + 9184 + 20000 + 10000);
    });
    test("時給制の人の月額の手当は、時間あたりにして時間外・深夜の割増に足す（時給の1.0倍分は働いた時間の賃金で払う）", () => {
        // 1年間 240日 × 8時間 ÷ 12 = 160時間。役職手当 16,000円 ÷ 160 = 100円
        // 時間外8時間：(1,200 × 0.25 ＋ 100 × 1.25) × 8 = 3,400円、深夜2時間：(1,200 ＋ 100) × 0.25 × 2 = 650円
        const allowance = [{ name: "役職手当", amount: 16000, type: "earning" as const }];
        const rows = [day("08", 8, "normal", { night_hours: 2 }), ...weekdays().slice(1), day("13", 8, "holiday_work")];
        const r = calc(hourly, rows, { annualWorkDays: 240, customItems: allowance });
        expect(r.overtimeHourlyRate).toBe(1300);
        expect(r.basePay).toBe(57600);
        expect(r.standardOvertimePay).toBe(3400);
        expect(r.nightPay).toBe(650);
        expect(r.totalEarnings).toBe(57600 + 3400 + 650 + 16000);

        // 「残業代の時給に入れる」を外せば、時給だけで計算する
        const off = calc(hourly, rows, { annualWorkDays: 240, customItems: [{ ...allowance[0], inOvertimeBase: false }] });
        expect([off.standardOvertimePay, off.nightPay]).toEqual([2400, 600]);
    });
    test("給与項目の読み込み：金額が入った項目だけを読み、「残業代の時給に入れる」を外した支給項目に印を付ける", async () => {
        const db = new Database(":memory:");
        for (const s of DB_SCHEMAS) db.exec(s);
        db.exec("INSERT INTO salary_item_master (id, name, type, category, display_order) VALUES (1, '役職手当', 'earning', 'fixed', 10)");
        db.exec("INSERT INTO salary_item_master (id, name, type, category, display_order, in_overtime_base) VALUES (2, '住宅手当', 'earning', 'fixed', 20, 0)");
        db.exec("INSERT INTO salary_item_master (id, name, type, category, display_order) VALUES (3, '資格手当', 'earning', 'fixed', 30)");
        db.exec("INSERT INTO salary_item_master (id, name, type, category, display_order) VALUES (4, '社宅費', 'deduction', 'fixed', 10)");
        db.exec("INSERT INTO staff_salary_values (staff_id, item_id, amount) VALUES ('S001', 1, 20000), ('S001', 2, 15000), ('S001', 3, 0), ('S001', 4, 5000)");
        const asyncDb = { select: async (sql: string, params: any[]) => db.prepare(sql).all(...params) };
        expect(await loadCustomItems(asyncDb, "S001")).toEqual([
            { name: "役職手当", amount: 20000, type: "earning", inOvertimeBase: true, fixed: true, averageWage: "month" },
            { name: "住宅手当", amount: 15000, type: "earning", inOvertimeBase: false, fixed: true, averageWage: "month" },
            { name: "社宅費", amount: 5000, type: "deduction", inOvertimeBase: true, fixed: true, averageWage: "month" },
        ]);
    });
});

describe("日給制（日給 ÷ 1日の所定労働時間で残業代の時給を出す。労基則19条1項2号・25条）", () => {
    /** 日給 9,600円・所定8時間（残業代の時給 1,200円）・社保未加入 */
    const daily = {
        wage_type: "daily", base_wage: 9600, scheduled_work_hours: 8,
        commute_type: "none", commute_amount: 0, standard_remuneration: 0, birthday: "1980-01-10",
    };
    const withWage = (rows: any[]) => rows.map((r) => ({ ...r, actual_base_wage: 9600 }));

    test("働いた日数分の日給を払う（日給を時給として時間に掛けない）", () => {
        const r = calc(daily, withWage([day("08", 8), day("09", 8)]));
        expect(r.basePay).toBe(19200);
        expect(r.dailyWageDays).toBe(2);
        expect(r.overtimeHourlyRate).toBe(1200);
        expect(r.totalEarnings).toBe(19200);
    });
    test("1日8時間を超えた時間は、日給 ÷ 所定労働時間 × 1.25 で払う", () => {
        // 10時間働いた日の2時間：1,200 × 1.25 × 2 = 3,000円
        const r = calc(daily, withWage([day("08", 10), ...weekdays().slice(1)]));
        expect(r.basePay).toBe(48000);
        expect(r.standardOvertimePay).toBe(3000);
        expect(r.totalEarnings).toBe(51000);
    });
    test("所定7時間の人が8時間働いた日の1時間は法定内残業（1.0倍）", () => {
        // 日給 8,400円 ÷ 7時間 = 1,200円。5日 × (8,400 ＋ 1,200)
        const seven = { ...daily, base_wage: 8400, scheduled_work_hours: 7 };
        const r = calc(seven, weekdays().map((x) => ({ ...x, actual_base_wage: 8400 })));
        expect(r.basePay).toBe(42000);
        expect(r.statutoryOvertimePay).toBe(6000);
        expect(r.totalEarnings).toBe(48000);
    });
    test("所定休日・法定休日の労働には日給を払わず、時間を残業・休日労働として払う", () => {
        // 土曜（週40時間超）8時間：1,200 × 1.25 × 8 = 12,000円
        const sat = calc(daily, withWage([...weekdays(), day("13", 8, "holiday_work")]));
        expect(sat.dailyWageDays).toBe(5);
        expect(sat.standardOvertimePay).toBe(12000);
        expect(sat.totalEarnings).toBe(60000);
        // 法定休日8時間：1,200 × 1.35 × 8 = 12,960円
        const sun = calc(daily, withWage([day("07", 8, "statutory_holiday")]));
        expect([sun.basePay, sun.holidayWorkPay, sun.totalEarnings]).toEqual([0, 12960, 12960]);
    });
    test("有給休暇は日給で払い、半休・時間単位の有給は有給の時間の割合で分ける", () => {
        const rows = withWage([
            day("08", 0, "paid_full"),
            day("09", 4, "paid_half"),
            day("10", 6, "normal", { paid_leave_hours: 2 }),
            day("11", 8), day("12", 8),
        ]);
        const r = calc(daily, rows);
        // 日給：9,600 × (0.5 ＋ 0.75 ＋ 1 ＋ 1) = 31,200円、有給：9,600 × (1 ＋ 0.5 ＋ 0.25) = 16,800円
        expect(r.dailyWageDays).toBe(3.25);
        expect(r.basePay).toBe(31200);
        expect(r.paidLeavePay).toBe(16800);
        expect(r.paidLeaveHours).toBe(14);
        expect(r.totalEarnings).toBe(48000);
    });
    test("欠勤・公休の日は日給を払わない（欠勤控除はしない）", () => {
        const r = calc(daily, withWage([day("08", 0, "absent"), day("09", 0, "holiday"), day("10", 8)]));
        expect([r.basePay, r.absenceDeduction, r.totalEarnings]).toEqual([9600, 0, 9600]);
    });
    test("深夜の時間は 日給 ÷ 所定労働時間 × 0.25 を足す", () => {
        const r = calc(daily, withWage([day("08", 8, "normal", { night_hours: 2 })]));
        expect(r.nightPay).toBe(600);
        expect(r.totalEarnings).toBe(10200);
    });
    test("月額の手当は、1年間における1か月平均所定労働時間で割って残業代の時給に足す", () => {
        // 役職手当 16,000円 ÷ (240日 × 8時間 ÷ 12 = 160時間) = 100円 → 残業代の時給 1,300円。2時間 × 1.25 = 3,250円
        const allowance = [{ name: "役職手当", amount: 16000, type: "earning" as const }];
        const r = calc(daily, withWage([day("08", 10), ...weekdays().slice(1)]), { annualWorkDays: 240, customItems: allowance });
        expect(r.overtimeHourlyRate).toBe(1300);
        expect(r.standardOvertimePay).toBe(3250);
        expect(r.totalEarnings).toBe(48000 + 3250 + 16000);
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

describe("休業・休職の日の給与（決まりは leaveOfAbsence.ts。2026年6月は平日22日）", () => {
    const JUNE = { start: "2026-06-01", end: "2026-06-30" };
    const leaves = (...list: [string, string, string][]) => JSON.stringify(list.map(([type, start, end]) => ({ type, start, end })));
    // 6月16日から休業：休業していない所定労働日は 6/1〜15 の平日11日
    const fromJune16 = (type = "childcare") => leaves([type, "2026-06-16", "2027-03-31"]);
    const opts = (o: Partial<SalaryExtras> = {}): Partial<SalaryExtras> => ({ period: JUNE, periodWorkDays: 22, nonLeaveWorkDays: 11, ...o });
    const items = [
        { name: "役職手当", amount: 20000, type: "earning" as const, fixed: true },
        { name: "資格手当", amount: 5000, type: "earning" as const, fixed: false },
    ];

    test("まるごと休業の月：月給・固定の支給項目・固定残業代・通勤手当（月額）を払わない（「変動」の項目は入れた額）", () => {
        const staff = {
            ...monthly, commute_type: "monthly", commute_amount: 10000, fixed_overtime_allowance: 30000, fixed_overtime_hours: 20,
            leave_periods: leaves(["childcare", "2026-05-20", "2027-03-31"]),
        };
        const r = calc(staff, [], opts({ nonLeaveWorkDays: 0, customItems: items }));
        expect(r.leave).toEqual({ types: ["childcare"], days: 30, full: true, paidDays: 0, workedDates: [] });
        expect([r.basePay, r.commutePay, r.fixedOvertimeAllowance]).toEqual([0, 0, 0]);
        expect(r.customEarningLines).toEqual([{ name: "役職手当", amount: 0, avg: "month" }, { name: "資格手当", amount: 5000, avg: "time" }]);
        expect(r.totalEarnings).toBe(5000);
        // 育休なので社会保険料は免除（雇用保険料は払った給与にかかる）
        expect([r.healthInsurance, r.welfarePension]).toEqual([0, 0]);
    });
    test("途中で休業が始まる月：所定労働日数で日割り（初めの値）。通勤手当・固定残業代は日割りしない", () => {
        const staff = { ...monthly, commute_type: "monthly", commute_amount: 10000, leave_periods: fromJune16() };
        const r = calc(staff, [], opts({ customItems: items }));
        expect(r.proration).toEqual({ method: "workdays", numerator: 11, denominator: 22, reason: "leave" });
        expect(r.basePay).toBe(150000);
        expect(r.customEarningLines[0]).toEqual({ name: "役職手当", amount: 10000, avg: "month" });
        expect(r.commutePay).toBe(10000);
        expect(r.leave).toMatchObject({ days: 15, full: false, paidDays: 11 });
    });
    test("暦日数で日割り・日割りしない（まるごと休業の月は、日割りしない設定でも払わない）", () => {
        const cal = calc({ ...monthly, leave_periods: fromJune16() }, [], opts({ leaveProrationMethod: "calendar" }));
        expect(cal.proration).toEqual({ method: "calendar", numerator: 15, denominator: 30, reason: "leave" });
        expect(cal.basePay).toBe(150000);
        expect(cal.leave?.paidDays).toBe(15);
        const none = calc({ ...monthly, leave_periods: fromJune16() }, [], opts({ leaveProrationMethod: "none" }));
        expect([none.basePay, none.leave?.paidDays]).toEqual([300000, null]);
        const fullNone = calc({ ...monthly, leave_periods: leaves(["childcare", "2026-05-20", "2027-03-31"]) }, [], opts({ leaveProrationMethod: "none", nonLeaveWorkDays: 0 }));
        expect(fullNone.basePay).toBe(0);
    });
    test("休業の日のほかに所定労働日がない月も、まるごと休業の月にする（休業していない日が休日だけ）", () => {
        // 6/29 から復帰でも、会社カレンダーで 6/29・30 が休日なら、休業していない所定労働日は0日
        const r = calc({ ...monthly, commute_type: "monthly", commute_amount: 10000, leave_periods: leaves(["family_care", "2026-05-01", "2026-06-28"]) }, [],
            opts({ nonLeaveWorkDays: 0, leaveProrationMethod: "calendar" }));
        expect(r.leave?.full).toBe(true);
        expect([r.basePay, r.commutePay]).toEqual([0, 0]);
    });
    test("計算期間に所定労働日がまったくない（出勤曜日の入れ忘れなど）ときは、休業1日でまるごと休業にしない", () => {
        const r = calc({ ...monthly, leave_periods: leaves(["other", "2026-06-30", "2026-06-30"]) }, [], opts({ periodWorkDays: 0, nonLeaveWorkDays: 0 }));
        expect(r.leave?.full).toBe(false);
        expect(r.basePay).toBe(300000);
        expect(r.prorationNote).toContain("所定労働日がない");
    });
    test("会社カレンダーを読み込めていないときは、所定労働日数で日割りせずに知らせる", () => {
        const r = calc({ ...monthly, leave_periods: fromJune16() }, [], opts({ nonLeaveWorkDays: null, periodWorkDays: null }));
        expect(r.basePay).toBe(300000);
        expect(r.prorationNote).toContain("休業の日の分を日割りしていません");
        expect(r.leave?.paidDays).toBeNull();
    });
    test("休業の日の欠勤・公休の記録は使わない（欠勤控除を2回しない）。休業していない日の欠勤は引く", () => {
        const r = calc({ ...monthly, leave_periods: fromJune16() }, [day("10", 0, "absent"), day("17", 0, "absent"), day("18", 0, "holiday")], opts());
        expect(r.basePay).toBe(150000);
        expect(r.absenceDeduction).toBe(13636); // 300,000 ÷ 22日 × 1日（6/10 だけ）
        expect(r.leave?.workedDates).toEqual([]);
    });
    test("休業の日に働いた記録は、働いた時間の分を払い、知らせる（時給制）", () => {
        const r = calc({ ...hourly, leave_periods: fromJune16() }, [day("08", 8), day("17", 8)], opts());
        expect(r.basePay).toBe(1200 * 16);
        expect(r.leave).toMatchObject({ workedDates: ["2026-06-17"], paidDays: null });
    });
    test("介護休業は保険料の免除がないので、給与がない月も社会保険料を引く（差引支給額がマイナス。雇用保険料・所得税は0円）", () => {
        const r = calc({ ...monthly, leave_periods: leaves(["family_care", "2026-05-01", "2026-08-31"]) }, [], opts({ nonLeaveWorkDays: 0, residentTax: 12000 }));
        expect(r.totalEarnings).toBe(0);
        expect(r.isLeaveExemptMonth).toBe(false);
        expect(r.healthInsurance).toBe(calc(monthly, []).healthInsurance);
        expect(r.welfarePension).toBe(calc(monthly, []).welfarePension);
        expect([r.empInsurance, r.incomeTax, r.residentTax]).toEqual([0, 0, 12000]);
        expect(r.netPay).toBe(-r.totalDeductions);
        expect(r.netPay).toBeLessThan(0);
    });
    test("フレックスタイム制：休業していない日で清算する（休業の日の分を不足時間として引かない）", () => {
        const flex = { ...monthly, is_flex: 1, leave_periods: fromJune16() };
        const worked = ["01", "02", "03", "04", "05", "08", "09", "10", "11", "12", "15"].map((d) => day(d, 8));
        const r = calc(flex, worked, opts());
        expect(r.flex?.requiredHours).toBe(88); // 11日 × 8時間
        expect(r.flex?.shortageHours).toBe(0);
        expect(r.flexShortageDeduction).toBe(0);
        expect(r.basePay).toBe(150000);
        // 決めた時間（160時間）は、所定労働日数のうち休業していない日の割合（11/22）で80時間にする
        const fixed = calc(flex, worked, opts({ flexRule: { total: { mode: "fixed", hours: 160 }, limit: "standard", shortage: "deduct" } }));
        expect(fixed.flex?.requiredHours).toBe(80);
        expect(fixed.flexShortageDeduction).toBe(0);
    });
    test("確定すると、休業の月に払った日数を残す（算定・月変の支払基礎日数に使う）", async () => {
        const db = new Database(":memory:");
        for (const s of DB_SCHEMAS) db.exec(s);
        db.exec("INSERT INTO staff (id, name, base_wage) VALUES ('S001', '山田', 300000)");
        const asyncDb = { execute: async (sql: string, params: any[]) => db.prepare(sql).run(...params) };
        const staff = { ...monthly, leave_periods: fromJune16() };
        await saveSalaryResult(asyncDb, "S001", 2026, 6, calc(staff, [], opts()), staff);
        expect(db.query("SELECT leave_paid_days AS d, total_earnings AS t FROM salary_results").get()).toEqual({ d: 11, t: 150000 });
        await saveSalaryResult(asyncDb, "S001", 2026, 5, calc(monthly, [], opts()), monthly);
        expect(db.query("SELECT leave_paid_days AS d FROM salary_results WHERE target_month = 5").get()).toEqual({ d: null });
    });
});

describe("会社都合で休ませた日の休業手当（労働基準法26条）と、労災の待期の休業補償（76条）。平均賃金は averageWage.test.ts", () => {
    const JUNE = { start: "2026-06-01", end: "2026-06-30" };
    const wage = (amountSen: number | null, error: string | null = null) => ({ amountSen, error, manual: false });
    const pay = (o: Partial<AverageWagePay> = {}): AverageWagePay => ({ shutdownRate: 60, shutdownEvents: {}, waitingEvents: {}, wages: {}, ...o });
    const opts = (o: Partial<SalaryExtras> = {}): Partial<SalaryExtras> => ({ period: JUNE, periodWorkDays: 22, ...o });

    test("月給の人：休業の日を欠勤控除と同じ計算で引き、平均賃金 × 60% × 日数の休業手当を払う（続いている休業は初めの日の平均賃金）", () => {
        const rows = [day("15", 0, "company_leave"), day("16", 0, "company_leave")];
        const avg = pay({ shutdownEvents: { "2026-06-15": "2026-06-15", "2026-06-16": "2026-06-15" }, wages: { "2026-06-15": wage(1000000) } });
        const r = calc(monthly, rows, opts({ averageWagePay: avg }));
        // 休業の日の控除：300,000 × 2日 ÷ 22日 ＝ 27,272円（1円未満切り捨て）
        expect(r.shutdown).toMatchObject({ days: 2, fullDays: 2, deduction: 27272, allowance: 12000, rate: 60 });
        expect(r.shutdown?.lines[0]).toContain("平均賃金 10,000円00銭 × 60% ＝ 1日 6,000円 × 2日 ＝ ¥12,000");
        expect(r.totalEarnings).toBe(300000 - 27272 + 12000);
        // 休業手当は賃金（所得税・雇用保険の対象。月変では非固定的賃金）
        expect([r.taxableAmount, r.nonRemuneration, r.nonFixedEarnings]).toEqual([r.totalEarnings, 0, 12000]);
        // 率を上げた会社（80%）
        expect(calc(monthly, rows, opts({ averageWagePay: { ...avg, shutdownRate: 80 } })).shutdown?.allowance).toBe(16000);
    });
    test("月給の人：働いた時間がある休業の日と、完全月給制は、月給を引かずに払うので休業手当は払わない", () => {
        const avg = pay({ wages: { "2026-06-15": wage(1000000) } });
        const worked = calc(monthly, [day("15", 3, "company_leave")], opts({ averageWagePay: avg }));
        expect(worked.shutdown).toMatchObject({ deduction: 0, allowance: 0, partialDays: 1 });
        expect(worked.shutdown?.notes[0]).toContain("月給を引かずに払う");
        expect(worked.statutoryOvertimePay).toBe(0); // 働いた時間は所定労働時間の中（残業にしない）
        const none = calc(monthly, [day("15", 0, "company_leave")], opts({ averageWagePay: avg, absenceDeductionMethod: "none" }));
        expect(none.shutdown).toMatchObject({ deduction: 0, allowance: 0 });
        expect(none.totalEarnings).toBe(300000);
    });
    test("時給の人：休業の日は払わず休業手当。少し働いた日は、働いた分の賃金との差額（平均賃金 8,000円 × 60% ＝ 4,800円）", () => {
        const rows = [day("15", 0, "company_leave"), day("16", 2, "company_leave")];
        const r = calc(hourly, rows, opts({ averageWagePay: pay({ wages: { "2026-06-15": wage(800000), "2026-06-16": wage(800000) } }) }));
        expect(r.basePay).toBe(2400);
        expect(r.shutdown?.allowance).toBe(4800 + (4800 - 2400));
        expect(r.shutdownWorkedPay).toBe(2400);
        expect(r.totalEarnings).toBe(2400 + 7200);
    });
    test("日給の人：少し働いた日は、働いた時間の割合の日給と、休業手当との差額", () => {
        const daily = { ...hourly, wage_type: "daily", base_wage: 10000 };
        const r = calc(daily, [day("16", 4, "company_leave")], opts({ averageWagePay: pay({ wages: { "2026-06-16": wage(900000) } }) }));
        expect(r.basePay).toBe(5000);
        expect(r.shutdown?.allowance).toBe(400); // 9,000 × 60% ＝ 5,400 − 5,000
    });
    test("フレックスタイム制：休ませた日の所定労働時間は、働かなければならない時間から除く（不足時間にしない）", () => {
        const worked = ["01", "02", "03", "04", "05", "08", "09", "10", "11", "12", "16", "17", "18", "19", "22", "23", "24", "25", "26", "29", "30"].map((d) => day(d, 8));
        const r = calc({ ...monthly, is_flex: 1 }, [...worked, day("15", 0, "company_leave")], opts({ averageWagePay: pay({ wages: { "2026-06-15": wage(1000000) } }) }));
        expect(r.flex?.requiredHours).toBe(168); // 22日 × 8時間 − 8時間
        expect(r.flexShortageDeduction).toBe(0);
        expect(r.shutdown).toMatchObject({ deduction: 13636, allowance: 6000 });
    });
    test("平均賃金を読み込み中・出せないときは、休業手当を計算せず知らせる（給与明細は確定しない）", () => {
        const rows = [day("15", 0, "company_leave")];
        const loading = calc(monthly, rows, opts());
        expect([loading.averageWageLoading, loading.shutdown?.allowance]).toEqual([true, 0]);
        const missing = calc(monthly, rows, opts({ averageWagePay: pay({ wages: { "2026-06-15": wage(null, "2026年6月支給の給与を確定してください") } }) }));
        expect(missing.averageWageLoading).toBe(false);
        expect(missing.averageWageMissing).toEqual(["休業手当（6月15日からの休業）：2026年6月支給の給与を確定してください"]);
    });
    test("労災の待期の3日：平均賃金（事故の日）× 60% の休業補償。賃金ではないので、所得税・雇用保険の対象外", () => {
        const staff = { ...monthly, leave_periods: JSON.stringify([{ type: "injury", start: "2026-06-10", end: "2026-06-30", accident: "2026-06-09" }]) };
        const avg = pay({ wages: { "2026-06-09": wage(1000000) } });
        const r = calc(staff, [], opts({ nonLeaveWorkDays: 7, averageWagePay: avg }));
        expect(r.injuryCompensation).toMatchObject({ amount: 18000, days: 3 });
        expect(r.injuryCompensation?.lines[0]).toContain("6月9日の事故の待期（6月10日・6月11日・6月12日）");
        expect(r.nonRemuneration).toBe(18000);
        expect(r.totalEarnings).toBe(r.basePay + 18000);
        expect(r.taxableAmount).toBe(r.totalEarnings - 18000);
        // 雇用保険料は、休業補償を除いた額にかかる（休業補償がないときと同じ）
        const withoutComp = calc(staff, [], opts({ nonLeaveWorkDays: 7, averageWagePay: pay() }));
        expect(withoutComp.averageWageMissing[0]).toContain("6月9日の事故");
        expect(r.empInsurance).toBe(withoutComp.empInsurance);
        // 月給を日割りしない設定なら、待期の日も月給を払っているので払わない
        const none = calc(staff, [], opts({ nonLeaveWorkDays: 7, averageWagePay: avg, leaveProrationMethod: "none" }));
        expect(none.injuryCompensation).toMatchObject({ amount: 0 });
        expect(none.injuryCompensation?.notes[0]).toContain("日割りしない");
    });
    test("確定すると、休業の日の控除・休業手当・休業補償を内訳に残し（平均賃金での分け方も）、休業補償を賃金・報酬でない額に残す", async () => {
        const db = new Database(":memory:");
        for (const s of DB_SCHEMAS) db.exec(s);
        db.exec("INSERT INTO staff (id, name, base_wage) VALUES ('S001', '山田', 300000)");
        const asyncDb = { execute: async (sql: string, params: any[]) => db.prepare(sql).run(...params) };
        const staff = { ...monthly, leave_periods: JSON.stringify([{ type: "injury", start: "2026-06-25", end: "2026-07-31" }]) };
        const avg = pay({ wages: { "2026-06-15": wage(1000000), "2026-06-25": wage(1000000) } });
        const r = calc(staff, [day("15", 0, "company_leave")], opts({ nonLeaveWorkDays: 18, averageWagePay: avg }));
        await saveSalaryResult(asyncDb, "S001", 2026, 6, r, staff);
        const row = db.query("SELECT non_remuneration AS n, total_earnings AS t, ledger FROM salary_results").get() as { n: number; t: number; ledger: string };
        expect([row.n, row.t]).toEqual([18000, r.totalEarnings]);
        const lines = JSON.parse(row.ledger).earnings as { name: string; amount: number; avg: string }[];
        expect(lines.filter((l) => l.name.startsWith("休業"))).toEqual([
            { name: "休業の日の控除", amount: -r.shutdown!.deduction, avg: "month" },
            { name: "休業手当", amount: 6000, avg: "none" },
            { name: "休業補償(労災の待期)", amount: 18000, avg: "none" },
        ]);
        expect(lines.reduce((sum, l) => sum + l.amount, 0)).toBe(r.totalEarnings);
    });
});
