/**
 * 養育期間の従前標準報酬月額のみなし措置（youikuTokurei.ts）のテスト
 * 実行方法: bun test
 *
 * 出典：厚生年金保険法26条、厚生年金保険法施行規則10条の2の2・10条の3（e-Gov法令検索）
 *       日本年金機構「養育期間の従前標準報酬月額のみなし措置」https://www.nenkin.go.jp/service/kounen/hokenryo/menjo/20150120.html
 */
import { describe, expect, test } from "bun:test";
import {
    emptyYouikuEntry, findYouikuCandidates, judgeYouikuEntries, parseYouikuEntries, stringifyYouikuEntries,
    validateYouikuEntry, type YouikuEntry,
} from "./youikuTokurei";
import { stringifyLeavePeriods, type LeavePeriod } from "./leaveExemption";
import { stringifyRemunerationHistory, type RemunerationEntry } from "./standardRemuneration";

const TODAY = "2026-11-02";
const history = (...entries: [string, number][]) =>
    stringifyRemunerationHistory(entries.map(([from, amount]): RemunerationEntry => ({ from, amount, reason: from ? "other" : "shutoku" })));
const staffWith = (o: Record<string, unknown> = {}, leaves: LeavePeriod[] = []) => ({
    id: "A", name: "山田", birthday: "1992-06-10", join_date: "2020-04-01", retirement_date: "", is_executive: 0,
    standard_remuneration: 300000, leave_periods: "", ...o,
    ...(leaves.length > 0 ? { leave_periods: stringifyLeavePeriods(leaves) } : {}),
});
const entry = (o: Partial<YouikuEntry>) => emptyYouikuEntry({ childName: "太郎", ...o });
const ym = (m: { year: number; month: number } | null) => (m ? `${m.year}-${String(m.month).padStart(2, "0")}` : null);

// 産休・育休を取って、2025年4月1日に職場に戻り、終了時改定で7月分から22万円に下がった人
const mother = staffWith({ standard_remuneration_history: history(["", 300000], ["2025-07", 220000]) }, [
    { type: "maternity", start: "2024-08-21", end: "2024-11-25" },
    { type: "childcare", start: "2024-11-26", end: "2025-03-31" },
]);

describe("基準月と、みなされる月", () => {
    test("育休が終わった日の翌日からの申出：基準月は前月（育休中の3月・30万円）、7月分から下回る月がみなされる", () => {
        const [j] = judgeYouikuEntries(mother, [entry({ childBirthday: "2024-10-01", start: "2025-04-01" })], TODAY);
        expect(j.error).toBeNull();
        expect([ym(j.startYm), ym(j.basisYm), j.basis, j.basisSource]).toEqual(["2025-04", "2025-03", 300000, "prev_month"]);
        // 3歳の誕生日（2027年10月1日）がある月の前月まで
        expect([ym(j.lastYm), j.endReason, j.ended]).toEqual(["2027-09", "age3", false]);
        // 4〜6月は下回らない。7月から今月（2026年11月）までの17か月がみなされる
        expect(j.months).toHaveLength(20);
        expect(j.months.filter((m) => m.deemed).map((m) => `${m.year}-${m.month}`)[0]).toBe("2025-7");
        expect(j.deemedCount).toBe(17);
    });
    test("厚生年金の上限（65万円）で比べる：健康保険の標準報酬月額が71万円から68万円に下がっても、厚生年金はどちらも65万円なので下回らない", () => {
        const s = staffWith({ standard_remuneration_history: history(["", 710000], ["2025-07", 680000]) });
        const [j] = judgeYouikuEntries(s, [entry({ childBirthday: "2025-03-01", start: "2025-03-01" })], TODAY);
        expect(j.basis).toBe(650000);
        expect(j.deemedCount).toBe(0);
    });
    test("前月に厚生年金に入っていなければ、その前1年以内の直近の月を基準月にする", () => {
        const s = staffWith({ standard_remuneration_history: history(["", 300000], ["2025-03", 0], ["2025-05", 200000]) });
        const [j] = judgeYouikuEntries(s, [entry({ childBirthday: "2025-05-10", start: "2025-05-10" })], TODAY);
        expect([ym(j.basisYm), j.basis, j.basisSource]).toEqual(["2025-02", 300000, "within_year"]);
        expect(j.deemedCount).toBe(19);
    });
    test("子を養育しながら入社した人：前月はこの会社にいないので、前の会社の額を入れなければ基準月がない", () => {
        const s = staffWith({ join_date: "2025-06-01", standard_remuneration_history: history(["", 280000]) });
        const [none] = judgeYouikuEntries(s, [entry({ childBirthday: "2025-03-01", start: "2025-06-01" })], TODAY);
        expect([none.basis, none.basisSource, none.deemedCount]).toEqual([null, null, 0]);
        const [given] = judgeYouikuEntries(s, [entry({ childBirthday: "2025-03-01", start: "2025-06-01", basisOverride: 360000 })], TODAY);
        expect([given.basisYm, given.basis, given.basisSource, given.deemedCount]).toEqual([null, 360000, "override", 18]);
    });
});

