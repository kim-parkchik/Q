/**
 * 年末調整の申告書の内容 → 年税額の計算の入力（nenchoDeclaration.ts）のテスト（令和8年分）
 * 実行方法: bun test
 *
 * 年齢の境目は、国税庁「令和8年分 年末調整のしかた」の扶養控除額等の表の生年月日
 * （特定扶養親族：平成16年1月2日〜平成20年1月1日生、16歳以上：平成23年1月1日以前生、70歳以上：昭和32年1月1日以前生）。
 * 扶養親族の所得要件（62万円以下）は国税庁 タックスアンサー No.1180。
 */
import { describe, expect, test } from "bun:test";
import { NENCHO_2026 } from "../constants/nencho";
import { calcNencho } from "./nencho";
import {
    ageAtYearEnd, buildNenchoInput, classifyDependent, dependentIncomeLimit, emptyDeclaration, nenchoExclusion, parseDeclaration, settlementStatusOf,
    sumYearTotals, validateDeclaration, type DeclaredDependent, type NenchoDeclaration,
} from "./nenchoDeclaration";

const m = NENCHO_2026;
const person = (birthday: string, o: Partial<DeclaredDependent> = {}): DeclaredDependent => ({
    name: "", relation: "", birthday, totalIncome: 0, disability: "none", livingTogether: true, linealAscendant: false, ...o,
});

describe("12月31日の年齢と扶養親族の区分（令和8年分）", () => {
    test("年齢は誕生日の前日に上がる（1月1日生まれは、12月31日に1つ上がる）", () => {
        expect(ageAtYearEnd("2008-01-01", 2026)).toBe(19);
        expect(ageAtYearEnd("2008-01-02", 2026)).toBe(18);
        expect(ageAtYearEnd("", 2026)).toBeNull();
    });
    test("特定扶養親族は平成16年1月2日〜平成20年1月1日生", () => {
        expect(classifyDependent(person("2004-01-02"), 2026, m)).toBe("specific");
        expect(classifyDependent(person("2008-01-01"), 2026, m)).toBe("specific");
        expect(classifyDependent(person("2004-01-01"), 2026, m)).toBe("general");
        expect(classifyDependent(person("2008-01-02"), 2026, m)).toBe("general");
    });
    test("16歳以上（平成23年1月1日以前生）が控除対象。それより後は年少扶養親族", () => {
        expect(classifyDependent(person("2011-01-01"), 2026, m)).toBe("general");
        expect(classifyDependent(person("2011-01-02"), 2026, m)).toBe("young");
    });
    test("70歳以上（昭和32年1月1日以前生）は老人扶養親族。直系尊属で同居なら同居老親等", () => {
        expect(classifyDependent(person("1957-01-01", { linealAscendant: true }), 2026, m)).toBe("elderlyTogether");
        expect(classifyDependent(person("1957-01-01", { linealAscendant: true, livingTogether: false }), 2026, m)).toBe("elderlyOther");
        expect(classifyDependent(person("1957-01-01", { linealAscendant: false }), 2026, m)).toBe("elderlyOther");
        expect(classifyDependent(person("1957-01-02"), 2026, m)).toBe("general");
    });
    test("合計所得金額が62万円を超えると扶養親族ではない（19歳以上23歳未満で123万円以下なら特定親族）", () => {
        expect(dependentIncomeLimit(m)).toBe(620000);
        expect(classifyDependent(person("2005-05-05", { totalIncome: 620000 }), 2026, m)).toBe("specific");
        expect(classifyDependent(person("2005-05-05", { totalIncome: 620001 }), 2026, m)).toBe("specificRelative");
        expect(classifyDependent(person("2005-05-05", { totalIncome: 1230001 }), 2026, m)).toBe("none");
        expect(classifyDependent(person("1990-05-05", { totalIncome: 620001 }), 2026, m)).toBe("none");
    });
});

