/**
 * 産前産後休業終了時改定・育児休業等終了時改定（leaveEndRevision.ts）のテスト
 * 実行方法: bun test
 *
 * 出典：日本年金機構「育児休業等終了時報酬月額変更届の提出」「産前産後休業終了時報酬月額変更届の提出」、
 *       厚生年金保険法23条の2・23条の3（終了日の翌日に次の休業を始めたときは改定できない）
 * 等級表は協会けんぽの保険料額表（令和8年度。Excel から自動生成したデータ）の健康保険の等級を使う
 * （30万円は22等級（29万円以上31万円未満）、28万円は21等級）。
 */
import { describe, expect, test } from "bun:test";
import { findLeaveEndCandidates, judgeLeaveEnd } from "./leaveEndRevision";
import { stringifyLeavePeriods, type LeavePeriod } from "./leaveExemption";
import { stringifyRemunerationHistory } from "./standardRemuneration";
import { getInsuranceMaster } from "../constants";

const table = getInsuranceMaster(2026, 9).HYOJUN_TABLE;
const months = (amounts: number[], days: number[] = [30, 31, 30]) => amounts.map((amount, i) => ({ days: days[i], amount }));

describe("改定できるか（1等級以上の差）", () => {
    test("1等級の差でも改定できる（30万円・22等級 → 28万円・21等級。随時改定と違う）", () => {
        expect(judgeLeaveEnd(months([280000, 280000, 280000]), "general", 300000, table))
            .toMatchObject({ status: "target", average: 280000, grade: 21, standard: 280000, previousGrade: 22, gradeDiff: -1, usedIndexes: [0, 1, 2] });
    });
    test("等級が変わらなければ改定しない", () => {
        expect(judgeLeaveEnd(months([295000, 295000, 295000]), "general", 300000, table).status).toBe("same");
    });
    test("支払基礎日数が17日未満の月は除いて平均する（復帰した月が10日など）", () => {
        const r = judgeLeaveEnd(months([100000, 280000, 280000], [10, 20, 20]), "general", 300000, table);
        expect(r).toMatchObject({ status: "target", usedIndexes: [1, 2], average: 280000, method: "normal" });
    });
    test("17日以上の月が1か月もなければ改定できない", () => {
        expect(judgeLeaveEnd(months([150000, 150000, 150000], [16, 15, 12]), "general", 300000, table).status).toBe("days");
    });
    test("短時間就労者（パート）は、3か月とも17日未満なら15日以上17日未満の月で平均する", () => {
        const r = judgeLeaveEnd(months([150000, 160000, 100000], [16, 15, 12]), "part", 300000, table);
        expect(r).toMatchObject({ status: "target", usedIndexes: [0, 1], average: 155000, method: "part15" });
        // 17日以上の月があれば、その月だけで平均する
        expect(judgeLeaveEnd(months([150000, 280000, 100000], [16, 17, 12]), "part", 300000, table))
            .toMatchObject({ usedIndexes: [1], average: 280000, method: "normal" });
    });
    test("特定適用事業所の短時間労働者は11日以上の月で平均する", () => {
        expect(judgeLeaveEnd(months([120000, 120000, 120000], [11, 12, 11]), "short", 300000, table))
            .toMatchObject({ status: "target", usedIndexes: [0, 1, 2], average: 120000 });
        expect(judgeLeaveEnd(months([120000, 120000, 120000], [10, 10, 10]), "short", 300000, table).status).toBe("days");
    });
    test("給与を確定していない月があれば判定しない・未加入の人は判定しない・翌日から次の休業を始めたら改定しない", () => {
        expect(judgeLeaveEnd([{ days: 30, amount: 280000 }, { days: null, amount: null }], "general", 300000, table).status).toBe("pending");
        expect(judgeLeaveEnd(months([280000, 280000, 280000]), "general", 0, table).status).toBe("not_enrolled");
        expect(judgeLeaveEnd(months([280000, 280000, 280000]), "general", 300000, table, true).status).toBe("followed");
    });
});

