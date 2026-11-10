/**
 * 年末調整（nencho.ts）のテスト（令和8年分）
 * 実行方法: bun test
 *
 * 期待値は国税庁「令和8年分 年末調整のしかた」から引用。
 *   ・設例：「本年最後に支払う給与（賞与）についての税額計算を省略して年末調整を行う場合」（110rei.pdf）
 *   ・電子計算機等による年末調整の計算例（204.pdf）
 *   ・保険料控除申告書の受理と内容の確認（107.pdf）・速算表など（115.pdf）
 */
import { describe, expect, test } from "bun:test";
import { NENCHO_2026, getNenchoMaster } from "../constants/nencho";
import {
  basicDeduction, calcNencho, calculatedTaxOf, earthquakeDeduction, employmentIncomeOf, insuranceDeduction,
  lifeInsuranceDeduction, roundedSalaryOf, specificRelativeDeduction, spouseDeductions, type NenchoInput,
} from "./nencho";

const m = NENCHO_2026;

/** 設例の山川太郎さん */
const example: NenchoInput = {
  salaryTotal: 8970000,
  withheldTax: 156670,
  socialInsuranceFromPay: 1386102,
  socialInsuranceDeclared: 0,
  smallBusinessMutualAid: 0,
  lifeInsurance: { generalNew: 80000, generalOld: 35000, medical: 80000, pensionNew: 30000, pensionOld: 90000 },
  earthquake: { earthquake: 42000, oldLongTerm: 14800 },
  housingLoanCredit: 76500,
  otherIncome: 0,
  incomeAdjustmentEligible: true, // 特定扶養親族（23歳未満）がいる
  hasDependentUnder23: true,
  spouse: { totalIncome: 500000, elderly: false },
  dependents: { general: 1, specific: 1, elderlyLivingTogether: 1, elderlyOther: 0 },
  specificRelativeIncomes: [1000000],
  disability: { general: 1, special: 0, specialLivingTogether: 0 }, // 老人扶養親族が一般の障害者
  widow: false, singleParent: false, workingStudent: false,
};

describe("設例：給与の総額897万円・住宅借入金等特別控除あり（令和8年分 年末調整のしかた）", () => {
    const r = calcNencho(example, m);
    test("給与所得控除後の給与等の金額 7,020,000円、所得金額調整控除 47,000円、調整控除後 6,973,000円", () => {
        expect(r.employmentIncome).toBe(7020000);
        expect(r.incomeAdjustment).toBe(47000);
        expect(r.employmentIncomeAdjusted).toBe(6973000);
    });
    test("所得控除：生命保険料 120,000円・地震保険料 50,000円・配偶者 380,000円・特定親族 410,000円・扶養等 1,860,000円・基礎 620,000円、合計 4,826,102円", () => {
        expect(r.deductions).toEqual({
            socialInsurance: 1386102, smallBusinessMutualAid: 0, lifeInsurance: 120000, earthquake: 50000,
            spouse: 380000, spouseSpecial: 0, specificRelative: 410000, dependentsAndOthers: 1860000, basic: 620000,
            total: 4826102,
        });
    });
    test("課税給与所得金額 2,146,000円、算出所得税額 117,100円、年調所得税額 40,600円、年調年税額 41,400円", () => {
        expect(r.taxableIncome).toBe(2146000);
        expect(r.calculatedTax).toBe(117100);
        expect(r.housingLoanCredit).toBe(76500);
        expect(r.annualIncomeTax).toBe(40600);
        expect(r.annualTax).toBe(41400);
    });
    test("徴収した税額 156,670円のほうが 115,270円多いので、超過額 115,270円を還付する", () => {
        expect(r.difference).toBe(115270);
        expect(r.eligible).toBe(true);
    });
});

describe("給与所得控除後の給与等の金額", () => {
    test("年調給与額：220万円以上660万円未満は4,000円刻みの最低額（計算例：5,310,000円 → 5,308,000円）", () => {
        expect(roundedSalaryOf(5310000, m)).toBe(5308000);
        expect(roundedSalaryOf(2199999, m)).toBe(2199999);
        expect(roundedSalaryOf(6600000, m)).toBe(6600000);
    });
    test("区分ごとの計算（令和8年分は給与所得控除の最低保障額が74万円）", () => {
        expect(employmentIncomeOf(740999, m)).toBe(0);
        expect(employmentIncomeOf(741000, m)).toBe(1000);
        expect(employmentIncomeOf(2190999, m)).toBe(1450999);
        expect(employmentIncomeOf(2191000, m)).toBe(1451000);
        expect(employmentIncomeOf(2200000, m)).toBe(1460000);
        expect(employmentIncomeOf(5310000, m)).toBe(5308000 * 0.8 - 440000);
        expect(employmentIncomeOf(6600001, m)).toBe(Math.floor(6600001 * 0.9) - 1100000); // 1円未満切り捨て
        expect(employmentIncomeOf(8970000, m)).toBe(7020000);
        expect(employmentIncomeOf(0, m)).toBe(0);
    });
});

