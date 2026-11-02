/**
 * 給与所得の源泉徴収票（withholdingSlip.ts）のテスト（令和8年分）
 * 実行方法: bun test
 *
 * 期待値は国税庁「令和8年分 給与所得の源泉徴収票等の法定調書の作成と提出の手引」第2章の記載例1〜4から引用。
 * 記載例の源泉徴収簿・申告書に出ていない値（配偶者・扶養親族の生年月日の一部、生命保険料の支払額の内訳、
 * どの扶養親族が障害者か）は、記載例の控除額・人数と合うように置いた仮の値（コメントに「仮」と書く）。
 */
import { describe, expect, test } from "bun:test";
import { GENSEN_2026, NENCHO_2026 } from "../constants/nencho";
import { classifyDependent, emptyDeclaration, type DeclaredDependent, type NenchoDeclaration } from "./nenchoDeclaration";
import { buildWithholdingSlip, housingLoanKindDescription, specificRelativeCode, type SlipSource } from "./withholdingSlip";
import { formatWareki, toWareki } from "./wareki";

const nm = NENCHO_2026;
const gm = GENSEN_2026;
const company = { name: "国税商事株式会社", address: "東京都千代田区霞が関3-1-1", phone: "03-0000-0000" };
const dep = (name: string, birthday: string, o: Partial<DeclaredDependent> = {}): DeclaredDependent => ({
    name, relation: "", birthday, totalIncome: 0, disability: "none", livingTogether: true, linealAscendant: false, ...o,
});
const slipOf = (o: Partial<SlipSource>) => buildWithholdingSlip({
    year: 2026,
    staff: { name: "国税 太郎", furigana: "コクゼイ タロウ", address: "東京都千代田区霞が関", birthday: "1970-01-01", join_date: "2010-04-01" },
    company,
    totals: { salary: 0, socialInsurance: 0, withheldTax: 0, salaryMonths: [], bonusCount: 0 },
    declaration: null,
    ...o,
}, nm, gm);

describe("手引から自動生成した区分（gensen2026.ts）", () => {
    test("特定親族特別控除の額の区分は、年末調整のしかた（別の PDF）の特定親族特別控除額の表と、金額・所得の範囲が同じ", () => {
        expect(gm.specificRelativeCodes.map(({ amount, over, upTo }) => ({ amount, over, upTo })))
            .toEqual(nm.specificRelative.map(({ amount, over, upTo }) => ({ amount, over, upTo })));
        expect(specificRelativeCode(630000, gm)).toBe("10");
        expect(specificRelativeCode(510000, gm)).toBe("30");
        expect(specificRelativeCode(30000, gm)).toBe("90");
    });
    test("16歳未満の扶養親族の生年月日の境目は、扶養親族の区分（年少）と同じ", () => {
        const young = gm.youngBornOnOrAfter;
        expect(young).toBe("2011-01-02");
        expect(classifyDependent(dep("", young), 2026, nm)).toBe("young");
        expect(classifyDependent(dep("", "2011-01-01"), 2026, nm)).toBe("general");
    });
    test("住宅借入金等特別控除区分は14種類。説明を付けられる", () => {
        expect(gm.housingLoanKinds).toHaveLength(14);
        expect(housingLoanKindDescription("住（特）")).toBe("住（特）：一般の住宅・特定取得");
        expect(housingLoanKindDescription("認（特家）")).toBe("認（特家）：認定住宅等・特例認定住宅等");
    });
});

describe("和暦", () => {
    test("元号の境目", () => {
        expect(toWareki("1989-01-07")).toEqual({ era: "昭和", year: 64, month: 1, day: 7 });
        expect(toWareki("1989-01-08")).toEqual({ era: "平成", year: 1, month: 1, day: 8 });
        expect(toWareki("2019-04-30")).toEqual({ era: "平成", year: 31, month: 4, day: 30 });
        expect(formatWareki("2019-05-01")).toBe("令和元年5月1日");
        expect(formatWareki("2026-03-31")).toBe("令和8年3月31日");
        expect(toWareki("")).toBeNull();
    });
});

