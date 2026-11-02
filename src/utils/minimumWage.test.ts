/**
 * 最低賃金のチェック（minimumWage.ts）と、1年間の所定労働日数（annualWorkDays.ts）のテスト
 * 実行方法: bun test
 *
 * 最低賃金のデータは、厚生労働省「地域別最低賃金の全国一覧」のページから自動で作ったもの（constants/minimumWage.ts）。
 * 期待値は同じページの表の値（東京・秋田・岩手）。
 */
import { describe, expect, test } from "bun:test";
import { MINIMUM_WAGES } from "../constants/minimumWage";
import { INSURANCE_2026 } from "../constants/insurance";
import { baseWagePerHour, checkMinimumWage, describeMinimumWage, minimumWageOn, nextMinimumWage } from "./minimumWage";
import { countAnnualWorkDays, countPrescribedWorkDays, parseWorkDays } from "./annualWorkDays";

describe("最低賃金のデータ", () => {
    test("47都道府県そろっていて、名前は保険料率と同じ書き方", () => {
        expect(Object.keys(MINIMUM_WAGES).sort()).toEqual(Object.keys(INSURANCE_2026.KENPO_RATES).sort());
    });
    test("どの都道府県も、発効日・金額とも年度の順に上がっている（令和3〜8年度の6件）", () => {
        for (const entries of Object.values(MINIMUM_WAGES)) {
            expect(entries).toHaveLength(6);
            for (let i = 1; i < entries.length; i++) {
                expect(entries[i].from > entries[i - 1].from).toBe(true);
                expect(entries[i].amount).toBeGreaterThan(entries[i - 1].amount);
            }
        }
    });
});

describe("その日の最低賃金", () => {
    test("発効日から新しい金額（東京：令和7年度 1,226円は2025年10月3日から、令和8年度 1,280円は2026年10月1日から）", () => {
        expect(minimumWageOn("東京", "2025-10-02")?.amount).toBe(1163);
        expect(minimumWageOn("東京", "2025-10-03")?.amount).toBe(1226);
        expect(minimumWageOn("東京", "2026-09-30")?.amount).toBe(1226);
        expect(minimumWageOn("東京", "2026-10-01")?.amount).toBe(1280);
    });
    test("発効日が年度をまたぐ県（秋田：令和7年度 1,031円は2026年3月31日から）", () => {
        expect(minimumWageOn("秋田", "2026-03-30")?.amount).toBe(951);
        expect(minimumWageOn("秋田", "2026-03-31")?.amount).toBe(1031);
    });
    test("データより前の日・知らない都道府県は null", () => {
        expect(minimumWageOn("東京", "2021-09-30")).toBeNull();
        expect(minimumWageOn("東京都", "2026-10-01")).toBeNull();
        expect(minimumWageOn(null, "2026-10-01")).toBeNull();
    });
    test("次に発効する最低賃金（岩手：2026年10月31日の次は、2026年12月1日から1,090円）", () => {
        expect(nextMinimumWage("岩手", "2026-10-31")).toEqual({ from: "2026-12-01", amount: 1090 });
        expect(nextMinimumWage("東京", "2026-10-31")).toBeNull();
    });
});

describe("基本給を時間あたりにする", () => {
    test("時給はそのまま、日給は1日の所定労働時間で割る", () => {
        expect(baseWagePerHour("hourly", 1200, 8, null)).toBe(1200);
        expect(baseWagePerHour("daily", 9600, 8, null)).toBe(1200);
        expect(baseWagePerHour("daily", 9600, 0, null)).toBeNull();
    });
    test("月給は1年間における1月平均所定労働時間で割る（年245日・1日8時間 → 月163.33時間）", () => {
        const hours = (245 * 8) / 12;
        expect(baseWagePerHour("monthly", 200000, 8, hours)).toBeCloseTo(1224.49, 2);
        expect(baseWagePerHour("monthly", 200000, 8, null)).toBeNull();
    });
    test("基本給が0なら比べない", () => {
        expect(baseWagePerHour("hourly", 0, 8, null)).toBeNull();
    });
});