describe("1年分の給与・賞与の集計", () => {
    test("給与は課税対象額、賞与は総支給額を合計し、社会保険料・源泉税も合計する", () => {
        const t = sumYearTotals(
            [
                { target_month: 2, taxable_amount: 300000, social_ins_total: 45000, income_tax: 6000 },
                { target_month: 1, taxable_amount: 300000, social_ins_total: 45000, income_tax: 6000 },
            ],
            [{ total_earnings: 500000, health_insurance: 25000, nursing_insurance: 0, child_support: 1000, welfare_pension: 45000, emp_insurance: 2500, income_tax: 30000 }],
        );
        expect(t).toEqual({ salary: 1100000, socialInsurance: 163500, withheldTax: 42000, salaryMonths: [1, 2], bonusCount: 1 });
    });
});

describe("設例（令和8年分 年末調整のしかた）を申告書の形で入れると、同じ年税額・過不足額になる", () => {
    const decl: NenchoDeclaration = {
        ...emptyDeclaration(),
        spouse: { name: "配偶者", birthday: "1962-04-01", totalIncome: 500000, disability: "none", livingTogether: true },
        dependents: [
            person("1996-08-01", { relation: "子" }),                                                     // 一般の控除対象扶養親族
            person("2006-08-01", { relation: "子" }),                                                     // 特定扶養親族（23歳未満）
            person("1950-08-01", { relation: "父", linealAscendant: true, disability: "general" }),         // 同居老親等・一般の障害者
            person("2005-08-01", { relation: "子", totalIncome: 1000000 }),                               // 特定親族（給与所得の金額100万円）
        ],
        insurance: {
            ...emptyDeclaration().insurance,
            lifeGeneralNew: 80000, lifeGeneralOld: 35000, lifeMedical: 80000, lifePensionNew: 30000, lifePensionOld: 90000,
            earthquake: 42000, oldLongTerm: 14800,
        },
        housingLoanCredit: 76500,
    };
    const totals = { salary: 8970000, socialInsurance: 1386102, withheldTax: 156670, salaryMonths: [], bonusCount: 0 };
    const input = buildNenchoInput(decl, totals, 2026, m);

    test("扶養親族の人数・障害者・特定親族・所得金額調整控除・生命保険料控除の特例", () => {
        expect(input.dependents).toEqual({ general: 1, specific: 1, elderlyLivingTogether: 1, elderlyOther: 0 });
        expect(input.disability).toEqual({ general: 1, special: 0, specialLivingTogether: 0 });
        expect(input.specificRelativeIncomes).toEqual([1000000]);
        expect(input.spouse).toEqual({ totalIncome: 500000, elderly: false });
        expect(input.incomeAdjustmentEligible).toBe(true);
        expect(input.hasDependentUnder23).toBe(true);
    });
    test("年調年税額 41,400円、超過額 115,270円", () => {
        const r = calcNencho(input, m);
        expect(r.annualTax).toBe(41400);
        expect(r.difference).toBe(115270);
    });
    test("前の勤め先の給与・社会保険料・源泉税は、合計に足す", () => {
        const withPrev = buildNenchoInput({ ...decl, previousJob: { ...decl.previousJob, salary: 1000000, socialInsurance: 150000, withheldTax: 20000 } }, totals, 2026, m);
        expect(withPrev.salaryTotal).toBe(9970000);
        expect(withPrev.socialInsuranceFromPay).toBe(1536102);
        expect(withPrev.withheldTax).toBe(176670);
    });
});

