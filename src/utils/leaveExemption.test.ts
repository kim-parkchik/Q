/**
 * 産休・育休中の社会保険料の免除（leaveExemption.ts）のテスト
 * 実行方法: bun test
 *
 * 出典：日本年金機構 https://www.nenkin.go.jp/service/kounen/hokenryo/menjo/sankyu-menjo/20140509-02.html
 *       https://www.nenkin.go.jp/service/kounen/hokenryo/menjo/ikuji-menjo/20140327-05.html
 *       健康保険法159条・159条の3、健康保険法施行規則135条
 */
import { describe, expect, test } from "bun:test";
import {
    canExemptLeave, checkLeaveExemptBonus, checkLeaveExemptMonth, exemptLeavePeriodsOf, papaLeaveWorkDays, parseLeavePeriods,
    parsePlannedWorkHoursText, sameMonthChildcareDays, stringifyLeavePeriods, validateLeavePeriod, type LeavePeriod,
} from "./leaveExemption";

const maternity = (start: string, end = ""): LeavePeriod => ({ type: "maternity", start, end });
const childcare = (start: string, end = ""): LeavePeriod => ({ type: "childcare", start, end });
/** 2026年の各月が免除になるか（1〜12月） */
const exemptMonths2026 = (leaves: LeavePeriod[]) =>
    Array.from({ length: 12 }, (_, i) => i + 1).filter((m) => checkLeaveExemptMonth(leaves, 2026, m));

describe("産前産後休業", () => {
    test("開始日がある月の分から、終了日の翌日がある月の前月分まで免除", () => {
        // 5月10日〜8月20日 → 終了日の翌日（8月21日）は8月 → 5〜7月分
        expect(exemptMonths2026([maternity("2026-05-10", "2026-08-20")])).toEqual([5, 6, 7]);
    });
    test("終了日が月末なら、終了した月の分まで免除", () => {
        expect(exemptMonths2026([maternity("2026-05-10", "2026-08-31")])).toEqual([5, 6, 7, 8]);
    });
    test("終了日が未定なら、開始した月の分からずっと免除", () => {
        expect(exemptMonths2026([maternity("2026-05-10")])).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
    });
    test("免除になる月に支払った賞与も免除（期間の長さは問わない）", () => {
        const leaves = [maternity("2026-05-10", "2026-08-20")];
        expect(checkLeaveExemptBonus(leaves, "2026-07-10")).toBe(true);
        expect(checkLeaveExemptBonus(leaves, "2026-05-01")).toBe(true); // 開始日より前でも、開始した月なら免除
        expect(checkLeaveExemptBonus(leaves, "2026-08-10")).toBe(false);
    });
});