describe("記載例1：年末調整を行った一般の受給者", () => {
    const decl: NenchoDeclaration = {
        ...emptyDeclaration(),
        spouse: { name: "国税 花子", furigana: "コクゼイ ハナコ", birthday: "1972-01-01", totalIncome: 400000, disability: "none", livingTogether: true },
        dependents: [
            dep("国税 一郎", "2005-01-01", { relation: "子", totalIncome: 950000 }),                                    // 特定親族（合計所得 950,000円）
            dep("国税 次郎", "2009-02-02", { relation: "子" }),                                                        // 控除対象扶養親族
            dep("国税 孝男", "1940-10-10", { relation: "父", linealAscendant: true, disability: "general" }),          // 同居老親等（障害者は仮）
            dep("国税 三郎", "2014-03-03", { relation: "子" }),                                                        // 16歳未満
        ],
        insurance: {
            ...emptyDeclaration().insurance,
            // 生命保険料の支払額は仮（控除額 120,000円になる金額）
            lifeGeneralNew: 200000, lifeMedical: 100000, lifePensionNew: 100000,
            earthquake: 30000, oldLongTerm: 19600,
            socialInsurance: 176460, nationalPension: 176460,
        },
    };
    const slip = slipOf({
        totals: { salary: 7620000 + 2000000, socialInsurance: 1483023, withheldTax: 135720 + 236740, salaryMonths: [], bonusCount: 1 },
        declaration: decl,
    });

    test("支払金額・給与所得控除後の金額（調整控除後）・所得控除の額の合計額・源泉徴収税額", () => {
        expect(slip.adjusted).toBe(true);
        expect(slip.kind).toBe("給与・賞与");
        expect(slip.payment).toBe(9620000);
        expect(slip.employmentIncome).toBe(7558000);
        expect(slip.deductionTotal).toBe(4564283);
        expect(slip.withholdingTax).toBe(206000);
    });
    test("控除額・社会保険料等の金額・所得金額調整控除額・基礎控除の額", () => {
        expect(slip.spouseDeduction).toBe(380000);
        expect(slip.specificRelativeDeduction).toBe(510000);
        expect(slip.socialInsurance).toBe(1659483);
        expect(slip.lifeInsuranceDeduction).toBe(120000);
        expect(slip.earthquakeDeduction).toBe(44800);
        expect(slip.incomeAdjustment).toBe(112000);
        expect(slip.basicDeduction).toBe(620000);
        expect(slip.nationalPension).toBe(176460);
        expect(slip.oldLongTerm).toBe(19600);
        expect(slip.spouseTotalIncome).toBe(400000);
    });
    test("人数（控除対象配偶者あり・その他1・老人1（同居老親等1）・特定親族1・16歳未満1・障害者1）", () => {
        expect(slip.spouseMark).toEqual({ has: true, elderly: false });
        expect(slip.dependentCounts).toEqual({ specific: null, elderly: 1, elderlyTogether: 1, other: 1, specificRelative: 1 });
        expect(slip.youngCount).toBe(1);
        expect(slip.disabledCounts).toEqual({ special: null, specialTogether: null, other: 1 });
    });
    test("控除対象扶養親族等の区分：居住者は00、特定親族は特定親族特別控除の額（51万円）の区分30", () => {
        expect(slip.spouse).toEqual({ furigana: "コクゼイ ハナコ", name: "国税 花子", code: "00" });
        expect(slip.dependents.map((p) => [p.name, p.code])).toEqual([["国税 一郎", "30"], ["国税 次郎", "00"], ["国税 孝男", "00"]]);
        expect(slip.youngDependents.map((p) => [p.name, p.code])).toEqual([["国税 三郎", ""]]);
    });
    test("生命保険料控除の特例（23歳未満の扶養親族あり）は摘要欄に書く", () => {
        expect(slip.remarks).toEqual(["租税特別措置法第41条の15の5第1項適用"]);
    });
});

describe("記載例2：就職前に他の支払者から受けた給与等を通算して年末調整を行った受給者", () => {
    const decl: NenchoDeclaration = {
        ...emptyDeclaration(),
        spouse: { name: "国税 昌子", birthday: "1990-04-01", totalIncome: 0, disability: "none", livingTogether: true }, // 生年月日は仮
        dependents: [dep("国税 和夫", "2000-06-01")], // 生年月日は仮（一般の控除対象扶養親族）
        previousJob: {
            salary: 1095000, withheldTax: 15180, socialInsurance: 169722,
            payerName: "株式会社××商事", payerAddress: "神戸市中央区山手通2-X-X", retiredOn: "2026-03-31",
        },
    };
    // 源泉徴収簿の金額（給料 4,380,000円・賞与 1,490,000円など）から、前の勤め先の分を引いたものが Q の分
    const slip = slipOf({
        staff: { name: "国税 正", furigana: "コクゼイ タダシ", address: "東京都中野区4-X-OO", birthday: "1987-05-13", join_date: "2026-04-01" },
        totals: { salary: 4380000 + 1490000 - 1095000, socialInsurance: 836110 - 169722, withheldTax: 55660 + 54430 - 15180, salaryMonths: [], bonusCount: 1 },
        declaration: decl,
    });

    test("前の勤め先の給与を含めて書く", () => {
        expect(slip.payment).toBe(5870000);
        expect(slip.employmentIncome).toBe(4254400);
        expect(slip.deductionTotal).toBe(2636110);
        expect(slip.withholdingTax).toBe(82500);
        expect(slip.socialInsurance).toBe(836110);
        expect(slip.spouseDeduction).toBe(380000);
        expect(slip.basicDeduction).toBe(1040000);
        expect(slip.spouseTotalIncome).toBe(0);
        expect(slip.dependentCounts.other).toBe(1);
    });
    test("摘要欄に前の勤め先の所在地・名称・退職日・支払金額・源泉徴収税額・社会保険料", () => {
        expect(slip.remarks).toEqual(["神戸市中央区山手通2-X-X 株式会社××商事 令和8年3月31日退職 支払金額 1,095,000円 源泉徴収税額 15,180円 社会保険料 169,722円"]);
    });
    test("中途就職（令和8年4月1日）・生年月日（昭和62年5月13日）", () => {
        expect(slip.joinRetire).toEqual({ joined: true, retired: false, date: { era: "令和", year: 8, month: 4, day: 1 } });
        expect(slip.birthday).toEqual({ era: "昭和", year: 62, month: 5, day: 13 });
    });
});