describe("生命保険料控除・地震保険料控除（設例の内訳）", () => {
    test("一般：23歳未満の扶養親族がいるので新生命保険料は計算式Ⅱ（80,000円 → 50,000円）、旧 35,000円 → 30,000円、両方で上限6万円", () => {
        expect(insuranceDeduction(80000, m.lifeInsurance.newYoung)).toBe(50000);
        expect(insuranceDeduction(35000, m.lifeInsurance.old)).toBe(30000);
    });
    test("介護医療 80,000円 → 40,000円、個人年金は新 25,000円・旧 47,500円・両方 40,000円のうち最も大きい 47,500円", () => {
        expect(insuranceDeduction(80000, m.lifeInsurance.new)).toBe(40000);
        expect(insuranceDeduction(30000, m.lifeInsurance.new)).toBe(25000);
        expect(insuranceDeduction(90000, m.lifeInsurance.old)).toBe(47500);
    });
    test("合計 147,500円は上限の12万円", () => {
        expect(lifeInsuranceDeduction(example.lifeInsurance, true, m)).toBe(120000);
    });
    test("23歳未満の扶養親族がいなければ、一般の新旧両方の上限は4万円", () => {
        const p = { generalNew: 80000, generalOld: 35000, medical: 0, pensionNew: 0, pensionOld: 0 };
        expect(lifeInsuranceDeduction(p, false, m)).toBe(40000);
        expect(lifeInsuranceDeduction(p, true, m)).toBe(60000);
    });
    test("旧生命保険料だけが多いときは、旧の控除額（最高5万円）", () => {
        const p = { generalNew: 0, generalOld: 120000, medical: 0, pensionNew: 0, pensionOld: 0 };
        expect(lifeInsuranceDeduction(p, false, m)).toBe(50000);
    });
    test("1円未満は切り上げる（新 20,001円 → 10,000.5円 → 10,001円＋10,000円）", () => {
        expect(insuranceDeduction(20001, m.lifeInsurance.new)).toBe(20001);
        expect(insuranceDeduction(30001, m.lifeInsurance.new)).toBe(25001);
    });
    test("地震保険料：42,000円 ＋ 旧長期 14,800円の控除額 12,400円 ＝ 54,400円 → 上限の5万円", () => {
        expect(insuranceDeduction(14800, m.earthquake.oldLongTerm)).toBe(12400);
        expect(earthquakeDeduction({ earthquake: 42000, oldLongTerm: 14800 }, m)).toBe(50000);
        expect(earthquakeDeduction({ earthquake: 0, oldLongTerm: 30000 }, m)).toBe(15000);
    });
});

describe("配偶者控除・特定親族特別控除・基礎控除（令和8年分の表）", () => {
    test("配偶者控除：所得者の合計所得金額900万円以下・950万円以下・1,000万円以下で 38万・26万・13万円（老人は48万・32万・16万円）", () => {
        expect(spouseDeductions({ totalIncome: 620000, elderly: false }, 9000000, m).spouse).toBe(380000);
        expect(spouseDeductions({ totalIncome: 620000, elderly: false }, 9500000, m).spouse).toBe(260000);
        expect(spouseDeductions({ totalIncome: 0, elderly: true }, 10000000, m).spouse).toBe(160000);
        expect(spouseDeductions({ totalIncome: 0, elderly: false }, 10000001, m)).toEqual({ spouse: 0, spouseSpecial: 0 });
    });
    test("配偶者特別控除：配偶者の合計所得金額 62万円超95万円以下は38万円、133万円を超えると0円", () => {
        expect(spouseDeductions({ totalIncome: 620001, elderly: false }, 5000000, m)).toEqual({ spouse: 0, spouseSpecial: 380000 });
        expect(spouseDeductions({ totalIncome: 1330000, elderly: false }, 5000000, m).spouseSpecial).toBe(30000);
        expect(spouseDeductions({ totalIncome: 1330001, elderly: false }, 5000000, m).spouseSpecial).toBe(0);
    });
    test("特定親族特別控除：合計所得金額 95万円超100万円以下は41万円、62万円以下・123万円超は0円", () => {
        expect(specificRelativeDeduction([1000000], m)).toBe(410000);
        expect(specificRelativeDeduction([620000, 1230001], m)).toBe(0);
        expect(specificRelativeDeduction([700000, 1230000], m)).toBe(630000 + 30000);
    });
    test("基礎控除：489万円以下 104万円、655万円以下 67万円、2,350万円以下 62万円、2,500万円を超えると0円", () => {
        expect(basicDeduction(4890000, m)).toBe(1040000);
        expect(basicDeduction(4890001, m)).toBe(670000);
        expect(basicDeduction(6973000, m)).toBe(620000);
        expect(basicDeduction(25000001, m)).toBe(0);
    });
    test("速算表：課税給与所得金額 2,146,000円 × 10% − 97,500円 ＝ 117,100円", () => {
        expect(calculatedTaxOf(2146000, m)).toBe(117100);
        expect(calculatedTaxOf(1950000, m)).toBe(97500);
        expect(calculatedTaxOf(0, m)).toBe(0);
    });
});

