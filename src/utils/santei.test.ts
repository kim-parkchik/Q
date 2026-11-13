/**
 * 定時決定（算定基礎届）の計算（santei.ts）のテスト
 * 実行方法: bun test
 *
 * 出典：日本年金機構 https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/20121017.html
 *       https://www.nenkin.go.jp/service/kounen/info/jireishokai/henreisantei.html
 * 等級表は協会けんぽの保険料額表（令和8年度。Excel から自動生成したデータ）を使う。
 */
import { describe, expect, test } from "bun:test";
import {
    buildSanteiInputs, decideTeiji, gradeOfStandard, lookupGrade, paymentBasisDays, santeiExclusionReason, type SanteiMonth,
} from "./santei";
import { getInsuranceMaster } from "../constants";

const table = getInsuranceMaster(2026, 9).HYOJUN_TABLE;
const m = (month: number, days: number | null, amount: number | null, partialJoin = false): SanteiMonth =>
    ({ month, days, amount, partialJoin });

describe("等級表", () => {
    test("報酬月額が当たる等級（令和8年度：29万円以上31万円未満は22等級・30万円）", () => {
        expect(lookupGrade(table, 290000)).toEqual({ grade: 22, standard: 300000 });
        expect(lookupGrade(table, 309999)).toEqual({ grade: 22, standard: 300000 });
        expect(lookupGrade(table, 310000)).toEqual({ grade: 23, standard: 320000 });
        expect(lookupGrade(table, 0)).toEqual({ grade: 1, standard: 58000 });
        expect(lookupGrade(table, 5000000)).toEqual({ grade: 50, standard: 1390000 });
    });
    test("標準報酬月額から等級を求める（等級表にない額は null）", () => {
        expect(gradeOfStandard(table, 300000)).toBe(22);
        expect(gradeOfStandard(table, 123456)).toBeNull();
    });
});

describe("4〜6月の報酬から標準報酬月額を決める", () => {
    test("3か月とも17日以上なら、3か月の平均（1円未満切り捨て）", () => {
        const r = decideTeiji([m(4, 30, 300000), m(5, 31, 310000), m(6, 30, 305001)], "general", 280000, table);
        expect(r.usedMonths).toEqual([4, 5, 6]);
        expect(r.total).toBe(915001);
        expect(r.average).toBe(305000);
        expect(r).toMatchObject({ method: "normal", standard: 300000, grade: 22 });
    });
    test("17日未満の月は平均に入れない", () => {
        const r = decideTeiji([m(4, 16, 100000), m(5, 20, 330000), m(6, 18, 330000)], "general", 280000, table);
        expect(r.usedMonths).toEqual([5, 6]);
        expect(r.average).toBe(330000);
        expect(r.standard).toBe(340000);
    });
    test("給与を支払っていない月は使わない", () => {
        const r = decideTeiji([m(4, null, null), m(5, 31, 300000), m(6, 30, 300000)], "general", 280000, table);
        expect(r.usedMonths).toEqual([5, 6]);
    });
    test("途中入社で1か月分の給与が支払われていない月は、17日以上でも除く（修正平均）", () => {
        const r = decideTeiji([m(5, 20, 200000, true), m(6, 30, 300000)], "general", 300000, table);
        expect(r.usedMonths).toEqual([6]);
        expect(r.average).toBe(300000);
    });
    test("17日以上の月がなければ、従前の標準報酬月額のまま", () => {
        const r = decideTeiji([m(4, 10, 100000), m(5, 16, 150000), m(6, 15, 150000)], "general", 280000, table);
        expect(r).toMatchObject({ method: "keep", standard: 280000, grade: 21, average: null });
    });
    test("短時間就労者（パート）は、17日以上の月がなければ15日以上17日未満の月で平均する", () => {
        const r = decideTeiji([m(4, 14, 90000), m(5, 16, 150000), m(6, 15, 150000)], "part", 98000, table);
        expect(r.usedMonths).toEqual([5, 6]);
        expect(r.method).toBe("part15");
        expect(r.average).toBe(150000);
        // 17日以上の月が1か月でもあれば、その月だけで平均する
        const r2 = decideTeiji([m(4, 17, 160000), m(5, 16, 150000), m(6, 15, 150000)], "part", 98000, table);
        expect(r2.usedMonths).toEqual([4]);
        // 3か月とも15日未満なら従前のまま
        expect(decideTeiji([m(4, 14, 90000)], "part", 98000, table).method).toBe("keep");
    });
    test("特定適用事業所の短時間労働者は、11日以上の月で平均する", () => {
        const r = decideTeiji([m(4, 10, 80000), m(5, 11, 100000), m(6, 12, 110000)], "short", 98000, table);
        expect(r.usedMonths).toEqual([5, 6]);
        expect(r.average).toBe(105000);
    });
});

