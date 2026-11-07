/**
 * 社会保険料のテスト
 * 実行方法: bun test
 *
 * 期待値は、協会けんぽの「保険料額表」（insurance-tables/ の Excel）に印刷されている
 * 「折半額」を、給与から控除するときの端数処理（50銭以下切り捨て・50銭超切り上げ）で円にしたもの。
 */
import { describe, expect, test } from "bun:test";
import { calcPremium } from "./socialInsurance";
import { getHyojunHoshu } from "./calcSalary";
import { getInsuranceMaster, isChildSupportMonth, INSURANCE_2020, INSURANCE_2020_04, INSURANCE_2020_09, INSURANCE_2021, INSURANCE_2022, INSURANCE_2023, INSURANCE_2024, INSURANCE_2025, INSURANCE_2026, LABOR_INSURANCE_PERIODS } from "../constants/insurance";
import { getTaxMasterWarnings } from "../constants/tax";

const LAW = "currency_law";

describe("端数処理（50銭以下切り捨て・50銭超切り上げ）を小数の誤差なく計算する", () => {
    test("ちょうど50銭は切り捨て（例: 68,457.5円 → 68,457円）", () => {
        // 東京・50級: 1,390,000円 × 9.85% ÷ 2 = 68,457.5
        expect(calcPremium(1390000, 9.85, LAW)).toBe(68457);
        expect(calcPremium(1390000, 9.85, "round")).toBe(68458); // 四捨五入なら切り上げ
    });
    test("Excel では 14,774.999…と表示される値も、正しく 14,775円になる", () => {
        // 東京・22級: 300,000円 × 9.85% ÷ 2 = 14,775（小数の誤差で 14,774.999… になりやすい）
        expect(calcPremium(300000, 9.85, LAW)).toBe(14775);
        expect(calcPremium(300000, 9.85, "floor")).toBe(14775);
    });
    test("50銭を超えたら切り上げ（例: 2,981.2円 → 2,981円、3,326.3円 → 3,326円、66.7円 → 67円）", () => {
        expect(calcPremium(58000, 10.28, LAW)).toBe(2981);
        expect(calcPremium(58000, 9.85 + 1.62, LAW)).toBe(3326);
        expect(calcPremium(58000, 0.23, LAW)).toBe(67);
    });
});

describe("令和8年度（協会けんぽ 令和8年3月分から）の保険料額表と照合", () => {
    const m = INSURANCE_2026;
    const h = (pref: string) => m.KENPO_RATES[pref][1];
    const care = m.KENPO_CARE_RATE[1];
    test("料率", () => {
        expect(h("北海道")).toBe(10.28);
        expect(h("東京")).toBe(9.85);
        expect(h("京都")).toBe(9.89);
        expect(care).toBe(1.62);
        expect(m.PENSION_RATE[1]).toBe(18.3);
        expect(m.CHILD_SUPPORT_RATE?.[1]).toBe(0.23);
        expect(m.CHILD_ALLOWANCE_RATE).toBe(0.36);
    });
    test("東京・22級（標準報酬月額 300,000円）", () => {
        expect(calcPremium(300000, h("東京"), LAW)).toBe(14775);          // 健康保険（折半額 14,775）
        expect(calcPremium(300000, h("東京") + care, LAW)).toBe(17205);   // 介護保険を含む（折半額 17,205）
        expect(calcPremium(300000, 0.23, LAW)).toBe(345);                // 子ども・子育て支援金（折半額 345）
        expect(calcPremium(300000, 18.3, LAW)).toBe(27450);              // 厚生年金（折半額 27,450）
    });
    test("京都・35級（標準報酬月額 650,000円）：ちょうど50銭の行", () => {
        expect(calcPremium(650000, h("京都"), LAW)).toBe(32142);          // 折半額 32,142.5
        expect(calcPremium(650000, h("京都") + care, LAW)).toBe(37407);   // 折半額 37,407.5
        expect(calcPremium(650000, 0.23, LAW)).toBe(747);                // 折半額 747.5
        expect(calcPremium(650000, 18.3, LAW)).toBe(59475);              // 折半額 59,475
    });
    test("北海道・50級（標準報酬月額 1,390,000円）", () => {
        expect(calcPremium(1390000, h("北海道"), LAW)).toBe(71446);        // 折半額 71,446
        expect(calcPremium(1390000, h("北海道") + care, LAW)).toBe(82705); // 折半額 82,705
    });
    test("標準報酬月額表は50等級、上限は1,390,000円", () => {
        expect(m.HYOJUN_TABLE.length).toBe(50);
        expect(m.KENPO_MAX_HYOJUN).toBe(1390000);
        expect(getHyojunHoshu(295000, m.HYOJUN_TABLE)).toBe(300000);
        expect(getHyojunHoshu(5000000, m.HYOJUN_TABLE)).toBe(1390000);
        expect(m.PENSION_MIN_HYOJUN).toBe(88000);
        expect(m.PENSION_MAX_HYOJUN).toBe(650000);
    });
    test("雇用保険（令和8年度）: 一般 本人5/1000・合計13.5/1000", () => {
        expect(getInsuranceMaster(2026, 4).LABOR_INSURANCE_RATES.general).toEqual([0.005, 0.0135]);
        expect(getInsuranceMaster(2026, 4).LABOR_INSURANCE_RATES.construction).toEqual([0.006, 0.0165]);
        expect(calcPremium(300000, 0.5, "round", 1)).toBe(1500);
    });
});