describe("最低賃金以上か", () => {
    test("東京・2026年10月15日：時給1,280円は以上、1,279円は下回る", () => {
        expect(checkMinimumWage("東京", "2026-10-15", 1280)?.ok).toBe(true);
        expect(checkMinimumWage("東京", "2026-10-15", 1279)?.ok).toBe(false);
    });
    test("月給20万円・月163.33時間（1時間1,224.49円）は、東京の1,226円を下回る", () => {
        const perHour = baseWagePerHour("monthly", 200000, 8, (245 * 8) / 12);
        expect(checkMinimumWage("東京", "2026-03-01", perHour)).toMatchObject({ ok: false, minimum: { amount: 1226 } });
    });
    test("比べられないとき（データなし・時間あたりにできない）は null", () => {
        expect(checkMinimumWage("東京", "2020-04-01", 1000)).toBeNull();
        expect(checkMinimumWage("東京", "2026-10-15", null)).toBeNull();
    });
    test("表示の文", () => {
        expect(describeMinimumWage("東京", { from: "2025-10-03", amount: 1226 })).toBe("東京の最低賃金 1,226円（2025年10月3日から）");
    });
});

describe("1年間の所定労働日数", () => {
    test("曜日で決める（カレンダーパターン0）：2026年の月〜金は261日", () => {
        expect(countAnnualWorkDays(2026, 0, parseWorkDays("mon,tue,wed,thu,fri"), new Set(), {})).toBe(261);
        expect(countAnnualWorkDays(2026, 0, parseWorkDays(""), new Set(), {})).toBe(0);
    });
    test("会社カレンダー：土日と祝日を休みにし、会社の設定で休み（1）・出勤（0）に変える", () => {
        const holidays = new Set(["2026-01-01"]); // 木曜
        expect(countAnnualWorkDays(2026, 1, {}, holidays, {})).toBe(260);
        expect(countAnnualWorkDays(2026, 1, {}, holidays, { "2026-01-03": 0 })).toBe(261); // 土曜を出勤日に
        expect(countAnnualWorkDays(2026, 1, {}, holidays, { "2026-01-02": 1 })).toBe(259); // 金曜を休みに
    });
});

describe("期間の所定労働日数（日割りに使う）", () => {
    const ctx = (o: Partial<Parameters<typeof countPrescribedWorkDays>[0]> = {}) =>
        ({ patternId: 1, workDays: parseWorkDays(""), holidays: new Set<string>(), companyCalendar: {}, ...o });
    test("土日と祝日を休みにし、会社カレンダーで休み・出勤に変えた日を反映する（2026年6月は平日22日）", () => {
        expect(countPrescribedWorkDays(ctx(), "2026-06-01", "2026-06-30")).toBe(22);
        expect(countPrescribedWorkDays(ctx({ companyCalendar: { "2026-06-15": 1 } }), "2026-06-01", "2026-06-30")).toBe(21);
        expect(countPrescribedWorkDays(ctx({ companyCalendar: { "2026-06-13": 0 } }), "2026-06-01", "2026-06-30")).toBe(23);
        expect(countPrescribedWorkDays(ctx({ holidays: new Set(["2026-06-16"]) }), "2026-06-16", "2026-06-30")).toBe(10);
    });
    test("カレンダーパターン0（曜日で決める）は、出勤する曜日の日数。期間が逆なら0", () => {
        expect(countPrescribedWorkDays(ctx({ patternId: 0, workDays: parseWorkDays("mon,wed,fri") }), "2026-06-01", "2026-06-30")).toBe(13);
        expect(countPrescribedWorkDays(ctx(), "2026-06-30", "2026-06-01")).toBe(0);
    });
    test("年をまたぐ期間も数えられる", () => {
        expect(countPrescribedWorkDays(ctx(), "2025-12-29", "2026-01-02")).toBe(5);
    });
});
