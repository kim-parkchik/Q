/**
 * 源泉所得税（給与・賞与）の計算
 *
 * 甲欄の計算方法は2つから選べる（市販の給与ソフトと同じ）。
 *   - "table"    : 国税庁の月額表どおり（初期値）。手計算や税理士の確認と1円も違わない。
 *   - "densanki" : 電算機計算の特例の式。その月の給与そのものから計算する。
 * 両者には数十〜百円程度の差が出ることがあるが、どちらも正しい方法として認められており、
 * 差は年末調整で精算される。
 *
 * 「給与所得者の扶養控除等申告書」を出していない人（ほかの会社が主たる給与の人など）は乙欄で計算する。
 * 乙欄はいつも月額表で計算する（電算機計算の特例は甲欄の式）。
 * 出典：国税庁 タックスアンサー No.2520 https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2520.htm
 *       No.2523 https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2523.htm
 *
 * 日雇賃金（日々雇い入れる人、または雇用契約の期間が2か月以内の人に、働いた日・時間で計算して払う給与）は
 * 日額表の丙欄で計算する（所得税法185条1項3号、施行令309条、所得税基本通達185-8）。
 * ・働いた日ごとの給与（社会保険料等を引いた額）に丙欄を当てはめた税額の合計。まとめて払うときも同じ（通達185-8）
 * ・同じ会社から継続して2か月を超えて払う分は丙欄を使えない（施行令309条かっこ書。甲欄か乙欄）
 * ・扶養親族等の数は使わない。賞与は「扶養控除等申告書を出した人以外の賞与」として乙欄の率で計算する（所得税法186条1項2号）
 * 出典：e-Gov 所得税法185条・186条 https://laws.e-gov.go.jp/law/340AC0000000033
 *       e-Gov 所得税法施行令309条 https://laws.e-gov.go.jp/law/340CO0000000096
 *       国税庁 所得税基本通達185-8・185-9 https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/31/01.htm
 *       国税庁 タックスアンサー No.2511 https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2511.htm
 *       No.2514 https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2514.htm
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

/**
 * 月額表（乙欄）で税額を求める
 * ・表の最初の金額未満は、給与 × 3.063%（率は月額表から読んだもの）
 * ・表の最後（例: 740,000円）以上は「基準の税額 ＋ 超えた金額 × 率」
 * ・「従たる給与についての扶養控除等申告書」が出ていれば、扶養親族等1人につき1,610円を引く
 *   （タックスアンサー No.2520。7人を超える1人ごとの額と同じ金額なので、月額表から読んだ値を使う）
 * 1円未満は切り捨て、マイナスにはならない
 * @param taxBase    その月の社会保険料等控除後の給与等の金額
 * @param dependents 従たる給与についての扶養控除等申告書に書かれた扶養親族等の数（出ていなければ 0）
 */
export const calcMonthlyOtsuTaxByTable = (
    taxBase: number,
    dependents: number,
    table: Master.MonthlyTaxTable = Master.TAX_2026.MONTHLY_TABLE
): number => {
    const amount = Math.max(0, Math.floor(taxBase));
    const deps = Math.max(0, Math.floor(dependents || 0));

    let tax: number;
    const row = table.rows.find(([from, to]) => amount >= from && amount < to);
    if (row) {
        tax = row[10];
    } else if (amount < table.rows[0][0]) {
        if (table.otsuLowRate === null) throw new Error("月額表に、乙欄の最初の金額未満の率がありません");
        tax = addRate(amount, table.otsuLowRate);
    } else {
        const anchor = [...table.otsuHigh].reverse().find((a) => amount >= a.amount);
        if (!anchor) throw new Error(`月額表（乙欄）に該当する行がありません: ${amount}円`);
        tax = anchor.base + addRate(amount - anchor.amount, anchor.rate);
    }
    return Math.max(0, tax - deps * table.perExtraDependent);
};

// ─────────────────────────────────────────────────────────────
// 日額表の丙欄（日雇賃金）
// ─────────────────────────────────────────────────────────────

/**
 * 日額表の丙欄で、1日分の税額を求める
 * ・表の最初の金額未満は0円
 * ・表の最後（24,000円）以上は「基準の税額 ＋ 超えた金額 × 率」（1円未満は切り捨て）
 * @param dayAmount その日の社会保険料等控除後の給与等の金額
 */
