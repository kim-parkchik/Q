/**
 * 賞与の源泉所得税のテスト（甲欄・乙欄）
 * 実行方法: bun test
 *
 * 期待値は国税庁「賞与に対する源泉徴収税額の算出率の表」（tax-tables/ の Excel）から引用。
 * 表は扶養親族等の数ごとに、率が変わる金額の区切りが違う（例: 令和8年分の6.126%は、0人なら26万〜30.9万円、2人なら32.1万〜37.7万円）。
 */
import { describe, expect, test } from "bun:test";
import { calcBonusOtsuTaxRate, calcBonusTaxRate, calcBonusWithholdingTax, calcMonthlyOtsuTaxByTable, calcMonthlyTaxByTable } from "./incomeTax";
import { TAX_2025, TAX_2026 } from "../constants/tax";

describe("令和8年分 算出率の表（甲欄）との照合", () => {
    const t = TAX_2026.BONUS_TABLE;
    test("0人: 82千円未満は0%、82千円から2.042%、94千円から4.084%", () => {
        expect(calcBonusTaxRate(81999, 0, t)).toBe(0);
        expect(calcBonusTaxRate(82000, 0, t)).toBe(2.042);
        expect(calcBonusTaxRate(94000, 0, t)).toBe(4.084);
    });
    test("前月の給与30万円: 0人 6.126% / 2人 4.084% / 4人 4.084% / 7人以上 0%", () => {
        expect(calcBonusTaxRate(300000, 0, t)).toBe(6.126);
        expect(calcBonusTaxRate(300000, 2, t)).toBe(4.084);
        expect(calcBonusTaxRate(300000, 4, t)).toBe(4.084);
        expect(calcBonusTaxRate(300000, 7, t)).toBe(0);
    });
    test("扶養4人以上も、その人数の列を使う（3人で打ち切らない）", () => {
        // 前月の給与 25万円: 3人 2.042%（18.1万〜30万）、5人 0%（25.1万円未満）
        expect(calcBonusTaxRate(250000, 3, t)).toBe(2.042);
        expect(calcBonusTaxRate(250000, 5, t)).toBe(0);
    });
    test("7人を超えても「7人以上」の列（率から差し引く決まりはない）", () => {
        expect(calcBonusTaxRate(400000, 9, t)).toBe(calcBonusTaxRate(400000, 7, t));
        expect(calcBonusTaxRate(400000, 7, t)).toBe(4.084); // 38.3万〜46.3万
    });
    test("最高は45.945%（0人: 3,495千円以上）", () => {
        expect(calcBonusTaxRate(3494999, 0, t)).toBe(41.861);
        expect(calcBonusTaxRate(3495000, 0, t)).toBe(45.945);
    });
    test("乙欄も読み取れている（224千円未満 10.21% 〜 1,118千円以上 45.945%）", () => {
        expect(t.otsu[0]).toEqual([0, 224000, 10.21]);
        expect(t.otsu[t.otsu.length - 1]).toEqual([1118000, Infinity, 45.945]);
    });
    test("どの列も0円からすき間なくつながり、上限なしで終わる", () => {
        for (const col of t.kou) {
            expect(col[0][0]).toBe(0);
            col.slice(1).forEach((row, i) => expect(row[0]).toBe(col[i][1]));
            expect(col[col.length - 1][1]).toBe(Infinity);
        }
    });
});

describe("令和7年分 算出率の表（2025年以前の賞与）", () => {
    test("0人: 68千円未満は0%、68千〜79千円は2.042%、79千円から4.084%", () => {
        const t = TAX_2025.BONUS_TABLE;
        expect(calcBonusTaxRate(67999, 0, t)).toBe(0);
        expect(calcBonusTaxRate(68000, 0, t)).toBe(2.042);
        expect(calcBonusTaxRate(79000, 0, t)).toBe(4.084);
    });
    test("支払う年で表を切り替える（前月の給与8万円・0人: 2025年は4.084%、2026年は0%）", () => {
        expect(calcBonusWithholdingTax(500000, 80000, 0, 2025)).toBe(20420); // 500,000 × 4.084%
        expect(calcBonusWithholdingTax(500000, 80000, 0, 2026)).toBe(0);
    });
});

