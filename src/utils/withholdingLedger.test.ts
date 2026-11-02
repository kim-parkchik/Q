/**
 * 給与所得に対する源泉徴収簿（withholdingLedger.ts）のテスト（令和8年分）
 * 実行方法: bun test
 *
 * 期待値は国税庁「令和8年分 年末調整のしかた」の設例（110rei.pdf。山川太郎さんの源泉徴収簿）から引用。
 * 設例は「本年最後に支払う給与（賞与）についての税額計算を省略して年末調整を行う場合」なので、
 * 12月の賞与の算出税額は 0 にしている（Q は12月の給与で過不足額を精算するので、過不足税額は12月の給与の行に書く）。
 * 扶養親族の生年月日・社会保険料の内訳は、設例の区分・合計と合うように置いた仮の値。
 */
import { describe, expect, test } from "bun:test";
import { NENCHO_2026 } from "../constants/nencho";
import { emptyDeclaration, type DeclaredDependent, type NenchoDeclaration } from "./nenchoDeclaration";
import { bonusTaxRateUsed } from "./incomeTax";
import { buildWithholdingLedger, payDayOf, type LedgerBonusInput, type LedgerSalaryInput, type LedgerSource } from "./withholdingLedger";

const m = NENCHO_2026;
const person = (birthday: string, o: Partial<DeclaredDependent> = {}): DeclaredDependent => ({
    name: "", relation: "", birthday, totalIncome: 0, disability: "none", livingTogether: true, linealAscendant: false, ...o,
});

/** 設例の申告書の内容（nenchoDeclaration.test.ts と同じ） */
const decl: NenchoDeclaration = {
    ...emptyDeclaration(),
    spouse: { name: "配偶者", birthday: "1962-04-01", totalIncome: 500000, disability: "none", livingTogether: true },
    dependents: [
        person("1996-08-01", { relation: "子" }),                                              // 一般の控除対象扶養親族（仮の生年月日）
        person("2006-08-01", { relation: "子" }),                                              // 特定扶養親族（仮）
        person("1950-08-01", { relation: "父", linealAscendant: true, disability: "general" }),  // 同居老親等・一般の障害者（仮）
        person("2005-08-01", { relation: "子", totalIncome: 1000000 }),                        // 特定親族（給与所得の金額100万円）
    ],
    insurance: {
        ...emptyDeclaration().insurance,
        lifeGeneralNew: 80000, lifeGeneralOld: 35000, lifeMedical: 80000, lifePensionNew: 30000, lifePensionOld: 90000,
        earthquake: 42000, oldLongTerm: 14800,
    },
    housingLoanCredit: 76500,
};

/** 設例の給料：1〜3月 590,000円（社会保険料 90,712円・税額 6,320円）、4〜12月 600,000円（92,454円・6,690円）、扶養親族等の数 6人 */
const salary = (month: number, o: Partial<LedgerSalaryInput> = {}): LedgerSalaryInput => ({
    target_year: 2026, target_month: month,
    taxable_amount: month <= 3 ? 590000 : 600000,
    social_ins_total: month <= 3 ? 90712 : 92454,
    applied_dependents: 6,
    income_tax: month <= 3 ? 6320 : 6690,
    year_end_adjustment: 0,
    ...o,
});
/** 設例の賞与：6月・12月に 900,000円（社会保険料 140,940円）。6月の税額 77,500円、12月は税額計算を省略 */
const bonus = (month: number, date: string, tax: number): LedgerBonusInput => ({
    target_year: 2026, target_month: month, payment_date: date,
    total_earnings: 900000, health_insurance: 50000, nursing_insurance: 0, child_support: 0, welfare_pension: 82350, emp_insurance: 8590, // 計 140,940円（内訳は仮）
    income_tax: tax,
});
const salaries = Array.from({ length: 12 }, (_, i) => salary(i + 1, i === 11 ? { year_end_adjustment: 115270 } : {}));
const source = (o: Partial<LedgerSource> = {}): LedgerSource => ({
    year: 2026,
    staff: { name: "山川 太郎", tax_column: "kou", dependents: 6 },
    paymentDay: 20,
    salaries,
    bonuses: [bonus(6, "2026-06-10", 77500), bonus(12, "2026-12-10", 0)],
    adjustment: { declaration: decl, settleYear: 2026, settleMonth: 12 },
    previousYearDifference: null,
    ...o,
});