describe("特例が終わる月", () => {
    const end = (s: any, e: Partial<YouikuEntry>) => {
        const [j] = judgeYouikuEntries(s, [entry(e)], TODAY);
        return [ym(j.lastYm), j.endReason];
    };
    const s = staffWith({ standard_remuneration_history: history(["", 300000], ["2025-07", 220000]) });
    test("3歳の誕生日がある月の前月まで（1日生まれ・15日生まれ・2月29日生まれ）", () => {
        expect(end(s, { childBirthday: "2024-05-01", start: "2024-05-01" })).toEqual(["2027-04", "age3"]);
        expect(end(s, { childBirthday: "2024-05-15", start: "2024-05-15" })).toEqual(["2027-04", "age3"]);
        // 2月29日生まれは、うるう年でない年の2月28日に3歳に達するので、その翌日（3月1日）がある月の前月＝2月まで
        expect(end(s, { childBirthday: "2024-02-29", start: "2024-02-29" })).toEqual(["2027-02", "age3"]);
    });
    test("退職：資格を失った日（退職日の翌日）がある月の前月まで", () => {
        expect(end({ ...s, retirement_date: "2026-03-15" }, { childBirthday: "2025-01-10", start: "2025-01-10" })).toEqual(["2026-02", "loss"]);
        expect(end({ ...s, retirement_date: "2026-03-31" }, { childBirthday: "2025-01-10", start: "2025-01-10" })).toEqual(["2026-03", "loss"]);
    });
    test("保険料が免除される育児休業等を始めたら、その日の翌日がある月の前月まで。役員の育休は免除されないので終わらない", () => {
        const leaves: LeavePeriod[] = [{ type: "childcare", start: "2026-02-10", end: "2026-03-31" }];
        const e = { childBirthday: "2025-01-10", start: "2025-01-10" };
        expect(end(staffWith(s, leaves), e)).toEqual(["2026-01", "childcare_leave"]);
        expect(end(staffWith({ ...s, is_executive: 1 }, leaves), e)).toEqual(["2027-12", "age3"]);
    });
    test("子が死亡した・養育しなくなった：その日の翌日がある月の前月まで。申出をしていれば終了届が要る", () => {
        const [j] = judgeYouikuEntries(s, [entry({ childBirthday: "2025-01-10", start: "2025-01-10", endDate: "2026-04-30", appliedOn: "2025-08-01" })], TODAY);
        expect([ym(j.lastYm), j.endReason, j.ended, j.needsEndReport]).toEqual(["2026-04", "not_raising", true, true]);
        expect(j.months.at(-1)).toMatchObject({ year: 2026, month: 4 });
    });
});

