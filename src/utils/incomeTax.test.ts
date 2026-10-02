/**
 * 源泉所得税（月額・甲欄）のテスト
 * 実行方法: bun test
 *
 * 前半は「電算機計算の特例」（式）、後半は「月額表」（国税庁の表）の確認。
 *
 * 期待値は国税庁「令和8年分 源泉徴収税額表（月額表）」から引用。
 * 月額表は金額の幅ごとの税額、こちらは式での計算なので、数十円の差は出ることがある
 * （電算機計算の特例として認められている差）。そのため「ぴったり一致」と「±30円以内」を使い分ける。
 */
import { describe, expect, test } from "bun:test";
import { calcMonthlyWithholdingTax, calcEmploymentDeduction, calcBasicDeduction, calcMonthlyTaxByTable, calcWithholdingTax } from "./incomeTax";
import { TAX_2025, TAX_2026, getTaxMaster } from "../constants/tax";

const near = (actual: number, expected: number, tolerance = 30) =>
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);

describe("給与所得控除・基礎控除", () => {
    test("給与所得控除（最低保障・定率・上限）", () => {
        expect(calcEmploymentDeduction(100000)).toBe(54167);
        expect(calcEmploymentDeduction(200000)).toBe(66667);   // 200,000 × 30% + 6,667
        expect(calcEmploymentDeduction(500000)).toBe(136667);  // 500,000 × 20% + 36,667
        expect(calcEmploymentDeduction(1000000)).toBe(162500);
    });
    test("基礎控除は給与が高いと段階的に減る", () => {
        expect(calcBasicDeduction(300000)).toBe(48334);
        expect(calcBasicDeduction(2150000)).toBe(40000);
        expect(calcBasicDeduction(2300000)).toBe(0);
    });
});

describe("令和8年分 月額表（甲欄）との照合", () => {
    test("105,000円未満は0円（扶養0人）", () => {
        expect(calcMonthlyWithholdingTax(100000, 0)).toBe(0);
    });
    test("105,000〜107,000円: 0人 170円", () => {
        near(calcMonthlyWithholdingTax(106000, 0), 170);
        expect(calcMonthlyWithholdingTax(106000, 1)).toBe(0);
    });
    test("200,000〜203,000円: 0人 4,410 / 1人 2,800 / 2人 1,170 / 3人 0", () => {
        near(calcMonthlyWithholdingTax(201500, 0), 4410);
        near(calcMonthlyWithholdingTax(201500, 1), 2800);
        near(calcMonthlyWithholdingTax(201500, 2), 1170);
        expect(calcMonthlyWithholdingTax(201500, 3)).toBe(0);
    });
    test("500,000〜503,000円: 0人 28,190 / 1人 21,730", () => {
        near(calcMonthlyWithholdingTax(501500, 0), 28190);
        near(calcMonthlyWithholdingTax(501500, 1), 21730);
    });
    test("740,000円: 0人 71,680 / 1人 65,210 / 2人 58,750 / 3人 52,290", () => {
        expect(calcMonthlyWithholdingTax(740000, 0)).toBe(71680);
        near(calcMonthlyWithholdingTax(740000, 1), 65210);
        near(calcMonthlyWithholdingTax(740000, 2), 58750);
        near(calcMonthlyWithholdingTax(740000, 3), 52290);
    });
    test("740,000円超は、超えた金額の20.42%ずつ増える", () => {
        const base = calcMonthlyWithholdingTax(740000, 0);
        near(calcMonthlyWithholdingTax(760000, 0), base + 20000 * 0.2042, 10);
    });
});