describe("育児休業等", () => {
    test("開始日がある月の分から、終了日の翌日がある月の前月分まで免除", () => {
        expect(exemptMonths2026([childcare("2026-08-21", "2027-04-20")])).toEqual([8, 9, 10, 11, 12]);
        expect(checkLeaveExemptMonth([childcare("2026-08-21", "2027-04-20")], 2027, 3)).toBe(true);
        expect(checkLeaveExemptMonth([childcare("2026-08-21", "2027-04-20")], 2027, 4)).toBe(false);
    });
    test("月末をはさむ短い育休でも、その月の分は免除（6月30日〜7月1日 → 6月分）", () => {
        expect(exemptMonths2026([childcare("2026-06-30", "2026-07-01")])).toEqual([6]);
    });
    test("同じ月のうちに始まって終わるときは、14日以上なら免除（令和4年10月1日以後に開始）", () => {
        expect(exemptMonths2026([childcare("2026-06-01", "2026-06-14")])).toEqual([6]);
        expect(exemptMonths2026([childcare("2026-06-01", "2026-06-13")])).toEqual([]);
    });
    test("同じ月に2回休んだときは、日数を合わせて14日以上なら免除", () => {
        expect(exemptMonths2026([childcare("2026-06-01", "2026-06-07"), childcare("2026-06-20", "2026-06-26")])).toEqual([6]);
        expect(exemptMonths2026([childcare("2026-06-01", "2026-06-07"), childcare("2026-06-20", "2026-06-25")])).toEqual([]);
    });
    test("令和4年9月30日以前に開始した育休は、14日以上でも月の途中で終われば免除しない", () => {
        expect(checkLeaveExemptMonth([childcare("2022-09-01", "2022-09-20")], 2022, 9)).toBe(false);
        expect(checkLeaveExemptMonth([childcare("2022-10-01", "2022-10-20")], 2022, 10)).toBe(true);
    });
    test("賞与：育休の期間が1か月を超えるときだけ免除（1か月ちょうどは免除しない）", () => {
        // 6月15日〜7月14日はちょうど1か月、7月15日までなら1か月を超える
        expect(checkLeaveExemptBonus([childcare("2026-06-15", "2026-07-14")], "2026-06-10")).toBe(false);
        expect(checkLeaveExemptBonus([childcare("2026-06-15", "2026-07-15")], "2026-06-10")).toBe(true);
        // 月末をはさむ短い育休：月額は免除でも、賞与は免除しない
        expect(checkLeaveExemptBonus([childcare("2026-06-30", "2026-07-01")], "2026-06-10")).toBe(false);
        // 終了日が未定なら免除
        expect(checkLeaveExemptBonus([childcare("2026-06-15")], "2026-06-10")).toBe(true);
    });
    test("賞与：1か月後に同じ日がないときは、その月の末日でちょうど1か月（1月31日〜2月28日）", () => {
        expect(checkLeaveExemptBonus([childcare("2027-01-31", "2027-02-28")], "2027-01-25")).toBe(false);
        expect(checkLeaveExemptBonus([childcare("2027-01-31", "2027-03-01")], "2027-01-25")).toBe(true);
    });
    test("賞与：14日以上の決まりで免除になる月の賞与は、免除しない", () => {
        expect(checkLeaveExemptBonus([childcare("2026-06-01", "2026-06-20")], "2026-06-10")).toBe(false);
    });
    test("賞与：令和4年9月30日以前に開始した育休は、1か月以下でも月末を含む月の賞与を免除", () => {
        expect(checkLeaveExemptBonus([childcare("2021-06-30", "2021-07-01")], "2021-06-10")).toBe(true);
    });
    test("続けて取った育休（産後パパ育休のすぐ後の育休など）は、1つの育休として扱う", () => {
        // 6月1日〜20日（産後パパ育休）と6月21日〜7月10日（育休）→ 6月1日〜7月10日の1つの育休
        const leaves = [childcare("2026-06-01", "2026-06-20"), childcare("2026-06-21", "2026-07-10")];
        expect(exemptMonths2026(leaves)).toEqual([6]);
        // 合わせると1か月を超えるので、6月の賞与も免除（別々なら、どちらも1か月以下で免除されない）
        expect(checkLeaveExemptBonus(leaves, "2026-06-30")).toBe(true);
        expect(checkLeaveExemptBonus([leaves[1]], "2026-06-30")).toBe(false);
    });
});