describe("産休・育休の期間から候補を探す", () => {
    const group = { id: 1, closing_day: 99, is_next_month: 0 };
    const staffWith = (leaves: LeavePeriod[], o: Record<string, unknown> = {}) => ({
        id: "A", wage_type: "monthly", standard_remuneration: 300000, join_date: "2020-04-01", payroll_group_id: 1,
        leave_periods: stringifyLeavePeriods(leaves), ...o,
    });
    const salary = (target_year: number, target_month: number, total_earnings: number) =>
        ({ staff_id: "A", target_year, target_month, applied_base_wage: total_earnings, total_earnings });
    const after = [salary(2026, 4, 280000), salary(2026, 5, 280000), salary(2026, 6, 280000)];

    test("育休が3月31日に終われば、4〜6月の給与で判定し、7月分から改定する", () => {
        const staff = staffWith([{ type: "childcare", start: "2025-10-01", end: "2026-03-31" }]);
        const [c, ...rest] = findLeaveEndCandidates([staff], 2026, [group], after, []);
        expect(rest).toHaveLength(0);
        expect(c).toMatchObject({ nextDay: "2026-04-01", year: 2026, month: 4, previous: 300000, revisionFrom: "2026-07", followedBy: null, registered: null });
        expect(c.months.map((m) => [m.year, m.month, m.days, m.amount])).toEqual([[2026, 4, 30, 280000], [2026, 5, 31, 280000], [2026, 6, 30, 280000]]);
        expect(judgeLeaveEnd(c.months, "general", c.previous, table).status).toBe("target");
    });
    test("月の途中で終われば、終了日の翌日が属する月から3か月（4月15日に終了 → 4〜6月、7月分から）", () => {
        const [c] = findLeaveEndCandidates([staffWith([{ type: "childcare", start: "2025-10-01", end: "2026-04-15" }])], 2026, [group], after, []);
        expect([c.nextDay, c.month, c.revisionFrom]).toEqual(["2026-04-16", 4, "2026-07"]);
    });
    test("12月31日に終われば翌年1月からなので、その年の候補には出ない。前の年の12月31日に終われば出る", () => {
        expect(findLeaveEndCandidates([staffWith([{ type: "childcare", start: "2026-01-01", end: "2026-12-31" }])], 2026, [group], [], [])).toHaveLength(0);
        const [c] = findLeaveEndCandidates([staffWith([{ type: "childcare", start: "2025-01-01", end: "2025-12-31" }])], 2026, [group], [], []);
        expect([c.year, c.month, c.revisionFrom]).toEqual([2026, 1, "2026-04"]);
    });
    test("産休の終了日の翌日から育休を始めたら、産休終了時改定はできない（23条の3 ただし書）", () => {
        const staff = staffWith([
            { type: "maternity", start: "2026-01-10", end: "2026-04-20" },
            { type: "childcare", start: "2026-04-21", end: "2027-03-31" },
        ]);
        const [c, ...rest] = findLeaveEndCandidates([staff], 2026, [group], [], []);
        expect(rest).toHaveLength(0);
        expect(c.leave.type).toBe("maternity");
        expect(c.followedBy).toContain("産前産後休業終了時改定はできません");
    });
    test("育休の終了日の翌日から（次の子の）産休を始めたら、育休終了時改定はできない（23条の2 ただし書）", () => {
        const staff = staffWith([
            { type: "childcare", start: "2025-06-01", end: "2026-03-31" },
            { type: "maternity", start: "2026-04-01", end: "" },
        ]);
        const [c] = findLeaveEndCandidates([staff], 2026, [group], [], []);
        expect(c.followedBy).toContain("育児休業等終了時改定はできません");
    });
    test("役員の育休は候補に出さない（育児休業等ではないので、育休終了時改定はできない）。役員の産休は出す", () => {
        const leaves: LeavePeriod[] = [
            { type: "maternity", start: "2025-10-01", end: "2026-01-20" },
            { type: "childcare", start: "2026-01-21", end: "2026-03-31" },
        ];
        // 役員の育休は育児休業等ではないので、産休の終了日の翌日から育休を始めても、産休終了時改定はできる
        const [c, ...rest] = findLeaveEndCandidates([staffWith(leaves, { is_executive: 1 })], 2026, [group], [], []);
        expect(rest).toHaveLength(0);
        expect([c.leave.type, c.nextDay, c.followedBy]).toEqual(["maternity", "2026-01-21", null]);
        expect(findLeaveEndCandidates([staffWith(leaves)], 2026, [group], [], []).map((x) => x.leave.type)).toEqual(["maternity", "childcare"]);
    });
    test("育休を延長して別の期間で入れたときは、続けた育休の終わりで判定する", () => {
        const staff = staffWith([
            { type: "childcare", start: "2025-10-01", end: "2026-03-31" },
            { type: "childcare", start: "2026-04-01", end: "2026-09-30" },
        ]);
        const list = findLeaveEndCandidates([staff], 2026, [group], [], []);
        expect(list.map((c) => c.nextDay)).toEqual(["2026-10-01"]);
    });
    test("終了日が決まっていない休業・休業中に退職した人は出ない。退職した月の後の月は入れない", () => {
        expect(findLeaveEndCandidates([staffWith([{ type: "childcare", start: "2026-01-01", end: "" }])], 2026, [group], [], [])).toHaveLength(0);
        const leave: LeavePeriod[] = [{ type: "childcare", start: "2025-10-01", end: "2026-03-31" }];
        expect(findLeaveEndCandidates([staffWith(leave, { retirement_date: "2026-03-31" })], 2026, [group], [], [])).toHaveLength(0);
        const [c] = findLeaveEndCandidates([staffWith(leave, { retirement_date: "2026-05-31" })], 2026, [group], after, []);
        expect(c.months.map((m) => m.month)).toEqual([4, 5]);
    });
    test("この改定ですでに登録した標準報酬月額を出す", () => {
        const history = stringifyRemunerationHistory([
            { from: "", amount: 300000, reason: "shutoku" },
            { from: "2026-07", amount: 280000, reason: "kyugyo" },
        ]);
        const [c] = findLeaveEndCandidates(
            [staffWith([{ type: "childcare", start: "2025-10-01", end: "2026-03-31" }], { standard_remuneration_history: history })],
            2026, [group], after, [],
        );
        expect([c.previous, c.registered]).toEqual([300000, 280000]);
    });
});
