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

// ─────────────────────────────────────────────────────────────
// 定額減税（令和6年分・月次減税）
// ─────────────────────────────────────────────────────────────

/**
 * その人の、その年の月次減税額の合計（月次減税の対象でなければ 0）
 * 詳しいきまりは constants/tax/flatTaxReduction.ts
 * @param persons  定額減税の人数（本人＋同一生計配偶者＋扶養親族）
 * @param joinDate 入社日（YYYY-MM-DD。6月2日以後の入社は月次減税をしない）
 * @param payYear / payMonth 給与を支払う年月
 */
export const flatTaxReductionTotal = (
    persons: number,
    joinDate: string | null | undefined,
    payYear: number,
    payMonth: number
): number => {
    const rule = Master.FLAT_TAX_REDUCTION_2024;
    const n = Math.max(0, Math.floor(Number(persons) || 0));
    if (payYear !== rule.YEAR || payMonth < rule.FROM_MONTH || n === 0) return 0;
    if (joinDate && joinDate > rule.BASE_DATE) return 0;
    return n * rule.PER_PERSON;
};

// ─────────────────────────────────────────────────────────────
// 賞与（甲欄）
// ─────────────────────────────────────────────────────────────

/**
 * 賞与の金額に乗ずべき率（%）を「賞与に対する源泉徴収税額の算出率の表」の甲欄から求める
 * @param prevMonthAfterSocial 前月の社会保険料等控除後の給与等の金額
 * @param dependents 扶養親族等の数（7人以上は「7人以上」の列）
 */
export const calcBonusTaxRate = (
    prevMonthAfterSocial: number,
    dependents: number,
    table: Master.BonusTaxRateTable = Master.TAX_2026.BONUS_TABLE
): number => {
    const amount = Math.max(0, Math.floor(prevMonthAfterSocial));
    const col = table.kou[Math.min(Math.max(0, Math.floor(dependents || 0)), 7)];
    const row = col.find(([from, to]) => amount >= from && amount < to);
    if (!row) throw new Error(`賞与の算出率の表に該当する行がありません: ${amount}円`);
    return row[2];
};

/**
 * 賞与の源泉所得税（甲欄）
 * ・通常：賞与（社会保険料等控除後）× 算出率。1円未満切り捨て
 *   （率は、前月の社会保険料等控除後の給与と扶養親族等の数で決まる）
 * ・前月の給与がない（社会保険料等以下の場合を含む）、または賞与が前月の給与の10倍を超える場合は、算出率の表を使わず月額表で計算する
 *   （算出率の表の備考4）：賞与の6分の1（計算期間が6か月を超えるときは12分の1）を前月の給与に足して月額表の税額を求め、
 *   前月の給与だけの税額を引いた差額を6倍（12倍）する。前月の給与がなければ「賞与の6分の1の税額 × 6」になる
 * @param bonusAfterSocial 賞与の金額から社会保険料等を引いた金額
 * @param prevMonthAfterSocial 前月中の給与（賞与を除く）から社会保険料等を引いた金額
 * @param payYear 賞与を支払う年（その年の表を使う）
 * @param periodMonths 賞与の計算期間（月数）。6か月を超えるかどうかだけを使う
 */
export const calcBonusWithholdingTax = (
    bonusAfterSocial: number,
    prevMonthAfterSocial: number,
    dependents: number,
    payYear: number,
    periodMonths = 6
): number => {
    const bonus = Math.max(0, Math.floor(bonusAfterSocial));
    const prev = Math.max(0, Math.floor(prevMonthAfterSocial));
    const master = Master.getTaxMaster(payYear);

    if (prev === 0 || bonus > prev * 10) {
        const n = periodMonths > 6 ? 12 : 6;
        const monthly = (amount: number) => calcMonthlyTaxByTable(amount, dependents, master.MONTHLY_TABLE);
        return (monthly(prev + bonus / n) - monthly(prev)) * n;
    }
    return addRate(bonus, calcBonusTaxRate(prev, dependents, master.BONUS_TABLE));
};