describe("令和7年度（協会けんぽ 令和7年3月分から）の保険料額表と照合", () => {
    const m = INSURANCE_2025;
    const h = (pref: string) => m.KENPO_RATES[pref][1];
    test("料率", () => {
        expect(h("東京")).toBe(9.91);
        expect(m.KENPO_CARE_RATE[1]).toBe(1.59);
        expect(m.CHILD_SUPPORT_RATE).toBeNull(); // 子ども・子育て支援金はまだない
        expect(getInsuranceMaster(2025, 4).LABOR_INSURANCE_RATES.general).toEqual([0.0055, 0.0145]);
    });
    test("東京・22級 / 北海道・35級", () => {
        expect(calcPremium(300000, h("東京"), LAW)).toBe(14865);                          // 折半額 14,865
        expect(calcPremium(300000, h("東京") + m.KENPO_CARE_RATE[1], LAW)).toBe(17250);   // 折半額 17,250
        expect(calcPremium(650000, h("北海道"), LAW)).toBe(33507);                         // 折半額 33,507.5
    });
});

describe("令和6年度（協会けんぽ 令和6年3月分から）の保険料額表と照合", () => {
    const m = INSURANCE_2024;
    const h = (pref: string) => m.KENPO_RATES[pref][1];
    test("料率", () => {
        expect(h("東京")).toBe(9.98);
        expect(m.KENPO_CARE_RATE[1]).toBe(1.6);
        expect(m.PENSION_RATE[1]).toBe(18.3);
        expect(m.CHILD_SUPPORT_RATE).toBeNull();
        // 厚生労働省「令和6年度の雇用保険料率について」
        const labor = getInsuranceMaster(2024, 4).LABOR_INSURANCE_RATES;
        expect(labor.general).toEqual([0.006, 0.0155]);
        expect(labor.agriculture).toEqual([0.007, 0.0175]);
        expect(labor.construction).toEqual([0.007, 0.0185]);
    });
    test("東京・22級 / 北海道・35級", () => {
        expect(calcPremium(300000, h("東京"), LAW)).toBe(14970);                          // 折半額 14,970
        expect(calcPremium(300000, h("東京") + m.KENPO_CARE_RATE[1], LAW)).toBe(17370);   // 折半額 17,370
        expect(calcPremium(300000, m.PENSION_RATE[1], LAW)).toBe(27450);                  // 折半額 27,450
        expect(calcPremium(650000, h("北海道"), LAW)).toBe(33182);                         // 折半額 33,182.5
        expect(calcPremium(650000, h("北海道") + m.KENPO_CARE_RATE[1], LAW)).toBe(38382);  // 折半額 38,382.5
    });
});