describe("100万円以上・高額の給与", () => {
    test("100万円をまたいでも税額がなめらかにつながる（段差がない）", () => {
        const before = calcMonthlyWithholdingTax(999000, 0);
        const after = calcMonthlyWithholdingTax(1001000, 0);
        expect(after).toBeGreaterThan(before);
        expect(after - before).toBeLessThan(2000 * 0.35); // 2,000円の差 × 最高でも約34%
    });
    test("給与が増えれば税額は減らない（0〜400万円を1,000円刻みで確認）", () => {
        for (const dep of [0, 1, 3, 7]) {
            let prev = 0;
            for (let a = 0; a <= 4000000; a += 1000) {
                const t = calcMonthlyWithholdingTax(a, dep);
                expect(t).toBeGreaterThanOrEqual(prev);
                prev = t;
            }
        }
    });
    test("扶養が多いほど税額は少ない", () => {
        for (const a of [200000, 500000, 1000000, 3000000]) {
            expect(calcMonthlyWithholdingTax(a, 1)).toBeLessThanOrEqual(calcMonthlyWithholdingTax(a, 0));
            expect(calcMonthlyWithholdingTax(a, 7)).toBeLessThanOrEqual(calcMonthlyWithholdingTax(a, 1));
        }
    });
    test("扶養8人以上にも対応（7人で打ち切らない）", () => {
        expect(calcMonthlyWithholdingTax(1000000, 8)).toBeLessThan(calcMonthlyWithholdingTax(1000000, 7));
    });
    test("マイナスや小数が来ても壊れない", () => {
        expect(calcMonthlyWithholdingTax(-5000, 0)).toBe(0);
        expect(calcMonthlyWithholdingTax(300000.7, 0)).toBe(calcMonthlyWithholdingTax(300000, 0));
    });
});

describe("令和7年分（2025年）月額表（甲欄）との照合", () => {
    // 令和7年分は令和8年分と基礎控除・給与所得控除の最低額が違う
    const calc2025 = (a: number, dep: number) => calcMonthlyWithholdingTax(a, dep, TAX_2025.DENSANKI);
    // 月額表は3,000円などの幅の中で同じ税額のため、式との差が最大で100円ほど出ることがある
    test("88,000円未満は0円、88,000〜89,000円は130円", () => {
        // 月額表では0円の範囲でも、式では数十円になることがある（電算機計算の特例として認められている差）
        expect(calc2025(85000, 0)).toBe(0);
        near(calc2025(87000, 0), 0, 100);
        near(calc2025(88500, 0), 130);
    });
    test("200,000〜201,000円: 0人 4,770 / 1人 3,140 / 2人 1,530 / 3人 0", () => {
        near(calc2025(200500, 0), 4770);
        near(calc2025(200500, 1), 3140);
        near(calc2025(200500, 2), 1530);
        expect(calc2025(200500, 3)).toBe(0);
    });
    test("300,000〜303,000円: 0人 8,420 / 1人 6,740（幅が広いので±100円）", () => {
        near(calc2025(301500, 0), 8420, 100);
        near(calc2025(301500, 1), 6740, 100);
    });
    test("500,000〜503,000円: 0人 29,890 / 1人 23,430", () => {
        near(calc2025(501500, 0), 29890);
        near(calc2025(501500, 1), 23430);
    });
    test("740,000円: 0人 73,390 / 1人 66,920 / 2人 60,450 / 3人 53,980", () => {
        near(calc2025(740000, 0), 73390);
        near(calc2025(740000, 1), 66920);
        near(calc2025(740000, 2), 60450);
        near(calc2025(740000, 3), 53980);
    });
    test("同じ給与なら、令和8年分のほうが税額は少ない（基礎控除などが増えたため）", () => {
        for (const a of [150000, 300000, 600000, 1000000]) {
            expect(calcMonthlyWithholdingTax(a, 0)).toBeLessThanOrEqual(calc2025(a, 0));
        }
    });
});

describe("支払った年で税額表を切り替える", () => {
    test("2025年は令和7年分、2026年は令和8年分", () => {
        expect(getTaxMaster(2025).DENSANKI.BASIC_DEDUCTION[0][1]).toBe(40000);
        expect(getTaxMaster(2026).DENSANKI.BASIC_DEDUCTION[0][1]).toBe(48334);
        expect(getTaxMaster(2027).DENSANKI.BASIC_DEDUCTION[0][1]).toBe(48334); // 新しい表ができるまでは最新を使う
    });
});