describe("産後パパ育休で働かせる日（14日から就業予定日数を除く。健康保険法施行規則135条4項・厚生年金保険法施行規則25条の2第5項）", () => {
    /** 1日の所定労働時間 hours の人（産後パパ育休の期間を JSON で持つ） */
    const papaStaff = (leaves: LeavePeriod[], hours: unknown = 8) => ({ leave_periods: stringifyLeavePeriods(leaves), scheduled_work_hours: hours });
    const papa = (start: string, end: string, plannedWorkHours?: number): LeavePeriod => ({ type: "childcare", start, end, papaLeave: true, plannedWorkHours });

    test("就業予定日数は、働かせる時間の合計 ÷ 1日の所定労働時間（1日未満は切り捨て）。産後パパ育休でなければ0日", () => {
        expect(papaLeaveWorkDays(papa("2026-11-01", "2026-11-15", 12), 8)).toBe(1); // 1.5日 → 1日
        expect(papaLeaveWorkDays(papa("2026-11-01", "2026-11-15", 16), 8)).toBe(2);
        expect(papaLeaveWorkDays(papa("2026-11-01", "2026-11-15", 15), 7.5)).toBe(2); // 7時間30分の人の15時間は、ちょうど2日
        expect(papaLeaveWorkDays(papa("2026-11-01", "2026-11-15", 14.75), 7.5)).toBe(1);
        expect(papaLeaveWorkDays(papa("2026-11-01", "2026-11-15"), 8)).toBe(0); // 働かせない
        expect(papaLeaveWorkDays({ ...childcare("2026-11-01", "2026-11-15"), plannedWorkHours: 16 }, 8)).toBe(0); // 産後パパ育休でない
        expect(papaLeaveWorkDays(papa("2026-11-01", "2026-11-15", 16), null)).toBeNull(); // 1日の所定労働時間がわからない
    });
    test("働かせる時間の入力欄（「12」「12:30」「１２：３０」。空は null、読めない・0は undefined）", () => {
        expect(parsePlannedWorkHoursText("12")).toBe(12);
        expect(parsePlannedWorkHoursText("12:30")).toBe(12.5);
        expect(parsePlannedWorkHoursText("１２：３０")).toBe(12.5);
        expect(parsePlannedWorkHoursText("80")).toBe(80);
        expect(parsePlannedWorkHoursText("")).toBeNull();
        expect(parsePlannedWorkHoursText("0")).toBeUndefined();
        expect(parsePlannedWorkHoursText("12:75")).toBeUndefined();
        expect(parsePlannedWorkHoursText("abc")).toBeUndefined();
    });
    test("同じ月のうちに始まって終わる産後パパ育休は、就業予定日数を除いて14日以上なら免除（11月1日〜15日の15日）", () => {
        // 8時間（1日）働かせる → 14日で免除。16時間（2日）働かせる → 13日で免除されない
        const one = exemptLeavePeriodsOf(papaStaff([papa("2026-11-01", "2026-11-15", 8)]));
        expect(one[0].workDays).toBe(1);
        expect(sameMonthChildcareDays(one, 2026, 11)).toEqual({ days: 14, calendarDays: 15, workDays: 1, count: 1 });
        expect(checkLeaveExemptMonth(one, 2026, 11)).toBe(true);
        const two = exemptLeavePeriodsOf(papaStaff([papa("2026-11-01", "2026-11-15", 16)]));
        expect(sameMonthChildcareDays(two, 2026, 11)).toEqual({ days: 13, calendarDays: 15, workDays: 2, count: 1 });
        expect(checkLeaveExemptMonth(two, 2026, 11)).toBe(false);
        // 1日の所定労働時間が6時間の人なら、12時間で2日 → 免除されない
        expect(checkLeaveExemptMonth(exemptLeavePeriodsOf(papaStaff([papa("2026-11-01", "2026-11-15", 12)], 6)), 2026, 11)).toBe(false);
        // 1日の所定労働時間がわからない人は、給与の計算と同じく8時間で見込む（12時間 → 1日 → 14日）
        expect(exemptLeavePeriodsOf(papaStaff([papa("2026-11-01", "2026-11-15", 12)], null))[0].workDays).toBe(1);
    });
    test("同じ月に2つ取ったときは、それぞれ就業予定日数を除いた日数を合わせる。続けて取ったものは1つとして数える", () => {
        // 11月2日〜10日（9日・8時間＝1日）と11月16日〜22日（7日・ふつうの育休）→ 8＋7＝15日で免除
        const leaves = exemptLeavePeriodsOf(papaStaff([papa("2026-11-02", "2026-11-10", 8), childcare("2026-11-16", "2026-11-22")]));
        expect(sameMonthChildcareDays(leaves, 2026, 11)).toEqual({ days: 15, calendarDays: 16, workDays: 1, count: 2 });
        expect(checkLeaveExemptMonth(leaves, 2026, 11)).toBe(true);
        // 24時間（3日）働かせると 6＋7＝13日で免除されない
        const more = exemptLeavePeriodsOf(papaStaff([papa("2026-11-02", "2026-11-10", 24), childcare("2026-11-16", "2026-11-22")]));
        expect(checkLeaveExemptMonth(more, 2026, 11)).toBe(false);
        // 11月1日〜8日の産後パパ育休（16時間＝2日）のすぐ後に11月9日〜16日の育休 → 1つの育休（16日 − 2日 ＝ 14日）で免除
        const joined = exemptLeavePeriodsOf(papaStaff([papa("2026-11-01", "2026-11-08", 16), childcare("2026-11-09", "2026-11-16")]));
        expect(sameMonthChildcareDays(joined, 2026, 11)).toEqual({ days: 14, calendarDays: 16, workDays: 2, count: 1 });
        expect(checkLeaveExemptMonth(joined, 2026, 11)).toBe(true);
    });
    test("月末をはさむ産後パパ育休は、働かせる日があっても、開始した月の分は免除（14日の数え方は使わない）。賞与は期間の長さで決める", () => {
        const leaves = exemptLeavePeriodsOf(papaStaff([papa("2026-11-20", "2026-12-10", 40)]));
        expect(exemptMonths2026(leaves)).toEqual([11]);
        expect(sameMonthChildcareDays(leaves, 2026, 11)).toBeNull();
        // 11月20日〜12月10日は1か月以下なので、11月の賞与は免除しない（働かせる日とは関係ない）
        expect(checkLeaveExemptBonus(leaves, "2026-11-25")).toBe(false);
    });
    test("産後パパ育休の印と働かせる時間・届けた就業予定日数を保存して読み直せる（産後パパ育休でなければ、働かせる時間は残さない）", () => {
        const leaves: LeavePeriod[] = [
            { ...papa("2026-11-01", "2026-11-15", 12.5), reported: { kind: "apply", on: "2026-11-16", start: "2026-11-01", end: "2026-11-15", workDays: 1 } },
        ];
        expect(parseLeavePeriods(stringifyLeavePeriods(leaves))).toEqual(leaves);
        expect(parseLeavePeriods(stringifyLeavePeriods([{ ...childcare("2026-11-01", "2026-11-15"), plannedWorkHours: 12 }]))).toEqual([childcare("2026-11-01", "2026-11-15")]);
    });
});