describe("過不足と対象外", () => {
    const simple = (o: Partial<NenchoInput>): NenchoInput => ({
        ...example, lifeInsurance: { generalNew: 0, generalOld: 0, medical: 0, pensionNew: 0, pensionOld: 0 },
        earthquake: { earthquake: 0, oldLongTerm: 0 }, housingLoanCredit: 0, spouse: null,
        dependents: { general: 0, specific: 0, elderlyLivingTogether: 0, elderlyOther: 0 }, specificRelativeIncomes: [],
        disability: { general: 0, special: 0, specialLivingTogether: 0 }, incomeAdjustmentEligible: false, hasDependentUnder23: false, ...o,
    });
    test("住宅借入金等特別控除は算出所得税額まで（引ききれない分は切り捨て）", () => {
        const r = calcNencho(simple({ salaryTotal: 4000000, socialInsuranceFromPay: 600000, housingLoanCredit: 999999, withheldTax: 50000 }), m);
        expect(r.housingLoanCredit).toBe(r.calculatedTax);
        expect(r.annualTax).toBe(0);
        expect(r.difference).toBe(50000);
    });
    test("徴収した税額が年調年税額より少なければ、不足額（マイナス）", () => {
        const r = calcNencho(simple({ salaryTotal: 4000000, socialInsuranceFromPay: 600000, withheldTax: 0 }), m);
        expect(r.annualTax).toBeGreaterThan(0);
        expect(r.difference).toBe(-r.annualTax);
    });
    test("給与の総額が2,000万円を超える人は、年末調整の対象外", () => {
        const r = calcNencho(simple({ salaryTotal: 20000001 }), m);
        expect(r.eligible).toBe(false);
        expect(r.ineligibleReason).toContain("20,000,000円");
    });
    test("令和8年分のほかの年分は、まだ表がない", () => {
        expect(getNenchoMaster(2026)).toBe(NENCHO_2026);
        expect(getNenchoMaster(2025)).toBeNull();
    });
});

/**
 * 令和9年分の表は、国税庁「令和9年分 年末調整のしかた」が出てから PDF で作る（nencho-tables/README.md）。
 * そのときに、国税庁「源泉所得税の改正のあらまし」（令和8年4月。https://www.nta.go.jp/publication/pamph/gensen/2026kaisei.pdf）
 * でわかっていることと合うかを確かめる。表ができるまでは飛ばす。
 * 合わなければ、令和9年度の税制改正などで変わっていないかを確かめる（令和8年度の改正は、令和8年分の年末調整から使われた）
 */
describe("令和9年分の表（令和8年4月の「源泉所得税の改正のあらまし」と照らし合わせる）", () => {
    const m27 = getNenchoMaster(2027);
    test.skipIf(m27 === null)("ひとり親控除は38万円（改正前：35万円。令和9年分以後。あらまし5ページ 6⑴）", () => {
        expect(m27!.deductions.singleParent).toBe(380000);
    });
    test.skipIf(m27 === null)("年調年税額は、防衛特別所得税と復興特別所得税を含めて、年調所得税額 × 102.1%（あらまし8ページ 3）", () => {
        expect(m27!.reconstruction.ratePercent).toBe(102.1);
        expect(m27!.reconstruction).toEqual(NENCHO_2026.reconstruction);
    });
    test.skipIf(m27 === null)(
        "ほかは令和8年分と同じ（基礎控除・給与所得控除は「令和8・9年分」の額。23歳未満の扶養親族がいるときの生命保険料控除の特例は令和9年分まで延長。あらまし1・2・6ページ）",
        () => {
            const sameAs2026 = { ...m27!, year: NENCHO_2026.year, deductions: { ...m27!.deductions, singleParent: NENCHO_2026.deductions.singleParent } };
            expect(sameAs2026).toEqual(NENCHO_2026);
        },
    );
});