// ─────────────────────────────────────────────────────────────
// 月額表（税額表）による計算
//   データは国税庁の Excel から自動生成（src/constants/tax/monthlyTable20XX.ts）。
//   下の期待値は、Excel とは別に国税庁の PDF から確かめた値。
// ─────────────────────────────────────────────────────────────
describe("月額表（令和8年分）による計算", () => {
    const T = TAX_2026.MONTHLY_TABLE;
    const byTable = (a: number, dep: number) => calcMonthlyTaxByTable(a, dep, T);
    test("国税庁の表のとおり、1円も違わない", () => {
        expect(byTable(104999, 0)).toBe(0);
        expect(byTable(105000, 0)).toBe(170);
        expect(byTable(106999, 0)).toBe(170);
        expect(byTable(201500, 0)).toBe(4410);
        expect(byTable(201500, 1)).toBe(2800);
        expect(byTable(201500, 2)).toBe(1170);
        expect(byTable(201500, 3)).toBe(0);
        expect(byTable(501500, 0)).toBe(28190);
        expect(byTable(501500, 1)).toBe(21730);
        expect(byTable(740000, 0)).toBe(71680);
        expect(byTable(740000, 3)).toBe(52290);
    });
    test("74万円超は「74万円の税額＋超えた金額の20.42%」（1円未満切り捨て）", () => {
        expect(byTable(760000, 0)).toBe(71680 + Math.floor(20000 * 0.2042));
        expect(byTable(790000, 0)).toBe(81890); // 次の基準額ちょうど
    });
    test("扶養8人以上は、7人の税額から1人ごとに1,610円を引く", () => {
        expect(byTable(500000, 9)).toBe(byTable(500000, 7) - 1610 * 2);
        expect(byTable(150000, 10)).toBe(0); // マイナスにはならない
    });
    test("表の範囲（10万5千円〜74万円）では、電算機計算の特例との差は100円以内", () => {
        for (const [from, to] of T.rows) {
            const mid = Math.floor((from + to) / 2);
            for (let dep = 0; dep <= 7; dep++) {
                near(byTable(mid, dep), calcMonthlyWithholdingTax(mid, dep), 100);
            }
        }
    });
    test("給与が増えれば税額は減らない（0〜600万円）", () => {
        for (const dep of [0, 2, 7]) {
            let prev = 0;
            for (let a = 0; a <= 6000000; a += 500) {
                const t = byTable(a, dep);
                expect(t).toBeGreaterThanOrEqual(prev);
                prev = t;
            }
        }
    });
});

describe("月額表（令和7年分）による計算", () => {
    const byTable = (a: number, dep: number) => calcMonthlyTaxByTable(a, dep, TAX_2025.MONTHLY_TABLE);
    test("国税庁の表のとおり", () => {
        expect(byTable(87999, 0)).toBe(0);
        expect(byTable(88000, 0)).toBe(130);
        expect(byTable(200500, 0)).toBe(4770);
        expect(byTable(200500, 1)).toBe(3140);
        expect(byTable(301500, 0)).toBe(8420);
        expect(byTable(301500, 1)).toBe(6740);
        expect(byTable(501500, 0)).toBe(29890);
        expect(byTable(740000, 0)).toBe(73390);
        expect(byTable(740000, 3)).toBe(53980);
    });
});

describe("計算方法と年の切り替え（給与計算から呼ぶ入口）", () => {
    test("初期値は月額表", () => {
        expect(calcWithholdingTax(301500, 0, 2025)).toBe(8420);
    });
    test("電算機計算の特例を選ぶと式で計算", () => {
        expect(calcWithholdingTax(301500, 0, 2025, "densanki")).toBe(calcMonthlyWithholdingTax(301500, 0, TAX_2025.DENSANKI));
        expect(calcWithholdingTax(301500, 0, 2025, "densanki")).not.toBe(8420); // この金額では差が出る例
    });
    test("支払った年の表を使う", () => {
        expect(calcWithholdingTax(100000, 0, 2025)).toBeGreaterThan(0); // 令和7年分: 88,000円から課税
        expect(calcWithholdingTax(100000, 0, 2026)).toBe(0);            // 令和8年分: 105,000円から課税
    });
});