describe("賞与の源泉所得税の計算", () => {
    test("通常は 賞与（社会保険料等控除後）× 率、1円未満切り捨て", () => {
        expect(calcBonusWithholdingTax(500000, 300000, 0, 2026)).toBe(30630);  // × 6.126%
        expect(calcBonusWithholdingTax(333333, 300000, 0, 2026)).toBe(20419);  // 20,419.97… → 20,419
    });
    test("前月の給与がないときは「賞与の6分の1の月額表の税額 × 6」", () => {
        // 1,200,000 ÷ 6 = 200,000円 → 令和8年分 月額表 199,000〜201,000円の行 0人 4,340円 × 6
        expect(calcBonusWithholdingTax(1200000, 0, 0, 2026)).toBe(26040);
    });
    test("計算期間が6か月を超えるときは12分の1 × 12", () => {
        expect(calcBonusWithholdingTax(2400000, 0, 0, 2026, 12)).toBe(4340 * 12);
    });
    test("賞与が前月の給与の10倍を超えるときは月額表で計算する", () => {
        // 前月の給与 10万円、賞与 120万円（10倍の100万円を超える）
        // → (10万 + 120万÷6 = 30万円 の税額 − 10万円の税額) × 6
        const m = TAX_2026.MONTHLY_TABLE;
        const expected = (calcMonthlyTaxByTable(300000, 0, m) - calcMonthlyTaxByTable(100000, 0, m)) * 6;
        expect(calcBonusWithholdingTax(1200000, 100000, 0, 2026)).toBe(expected);
        // ちょうど10倍なら算出率の表（10万円・0人 → 4.084%）
        expect(calcBonusWithholdingTax(1000000, 100000, 0, 2026)).toBe(40840);
    });
});

describe("賞与の源泉所得税（乙欄）", () => {
    // 出典：国税庁 タックスアンサー No.2523（扶養控除等申告書を出していない人は算出率の表の乙欄）
    const t = TAX_2026.BONUS_TABLE;
    test("乙欄の率は前月の給与だけで決まる（令和8年分: 224千円未満 10.21%、224千円から 20.42%）", () => {
        expect(calcBonusOtsuTaxRate(0, t)).toBe(10.21);
        expect(calcBonusOtsuTaxRate(223999, t)).toBe(10.21);
        expect(calcBonusOtsuTaxRate(224000, t)).toBe(20.42);
        expect(calcBonusOtsuTaxRate(300000, t)).toBe(30.63);
        expect(calcBonusOtsuTaxRate(1118000, t)).toBe(45.945);
    });
    test("通常：賞与 × 乙欄の率（1円未満切り捨て）。扶養人数で率は変わらない", () => {
        expect(calcBonusWithholdingTax(500000, 300000, 0, 2026, 6, "otsu")).toBe(Math.floor(500000 * 0.3063));
        expect(calcBonusWithholdingTax(500000, 300000, 2, 2026, 6, "otsu")).toBe(Math.floor(500000 * 0.3063));
    });
    test("前月の給与がない：賞与の6分の1を月額表の乙欄に当てはめて6倍", () => {
        // 600,000 ÷ 6 = 100,000円（105,000円未満なので 3.063%）→ 3,063円 × 6
        expect(calcBonusWithholdingTax(600000, 0, 0, 2026, 6, "otsu")).toBe(3063 * 6);
    });
    test("前月の給与の10倍を超える：（賞与の6分の1＋前月の給与）の乙欄の税額 − 前月の給与の乙欄の税額 を6倍", () => {
        const T = TAX_2026.MONTHLY_TABLE;
        const expected = (calcMonthlyOtsuTaxByTable(300000, 0, T) - calcMonthlyOtsuTaxByTable(100000, 0, T)) * 6;
        expect(calcBonusWithholdingTax(1200000, 100000, 0, 2026, 6, "otsu")).toBe(expected);
        // 月額表を使うときは、従たる給与の申告書の扶養親族等1人1,610円も引いて計算する
        expect(calcBonusWithholdingTax(600000, 0, 1, 2026, 6, "otsu")).toBe(Math.max(0, 3063 - 1610) * 6);
    });
    test("令和7年分（2025年）の乙欄の率を使う", () => {
        expect(calcBonusWithholdingTax(500000, 223000, 0, 2025, 6, "otsu")).toBe(Math.floor(500000 * 0.2042));
        expect(calcBonusWithholdingTax(500000, 223000, 0, 2026, 6, "otsu")).toBe(Math.floor(500000 * 0.1021));
    });
});