describe("記載例3：2つの住宅借入金等特別控除を受け、控除額が算出所得税額を超える", () => {
    const decl: NenchoDeclaration = {
        ...emptyDeclaration(),
        spouse: { name: "国税 昌子", birthday: "1990-04-01", totalIncome: 0, disability: "none", livingTogether: true }, // 生年月日は仮
        dependents: [dep("国税 和夫", "2000-06-01")], // 生年月日は仮
        insurance: { ...emptyDeclaration().insurance, earthquake: 50000 },
        housingLoanCredit: 178000,
        housingLoans: [
            { residenceStart: "2018-05-20", kindCode: "11", yearEndBalance: 11500000 },
            { residenceStart: "2024-05-20", kindCode: "01", yearEndBalance: 9000000 },
        ],
    };
    const slip = slipOf({
        staff: { name: "国税 健", furigana: "コクゼイ ケン", address: "神奈川県横浜市中区山下町X-X", birthday: "1980-01-01", join_date: "2010-04-01" },
        totals: { salary: 4380000 + 1490000, socialInsurance: 836110, withheldTax: 55660 + 54430, salaryMonths: [], bonusCount: 1 },
        declaration: decl,
    });

    test("住宅借入金等特別控除の額は算出所得税額まで（78,400円）、可能額は申告書の控除額（178,000円）", () => {
        expect(slip.deductionTotal).toBe(2686110);
        expect(slip.earthquakeDeduction).toBe(50000);
        expect(slip.housingLoanCredit).toBe(78400);
        expect(slip.withholdingTax).toBe(0);
        expect(slip.housingLoan.count).toBe(2);
        expect(slip.housingLoan.available).toBe(178000);
    });
    test("1回目・2回目の居住開始年月日・区分・年末残高", () => {
        expect(slip.housingLoan.entries).toEqual([
            { residenceStart: { era: "平成", year: 30, month: 5, day: 20 }, kindLabel: "住（特）", yearEndBalance: 11500000 },
            { residenceStart: { era: "令和", year: 6, month: 5, day: 20 }, kindLabel: "住", yearEndBalance: 9000000 },
        ]);
    });
    test("控除しきれるとき・1つだけのときは、可能額・年末残高を書かない。3つ目からは摘要欄", () => {
        const one = slipOf({
            totals: { salary: 5870000, socialInsurance: 836110, withheldTax: 110090, salaryMonths: [], bonusCount: 1 },
            declaration: { ...decl, housingLoanCredit: 50000, housingLoans: [decl.housingLoans[1]] },
        });
        expect(one.housingLoanCredit).toBe(50000);
        expect(one.housingLoan).toEqual({ count: 1, available: null, entries: [{ residenceStart: { era: "令和", year: 6, month: 5, day: 20 }, kindLabel: "住", yearEndBalance: null }] });
        const three = slipOf({
            totals: { salary: 5870000, socialInsurance: 836110, withheldTax: 110090, salaryMonths: [], bonusCount: 1 },
            declaration: { ...decl, housingLoans: [...decl.housingLoans, { residenceStart: "2025-03-01", kindCode: "02", yearEndBalance: 5000000 }] },
        });
        expect(three.housingLoan.entries).toHaveLength(2);
        expect(three.remarks).toEqual(["居住開始年月日 令和7年3月1日 住宅借入金等特別控除区分 認 住宅借入金等年末残高 5,000,000円"]);
    });
});

