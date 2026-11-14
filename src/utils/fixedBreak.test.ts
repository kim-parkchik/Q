/**
 * 1日の働いた時間と決まった休憩（fixedBreak.ts）・休憩の一覧（breaks.ts）のテスト
 * 実行方法: bun test
 *
 * 休憩の長さの決まりは、労働基準法34条1項（労働時間が6時間を超えるときは少なくとも45分、8時間を超えるときは少なくとも1時間）
 */
import { describe, expect, test } from "bun:test";
import {
    DEFAULT_LENGTH_RULES, autoBreakMinutes, breakShortage, calcDayHours, describeCombine, describeFixedBreak, fixedBreakRuleFor,
    leaveMinutesOf, parseFixedBreak, recordedRestMinutes, specialLeaveMinutesOf, stringifyFixedBreak, type DayTimes, type FixedBreakRule,
} from "./fixedBreak";
import { effectiveBreaks, parseBreaksJson, stringifyBreaks, type BreakSpan } from "./breaks";

const b = (start: string, end: string, leave = false): BreakSpan => (leave ? { start, end, leave: true } : { start, end });
const day = (entry: string, exit: string, breaks: BreakSpan[] = [], o: Partial<DayTimes> = {}): DayTimes => ({ entry, exit, breaks, ...o });
const lunch: FixedBreakRule = { mode: "time", start: "12:00", end: "13:00", combine: "record" };
const lunchMerge: FixedBreakRule = { ...lunch, combine: "merge" };
const byLength: FixedBreakRule = { mode: "length", rules: DEFAULT_LENGTH_RULES, combine: "record" };

describe("休憩の一覧（勤怠に JSON で残す）", () => {
    test("手入力した一覧があればそれを使い（空の一覧も）、なければ打刻を使う", () => {
        const punched = [b("12:00", "13:00")];
        expect(effectiveBreaks(null, punched)).toEqual(punched);
        expect(effectiveBreaks([], punched)).toEqual([]);
        expect(effectiveBreaks([b("12:30", "13:00")], punched)).toEqual([b("12:30", "13:00")]);
    });
    test("保存して読み直せる。時間有給の印も残す。読めない値・時刻でない値は入れない", () => {
        const spans = [b("12:00", "13:00"), b("15:00", "17:00", true), b("18:00", "")];
        expect(parseBreaksJson(stringifyBreaks(spans))).toEqual(spans);
        expect(stringifyBreaks(null)).toBeNull();
        expect(parseBreaksJson(null)).toBeNull();
        expect(parseBreaksJson("")).toBeNull();
        expect(parseBreaksJson("{")).toBeNull();
        expect(parseBreaksJson("[]")).toEqual([]);
        expect(parseBreaksJson(JSON.stringify([{ start: "25:00", end: "13:00" }, { start: "", end: "" }, { start: "09:00", end: "x" }])))
            .toEqual([{ start: "", end: "13:00" }, { start: "09:00", end: "" }]);
    });
});

describe("休憩を何回でも引く", () => {
    test("9:00〜18:00 で 12:00〜13:00 と 15:00〜15:10 に休めば、7時間50分", () => {
        const r = calcDayHours(day("09:00", "18:00", [b("12:00", "13:00"), b("15:00", "15:10")]), null);
        expect([r.total, r.breakMinutes, r.restMinutes, r.leaveMinutes, r.notice]).toEqual([7.833, 70, 70, 0, ""]);
    });
    test("重なる休憩は1つにまとめて引く（2回引かない）", () => {
        const r = calcDayHours(day("09:00", "18:00", [b("12:00", "13:00"), b("12:30", "13:30")]), null);
        expect([r.total, r.breakMinutes]).toEqual([7.5, 90]);
    });
    test("出勤から退勤までの外の分は引かずに知らせる", () => {
        const part = calcDayHours(day("09:00", "18:00", [b("17:30", "18:30")]), null);
        expect([part.total, part.breakMinutes]).toEqual([8.5, 30]);
        expect(part.notice).toContain("一部が出勤から退勤までの外");
        const out = calcDayHours(day("09:00", "18:00", [b("19:00", "19:30")]), null);
        expect([out.total, out.breakMinutes]).toEqual([9, 0]);
        expect(out.notice).toContain("外にある");
    });
    test("夜勤の夜中の休憩は次の日の時刻にして、深夜の分を時刻どおりに引く", () => {
        const r = calcDayHours(day("22:00", "07:00", [b("23:30", "00:15"), b("02:00", "02:45")]), null);
        expect([r.total, r.night, r.breakMinutes]).toEqual([7.5, 5.5, 90]);
    });
    test("時間有給にした中抜けも働いた時間に入れないが、休憩（34条）には数えない", () => {
        const r = calcDayHours(day("09:00", "18:00", [b("12:00", "13:00"), b("15:00", "17:00", true)]), null);
        expect([r.total, r.breakMinutes, r.restMinutes, r.leaveMinutes]).toEqual([6, 60, 60, 120]);
        expect(leaveMinutesOf(day("09:00", "18:00", [b("15:00", "17:00", true), b("16:30", "17:30", true)]))).toBe(150);
        expect(leaveMinutesOf(day("", "", [b("15:00", "16:30", true)]))).toBe(90);
    });
    test("始めか終わりの一方しかない休憩がある日は、その休憩も決まった休憩も引かずに知らせる（長さがわからない）", () => {
        const r = calcDayHours(day("09:00", "18:00", [b("12:00", ""), b("15:00", "15:10")]), lunch);
        expect([r.total, r.autoBreak]).toEqual([8.833, ""]);
        expect(r.notice).toContain("一方しか");
    });
    test("出勤・退勤が入っていない日（公休など）は計算しない", () => {
        expect(Number.isNaN(calcDayHours(day("", ""), lunch).total)).toBe(true);
    });
});