describe("産休から育休へ続けて休むとき", () => {
    test("産休の月と育休の月を合わせて免除する", () => {
        const leaves = [maternity("2026-03-01", "2026-06-10"), childcare("2026-06-11", "2027-06-10")];
        expect(exemptMonths2026(leaves)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    });
});

describe("役員（育児休業等の免除は受けられない。産前産後休業は受けられる）", () => {
    // 日本年金機構「従業員（健康保険・厚生年金保険の被保険者）が育児休業等を取得・延長したときの手続き」4．留意事項（1）
    const leaves = [maternity("2026-03-01", "2026-06-10"), childcare("2026-06-11", "2027-06-10")];
    const executive = { is_executive: 1, leave_periods: stringifyLeavePeriods(leaves) };
    test("役員の育休は、免除に使う期間に入れない（産休は入れる）", () => {
        expect(exemptLeavePeriodsOf(executive)).toEqual([leaves[0]]);
        expect(exemptMonths2026(exemptLeavePeriodsOf(executive))).toEqual([3, 4, 5]);
        expect(checkLeaveExemptBonus(exemptLeavePeriodsOf(executive), "2026-07-10")).toBe(false);
        expect(canExemptLeave(executive, childcare("2026-06-11"))).toBe(false);
        expect(canExemptLeave(executive, maternity("2026-03-01"))).toBe(true);
    });
    test("役員でなければ、育休も免除に使う（is_executive が 0・空・文字の \"0\" でも同じ）", () => {
        for (const is_executive of [0, null, undefined, "0", ""]) {
            expect(exemptLeavePeriodsOf({ ...executive, is_executive })).toEqual(leaves);
        }
        expect(exemptLeavePeriodsOf({ ...executive, is_executive: "1" })).toEqual([leaves[0]]);
        expect(exemptLeavePeriodsOf(null)).toEqual([]);
    });
});

describe("介護休業・業務上の負傷や疾病による休業・その他の休職（免除はない。給与・勤怠は leaveOfAbsence.ts）", () => {
    test("期間は読むが、免除に使う期間には入れない（その月の保険料も、賞与の保険料も引く）", () => {
        const others: LeavePeriod[] = [
            { type: "family_care", start: "2026-04-01", end: "2026-06-30" },
            { type: "injury", start: "2026-07-01", end: "2026-08-31" },
            { type: "other", start: "2026-09-01", end: "" },
        ];
        const staff = { leave_periods: stringifyLeavePeriods(others) };
        expect(parseLeavePeriods(staff.leave_periods)).toEqual(others);
        expect(exemptLeavePeriodsOf(staff)).toEqual([]);
        expect(exemptMonths2026(others)).toEqual([]);
        expect(checkLeaveExemptBonus(others, "2026-06-10")).toBe(false);
        for (const p of others) expect(canExemptLeave({}, p)).toBe(false);
        // 産休・育休と一緒に入れても、免除は産休・育休の分だけ
        const mixed = [maternity("2026-01-10", "2026-03-31"), ...others];
        expect(exemptLeavePeriodsOf({ leave_periods: stringifyLeavePeriods(mixed) })).toEqual([mixed[0]]);
    });
    test("業務上の負傷・疾病による休業は、事故の日も残す（ほかの種類には残さない。事故の日は開始日より後にできない）", () => {
        const injury: LeavePeriod = { type: "injury", start: "2026-07-01", end: "2026-08-31", accident: "2026-06-30" };
        const json = stringifyLeavePeriods([injury, { type: "other", start: "2026-09-01", end: "", accident: "2026-08-30" }]);
        expect(parseLeavePeriods(json)).toEqual([injury, { type: "other", start: "2026-09-01", end: "" }]);
        expect(validateLeavePeriod({ ...injury, accident: "2026-07-02" })).toBe("事故の日が開始日より後です");
    });
});

describe("入力と保存", () => {
    test("保存した JSON を読み直すと同じ期間になる", () => {
        const leaves = [maternity("2026-03-01", "2026-06-10"), childcare("2026-06-11", "")];
        expect(parseLeavePeriods(stringifyLeavePeriods(leaves))).toEqual(leaves);
        expect(stringifyLeavePeriods([])).toBe("");
    });
    test("空・壊れた JSON・知らない種類は、期間なしとして読む", () => {
        expect(parseLeavePeriods(null)).toEqual([]);
        expect(parseLeavePeriods("")).toEqual([]);
        expect(parseLeavePeriods("{")).toEqual([]);
        expect(parseLeavePeriods('{"type":"childcare"}')).toEqual([]);
        expect(parseLeavePeriods('[{"type":"sick","start":"2026-06-01","end":""}]')).toEqual([]);
    });
    test("開始日が空・終了日が開始日より前なら、入力の誤り", () => {
        expect(validateLeavePeriod(childcare(""))).not.toBeNull();
        expect(validateLeavePeriod(childcare("2026-06-10", "2026-06-01"))).not.toBeNull();
        expect(validateLeavePeriod(childcare("2026-06-10", "2026-06-10"))).toBeNull();
        expect(validateLeavePeriod(childcare("2026-06-10"))).toBeNull();
    });
    test("期間がなければ、どの月も賞与も免除しない", () => {
        expect(checkLeaveExemptMonth([], 2026, 6)).toBe(false);
        expect(checkLeaveExemptBonus([], "2026-06-10")).toBe(false);
    });
});