export const calcDailyHeiTaxByTable = (
    dayAmount: number,
    table: Master.DailyHeiTaxTable = Master.TAX_2026.DAILY_HEI_TABLE
): number => {
    const amount = Math.max(0, Math.floor(dayAmount));
    if (amount < table.rows[0][0]) return 0;
    const row = table.rows.find(([from, to]) => amount >= from && amount < to);
    if (row) return row[2];
    const anchor = [...table.high].reverse().find((a) => amount >= a.amount);
    if (!anchor) throw new Error(`日額表（丙欄）に該当する行がありません: ${amount}円`);
    return anchor.base + addRate(amount - anchor.amount, anchor.rate);
};

/**
 * 日雇賃金の源泉所得税：働いた日ごとの給与（社会保険料等を引いた額）に丙欄を当てはめた税額の合計（所得税基本通達185-8）
 * @param dayAmounts 働いた日ごとの、社会保険料等控除後の給与等の金額
 * @param payYear    支払った年（その年の税額表を使う）
 */
export const calcHeiWithholdingTax = (dayAmounts: number[], payYear: number): number => {
    const table = Master.getTaxMaster(payYear).DAILY_HEI_TABLE;
    return dayAmounts.reduce((sum, a) => sum + calcDailyHeiTaxByTable(a, table), 0);
};

// ─────────────────────────────────────────────────────────────
// 計算方法と年を指定して求める（給与計算からはこれを使う）
// ─────────────────────────────────────────────────────────────

export type TaxCalcMethod = "table" | "densanki";

/**
 * 源泉所得税の欄
 * kou: 甲欄（扶養控除等申告書を出している） / otsu: 乙欄（出していない） / hei: 丙欄（日雇賃金。日額表）
 */
export type TaxColumn = "kou" | "otsu" | "hei";

export const TAX_COLUMN_LABELS: Record<TaxColumn, string> = {
    kou: "甲欄",
    otsu: "乙欄",
    hei: "丙欄",
};

/** 従業員の tax_column を読む（空や知らない値は甲欄） */
export const toTaxColumn = (value: unknown): TaxColumn => (value === "otsu" || value === "hei" ? value : "kou");

/** 賞与の税額に使う欄（丙欄の人の賞与は、扶養控除等申告書を出した人以外の賞与として乙欄。所得税法186条1項2号） */
const bonusColumnOf = (column: TaxColumn): "kou" | "otsu" => (column === "kou" ? "kou" : "otsu");

export const TAX_CALC_METHOD_LABELS: Record<TaxCalcMethod, string> = {
    table: "税額表（月額表）",
    densanki: "電算機計算の特例",
};

/**
 * 月額の源泉所得税
 * @param payYear 支払った年（その年の税額表・式を使う）
 * @param method  甲欄の計算方法。"table"（月額表・初期値） または "densanki"（電算機計算の特例）
 * @param column  "kou"（甲欄・初期値） または "otsu"（乙欄。いつも月額表で計算する）。丙欄は日ごとに計算するので calcHeiWithholdingTax を使う
 */
