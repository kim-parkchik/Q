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
import { getInsuranceMaster, isChildSupportMonth, INSURANCE_2025, INSURANCE_2026 } from "../constants/insurance";

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
        expect(m.LABOR_INSURANCE_RATES.general).toEqual([0.005, 0.0135]);
        expect(m.LABOR_INSURANCE_RATES.construction).toEqual([0.006, 0.0165]);
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
        expect(m.LABOR_INSURANCE_RATES.general).toEqual([0.0055, 0.0145]);
    });
    test("東京・22級 / 北海道・35級", () => {
        expect(calcPremium(300000, h("東京"), LAW)).toBe(14865);                          // 折半額 14,865
        expect(calcPremium(300000, h("東京") + m.KENPO_CARE_RATE[1], LAW)).toBe(17250);   // 折半額 17,250
        expect(calcPremium(650000, h("北海道"), LAW)).toBe(33507);                         // 折半額 33,507.5
    });
});

describe("保険料の対象月による切り替え", () => {
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