describe("令和5年度（協会けんぽ 令和5年3月分から）の保険料額表と照合", () => {
    const m = INSURANCE_2023;
    const h = (pref: string) => m.KENPO_RATES[pref][1];
    test("料率", () => {
        expect(h("東京")).toBe(10.0);
        expect(m.KENPO_CARE_RATE[1]).toBe(1.82);
        expect(m.PENSION_RATE[1]).toBe(18.3);
        expect(m.CHILD_SUPPORT_RATE).toBeNull();
        // 厚生労働省「令和6年度の雇用保険料率について」の下段（令和5年度）
        expect(getInsuranceMaster(2023, 4).LABOR_INSURANCE_RATES.general).toEqual([0.006, 0.0155]);
    });
    test("東京・22級 / 北海道・35級", () => {
        expect(calcPremium(300000, h("東京"), LAW)).toBe(15000);                          // 折半額 15,000
        expect(calcPremium(300000, h("東京") + m.KENPO_CARE_RATE[1], LAW)).toBe(17730);   // 折半額 17,730
        expect(calcPremium(650000, h("北海道"), LAW)).toBe(33442);                         // 折半額 33,442.5
        // Excel では 39,357.4999… と保存されている（本当は 39,357.5 ちょうど）→ 50銭以下なので 39,357円
        expect(calcPremium(650000, h("北海道") + m.KENPO_CARE_RATE[1], LAW)).toBe(39357);
    });
    test("2024年2月分は令和5年度、3月分から令和6年度（協会けんぽ）", () => {
        expect(getInsuranceMaster(2024, 2).KENPO_RATES["東京"][1]).toBe(10.0);
        expect(getInsuranceMaster(2024, 3).KENPO_RATES["東京"][1]).toBe(9.98);
        expect(getInsuranceMaster(2024, 3).LABOR_FROM).toEqual({ year: 2023, month: 4 }); // 雇用保険は3月分まで前年度
        expect(getInsuranceMaster(2024, 4).LABOR_FROM).toEqual({ year: 2024, month: 4 });
    });
});

describe("保険料の対象月による切り替え", () => {
    test("2025年2月分は令和6年度、3月分から令和7年度（協会けんぽ）", () => {
        expect(getInsuranceMaster(2025, 2).KENPO_RATES["東京"][1]).toBe(9.98);
        expect(getInsuranceMaster(2025, 3).KENPO_RATES["東京"][1]).toBe(9.91);
    });
    test("雇用保険は2025年3月分まで令和6年度（本人 6/1000）、4月から令和7年度（本人 5.5/1000）", () => {
        expect(getInsuranceMaster(2025, 3).LABOR_INSURANCE_RATES.general[0]).toBe(0.006);
        expect(getInsuranceMaster(2025, 4).LABOR_INSURANCE_RATES.general[0]).toBe(0.0055);
    });
    test("2026年2月分は令和7年度、3月分から令和8年度（協会けんぽ）", () => {
        expect(getInsuranceMaster(2026, 2).KENPO_RATES["東京"][1]).toBe(9.91);
        expect(getInsuranceMaster(2026, 3).KENPO_RATES["東京"][1]).toBe(9.85);
    });
    test("雇用保険は4月から新年度（3月分は健康保険が新年度・雇用保険が前年度）", () => {
        expect(getInsuranceMaster(2026, 3).LABOR_INSURANCE_RATES.general[0]).toBe(0.0055);
        expect(getInsuranceMaster(2026, 4).LABOR_INSURANCE_RATES.general[0]).toBe(0.005);
    });
    test("子ども・子育て支援金は2026年4月分から", () => {
        expect(isChildSupportMonth(getInsuranceMaster(2026, 3), 2026, 3)).toBe(false);
        expect(isChildSupportMonth(getInsuranceMaster(2026, 4), 2026, 4)).toBe(true);
        expect(isChildSupportMonth(getInsuranceMaster(2025, 10), 2025, 10)).toBe(false);
    });
});

describe("令和4年度（協会けんぽ 令和4年3月分から）の保険料額表と照合", () => {
    const m = INSURANCE_2022;
    const h = (pref: string) => m.KENPO_RATES[pref][1];
    test("料率", () => {
        expect(h("東京")).toBe(9.81);
        expect(m.KENPO_CARE_RATE[1]).toBe(1.64);
        expect(m.PENSION_RATE[1]).toBe(18.3);
    });
    test("東京・22級 / 北海道・35級", () => {
        // Excel では 14,715.000000000002 と保存されている（小数の誤差）→ 14,715円
        expect(calcPremium(300000, h("東京"), LAW)).toBe(14715);
        expect(calcPremium(300000, h("東京") + m.KENPO_CARE_RATE[1], LAW)).toBe(17175);   // 折半額 17,175
        expect(calcPremium(650000, h("北海道"), LAW)).toBe(33767);                         // 折半額 33,767.5
        expect(calcPremium(650000, h("北海道") + m.KENPO_CARE_RATE[1], LAW)).toBe(39097);  // 折半額 39,097.5
    });
});