describe("申出より前の月（2年間）", () => {
    // 2024年3月10日に生まれた子を、休業を取らずに養育している父。4月分から24万円に下がった
    const father = staffWith({ standard_remuneration_history: history(["", 300000], ["2024-04", 240000]) });
    const e = { childBirthday: "2024-03-10", start: "2024-03-10" };
    test("まだ申し出ていなければ、今月（2026年11月）に申し出たとして、前月までの2年間（2024年11月から）の月だけみなされる", () => {
        const [j] = judgeYouikuEntries(father, [entry(e)], TODAY);
        expect(j.tooOldCount).toBe(7); // 2024年4〜10月
        expect(j.deemedCount).toBe(25); // 2024年11月〜2026年11月
        expect(j.months.find((m) => m.year === 2024 && m.month === 10)).toMatchObject({ lower: true, tooOld: true, deemed: false });
    });
    test("2025年1月に申し出ていれば、4月分からみなされる", () => {
        const [j] = judgeYouikuEntries(father, [entry({ ...e, appliedOn: "2025-01-15" })], TODAY);
        expect([j.tooOldCount, j.deemedCount]).toEqual([0, 32]);
    });
});

describe("ほかの子の特例との関係", () => {
    test("2人目の養育を始めたら1人目の特例は前月で終わり、2人目の基準月は1人目の特例でみなされた額（30万円）にする", () => {
        const father = staffWith({ standard_remuneration_history: history(["", 300000], ["2025-07", 220000]) });
        const [first, second] = judgeYouikuEntries(father, [
            entry({ childName: "太郎", childBirthday: "2025-04-01", start: "2025-04-01" }),
            entry({ childName: "花子", childBirthday: "2026-06-15", start: "2026-06-15" }),
        ], TODAY);
        expect([ym(first.lastYm), first.endReason]).toEqual(["2026-05", "other_child"]);
        expect([ym(second.basisYm), second.basis, second.basisSource, second.basisFromChild]).toEqual(["2026-05", 300000, "other_child", "太郎"]);
        expect(second.deemedCount).toBe(6); // 2026年6〜11月
    });
    test("1人目の特例が2人目の産休で終わっても、終わらなかったとしたらみなされる額を2人目の基準月に使う（26条3項）", () => {
        const s = staffWith({ standard_remuneration_history: history(["", 300000], ["2025-04", 200000]) }, [
            { type: "maternity", start: "2023-11-30", end: "2024-03-06" },
            { type: "childcare", start: "2024-03-07", end: "2024-12-31" },
            { type: "maternity", start: "2026-04-01", end: "2026-07-08" },
            { type: "childcare", start: "2026-07-09", end: "2027-03-31" },
        ]);
        const [first, second] = judgeYouikuEntries(s, [
            entry({ childName: "太郎", childBirthday: "2024-01-10", start: "2025-01-01" }),
            entry({ childName: "花子", childBirthday: "2026-05-13", start: "2026-05-13" }),
        ], TODAY);
        expect([ym(first.lastYm), first.endReason]).toEqual(["2026-03", "maternity_leave"]);
        expect([ym(second.basisYm), second.basis, second.basisSource]).toEqual(["2026-04", 300000, "other_child"]);
        // 2人目は育休を始めた月の前月（6月）まで。5・6月は産休中で保険料が免除されるので、みなされない
        expect([ym(second.lastYm), second.endReason, second.deemedCount]).toEqual(["2026-06", "childcare_leave", 0]);
        expect(second.months.every((m) => m.exempt)).toBe(true);
    });
    test("同じ子の申出をし直したとき（休業の後など）は、ほかの子として扱わない", () => {
        const s = staffWith({ standard_remuneration_history: history(["", 300000], ["2025-07", 220000]) });
        const [a, b] = judgeYouikuEntries(s, [
            entry({ childBirthday: "2024-10-01", start: "2024-10-01" }),
            entry({ childBirthday: "2024-10-01", start: "2025-10-01" }),
        ], TODAY);
        expect(a.endReason).toBe("age3");
        expect(b.basisSource).toBe("prev_month");
    });
});