export const calcWithholdingTax = (
    taxBase: number,
    dependents: number,
    payYear: number,
    method: TaxCalcMethod = "table",
    column: TaxColumn = "kou"
): number => {
    const master = Master.getTaxMaster(payYear);
    if (column === "hei") throw new Error("丙欄は働いた日ごとに計算します（calcHeiWithholdingTax）");
    if (column === "otsu") return calcMonthlyOtsuTaxByTable(taxBase, dependents, master.MONTHLY_TABLE);
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
 * @param column   乙欄の人は月次減税をしない
 */
export const flatTaxReductionTotal = (
    persons: number,
    joinDate: string | null | undefined,
    payYear: number,
    payMonth: number,
    column: TaxColumn = "kou"
): number => {
    const rule = Master.FLAT_TAX_REDUCTION_2024;
    const n = Math.max(0, Math.floor(Number(persons) || 0));
    if (column !== "kou") return 0;
    if (payYear !== rule.YEAR || payMonth < rule.FROM_MONTH || n === 0) return 0;
    if (joinDate && joinDate > rule.BASE_DATE) return 0;
    return n * rule.PER_PERSON;
};

// ─────────────────────────────────────────────────────────────
// 賞与
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

/** 賞与の金額に乗ずべき率（%）を、算出率の表の乙欄から求める（扶養親族等の数で率は変わらない） */
export const calcBonusOtsuTaxRate = (
    prevMonthAfterSocial: number,
    table: Master.BonusTaxRateTable = Master.TAX_2026.BONUS_TABLE
): number => {
    const amount = Math.max(0, Math.floor(prevMonthAfterSocial));
    const row = table.otsu.find(([from, to]) => amount >= from && amount < to);
    if (!row) throw new Error(`賞与の算出率の表（乙欄）に該当する行がありません: ${amount}円`);
    return row[2];
};

/**
 * 賞与の源泉所得税
 * ・通常：賞与（社会保険料等控除後）× 算出率。1円未満切り捨て
 *   （甲欄の率は、前月の社会保険料等控除後の給与と扶養親族等の数で決まる。乙欄の率は前月の給与だけで決まる）
 * ・前月の給与がない（社会保険料等以下の場合を含む）、または賞与が前月の給与の10倍を超える場合は、算出率の表を使わず月額表で計算する
 *   （算出率の表の備考4）：賞与の6分の1（計算期間が6か月を超えるときは12分の1）を前月の給与に足して月額表の税額を求め、
 *   前月の給与だけの税額を引いた差額を6倍（12倍）する。前月の給与がなければ「賞与の6分の1の税額 × 6」になる
 *   乙欄の人は月額表の乙欄を使う（従たる給与についての扶養控除等申告書があれば、1人1,610円を引いた税額で計算する）
 * @param bonusAfterSocial 賞与の金額から社会保険料等を引いた金額
 * @param prevMonthAfterSocial 前月中の給与（賞与を除く）から社会保険料等を引いた金額
 * @param payYear 賞与を支払う年（その年の表を使う）
 * @param periodMonths 賞与の計算期間（月数）。6か月を超えるかどうかだけを使う
 * @param column "kou"（甲欄・初期値） または "otsu"（乙欄）。丙欄の人は乙欄で計算する（所得税法186条1項2号）
 */
export const calcBonusWithholdingTax = (
    bonusAfterSocial: number,
    prevMonthAfterSocial: number,
    dependents: number,
    payYear: number,
    periodMonths = 6,
    taxColumn: TaxColumn = "kou"
): number => {
    const bonus = Math.max(0, Math.floor(bonusAfterSocial));
    const prev = Math.max(0, Math.floor(prevMonthAfterSocial));
    const master = Master.getTaxMaster(payYear);
    const column = bonusColumnOf(taxColumn);
    // 丙欄の人には「従たる給与についての扶養控除等申告書」の人数がないので、扶養親族等の数は使わない
    const deps = taxColumn === "hei" ? 0 : dependents;

    if (prev === 0 || bonus > prev * 10) {
        const n = periodMonths > 6 ? 12 : 6;
        const monthly = (amount: number) => column === "otsu"
            ? calcMonthlyOtsuTaxByTable(amount, deps, master.MONTHLY_TABLE)
            : calcMonthlyTaxByTable(amount, deps, master.MONTHLY_TABLE);
        return (monthly(prev + bonus / n) - monthly(prev)) * n;
    }
    const rate = column === "otsu"
        ? calcBonusOtsuTaxRate(prev, master.BONUS_TABLE)
        : calcBonusTaxRate(prev, deps, master.BONUS_TABLE);
    return addRate(bonus, rate);
};

/**
 * 確定した賞与の税額で使った「賞与の金額に乗ずべき率」（%。源泉徴収簿の税率の欄に書く）
 * ・算出率の表を使わない場合（前月の給与がない・賞与が前月の給与の10倍を超える。月額表で計算する）は null
 * ・前月の給与と扶養親族等の数から求めた率で計算し直した税額が、確定した税額と違うときも null
 *   （確定したときの扶養親族等の数などがわからないので、率を書かない）
 */
export const bonusTaxRateUsed = (
    bonusAfterSocial: number,
    prevMonthAfterSocial: number,
    dependents: number,
    payYear: number,
    column: TaxColumn,
    tax: number
): number | null => {
    const bonus = Math.max(0, Math.floor(bonusAfterSocial));
    const prev = Math.max(0, Math.floor(prevMonthAfterSocial));
    if (prev === 0 || bonus > prev * 10) return null;
    const master = Master.getTaxMaster(payYear);
    try {
        const rate = bonusColumnOf(column) === "otsu"
            ? calcBonusOtsuTaxRate(prev, master.BONUS_TABLE)
            : calcBonusTaxRate(prev, dependents, master.BONUS_TABLE);
        return addRate(bonus, rate) === Math.floor(Number(tax) || 0) ? rate : null;
    } catch {
        return null;
    }
};