describe("令和3年度（協会けんぽ 令和3年3月分から）の保険料額表と照合", () => {
    const m = INSURANCE_2021;
    const h = (pref: string) => m.KENPO_RATES[pref][1];
    test("料率", () => {
        expect(h("東京")).toBe(9.84);
        expect(m.KENPO_CARE_RATE[1]).toBe(1.8);
        expect(m.PENSION_MAX_HYOJUN).toBe(650000);
    });
    test("東京・22級 / 北海道・35級", () => {
        expect(calcPremium(300000, h("東京"), LAW)).toBe(14760);                          // 折半額 14,760
        expect(calcPremium(300000, h("東京") + m.KENPO_CARE_RATE[1], LAW)).toBe(17460);   // 折半額 17,460
        expect(calcPremium(650000, h("北海道"), LAW)).toBe(33962);                         // 折半額 33,962.5
        expect(calcPremium(650000, h("北海道") + m.KENPO_CARE_RATE[1], LAW)).toBe(39812);  // 折半額 39,812.5
        expect(calcPremium(650000, m.PENSION_RATE[1], LAW)).toBe(59475);                   // 厚生年金 折半額 59,475
    });
});

describe("令和2年度（3月分・4〜8月分・9月分からの3つの表）と照合", () => {
    const h = (pref: string) => INSURANCE_2020.KENPO_RATES[pref][1];
    test("健康保険・介護保険の料率は3つの表で同じ", () => {
        for (const m of [INSURANCE_2020, INSURANCE_2020_04, INSURANCE_2020_09]) {
            expect(m.KENPO_RATES).toEqual(INSURANCE_2020.KENPO_RATES);
            expect(m.KENPO_CARE_RATE[1]).toBe(1.79);
        }
        expect(h("東京")).toBe(9.87);
    });
    test("東京・22級 / 北海道・35級", () => {
        expect(calcPremium(300000, h("東京"), LAW)).toBe(14805);                                         // 折半額 14,805
        expect(calcPremium(300000, h("東京") + INSURANCE_2020.KENPO_CARE_RATE[1], LAW)).toBe(17490);     // 折半額 17,490
        expect(calcPremium(650000, h("北海道"), LAW)).toBe(33832);                                        // 折半額 33,832.5
        expect(calcPremium(650000, h("北海道") + INSURANCE_2020.KENPO_CARE_RATE[1], LAW)).toBe(39650);    // 折半額 39,650
    });
    test("子ども・子育て拠出金率（事業主のみ）は4月分から 0.34% → 0.36%", () => {
        expect(getInsuranceMaster(2020, 3).CHILD_ALLOWANCE_RATE).toBe(0.34);
        expect(getInsuranceMaster(2020, 4).CHILD_ALLOWANCE_RATE).toBe(0.36);
    });
    test("厚生年金の上限は8月分まで62万円（31級）、9月分から65万円（32級）", () => {
        expect(getInsuranceMaster(2020, 8).PENSION_MAX_HYOJUN).toBe(620000);
        expect(getInsuranceMaster(2020, 9).PENSION_MAX_HYOJUN).toBe(650000);
        expect(calcPremium(620000, INSURANCE_2020_04.PENSION_RATE[1], LAW)).toBe(56730); // 31級 折半額 56,730
        expect(INSURANCE_2020_09.HYOJUN_TABLE).toEqual(INSURANCE_2020_04.HYOJUN_TABLE);  // 健康保険の等級は変わらない
    });
});

