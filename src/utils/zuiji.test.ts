/**
 * 随時改定（月額変更届）の判定（zuiji.ts）のテスト
 * 実行方法: bun test
 *
 * 出典：日本年金機構 https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/20150515-02.html
 * 等級表は協会けんぽの保険料額表（令和8年度。Excel から自動生成したデータ）の健康保険の等級を使う。
 */
import { describe, expect, test } from "bun:test";
import { addMonths, buildZuijiCandidate, extendedGrade, findZuijiCandidates, judgeZuiji } from "./zuiji";
import type { SanteiMonth } from "./santei";
import { getInsuranceMaster } from "../constants";

const table = getInsuranceMaster(2026, 9).HYOJUN_TABLE;
const three = (amount: number, days = 30): SanteiMonth[] =>
    [4, 5, 6].map((month) => ({ month, days, amount, partialJoin: false }));

describe("表の外の等級", () => {
    test("健康保険：1,415千円以上は表の上（51）、53千円未満は表の下（0）として数える", () => {
        expect(extendedGrade(table, 1415000)).toBe(51);
        expect(extendedGrade(table, 1414999)).toBe(50);
        expect(extendedGrade(table, 52999)).toBe(0);
        expect(extendedGrade(table, 53000)).toBe(1);
        expect(extendedGrade(table, 300000)).toBe(22);
    });
});

describe("随時改定の対象か", () => {
    test("3か月の平均で2等級以上の差があれば対象（30万円・22等級 → 34万円・24等級）", () => {
        const r = judgeZuiji(three(340000), false, 300000, "up", table);
        expect(r).toMatchObject({ status: "target", average: 340000, grade: 24, standard: 340000, previousGrade: 22, gradeDiff: 2 });
    });
    test("1等級の差なら対象外", () => {
        expect(judgeZuiji(three(320000), false, 300000, "up", table).status).toBe("small");
    });
    test("固定的賃金が上がったのに、平均が2等級以上下がったときは対象外（逆も同じ）", () => {
        expect(judgeZuiji(three(260000), false, 300000, "up", table).status).toBe("direction");
        expect(judgeZuiji(three(340000), false, 300000, "down", table).status).toBe("direction");
        expect(judgeZuiji(three(260000), false, 300000, "down", table).status).toBe("target");
    });
    test("3か月のうち1か月でも支払基礎日数が17日未満なら対象外（短時間労働者は11日）", () => {
        const months = three(340000);
        months[1].days = 16;
        expect(judgeZuiji(months, false, 300000, "up", table).status).toBe("days");
        months[1].days = 11;
        expect(judgeZuiji(months, true, 300000, "up", table).status).toBe("target");
    });
    test("給与を確定していない月があれば判定しない・未加入の人は判定しない", () => {
        const months = three(340000);
        months[2].amount = null;
        expect(judgeZuiji(months, false, 300000, "up", table).status).toBe("pending");
        expect(judgeZuiji(three(340000), false, 0, "up", table).status).toBe("not_enrolled");
    });
    test("平均は1円未満を切り捨てる", () => {
        const months = three(340000);
        months[0].amount = 340001;
        expect(judgeZuiji(months, false, 300000, "up", table).average).toBe(340000);
    });
});

describe("上限・下限で1等級差でも対象になる場合（日本年金機構の表・健康保険）", () => {
    test("昇給：49等級・1,330千円 → 平均1,415千円以上なら50等級・1,390千円", () => {
        expect(judgeZuiji(three(1415000), false, 1330000, "up", table))
            .toMatchObject({ status: "target", grade: 50, standard: 1390000 });
        expect(judgeZuiji(three(1400000), false, 1330000, "up", table).status).toBe("small");
    });
    test("降給：2等級・68千円 → 平均53千円未満なら1等級・58千円", () => {
        expect(judgeZuiji(three(52000), false, 68000, "down", table))
            .toMatchObject({ status: "target", grade: 1, standard: 58000 });
    });
    test("従前が50等級・1等級のときは、従前を決めたときの報酬月額がわからないので注意を出す", () => {
        const down = judgeZuiji(three(1300000), false, 1390000, "down", table);
        expect(down.status).toBe("small");
        expect(down.boundaryNote).toContain("1,415,000円以上");
        const up = judgeZuiji(three(70000), false, 58000, "up", table);
        expect(up.status).toBe("small");
        expect(up.boundaryNote).toContain("53,000円未満");
    });
});

