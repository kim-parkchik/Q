/**
 * 決まった休憩（fixedBreak.ts）のテスト
 * 実行方法: bun test
 *
 * 休憩の長さの決まりは、労働基準法34条1項（労働時間が6時間を超えるときは少なくとも45分、8時間を超えるときは少なくとも1時間）
 */
import { describe, expect, test } from "bun:test";
import {
    DEFAULT_LENGTH_RULES, autoBreakMinutes, breakShortage, calcDayHours, describeFixedBreak, fixedBreakRuleFor, parseFixedBreak,
    recordedRestMinutes, stringifyFixedBreak, type DayTimes, type FixedBreakRule,
} from "./fixedBreak";
import { calcDetailedDiff } from "./calcSalary";

const day = (entry: string, exit: string, o: Partial<DayTimes> = {}): DayTimes =>
    ({ entry, exit, breakStart: "", breakEnd: "", outTime: "", returnTime: "", ...o });
const lunch: FixedBreakRule = { mode: "time", start: "12:00", end: "13:00" };
const byLength: FixedBreakRule = { mode: "length", rules: DEFAULT_LENGTH_RULES };

describe("決まった休憩の決まり", () => {
    test("時刻・長さを保存して読み直せる。読めない値・始めと終わりが同じ・時刻でない・休憩0分の行は使わない", () => {
        expect(parseFixedBreak(stringifyFixedBreak(lunch))).toEqual(lunch);
        expect(parseFixedBreak(stringifyFixedBreak(byLength))).toEqual(byLength);
        expect(parseFixedBreak("")).toBeNull();
        expect(parseFixedBreak("{")).toBeNull();
        expect(parseFixedBreak(JSON.stringify({ mode: "time", start: "12:00", end: "12:00" }))).toBeNull();
        expect(parseFixedBreak(JSON.stringify({ mode: "time", start: "25:00", end: "13:00" }))).toBeNull();
        expect(parseFixedBreak(JSON.stringify({ mode: "length", rules: [{ overMinutes: 360, breakMinutes: 0 }] }))).toBeNull();
        expect(stringifyFixedBreak(null)).toBe("");
    });
    test("画面の書き方", () => {
        expect(describeFixedBreak(lunch)).toBe("12:00〜13:00");
        expect(describeFixedBreak(byLength)).toBe("6時間を超えたら45分・8時間を超えたら60分");
        expect(describeFixedBreak({ mode: "length", rules: [{ overMinutes: 450, breakMinutes: 30 }] })).toBe("7時間30分を超えたら30分");
        expect(describeFixedBreak(null)).toBe("使わない");
    });
    test("人ごと：「決まった休憩を使う」を外した人（0）は使わない。前から登録している人（値がない）は使う", () => {
        const group = stringifyFixedBreak(lunch);
        expect(fixedBreakRuleFor(group, 1)).toEqual(lunch);
        expect(fixedBreakRuleFor(group, undefined)).toEqual(lunch);
        expect(fixedBreakRuleFor(group, null)).toEqual(lunch);
        expect(fixedBreakRuleFor(group, 0)).toBeNull();
        expect(fixedBreakRuleFor(null, 1)).toBeNull();
    });
});

describe("時刻で決める（12:00〜13:00）", () => {
    test("9:00〜18:00 で休憩の時刻が入っていなければ、決まった休憩を引いて8時間", () => {
        const r = calcDayHours(day("09:00", "18:00"), lunch);
        expect([r.total, r.night, r.breakMinutes, r.autoBreak, r.notice]).toEqual([8, 0, 60, "12:00〜13:00", ""]);
    });
    test("決まった休憩を使わない人・グループは、いままでどおり（休憩の時刻が入っていなければ休憩なしの9時間）", () => {
        expect(calcDayHours(day("09:00", "18:00"), null)).toMatchObject({ ...calcDetailedDiff("09:00", "18:00", "", ""), total: 9, autoBreak: "" });
    });
    test("その日の休憩の記録（手入力・打刻）が先：13:00〜13:30 に休んだ日は30分だけ引く", () => {
        const r = calcDayHours(day("09:00", "18:00", { breakStart: "13:00", breakEnd: "13:30" }), lunch);
        expect([r.total, r.breakMinutes, r.autoBreak]).toEqual([8.5, 30, ""]);
    });
    test("「休憩なし」の日（休憩を取らなかった日）は引かない", () => {
        const r = calcDayHours(day("09:00", "18:00", { breakNone: true }), lunch);
        expect([r.total, r.breakMinutes, r.autoBreak]).toEqual([9, 0, ""]);
    });
    test("半日の勤務（9:00〜12:00・13:00〜18:00）は、決まった休憩にかからないので引かない", () => {
        expect(calcDayHours(day("09:00", "12:00"), lunch)).toMatchObject({ total: 3, autoBreak: "", notice: "" });
        expect(calcDayHours(day("13:00", "18:00"), lunch)).toMatchObject({ total: 5, autoBreak: "", notice: "" });
    });
    test("決まった休憩の途中で退勤・出勤した日は、休憩を取ったかわからないので引かずに知らせる（働いた時間を少なく数えない）", () => {
        const early = calcDayHours(day("09:00", "12:30"), lunch);
        expect([early.total, early.autoBreak]).toEqual([3.5, ""]);
        expect(early.notice).toContain("途中で出勤・退勤");
        expect(calcDayHours(day("12:30", "18:00"), lunch).notice).toContain("途中で出勤・退勤");
    });
    test("外出と重なる日は引かずに知らせる。重ならなければ、外出と決まった休憩の両方を引く", () => {
        const over = calcDayHours(day("09:00", "18:00", { outTime: "12:30", returnTime: "13:30" }), lunch);
        expect([over.total, over.autoBreak]).toEqual([8, ""]); // 外出の1時間だけ引く
        expect(over.notice).toContain("外出と決まった休憩");
        const apart = calcDayHours(day("09:00", "18:00", { outTime: "15:00", returnTime: "15:30" }), lunch);
        expect([apart.total, apart.breakMinutes, apart.restMinutes]).toEqual([7.5, 60, 90]);
    });
    test("休憩の始めか終わりの一方しか入っていない日は、引かずに知らせる", () => {
        const r = calcDayHours(day("09:00", "18:00", { breakStart: "12:00" }), lunch);
        expect([r.total, r.autoBreak]).toEqual([9, ""]);
        expect(r.notice).toContain("一方しか");
    });
    test("夜勤：22:00〜翌7:00 で決まった休憩が 2:00〜3:00 なら、次の日の2時。深夜（22時〜5時）の7時間から1時間引く", () => {
        const r = calcDayHours(day("22:00", "07:00"), { mode: "time", start: "02:00", end: "03:00" });
        expect([r.total, r.night, r.autoBreak]).toEqual([8, 6, "02:00〜03:00"]);
    });
    test("出勤・退勤が入っていない日（公休など）は計算しない（いままでと同じ）", () => {
        expect(Number.isNaN(calcDayHours(day("", ""), lunch).total)).toBe(true);
    });
});