describe("記載例4：年末調整を行っていない（年の途中で退職）", () => {
    const slip = slipOf({
        staff: { name: "国税 直樹", address: "東京都", birthday: "1980-01-01", join_date: "2015-04-01", retirement_date: "2026-05-31" },
        totals: { salary: 1500000, socialInsurance: 220000, withheldTax: 30000, salaryMonths: [1, 2, 3, 4, 5], bonusCount: 0 },
    });
    test("支払金額・源泉徴収税額（源泉徴収した合計）・社会保険料等の金額だけ。年末調整の欄は空", () => {
        expect(slip.adjusted).toBe(false);
        expect(slip.kind).toBe("給与");
        expect(slip.payment).toBe(1500000);
        expect(slip.withholdingTax).toBe(30000);
        expect(slip.socialInsurance).toBe(220000);
        expect(slip.employmentIncome).toBeNull();
        expect(slip.deductionTotal).toBeNull();
        expect(slip.basicDeduction).toBeNull();
        expect(slip.warnings.length).toBeGreaterThan(0);
    });
    test("中途退職（令和8年5月31日）", () => {
        expect(slip.joinRetire).toEqual({ joined: false, retired: true, date: { era: "令和", year: 8, month: 5, day: 31 } });
    });
});

describe("そのほかの欄", () => {
    const totals = { salary: 3000000, socialInsurance: 450000, withheldTax: 50000, salaryMonths: [], bonusCount: 0 };
    test("同じ年に就職と退職：就職には印を付けず、退職日を書いて摘要に「中途就」", () => {
        const slip = slipOf({ staff: { name: "A", join_date: "2026-02-01", retirement_date: "2026-08-31" }, totals });
        expect(slip.joinRetire).toEqual({ joined: false, retired: true, date: { era: "令和", year: 8, month: 8, day: 31 } });
        expect(slip.remarks).toEqual(["中途就"]);
    });
    test("未成年者は平成21年1月3日以後に生まれた人。乙欄の人は乙欄に印", () => {
        expect(slipOf({ staff: { name: "A", birthday: "2009-01-03" }, totals }).marks.minor).toBe(true);
        expect(slipOf({ staff: { name: "A", birthday: "2009-01-02" }, totals }).marks.minor).toBe(false);
        const otsu = slipOf({ staff: { name: "A", tax_column: "otsu" }, totals });
        expect(otsu.marks.otsu).toBe(true);
        expect(otsu.adjusted).toBe(false);
    });
    test("丙欄の人は年末調整をしない人として書き、乙欄には印を付けない（注意を出す）", () => {
        const hei = slipOf({ staff: { name: "A", tax_column: "hei" }, totals });
        expect(hei.marks.otsu).toBe(false);
        expect(hei.adjusted).toBe(false);
        expect(hei.warnings.some((w) => w.includes("丙欄"))).toBe(true);
    });
    test("控除対象扶養親族等・16歳未満が5人以上なら、5人目から摘要欄に（1）（2）…で書く", () => {
        const decl: NenchoDeclaration = {
            ...emptyDeclaration(),
            dependents: [
                ...["A", "B", "C", "D"].map((n) => dep(n, "1990-01-01")),
                dep("E", "2005-05-05", { totalIncome: 700000 }), // 特定親族（63万円 → 区分10）
                ...["F", "G", "H", "I", "J"].map((n) => dep(n, "2015-01-01")),
            ],
        };
        const slip = slipOf({ totals: { ...totals, salary: 8000000 }, declaration: decl });
        expect(slip.dependents.map((p) => p.name)).toEqual(["A", "B", "C", "D"]);
        expect(slip.youngDependents.map((p) => p.name)).toEqual(["F", "G", "H", "I"]);
        expect(slip.remarks.slice(0, 2)).toEqual(["(1)E 10", "(2)J（年少）"]);
        expect(slip.dependentCounts.other).toBe(4);
        expect(slip.dependentCounts.specificRelative).toBe(1);
        expect(slip.youngCount).toBe(5);
    });
    test("所得が1,000万円を超えて配偶者控除を受けない人の、障害者の同一生計配偶者は「（同配）」と摘要欄に書く", () => {
        const decl: NenchoDeclaration = {
            ...emptyDeclaration(),
            spouse: { name: "国税 花子", birthday: "1980-01-01", totalIncome: 0, disability: "special", livingTogether: true },
        };
        const slip = slipOf({ totals: { ...totals, salary: 13000000 }, declaration: decl });
        expect(slip.spouse).toBeNull();
        expect(slip.spouseDeduction).toBeNull();
        expect(slip.disabledCounts).toEqual({ special: 1, specialTogether: 1, other: null });
        expect(slip.remarks).toEqual(["国税 花子（同配）"]);
    });
    test("給与の総額が2,000万円を超える人は年末調整をしないので、年末調整をしない人として書く", () => {
        const slip = slipOf({ totals: { ...totals, salary: 21000000 }, declaration: emptyDeclaration() });
        expect(slip.adjusted).toBe(false);
        expect(slip.withholdingTax).toBe(50000);
        expect(slip.warnings[0]).toContain("20,000,000円");
    });
});