describe("変動月の候補を探す", () => {
    const group = { id: 1, closing_day: 99, is_next_month: 0 };
    const staff = { id: "A", wage_type: "monthly", standard_remuneration: 300000, join_date: "2020-04-01", payroll_group_id: 1 };
    const salary = (target_year: number, target_month: number, applied_base_wage: number, total_earnings = applied_base_wage) =>
        ({ staff_id: "A", target_year, target_month, applied_base_wage, total_earnings });

    test("年月の計算（年をまたぐ）", () => {
        expect(addMonths(2026, 11, 3)).toEqual({ year: 2027, month: 2 });
        expect(addMonths(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    });
    test("確定した給与の基本給が前の月と変わった月を、変動月として探す（4月に昇給 → 7月分から改定）", () => {
        const salaries = [salary(2026, 3, 300000), salary(2026, 4, 340000), salary(2026, 5, 340000), salary(2026, 6, 340000)];
        const [c, ...rest] = findZuijiCandidates([staff], 2026, [group], salaries, []);
        expect(rest).toHaveLength(0);
        expect(c).toMatchObject({ year: 2026, month: 4, direction: "up", baseWageBefore: 300000, baseWageAfter: 340000, previous: 300000, revisionFrom: "2026-07" });
        expect(c.months.map((m) => [m.year, m.month, m.days, m.amount])).toEqual([[2026, 4, 30, 340000], [2026, 5, 31, 340000], [2026, 6, 30, 340000]]);
        expect(judgeZuiji(c.months, false, c.previous, c.direction, table).status).toBe("target");
    });
    test("11月に降給 → 11・12・1月の平均で判定し、翌年2月分から改定", () => {
        const salaries = [salary(2026, 10, 340000), salary(2026, 11, 260000), salary(2026, 12, 260000), salary(2027, 1, 260000)];
        const [c] = findZuijiCandidates([{ ...staff, standard_remuneration: 340000 }], 2026, [group], salaries, []);
        expect(c).toMatchObject({ month: 11, direction: "down", revisionFrom: "2027-02" });
        expect(c.months.map((m) => m.year)).toEqual([2026, 2026, 2027]);
    });
    test("基本給が変わらなければ候補にしない（残業代だけで総支給額が変わっても）", () => {
        const salaries = [salary(2026, 3, 300000), salary(2026, 4, 300000, 400000), salary(2026, 5, 300000, 400000)];
        expect(findZuijiCandidates([staff], 2026, [group], salaries, [])).toHaveLength(0);
    });
    describe("固定残業代の追加・廃止・金額の変更も、固定的賃金の変動として探す", () => {
        const pay = (m: number, base: number, fixed: number | null, total = base + (fixed ?? 0)) =>
            ({ ...salary(2026, m, base, total), fixed_overtime_allowance: fixed });
        test("固定残業代を新しく払い始めた月（基本給は同じ）→ 上がった", () => {
            const salaries = [pay(3, 300000, 0), pay(4, 300000, 60000), pay(5, 300000, 60000), pay(6, 300000, 60000)];
            const [c, ...rest] = findZuijiCandidates([staff], 2026, [group], salaries, []);
            expect(rest).toHaveLength(0);
            expect(c).toMatchObject({
                month: 4, direction: "up", baseWageBefore: null, baseWageAfter: null,
                fixedOvertimeBefore: 0, fixedOvertimeAfter: 60000, note: null, revisionFrom: "2026-07",
            });
            // 平均 360,000円 → 36万円（従前 30万円から2等級以上）
            expect(judgeZuiji(c.months, false, c.previous, c.direction, table).status).toBe("target");
        });
        test("固定残業代をやめた月 → 下がった", () => {
            const salaries = [pay(3, 300000, 60000), pay(4, 300000, 0), pay(5, 300000, 0), pay(6, 300000, 0)];
            const [c] = findZuijiCandidates([{ ...staff, standard_remuneration: 360000 }], 2026, [group], salaries, []);
            expect(c).toMatchObject({ month: 4, direction: "down", fixedOvertimeBefore: 60000, fixedOvertimeAfter: 0 });
        });
        test("固定残業代がわからない（空の）月とは比べない", () => {
            const salaries = [pay(3, 300000, null), pay(4, 300000, 60000), pay(5, 300000, 60000)];
            expect(findZuijiCandidates([staff], 2026, [group], salaries, [])).toHaveLength(0);
        });
        test("基本給と固定残業代が同じ月に変わったら、合計の上がり下がりで向きを決める", () => {
            // 基本給 +20,000円・固定残業代 −30,000円 → 合計 −10,000円で「下がった」
            const salaries = [pay(3, 300000, 60000), pay(4, 320000, 30000)];
            const [c] = findZuijiCandidates([staff], 2026, [group], salaries, []);
            expect(c).toMatchObject({ direction: "down", baseWageBefore: 300000, baseWageAfter: 320000, fixedOvertimeBefore: 60000, fixedOvertimeAfter: 30000, note: null });
        });
        test("基本給と固定残業代が逆向きに同じ額だけ変わったら、基本給の向きで判定し、注意を出す", () => {
            const salaries = [pay(3, 300000, 60000), pay(4, 330000, 30000)];
            const [c] = findZuijiCandidates([staff], 2026, [group], salaries, []);
            expect(c.direction).toBe("up");
            expect(c.note).toContain("年金事務所");
        });
    });
    test("従前は変動月から3か月目の分の値。改定の月の行がすでにあれば登録済み", () => {
        const history = JSON.stringify([{ from: "", amount: 300000, reason: "shutoku" }, { from: "2026-07", amount: 340000, reason: "zuiji" }]);
        const c = buildZuijiCandidate({ ...staff, standard_remuneration_history: history }, 2026, 4, "up", [group], [], []);
        expect(c.previous).toBe(300000);
        expect(c.registered).toBe(340000);
    });
});