describe("雇用保険料率は「何月から」で切り替わる（年度の途中の変更にも対応）", () => {
    // 出典: 厚生労働省「令和4年度の雇用保険料率について」
    test("令和4年度は10月から本人負担が変わった（一般: 9月分まで 3/1000、10月分から 5/1000）", () => {
        expect(getInsuranceMaster(2022, 9).LABOR_INSURANCE_RATES.general).toEqual([0.003, 0.0095]);
        expect(getInsuranceMaster(2022, 10).LABOR_INSURANCE_RATES.general).toEqual([0.005, 0.0135]);
        expect(getInsuranceMaster(2022, 10).LABOR_FROM).toEqual({ year: 2022, month: 10 });
        expect(getInsuranceMaster(2023, 3).LABOR_INSURANCE_RATES.construction).toEqual([0.006, 0.0165]);
    });
    test("令和2年度・令和3年度は同じ料率（一般 本人 3/1000、合計 9/1000）", () => {
        // 出典: 厚生労働省「令和3年度の雇用保険料率について」（表の下段が令和2年度）
        expect(getInsuranceMaster(2020, 4).LABOR_INSURANCE_RATES).toEqual(getInsuranceMaster(2021, 4).LABOR_INSURANCE_RATES);
        expect(getInsuranceMaster(2020, 4).LABOR_INSURANCE_RATES.general).toEqual([0.003, 0.009]);
        expect(getInsuranceMaster(2020, 4).LABOR_INSURANCE_RATES.construction).toEqual([0.004, 0.012]);
    });
    test("令和4年4月は事業主負担だけが変わった（本人 3/1000 のまま、合計 9/1000 → 9.5/1000）", () => {
        expect(getInsuranceMaster(2022, 3).LABOR_INSURANCE_RATES.general).toEqual([0.003, 0.009]);
        expect(getInsuranceMaster(2022, 4).LABOR_INSURANCE_RATES.general).toEqual([0.003, 0.0095]);
    });
    test("一覧は古い順に並び、同じ月が2回出てこない", () => {
        const idx = LABOR_INSURANCE_PERIODS.map((p) => p.from.year * 12 + p.from.month);
        idx.slice(1).forEach((v, i) => expect(v).toBeGreaterThan(idx[i]));
    });
});

describe("料率・税額表が登録されていない月は、注意を出す", () => {
    test("登録している範囲の中なら注意はない", () => {
        expect(getInsuranceMaster(2020, 4).WARNINGS).toEqual([]); // 協会けんぽ 令和2年4月分・雇用保険 令和2年度
        expect(getInsuranceMaster(2022, 3).WARNINGS).toEqual([]); // 協会けんぽ 令和4年度・雇用保険 令和3年度
        expect(getInsuranceMaster(2026, 12).WARNINGS).toEqual([]);
        expect(getInsuranceMaster(2027, 2).WARNINGS).toEqual([]); // 協会けんぽ 令和8年度・雇用保険 令和8年度の範囲
    });
    test("いちばん古い表より前は、その表で計算して注意を出す", () => {
        // 2020年3月分：協会けんぽはあるが、雇用保険は2020年4月から（それより前は64歳以上の免除があったため登録しない）
        expect(getInsuranceMaster(2020, 3).WARNINGS).toEqual([
            "2020年3月分の雇用保険料率が登録されていないため、2020年4月分からの料率で計算しています。",
        ]);
        const w = getInsuranceMaster(2020, 2).WARNINGS;
        expect(w).toHaveLength(2);
        expect(w[0]).toContain("2020年2月分の健康保険・介護保険・厚生年金の料率が登録されていない");
    });
    test("最新の表の年度を過ぎたら、最新の表で計算して注意を出す", () => {
        expect(getInsuranceMaster(2027, 3).WARNINGS).toEqual([
            "2027年3月分の健康保険・介護保険・厚生年金の料率がまだ登録されていないため、2026年3月分からの料率で計算しています。",
        ]);
        expect(getInsuranceMaster(2027, 4).WARNINGS).toHaveLength(2);
    });
    test("源泉徴収税額表は2020〜2027年分が登録済み", () => {
        expect(getTaxMasterWarnings(2020)).toEqual([]);
        expect(getTaxMasterWarnings(2026)).toEqual([]);
        expect(getTaxMasterWarnings(2027)).toEqual([]);
        expect(getTaxMasterWarnings(2019)[0]).toContain("2019年分の源泉徴収税額表が登録されていない");
        expect(getTaxMasterWarnings(2028)[0]).toContain("2028年分の源泉徴収税額表がまだ登録されていない");
    });
});