describe("設例の源泉徴収簿（令和8年分 年末調整のしかた）", () => {
    const l = buildWithholdingLedger(source(), m);

    test("給料・手当等の計：総支給金額 ① 7,170,000円・社会保険料等 ② 1,104,222円・算出税額 ③ 79,170円", () => {
        expect(l.salaryRows.filter(Boolean)).toHaveLength(12);
        expect(l.salaryRows[0]).toMatchObject({ month: 1, payDay: 20, gross: 590000, social: 90712, afterSocial: 499288, dependents: 6, tax: 6320 });
        expect(l.salaryRows[3]).toMatchObject({ month: 4, gross: 600000, social: 92454, afterSocial: 507546, tax: 6690 });
        expect(l.salaryTotal).toMatchObject({ gross: 7170000, social: 1104222, afterSocial: 6065778, tax: 79170 });
    });
    test("賞与等の計：④ 1,800,000円・⑤ 281,880円・⑥ 77,500円。6月の賞与の税率は 10.210%", () => {
        expect(l.bonusTotal).toMatchObject({ gross: 1800000, social: 281880, afterSocial: 1518120, tax: 77500 });
        expect(l.bonusRows[0]).toMatchObject({ month: 6, payDay: 10, afterSocial: 759060, dependents: 6, rate: 10.21, tax: 77500 });
        // 12月の賞与は税額計算を省略しているので、算出率の表の率で計算し直した税額と合わず、税率を書かない
        expect(l.bonusRows[1].rate).toBeNull();
    });
    test("年末調整の欄 ①〜㉗", () => {
        const a = l.adjustment!;
        expect([a.salaryAmount, a.salaryTax, a.bonusAmount, a.bonusTax]).toEqual([7170000, 79170, 1800000, 77500]);
        expect(a.result.employmentIncome).toBe(7020000);          // ⑨
        expect(a.result.incomeAdjustment).toBe(47000);            // ⑩
        expect(a.result.employmentIncomeAdjusted).toBe(6973000);  // ⑪
        expect([a.socialFromPay, a.socialDeclared, a.smallBusiness]).toEqual([1386102, 0, 0]); // ⑫⑬⑭
        const d = a.result.deductions;
        expect([d.lifeInsurance, d.earthquake, d.spouse + d.spouseSpecial, d.specificRelative, d.dependentsAndOthers, d.basic, d.total])
            .toEqual([120000, 50000, 380000, 410000, 1860000, 620000, 4826102]); // ⑮〜㉑
        expect([a.result.taxableIncome, a.result.calculatedTax, a.result.housingLoanCredit, a.result.annualIncomeTax, a.result.annualTax])
            .toEqual([2146000, 117100, 76500, 40600, 41400]); // ㉒〜㉖
        expect([a.differenceKind, a.difference]).toEqual(["excess", 115270]); // ㉗
        expect([a.spouseTotalIncome, a.oldLongTerm]).toEqual([500000, 14800]);
    });
    test("超過額は、12月の給与で本年中に還付する（㉚・㉛）。12月の給与の行に過不足税額 ▲115,270円を書く", () => {
        const a = l.adjustment!;
        expect([a.appliedToLastPay, a.appliedToUnpaid, a.refund, a.refundThisYear, a.refundNextYear]).toEqual([0, 0, 115270, 115270, 0]);
        expect(l.salaryRows[11]).toMatchObject({ tax: 6690, adjustment: -115270, netTax: 6690 - 115270 });
        expect(l.salaryTotal).toMatchObject({ adjustment: -115270, netTax: 79170 - 115270 });
    });
    test("扶養控除等の申告：一般38万円・特定63万円・同居老親等58万円・一般の障害者27万円、合計186万円が ⑲", () => {
        const lines = l.dependentLines!.filter((x) => x.count > 0);
        expect(lines.map((x) => [x.label, x.count, x.perPersonMan, x.totalMan])).toEqual([
            ["一般の控除対象扶養親族", 1, 38, 38],
            ["特定扶養親族", 1, 63, 63],
            ["老人扶養親族（同居老親等）", 1, 58, 58],
            ["一般の障害者", 1, 27, 27],
        ]);
        expect(l.dependentLines!.reduce((s, x) => s + x.totalMan, 0) * 10000).toBe(l.adjustment!.result.deductions.dependentsAndOthers);
    });
});