describe("決まった休憩の決まり", () => {
    test("時刻・長さ・入れた休憩との合わせ方を保存して読み直せる。読めない値・始めと終わりが同じ・時刻でない・休憩0分の行は使わない", () => {
        expect(parseFixedBreak(stringifyFixedBreak(lunch))).toEqual(lunch);
        expect(parseFixedBreak(stringifyFixedBreak(lunchMerge))).toEqual(lunchMerge);
        expect(parseFixedBreak(stringifyFixedBreak({ ...byLength, combine: "max" }))).toEqual({ ...byLength, combine: "max" });
        // 合わせ方がない・知らない値は「打刻を優先」
        expect(parseFixedBreak(JSON.stringify({ mode: "time", start: "12:00", end: "13:00" }))).toEqual(lunch);
        expect(parseFixedBreak(JSON.stringify({ mode: "time", start: "12:00", end: "13:00", combine: "sum" }))).toEqual(lunch);
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
        expect(describeFixedBreak({ mode: "length", rules: [{ overMinutes: 450, breakMinutes: 30 }], combine: "record" })).toBe("7時間30分を超えたら30分");
        expect(describeFixedBreak(null)).toBe("使わない");
        expect(describeCombine(lunchMerge)).toContain("合わせて引く");
        expect(describeCombine({ ...byLength, combine: "sum" })).toContain("合算");
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
    test("9:00〜18:00 で休憩が入っていなければ、決まった休憩を引いて8時間", () => {
        const r = calcDayHours(day("09:00", "18:00"), lunch);
        expect([r.total, r.night, r.breakMinutes, r.autoBreak, r.notice]).toEqual([8, 0, 60, "12:00〜13:00", ""]);
    });
    test("決まった休憩を使わない人・グループは、休憩が入っていなければ休憩なしの9時間", () => {
        expect(calcDayHours(day("09:00", "18:00"), null)).toMatchObject({ total: 9, breakMinutes: 0, autoBreak: "" });
    });
    test("打刻を優先：休憩を入れた日（13:00〜13:30）は、入れた休憩だけを引く", () => {
        const r = calcDayHours(day("09:00", "18:00", [b("13:00", "13:30")]), lunch);
        expect([r.total, r.breakMinutes, r.autoBreak]).toEqual([8.5, 30, ""]);
    });
    test("合わせて引く：重なれば1つにまとめ（12:30〜13:30 なら 12:00〜13:30）、重ならなければ足す（クラウド型の勤怠ソフトの「時刻で管理」と同じ）", () => {
        const over = calcDayHours(day("09:00", "18:00", [b("12:30", "13:30")]), lunchMerge);
        expect([over.total, over.breakMinutes, over.autoBreak]).toEqual([7.5, 90, "12:00〜13:00"]);
        const apart = calcDayHours(day("09:00", "18:00", [b("14:00", "15:00")]), lunchMerge);
        expect([apart.total, apart.breakMinutes]).toEqual([7, 120]);
    });
    test("「休憩なし」の日（休憩を取らなかった日）は、決まった休憩を引かない", () => {
        const r = calcDayHours(day("09:00", "18:00", [], { breakNone: true }), lunch);
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
    test("時間有給にした中抜けと重なる日は、決まった休憩を引かずに知らせる。重ならなければ両方を引く", () => {
        const over = calcDayHours(day("09:00", "18:00", [b("11:30", "12:30", true)]), lunch);
        expect([over.total, over.autoBreak, over.leaveMinutes]).toEqual([8, "", 60]);
        expect(over.notice).toContain("休暇にした中抜けと決まった休憩");
        const apart = calcDayHours(day("09:00", "18:00", [b("15:00", "17:00", true)]), lunch);
        expect([apart.total, apart.breakMinutes, apart.restMinutes, apart.leaveMinutes]).toEqual([6, 60, 60, 120]);
    });
    test("時間単位の特別休暇（子の看護等休暇など）にした中抜けも、働いた時間にも休憩（34条）にも入れない。時間有給とは分けて数える", () => {
        const special: BreakSpan = { start: "15:00", end: "17:00", leaveTypeId: 3 };
        const r = calcDayHours(day("09:00", "18:00", [b("12:00", "13:00"), special, b("10:00", "10:30", true)]), lunch);
        expect([r.total, r.breakMinutes, r.restMinutes, r.leaveMinutes, r.specialLeaveMinutes]).toEqual([5.5, 60, 60, 30, 120]);
        expect(specialLeaveMinutesOf(day("09:00", "18:00", [special]))).toBe(120);
        expect(leaveMinutesOf(day("09:00", "18:00", [special]))).toBe(0);
        // 出勤・退勤がない日は、入れた長さ
        expect(specialLeaveMinutesOf(day("", "", [special]))).toBe(120);
        // 34条の確かめに使う休憩には入れない
        expect(recordedRestMinutes(day("", "", [b("12:00", "13:00"), special]))).toBe(60);
        // 保存して読み直しても、休暇の種類が残る
        expect(parseBreaksJson(stringifyBreaks([special, b("12:00", "13:00", true)]))).toEqual([special, { start: "12:00", end: "13:00", leave: true }]);
    });
    test("夜勤：22:00〜翌7:00 で決まった休憩が 2:00〜3:00 なら、次の日の2時。深夜（22時〜5時）の7時間から1時間引く", () => {
        const r = calcDayHours(day("22:00", "07:00"), { mode: "time", start: "02:00", end: "03:00", combine: "record" });
        expect([r.total, r.night, r.autoBreak]).toEqual([8, 6, "02:00〜03:00"]);
    });
});

describe("長さで決める（出勤から退勤までが6時間を超えたら45分、8時間を超えたら60分）", () => {
    test("ちょうど6時間・8時間の日は、その下の行", () => {
        expect(calcDayHours(day("09:00", "15:00"), byLength)).toMatchObject({ total: 6, breakMinutes: 0, autoBreak: "" });
        expect(calcDayHours(day("09:00", "15:01"), byLength)).toMatchObject({ breakMinutes: 45, autoBreak: "45分" });
        expect(calcDayHours(day("09:00", "17:00"), byLength)).toMatchObject({ total: 7.25, breakMinutes: 45 });
        expect(calcDayHours(day("09:00", "17:01"), byLength)).toMatchObject({ breakMinutes: 60, autoBreak: "60分" });
    });
    test("時間有給にした中抜けは長さに入れない（9:00〜18:00 で中抜け1時間なら8時間なので45分）", () => {
        expect(calcDayHours(day("09:00", "18:00", [b("14:00", "15:00", true)]), byLength))
            .toMatchObject({ total: 7.25, breakMinutes: 45, restMinutes: 45, leaveMinutes: 60 });
    });
    test("入れた休憩との合わせ方：打刻を優先・長いほう・合算（クラウド型の勤怠ソフトの「時間で管理」と同じ）", () => {
        const smoke = [b("15:00", "15:15")];
        expect(calcDayHours(day("09:00", "18:00", smoke), byLength)).toMatchObject({ total: 8.75, breakMinutes: 15, autoBreak: "" });
        expect(calcDayHours(day("09:00", "18:00", smoke), { ...byLength, combine: "max" })).toMatchObject({ total: 8, breakMinutes: 60, autoBreak: "45分" });
        expect(calcDayHours(day("09:00", "18:00", [b("12:00", "13:10")]), { ...byLength, combine: "max" })).toMatchObject({ total: 7.833, autoBreak: "" });
        expect(calcDayHours(day("09:00", "18:00", smoke), { ...byLength, combine: "sum" })).toMatchObject({ total: 7.75, breakMinutes: 75, autoBreak: "60分" });
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
    test("確定した日：入れた休憩（時間有給にした中抜けを除く）と、確定したときに引いた決まった休憩の長さ", () => {
        expect(autoBreakMinutes("12:00〜13:00")).toBe(60);
        expect(autoBreakMinutes("23:30〜00:15")).toBe(45);
        expect(autoBreakMinutes("45分")).toBe(45);
        expect(autoBreakMinutes("")).toBe(0);
        const t = day("09:00", "18:00", [b("12:00", "12:45"), b("15:00", "15:10"), b("16:00", "17:00", true)]);
        expect(recordedRestMinutes(t)).toBe(55);
        expect(recordedRestMinutes(t, "30分")).toBe(85);
        // 時刻の決まった休憩は、入れた休憩と重なるところを1つにまとめる
        expect(recordedRestMinutes(t, "12:00〜13:00")).toBe(70);
    });
});
