/**
 * 源泉所得税（給与・甲欄）の計算
 *
 * 計算方法は2つから選べる（市販の給与ソフトと同じ）。
 *   - "table"    : 国税庁の月額表どおり（初期値）。手計算や税理士の確認と1円も違わない。
 *   - "densanki" : 電算機計算の特例の式。その月の給与そのものから計算する。
 * 両者には数十〜百円程度の差が出ることがあるが、どちらも正しい方法として認められており、
 * 差は年末調整で精算される。
 */
import * as Master from "../constants";

type DensankiMaster = typeof Master.TAX_2026.DENSANKI;

/** 給与所得控除の額（1円未満切り上げ） */
export const calcEmploymentDeduction = (amount: number, m: DensankiMaster = Master.TAX_2026.DENSANKI): number => {
    for (const [limit, rate, add] of m.EMPLOYMENT_DEDUCTION) {
        if (amount <= limit) return rate === 0 ? add : Math.ceil(amount * rate + add);
    }
    return 0;
};

/** 基礎控除の額 */
export const calcBasicDeduction = (amount: number, m: DensankiMaster = Master.TAX_2026.DENSANKI): number => {
    for (const [limit, deduction] of m.BASIC_DEDUCTION) {
        if (amount <= limit) return deduction;
    }
    return 0;
};

/**
 * 月額の源泉所得税（甲欄）
 * @param taxBase    その月の社会保険料等控除後の給与等の金額
 * @param dependents 扶養親族等の数（源泉控除対象配偶者を含む）
 * @returns 税額（10円未満四捨五入、マイナスにはならない）
 */
export const calcMonthlyWithholdingTax = (
    taxBase: number,
    dependents: number,
    m: DensankiMaster = Master.TAX_2026.DENSANKI
): number => {
    const amount = Math.max(0, Math.floor(taxBase));
    const deps = Math.max(0, Math.floor(dependents || 0));

    const taxable = amount
        - calcEmploymentDeduction(amount, m)
        - m.DEPENDENT_DEDUCTION * deps
        - calcBasicDeduction(amount, m);
    if (taxable <= 0) return 0;

    for (const [limit, ratePercent, minus] of m.TAX_RATES) {
        if (taxable <= limit) {
            // 小数の誤差を避けるため、先に 1000 倍して整数で計算する
            const tax = (taxable * Math.round(ratePercent * 1000)) / 100000 - minus;
            return Math.max(0, Math.round(tax / 10) * 10);
        }
    }
    return 0;
};

// ─────────────────────────────────────────────────────────────
// 月額表による計算
// ─────────────────────────────────────────────────────────────

/** 率(%)を掛けて1円未満を切り捨てる（小数の誤差を避けるため整数で計算） */
const addRate = (over: number, ratePercent: number) =>
    Math.floor((over * Math.round(ratePercent * 1000)) / 100000);

/**
 * 月額表（甲欄）で税額を求める
 * @param taxBase    その月の社会保険料等控除後の給与等の金額
 * @param dependents 扶養親族等の数（8人以上は、7人の税額から1人ごとに1,610円を引く）
 */
export const calcMonthlyTaxByTable = (
    taxBase: number,
    dependents: number,
    table: Master.MonthlyTaxTable = Master.TAX_2026.MONTHLY_TABLE
): number => {
    const amount = Math.max(0, Math.floor(taxBase));
    const deps = Math.max(0, Math.floor(dependents || 0));
    const col = Math.min(deps, 7);
    const extra = Math.max(0, deps - 7) * table.perExtraDependent;

    let tax = 0;
    if (amount < table.zeroBelow) {
        tax = 0;
    } else {
        const row = table.rows.find(([from, to]) => amount >= from && amount < to);
        if (row) {
            tax = row[2 + col];
        } else {
            // 表の最後（例: 740,000円）以上は「基準額の税額 ＋ 超えた金額 × 率」
            const anchor = [...table.highAnchors].reverse().find((a) => amount >= a.amount);
            if (!anchor) throw new Error(`月額表に該当する行がありません: ${amount}円`);
            tax = anchor.kou[col] + addRate(amount - anchor.amount, anchor.rate);
        }
    }
    return Math.max(0, tax - extra);
};

// ─────────────────────────────────────────────────────────────
// 計算方法と年を指定して求める（給与計算からはこれを使う）
// ─────────────────────────────────────────────────────────────

export type TaxCalcMethod = "table" | "densanki";

export const TAX_CALC_METHOD_LABELS: Record<TaxCalcMethod, string> = {
    table: "税額表（月額表）",
    densanki: "電算機計算の特例",
};

/**
 * 月額の源泉所得税（甲欄）
 * @param payYear 支払った年（その年の税額表・式を使う）
 * @param method  "table"（月額表・初期値） または "densanki"（電算機計算の特例）
 */
export const calcWithholdingTax = (
    taxBase: number,
    dependents: number,
    payYear: number,
    method: TaxCalcMethod = "table"
): number => {
    const master = Master.getTaxMaster(payYear);
    return method === "densanki"
        ? calcMonthlyWithholdingTax(taxBase, dependents, master.DENSANKI)
        : calcMonthlyTaxByTable(taxBase, dependents, master.MONTHLY_TABLE);
};