describe("精算の時期・不足額・年末調整をしない人", () => {
    test("翌年1月の給与で精算するなら、翌年において還付する金額（㉜）に書き、12月の行には書かない", () => {
        const l = buildWithholdingLedger(source({ adjustment: { declaration: decl, settleYear: 2027, settleMonth: 1 } }), m);
        expect([l.adjustment!.refundThisYear, l.adjustment!.refundNextYear]).toEqual([0, 115270]);
        expect(l.salaryRows[11]).toMatchObject({ adjustment: 0, netTax: 6690 });
    });
    test("不足額は、12月の給与で徴収する（㉝）か、翌年に繰り越して徴収する（㉞）", () => {
        // 源泉徴収した税額がなければ、年調年税額 41,400円がそのまま不足額
        const noTax = salaries.map((r) => ({ ...r, income_tax: 0, year_end_adjustment: r.target_month === 12 ? -41400 : 0 }));
        const dec = buildWithholdingLedger(source({ salaries: noTax, bonuses: [bonus(6, "2026-06-10", 0), bonus(12, "2026-12-10", 0)] }), m);
        expect([dec.adjustment!.differenceKind, dec.adjustment!.difference, dec.adjustment!.collectThisYear, dec.adjustment!.refund]).toEqual(["shortage", 41400, 41400, 0]);
        expect(dec.salaryRows[11]).toMatchObject({ tax: 0, adjustment: 41400, netTax: 41400 });
        const jan = buildWithholdingLedger(source({ salaries: noTax, bonuses: [bonus(6, "2026-06-10", 0), bonus(12, "2026-12-10", 0)], adjustment: { declaration: decl, settleYear: 2027, settleMonth: 1 } }), m);
        expect([jan.adjustment!.collectThisYear, jan.adjustment!.collectNextYear]).toEqual([0, 41400]);
    });
    test("年末調整をしない人（乙欄・年の途中で退職した人など）は、月ごとの欄だけ", () => {
        const l = buildWithholdingLedger(source({ staff: { name: "乙欄 花子", tax_column: "otsu" }, adjustment: null }), m);
        expect(l.taxColumn).toBe("otsu");
        expect([l.adjustment, l.dependentLines]).toEqual([null, null]);
        expect(l.salaryRows[11]).toMatchObject({ adjustment: 0 });
        expect(l.salaryTotal.tax).toBe(79170);
        expect(buildWithholdingLedger(source({ staff: { name: "丙欄 次郎", tax_column: "hei" }, adjustment: null }), m).taxColumn).toBe("hei");
    });
    test("払っていない月の行は空。年末調整の表がない年分は、年末調整の欄を作らない", () => {
        const l = buildWithholdingLedger(source({ salaries: [salary(4), salary(5)], bonuses: [] }), null);
        expect(l.salaryRows.map((r) => r?.month ?? null)).toEqual([null, null, null, 4, 5, null, null, null, null, null, null, null]);
        expect(l.adjustment).toBeNull();
    });
});

describe("前年の年末調整に基づき繰り越した過不足税額（1月の給与で精算）", () => {
    test("前年分の過不足額と、1月に精算した額・差引残高を書き、1月の行の過不足税額には書かない", () => {
        const jan = salary(1, { target_year: 2027, year_end_adjustment: 115270 });
        const l = buildWithholdingLedger(source({ year: 2027, salaries: [jan], bonuses: [], adjustment: null, previousYearDifference: 115270 }), null);
        expect(l.carryOver).toEqual({ amount: 115270, settledInJanuary: 115270, balance: 0 });
        expect(l.salaryRows[0]).toMatchObject({ adjustment: 0, netTax: 6320 });
    });
    test("まだ1月の給与を確定していなければ、全額が残高", () => {
        const l = buildWithholdingLedger(source({ year: 2027, salaries: [], bonuses: [], adjustment: null, previousYearDifference: -3000 }), null);
        expect(l.carryOver).toEqual({ amount: -3000, settledInJanuary: 0, balance: -3000 });
    });
    test("前年の年末調整を前年12月に精算していれば、書かない", () => {
        expect(buildWithholdingLedger(source(), m).carryOver).toBeNull();
    });
});

describe("支給日・賞与の税率", () => {
    test("給与の支給日：99（末日）や、その月にない日は月末にする", () => {
        expect(payDayOf(2026, 1, 25)).toBe(25);
        expect(payDayOf(2026, 2, 99)).toBe(28);
        expect(payDayOf(2026, 4, 31)).toBe(30);
        expect(payDayOf(2026, 4, null)).toBeNull();
    });
    test("前月の給与がない・賞与が前月の給与の10倍を超える（月額表で計算する）ときは、税率を書かない", () => {
        expect(bonusTaxRateUsed(759060, 0, 6, 2026, "kou", 77500)).toBeNull();
        expect(bonusTaxRateUsed(5075461, 507546, 6, 2026, "kou", 0)).toBeNull();
        expect(bonusTaxRateUsed(759060, 507546, 6, 2026, "kou", 77500)).toBe(10.21);
    });
});