describe("障害者控除と所得金額調整控除の判定", () => {
    test("同一生計配偶者・扶養親族が特別障害者で同居なら同居特別障害者。本人は同居特別障害者にならない", () => {
        const decl: NenchoDeclaration = {
            ...emptyDeclaration(),
            self: { ...emptyDeclaration().self, disability: "special" },
            spouse: { name: "", birthday: "1980-01-01", totalIncome: 0, disability: "special", livingTogether: true },
            dependents: [person("1960-01-01", { disability: "special", livingTogether: false })],
        };
        const input = buildNenchoInput(decl, { salary: 0, socialInsurance: 0, withheldTax: 0, salaryMonths: [], bonusCount: 0 }, 2026, m);
        expect(input.disability).toEqual({ general: 0, special: 2, specialLivingTogether: 1 });
        expect(input.incomeAdjustmentEligible).toBe(true);
    });
    test("年少扶養親族も障害者控除・23歳未満の判定に入る。所得が多い親族は入らない", () => {
        const decl: NenchoDeclaration = {
            ...emptyDeclaration(),
            dependents: [
                person("2015-01-01", { disability: "general" }),
                person("1990-01-01", { disability: "special", totalIncome: 2000000 }),
            ],
        };
        const input = buildNenchoInput(decl, { salary: 0, socialInsurance: 0, withheldTax: 0, salaryMonths: [], bonusCount: 0 }, 2026, m);
        expect(input.dependents).toEqual({ general: 0, specific: 0, elderlyLivingTogether: 0, elderlyOther: 0 });
        expect(input.disability).toEqual({ general: 1, special: 0, specialLivingTogether: 0 });
        expect(input.hasDependentUnder23).toBe(true);
    });
    test("配偶者が70歳以上なら老人控除対象配偶者", () => {
        const decl = { ...emptyDeclaration(), spouse: { name: "", birthday: "1955-06-01", totalIncome: 0, disability: "none" as const, livingTogether: true } };
        expect(buildNenchoInput(decl, { salary: 0, socialInsurance: 0, withheldTax: 0, salaryMonths: [], bonusCount: 0 }, 2026, m).spouse)
            .toEqual({ totalIncome: 0, elderly: true });
    });
});

describe("保存と入力の確認", () => {
    test("保存した JSON を読み直すと同じ。壊れた JSON は空の申告書", () => {
        const decl = { ...emptyDeclaration(), housingLoanCredit: 1000, dependents: [person("2010-01-01")] };
        expect(parseDeclaration(JSON.stringify(decl))).toEqual(decl);
        expect(parseDeclaration("{")).toEqual(emptyDeclaration());
        expect(parseDeclaration(null)).toEqual(emptyDeclaration());
    });
    test("寡婦とひとり親の両方、生年月日のない扶養親族は誤り", () => {
        expect(validateDeclaration(emptyDeclaration())).toEqual([]);
        const bad = { ...emptyDeclaration(), self: { ...emptyDeclaration().self, widow: true, singleParent: true }, dependents: [person("")] };
        expect(validateDeclaration(bad)).toHaveLength(2);
    });
});

describe("年末調整の対象", () => {
    test("甲欄で、12月にも在籍している人は対象。12月中に退職する人も対象", () => {
        expect(nenchoExclusion({ tax_column: "kou" }, 2026)).toBeNull();
        expect(nenchoExclusion({}, 2026)).toBeNull();
        expect(nenchoExclusion({ retirement_date: "2026-12-15" }, 2026)).toBeNull();
    });
    test("乙欄の人・11月までに退職した人は対象外", () => {
        expect(nenchoExclusion({ tax_column: "otsu" }, 2026)).toContain("乙欄");
        expect(nenchoExclusion({ retirement_date: "2026-11-30" }, 2026)).toContain("退職");
    });
});

describe("過不足額の精算の状況", () => {
    test("精算する給与が確定済みで同じ過不足額なら精算済み、違えば確定し直し、未確定なら精算前", () => {
        expect(settlementStatusOf(115270, 115270)).toBe("done");
        expect(settlementStatusOf(115270, 0)).toBe("redo");
        expect(settlementStatusOf(-5000, null)).toBe("pending");
        expect(settlementStatusOf(0, 0)).toBe("done"); // 過不足なしなら、確定するだけでよい
    });
});