describe("長さで決める（出勤から退勤までが6時間を超えたら45分、8時間を超えたら60分）", () => {
    test("ちょうど6時間・8時間の日は、その下の行", () => {
        expect(calcDayHours(day("09:00", "15:00"), byLength)).toMatchObject({ total: 6, breakMinutes: 0, autoBreak: "" });
        expect(calcDayHours(day("09:00", "15:01"), byLength)).toMatchObject({ breakMinutes: 45, autoBreak: "45分" });
        expect(calcDayHours(day("09:00", "17:00"), byLength)).toMatchObject({ total: 7.25, breakMinutes: 45 });
        expect(calcDayHours(day("09:00", "17:01"), byLength)).toMatchObject({ breakMinutes: 60, autoBreak: "60分" });
    });
    test("外出は長さに入れない（9:00〜18:00 で外出1時間なら8時間なので45分）", () => {
        expect(calcDayHours(day("09:00", "18:00", { outTime: "14:00", returnTime: "15:00" }), byLength))
            .toMatchObject({ total: 7.25, breakMinutes: 45, restMinutes: 105 });
    });
    test("時刻がわからないので、深夜の時間はできるだけ減らさない（深夜の割増を少なく数えない）", () => {
        // 22:00〜翌7:00（9時間。深夜7時間）：60分は、深夜でない5時〜7時から引いたとみなす
        expect(calcDayHours(day("22:00", "07:00"), byLength)).toMatchObject({ total: 8, night: 7 });
        // 22:00〜翌5:00（7時間すべて深夜）：45分は深夜から引くしかない
        expect(calcDayHours(day("22:00", "05:00"), byLength)).toMatchObject({ total: 6.25, night: 6.25 });
    });
    test("初めの値は、どの長さの日でも、引いたあとの労働時間に対して労働基準法34条の休憩を下回らない（1分から16時間まで）", () => {
        const pad = (n: number) => String(n).padStart(2, "0");
        for (let minutes = 1; minutes <= 16 * 60; minutes++) {
            const exit = `${pad(5 + Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
            const r = calcDayHours(day("05:00", exit), byLength);
            expect(breakShortage(Math.round(r.total * 60), r.restMinutes)).toBe(0);
        }
    });
});

describe("労働基準法34条の休憩に足りない日", () => {
    test("労働時間が6時間を超えたら45分、8時間を超えたら1時間", () => {
        expect(breakShortage(360, 0)).toBe(0); // ちょうど6時間なら、休憩がなくてもよい
        expect(breakShortage(361, 44)).toBe(1);
        expect(breakShortage(480, 45)).toBe(0); // ちょうど8時間なら45分でよい
        expect(breakShortage(481, 45)).toBe(15);
        expect(breakShortage(481, 60)).toBe(0);
    });
    test("確定した勤怠に残した決まった休憩の長さと、その日に記録した休憩・外出の長さ", () => {
        expect(autoBreakMinutes("12:00〜13:00")).toBe(60);
        expect(autoBreakMinutes("23:30〜00:15")).toBe(45);
        expect(autoBreakMinutes("45分")).toBe(45);
        expect(autoBreakMinutes("")).toBe(0);
        expect(recordedRestMinutes(day("09:00", "18:00", { breakStart: "12:00", breakEnd: "12:45", outTime: "15:00", returnTime: "15:10" }))).toBe(55);
    });
});