describe("支払基礎日数", () => {
    const period = { startStr: "2026-04-01", endStr: "2026-04-30" };
    test("月給制は、給与の計算期間の暦日数", () => {
        expect(paymentBasisDays("monthly", period, [], 22)).toBe(30);
        expect(paymentBasisDays("monthly", { startStr: "2026-03-16", endStr: "2026-04-15" }, [], 22)).toBe(31);
    });
    test("月給制で欠勤した日があれば、所定労働日数 − 欠勤日数", () => {
        const rows = [{ work_date: "2026-04-06", work_type: "absent" }, { work_date: "2026-04-07", work_type: "absent" }];
        expect(paymentBasisDays("monthly", period, rows, 22)).toBe(20);
        expect(paymentBasisDays("monthly", period, rows, 22, true)).toBe(20);
    });
    test("月給制で休業の日がある月は、月給を払った日数（欠勤控除をした日は、さらに引く）", () => {
        expect(paymentBasisDays("monthly", period, [], 22, undefined, 11)).toBe(11);
        expect(paymentBasisDays("monthly", period, [], 22, undefined, 0)).toBe(0);
        expect(paymentBasisDays("monthly", period, [{ work_date: "2026-04-06", work_type: "absent" }], 22, true, 11)).toBe(10);
        expect(paymentBasisDays("monthly", period, [], 22, undefined, null)).toBe(30);
    });
    test("欠勤控除をしない月給制（完全月給制）は、欠勤があっても暦日数（日本年金機構 算定基礎届の記入・提出ガイドブック：欠勤日数分だけ給料が差し引かれる場合だけ）", () => {
        const rows = [{ work_date: "2026-04-06", work_type: "absent" }, { work_date: "2026-04-07", work_type: "absent" }];
        expect(paymentBasisDays("monthly", period, rows, 22, false)).toBe(30);
    });
    test("時給制は、働いた日と有給休暇の日の数", () => {
        const rows = [
            { work_date: "2026-04-01", work_type: "normal", work_hours: 8 },
            { work_date: "2026-04-02", work_type: "paid_full", work_hours: 0 },
            { work_date: "2026-04-03", work_type: "paid_half", work_hours: 4 },
            { work_date: "2026-04-04", work_type: "absent", work_hours: 0 },
            { work_date: "2026-04-05", work_type: "holiday", work_hours: 0 },
        ];
        expect(paymentBasisDays("hourly", period, rows, 22)).toBe(3);
    });
    test("特別休暇：時給制は有給の休暇の日を数え、無給の休暇の日は数えない。月給制は無給の休暇（1日）で引いた日を欠勤と同じく引く", () => {
        const rows = [
            { work_date: "2026-04-06", work_type: "special", work_hours: 0, leave_paid: 1 },
            { work_date: "2026-04-07", work_type: "special", work_hours: 0, leave_paid: 0 },
            { work_date: "2026-04-08", work_type: "special_half", work_hours: 4, leave_paid: 0 },
            { work_date: "2026-04-09", work_type: "special_half", work_hours: 0, leave_paid: 1 },
        ];
        expect(paymentBasisDays("hourly", period, rows, 22)).toBe(3);
        // 月給制：無給の休暇（1日）の1日だけを引く（半日の日は残りの半日の給与を払っている）
        expect(paymentBasisDays("monthly", period, rows, 22, true)).toBe(21);
        expect(paymentBasisDays("monthly", period, rows, 22, false)).toBe(30);
    });
});

