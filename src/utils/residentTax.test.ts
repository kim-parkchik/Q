/**
 * 住民税の特別徴収の額（residentTax.ts）のテスト
 * 実行方法: bun test
 *
 * 出典：地方税法 第321条の5第1項（6月から翌年5月まで、給与の支払をする際毎月徴収）
 *       第20条の4の2第6項・第8項（月割額の100円未満の端数は最初の月に合算）
 */
import { describe, expect, test } from "bun:test";
import {
    annualTotal, fiscalYearLabel, fiscalYearOf, indexInFiscalYear, parseResidentTaxSchedule, residentTaxFor,
    simpleAmounts, stringifyResidentTaxSchedule, RESIDENT_TAX_MONTHS,
} from "./residentTax";

describe("年度（6月分〜翌年5月分）", () => {
    test("6月〜12月は、その年の年度。1月〜5月は前の年の年度", () => {
        expect(fiscalYearOf(2026, 6)).toBe(2026);
        expect(fiscalYearOf(2026, 12)).toBe(2026);
        expect(fiscalYearOf(2027, 1)).toBe(2026);
        expect(fiscalYearOf(2027, 5)).toBe(2026);
        expect(fiscalYearOf(2026, 5)).toBe(2025);
    });
    test("6月分が1番目、翌年5月分が12番目", () => {
        expect(RESIDENT_TAX_MONTHS.map(indexInFiscalYear)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    });
    test("和暦の年度も出す（令和元年度は2019年6月から）", () => {
        expect(fiscalYearLabel(2026)).toBe("2026年度（令和8年度）");
        expect(fiscalYearLabel(2019)).toBe("2019年度（令和元年度）");
        expect(fiscalYearLabel(2018)).toBe("2018年度（平成30年度）");
    });
});

describe("通知書の6月分と7月以降から12か月を作る", () => {
    test("年税額 100,000円：6月分 8,700円（100円未満の端数を足した額）、7月以降 8,300円", () => {
        const amounts = simpleAmounts(8700, 8300);
        expect(amounts).toHaveLength(12);
        expect(amounts[0]).toBe(8700);
        expect(amounts.slice(1).every((v) => v === 8300)).toBe(true);
        expect(annualTotal(amounts)).toBe(100000);
    });
    test("マイナスや小数は入れない", () => {
        expect(simpleAmounts(-100, 1234.9)).toEqual([0, ...Array(11).fill(1234)]);
    });
});

describe("その月に支給する給与から引く額", () => {
    const schedule = stringifyResidentTaxSchedule([
        { fiscalYear: 2026, amounts: [8700, 8300, 8300, 8300, 8300, 8300, 8300, 8300, 8300, 8300, 8300, 8300] },
        // 2027年度：12月に変更の通知を受け取って、12月分から減った
        { fiscalYear: 2027, amounts: [5600, 5500, 5500, 5500, 5500, 5500, 3000, 3000, 3000, 3000, 3000, 3000] },
    ]);
    const staff = { resident_tax: 0, resident_tax_schedule: schedule };
    test("年度の月ごとの額", () => {
        expect(residentTaxFor(staff, 2026, 6)).toBe(8700);
        expect(residentTaxFor(staff, 2026, 7)).toBe(8300);
        expect(residentTaxFor(staff, 2027, 5)).toBe(8300);
        expect(residentTaxFor(staff, 2027, 6)).toBe(5600);
        expect(residentTaxFor(staff, 2027, 11)).toBe(5500);
        expect(residentTaxFor(staff, 2027, 12)).toBe(3000);
        expect(residentTaxFor(staff, 2028, 5)).toBe(3000);
    });
    test("年度の額を入れていない月は0円", () => {
        expect(residentTaxFor(staff, 2026, 5)).toBe(0);
        expect(residentTaxFor(staff, 2028, 6)).toBe(0);
    });
    test("年度の額を入れていない月は、以前の入れ方の月額を使う", () => {
        expect(residentTaxFor({ ...staff, resident_tax: 7000 }, 2026, 5)).toBe(7000);
        expect(residentTaxFor({ ...staff, resident_tax: 7000 }, 2026, 6)).toBe(8700);
        expect(residentTaxFor({ resident_tax: 7000 }, 2026, 6)).toBe(7000);
    });
});

describe("保存の形（JSON）", () => {
    test("年度の順に並べ、年度がなければ空（NULL）", () => {
        const json = stringifyResidentTaxSchedule([
            { fiscalYear: 2027, amounts: simpleAmounts(1, 1) },
            { fiscalYear: 2026, amounts: simpleAmounts(2, 2) },
        ]);
        expect(parseResidentTaxSchedule(json).map((e) => e.fiscalYear)).toEqual([2026, 2027]);
        expect(stringifyResidentTaxSchedule([])).toBeNull();
    });
    test("壊れた値は読み飛ばし、12か月にそろえる。同じ年度は後のもの", () => {
        expect(parseResidentTaxSchedule("{")).toEqual([]);
        expect(parseResidentTaxSchedule(null)).toEqual([]);
        const list = parseResidentTaxSchedule(JSON.stringify([
            { fiscalYear: 2026, amounts: [100, 200] },
            { fiscalYear: "x", amounts: [] },
            { fiscalYear: 2025 },
            { fiscalYear: 2026, amounts: [300, 400, -5, "50"] },
        ]));
        expect(list).toEqual([{ fiscalYear: 2026, amounts: [300, 400, 0, 50, 0, 0, 0, 0, 0, 0, 0, 0] }]);
    });
});