describe("入力と保存", () => {
    test("入力の誤り", () => {
        expect(validateYouikuEntry(entry({ start: "2025-01-01" }))).toContain("子の生年月日");
        expect(validateYouikuEntry(entry({ childBirthday: "2025-01-01" }))).toContain("養育特例開始年月日を");
        expect(validateYouikuEntry(entry({ childBirthday: "2025-01-01", start: "2024-12-31" }))).toContain("子の生年月日より前");
        expect(validateYouikuEntry(entry({ childBirthday: "2022-01-01", start: "2025-01-01" }))).toContain("3歳に達した後");
        expect(validateYouikuEntry(entry({ childBirthday: "2022-01-01", start: "2024-12-31" }))).toBeNull();
        expect(validateYouikuEntry(entry({ childBirthday: "2025-01-01", start: "2025-02-01", endDate: "2025-01-31" }))).toContain("養育しなくなった日");
        const [j] = judgeYouikuEntries(mother, [entry({ start: "2025-01-01" })], TODAY);
        expect(j.error).toContain("子の生年月日");
    });
    test("JSON に入れて読み直せる（開始日の順に並べる）。壊れた値は読まない", () => {
        const list = [
            entry({ childName: "花子", childBirthday: "2026-06-15", start: "2026-06-15", basisOverride: 300000 }),
            entry({ childName: "太郎", childBirthday: "2025-04-01", start: "2025-04-01", appliedOn: "2025-05-01" }),
        ];
        expect(parseYouikuEntries(stringifyYouikuEntries(list)).map((e) => e.childName)).toEqual(["太郎", "花子"]);
        expect(parseYouikuEntries(stringifyYouikuEntries(list))[1]).toEqual(list[0]);
        expect(stringifyYouikuEntries([])).toBe("");
        expect(parseYouikuEntries("{壊れた")).toEqual([]);
        expect(parseYouikuEntries(null)).toEqual([]);
    });
});

describe("役員（育休の保険料は免除されない）", () => {
    test("役員の育休は、特例を終わらせず、免除の月でもないので、下回っていればみなされる", () => {
        const leaves: LeavePeriod[] = [{ type: "childcare", start: "2025-04-01", end: "2025-09-30" }];
        const s = { standard_remuneration_history: history(["", 300000], ["2025-04", 200000]) };
        const e = entry({ childBirthday: "2025-03-01", start: "2025-03-01" });
        // 役員でなければ、保険料が免除される育休を始めたので、その日の翌日がある月の前月（3月）で終わる
        const [worker] = judgeYouikuEntries(staffWith(s, leaves), [e], TODAY);
        expect([worker.endReason, ym(worker.lastYm)]).toEqual(["childcare_leave", "2025-03"]);
        const [exec] = judgeYouikuEntries(staffWith({ ...s, is_executive: 1 }, leaves), [e], TODAY);
        expect(exec.endReason).toBe("age3");
        const during = exec.months.filter((m) => m.year === 2025 && m.month >= 4 && m.month <= 9);
        expect(during).toHaveLength(6);
        expect(during.every((m) => !m.exempt && m.deemed)).toBe(true);
    });
});

describe("申出ができそうな人", () => {
    test("育休が終わった後に標準報酬月額が下がった人を出す。その日からの特例を登録すれば出ない", () => {
        const [c, ...rest] = findYouikuCandidates([mother], TODAY);
        expect(rest).toHaveLength(0);
        expect([c.nextDay, c.basis, c.current, c.lowerCount]).toEqual(["2025-04-01", 300000, 220000, 17]);
        const registered = { ...mother, youiku_tokurei: stringifyYouikuEntries([entry({ childBirthday: "2024-10-01", start: "2025-04-01" })]) };
        expect(findYouikuCandidates([registered], TODAY)).toHaveLength(0);
    });
    test("下がっていない人・3年より前に休業が終わった人・産休の翌日から育休を始めた（続けた）休業の産休は出ない", () => {
        const same = staffWith({ standard_remuneration_history: history(["", 300000]) }, [{ type: "childcare", start: "2025-01-01", end: "2025-03-31" }]);
        expect(findYouikuCandidates([same], TODAY)).toHaveLength(0);
        const old = staffWith({ standard_remuneration_history: history(["", 300000], ["2023-07", 220000]) }, [{ type: "childcare", start: "2022-10-01", end: "2023-03-31" }]);
        expect(findYouikuCandidates([old], TODAY)).toHaveLength(0);
        expect(findYouikuCandidates([mother], TODAY).map((c) => c.leave.type)).toEqual(["childcare"]);
    });
});