describe("算定基礎届の対象", () => {
    test("7月1日に加入していて、6月より前に入社した人は対象", () => {
        expect(santeiExclusionReason({ join_date: "2026-05-31" }, 2026, true, false)).toBeNull();
    });
    test("6月1日以後に入社した人・6月30日以前に退職した人・7〜9月に随時改定がある人・未加入の人は対象外", () => {
        expect(santeiExclusionReason({ join_date: "2026-06-01" }, 2026, true, false)).not.toBeNull();
        expect(santeiExclusionReason({ join_date: "2020-04-01", retirement_date: "2026-06-30" }, 2026, true, false)).not.toBeNull();
        expect(santeiExclusionReason({ join_date: "2020-04-01", retirement_date: "2026-07-01" }, 2026, true, false)).toBeNull();
        expect(santeiExclusionReason({ join_date: "2020-04-01" }, 2026, true, true)).not.toBeNull();
        expect(santeiExclusionReason({ join_date: "2020-04-01" }, 2026, false, false)).not.toBeNull();
    });
});

describe("確定した給与と勤怠から、1人ずつの値を作る", () => {
    const endOfMonth = { id: 1, closing_day: 99, is_next_month: 0 };       // 末締め・当月払い
    const close20Next = { id: 2, closing_day: 20, is_next_month: 1 };      // 20日締め・翌月払い
    const salary = (staff_id: string, target_month: number, total_earnings: number) => ({ staff_id, target_year: 2026, target_month, total_earnings });
    const monthly = { wage_type: "monthly", standard_remuneration: 300000, join_date: "2020-04-01", payroll_group_id: 1 };

    test("月給制・末締め当月払い：4〜6月の暦日数と、確定した給与の総支給額", () => {
        const [r] = buildSanteiInputs([{ ...monthly, id: "A" }], 2026, [endOfMonth],
            [salary("A", 4, 300000), salary("A", 5, 310000), salary("A", 6, 305000)], []);
        expect(r.exclusion).toBeNull();
        expect(r.previous).toBe(300000);
        expect(r.months).toEqual([
            { month: 4, days: 30, amount: 300000, partialJoin: false },
            { month: 5, days: 31, amount: 310000, partialJoin: false },
            { month: 6, days: 30, amount: 305000, partialJoin: false },
        ]);
        expect(r.unfinalizedMonths).toEqual([]);
    });
    test("20日締め翌月払い：5月に支払う給与の計算期間は3月21日〜4月20日（31日）", () => {
        const [r] = buildSanteiInputs([{ ...monthly, id: "A", payroll_group_id: 2 }], 2026, [endOfMonth, close20Next],
            [salary("A", 5, 300000)], []);
        expect(r.months[1]).toMatchObject({ month: 5, days: 31 });
    });
    test("時給制：計算期間の確定した勤怠のうち、働いた日と有給休暇の日を数える", () => {
        const attendance = [
            { staff_id: "B", work_date: "2026-04-01", work_type: "normal", work_hours: 6 },
            { staff_id: "B", work_date: "2026-04-02", work_type: "paid_full", work_hours: 0 },
            { staff_id: "B", work_date: "2026-05-01", work_type: "normal", work_hours: 6 }, // 5月分の期間
            { staff_id: "C", work_date: "2026-04-03", work_type: "normal", work_hours: 6 }, // 別の人
        ];
        const [r] = buildSanteiInputs([{ ...monthly, id: "B", wage_type: "hourly" }], 2026, [endOfMonth],
            [salary("B", 4, 120000)], attendance);
        expect(r.months[0].days).toBe(2);
    });
    test("月給制で欠勤控除をした月：確定したときに残した計算期間の所定労働日数（会社カレンダー）− 欠勤日数", () => {
        // 2026年5月は祝日が平日に3日あり、所定労働日は18日（土日を除いた日数は21日）
        const absent = (date: string) => ({ staff_id: "A", work_date: date, work_type: "absent", work_hours: 0 });
        const attendance = [absent("2026-05-11"), absent("2026-05-12")];
        const deducted = { ...salary("A", 5, 266668), absence_deduction: 33332, prescribed_work_days: 18 };
        const [r] = buildSanteiInputs([{ ...monthly, id: "A" }], 2026, [endOfMonth], [deducted], attendance);
        expect(r.months[1]).toMatchObject({ month: 5, days: 16 });
        // 欠勤控除をしない設定（完全月給制）で確定した月は、暦日数
        const notDeducted = { ...salary("A", 5, 300000), absence_deduction: 0, prescribed_work_days: 18 };
        const [full] = buildSanteiInputs([{ ...monthly, id: "A" }], 2026, [endOfMonth], [notDeducted], attendance);
        expect(full.months[1]).toMatchObject({ month: 5, days: 31 });
        // 欠勤控除の額・所定労働日数を残していない前の給与は、土日を除いた日数（21日）− 欠勤日数
        const [old] = buildSanteiInputs([{ ...monthly, id: "A" }], 2026, [endOfMonth], [salary("A", 5, 271430)], attendance);
        expect(old.months[1]).toMatchObject({ month: 5, days: 19 });
    });
    test("休業・休職の日がある月（月給制）：確定したときに残した、月給を払った日数（まるごと休業の月は0日で、算定に使わない）", () => {
        const leave_periods = JSON.stringify([{ type: "childcare", start: "2026-04-01", end: "2026-05-15" }]);
        const staff = { ...monthly, id: "A", leave_periods };
        // 4月はまるごと育休（0日・0円）、5月は16日から復帰（所定労働日数で日割りして10日分）、6月はいつもどおり
        const salaries = [
            { ...salary("A", 4, 0), absence_deduction: 0, prescribed_work_days: 21, leave_paid_days: 0 },
            { ...salary("A", 5, 166667), absence_deduction: 0, prescribed_work_days: 18, leave_paid_days: 10 },
            { ...salary("A", 6, 300000), absence_deduction: 0, prescribed_work_days: 22, leave_paid_days: null },
        ];
        // 休業の日の欠勤の記録は使わない。休業していない日の欠勤は引く
        const attendance = [
            { staff_id: "A", work_date: "2026-05-11", work_type: "absent", work_hours: 0 },
            { staff_id: "A", work_date: "2026-05-20", work_type: "absent", work_hours: 0 },
        ];
        const [r] = buildSanteiInputs([staff], 2026, [endOfMonth], salaries, attendance);
        expect(r.months.map((m) => m.days)).toEqual([0, 10, 30]);
        const deducted = salaries.map((s) => (s.target_month === 5 ? { ...s, absence_deduction: 16667 } : s));
        const [d] = buildSanteiInputs([staff], 2026, [endOfMonth], deducted, attendance);
        expect(d.months[1].days).toBe(9);
    });
    test("計算期間の途中で入社した月は「途中入社で日割り」", () => {
        const [r] = buildSanteiInputs([{ ...monthly, id: "A", join_date: "2026-04-10" }], 2026, [endOfMonth],
            [salary("A", 4, 200000), salary("A", 5, 300000)], []);
        expect(r.months[0].partialJoin).toBe(true);
        expect(r.months[1].partialJoin).toBe(false);
    });
    test("入社後なのに給与を確定していない月を知らせる（入社前の月は知らせない）", () => {
        const [a] = buildSanteiInputs([{ ...monthly, id: "A" }], 2026, [endOfMonth], [salary("A", 4, 300000)], []);
        expect(a.unfinalizedMonths).toEqual([5, 6]);
        const [b] = buildSanteiInputs([{ ...monthly, id: "B", join_date: "2026-05-15" }], 2026, [endOfMonth], [], []);
        expect(b.unfinalizedMonths).toEqual([5, 6]);
    });
    test("6月1日以後の入社は対象外、4月より前に辞めた人は出さない", () => {
        const rows = buildSanteiInputs([
            { ...monthly, id: "A", join_date: "2026-06-01" },
            { ...monthly, id: "B", retirement_date: "2026-03-31" },
        ], 2026, [endOfMonth], [], []);
        expect(rows).toHaveLength(1);
        expect(rows[0].exclusion).not.toBeNull();
    });
    test("7〜9月分からの随時改定が履歴にある人は対象外、9月分からの定時決定があれば登録済み", () => {
        const zuiji = JSON.stringify([{ from: "", amount: 300000, reason: "shutoku" }, { from: "2026-07", amount: 360000, reason: "zuiji" }]);
        const teiji = JSON.stringify([{ from: "", amount: 300000, reason: "shutoku" }, { from: "2026-09", amount: 320000, reason: "teiji" }]);
        const [a, b] = buildSanteiInputs([
            { ...monthly, id: "A", standard_remuneration_history: zuiji },
            { ...monthly, id: "B", standard_remuneration_history: teiji },
        ], 2026, [endOfMonth], [], []);
        expect(a.exclusion).not.toBeNull();
        expect(b.exclusion).toBeNull();
        expect(b.registered).toBe(320000);
        expect(b.previous).toBe(300000); // 従前は8月分の値
    });
});
