/**
 * 年間報酬の平均による保険者算定（定時決定）（santeiAnnual.ts）のテスト
 * 実行方法: bun test
 *
 * 出典：厚生労働省 保発第4号 記1(4) https://www.mhlw.go.jp/web/t_doc?dataId=00tb1543&dataType=1&pageNo=1
 *       平成30年3月1日事務連絡 Q&A 別紙2 https://www.mhlw.go.jp/web/t_doc?dataId=00tc3243&dataType=1&pageNo=1
 * 等級表は協会けんぽの保険料額表（令和8年度。Excel から自動生成したデータ）を使う。
 */
import { describe, expect, test } from "bun:test";
import { decideTeiji, type SanteiMonth, type SanteiWorkerKind } from "./santei";
import { buildAnnualEarlierMonths, decideTeijiAnnual, earlierMonthsOf, type AnnualMonth } from "./santeiAnnual";
import { getInsuranceMaster } from "../constants";

const table = getInsuranceMaster(2026, 9).HYOJUN_TABLE;
const m = (month: number, days: number | null, amount: number | null): SanteiMonth => ({ month, days, amount, partialJoin: false });
/** 前年7月〜当年3月の9か月を、同じ日数・報酬で作る（patch で月ごとに変える） */
const earlier = (days: number | null, amount: number | null, patch: Record<string, Partial<AnnualMonth>> = {}): AnnualMonth[] =>
    earlierMonthsOf(2026).map(({ year, month }) => ({
        year, month, days, amount, partialJoin: false, notInsured: false, unfinalized: false,
        ...patch[`${year}-${month}`],
    }));
const judge = (prev: AnnualMonth[], aprJun: SanteiMonth[], kind: SanteiWorkerKind = "general") =>
    decideTeijiAnnual(2026, prev, aprJun, kind, decideTeiji(aprJun, kind, 300000, table), table);

describe("4〜6月の平均と、前年7月〜当年6月の平均を比べる", () => {
    test("4〜6月が繁忙期：4〜6月は34万円（24等級）、1年の平均は27万円で28万円（21等級）→ 3等級の差", () => {
        const r = judge(earlier(30, 250000), [m(4, 30, 330000), m(5, 31, 330000), m(6, 30, 330000)]);
        expect(r.total).toBe(250000 * 9 + 330000 * 3);
        expect(r.average).toBe(270000);
        expect(r).toMatchObject({ status: "target", standard: 280000, grade: 21, gradeDiff: -3, minDays: 17 });
        expect(r.usedMonths).toHaveLength(12);
        expect(r.usedMonths[0]).toBe("2025-07");
        expect(r.usedMonths[11]).toBe("2026-06");
    });
    test("4〜6月が閑散期でも（1年の平均のほうが高くても）2等級以上の差なら対象", () => {
        const r = judge(earlier(30, 400000), [m(4, 30, 250000), m(5, 31, 250000), m(6, 30, 250000)]);
        expect(r.average).toBe(362500);
        expect(r).toMatchObject({ status: "target", standard: 360000, gradeDiff: 5 });
    });
    test("差が1等級なら対象にならない（32万円・23等級と、30万5千円・22等級）", () => {
        const r = judge(earlier(30, 300000), [m(4, 30, 320000), m(5, 31, 320000), m(6, 30, 320000)]);
        expect(r.average).toBe(305000);
        expect(r).toMatchObject({ status: "small", gradeDiff: -1 });
    });
    test("1円未満は切り捨てる", () => {
        const r = judge(earlier(30, 250001), [m(4, 30, 330000), m(5, 31, 330000), m(6, 30, 330000)]);
        expect(r.total).toBe(3240009);
        expect(r.average).toBe(270000);
    });
});

describe("平均に入れる月（Q&A 別紙2 Q7・Q12・Q15）", () => {
    test("17日未満の月・給与がない月・途中入社の月・社会保険に入っていない月は入れない", () => {
        const prev = earlier(30, 250000, {
            "2025-7": { notInsured: true, amount: null, days: null },
            "2025-8": { partialJoin: true, amount: 100000, days: 20 },
            "2025-9": { days: 16 },
            "2025-10": { amount: null, days: null },
        });
        const r = judge(prev, [m(4, 30, 330000), m(5, 31, 330000), m(6, 30, 330000)]);
        expect(r.usedMonths).toEqual(["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]);
        expect(r.average).toBe(Math.floor((250000 * 5 + 330000 * 3) / 8));
    });
    test("4〜6月で使わなかった月（17日未満）は、1年の平均にも入れない", () => {
        const r = judge(earlier(30, 250000), [m(4, 10, 100000), m(5, 31, 330000), m(6, 30, 330000)]);
        expect(r.usedMonths).not.toContain("2026-04");
        expect(r.total).toBe(250000 * 9 + 330000 * 2);
    });
    test("パートで4〜6月を15日以上の月で平均した人は、前年7月〜当年3月も15日以上の月を入れる", () => {
        const prev = earlier(15, 100000, { "2025-7": { days: 14 } });
        const r = judge(prev, [m(4, 16, 150000), m(5, 15, 150000), m(6, 15, 150000)], "part");
        expect(r.minDays).toBe(15);
        expect(r.usedMonths).toHaveLength(11);
        expect(r.usedMonths).not.toContain("2025-07");
    });
    test("パートでも、4〜6月に17日以上の月があれば17日以上の月だけ", () => {
        const prev = earlier(16, 100000);
        const r = judge(prev, [m(4, 17, 150000), m(5, 15, 150000), m(6, 15, 150000)], "part");
        expect(r.minDays).toBe(17);
        expect(r.status).toBe("no_earlier");
    });
    test("特定適用事業所の短時間労働者は11日以上の月", () => {
        const r = judge(earlier(11, 100000, { "2025-7": { days: 10 } }), [m(4, 12, 100000), m(5, 11, 100000), m(6, 11, 100000)], "short");
        expect(r.minDays).toBe(11);
        expect(r.usedMonths).toHaveLength(11);
    });
    test("前年7月〜当年3月に入れる月が1か月もなければ対象にならない（4〜5月に入社した人など）", () => {
        const r = judge(earlier(null, null), [m(4, null, null), m(5, 31, 330000), m(6, 30, 330000)]);
        expect(r).toMatchObject({ status: "no_earlier", average: null, standard: null });
    });
    test("前年7月〜当年3月に入れる月が1か月あれば対象になりうる（入社1年未満でもよい）", () => {
        const prev = earlier(null, null, { "2026-3": { days: 31, amount: 200000 } });
        const r = judge(prev, [m(4, 30, 330000), m(5, 31, 330000), m(6, 30, 330000)]);
        expect(r.usedMonths).toEqual(["2026-03", "2026-04", "2026-05", "2026-06"]);
        expect(r.average).toBe(297500);
        expect(r.status).toBe("target");
    });
    test("4〜6月に入れる月がなく従前のままになる人は対象にならない（Q8）", () => {
        const r = judge(earlier(30, 250000), [m(4, 16, 100000), m(5, 16, 100000), m(6, 16, 100000)]);
        expect(r).toMatchObject({ status: "keep", average: null });
    });
});

describe("上限・下限の等級は、1等級の差でも対象になることがある（Q&A 別紙2 Q16）", () => {
    test("健康保険①：片方が141.5万円以上、もう片方が129.5万円以上135.5万円未満", () => {
        const r = judge(earlier(30, 1260000), [m(4, 30, 1420000), m(5, 31, 1420000), m(6, 30, 1420000)]);
        expect(r.average).toBe(1300000);
        expect(r).toMatchObject({ status: "target", grade: 49, gradeDiff: -2 });
    });
    test("健康保険①：4〜6月が141.5万円未満なら、1等級の差では対象にならない", () => {
        const r = judge(earlier(30, 1260000), [m(4, 30, 1410000), m(5, 31, 1410000), m(6, 30, 1410000)]);
        expect(r.average).toBe(1297500);
        expect(r).toMatchObject({ status: "small", grade: 49, gradeDiff: -1 });
    });
    test("健康保険②：片方が5.3万円未満、もう片方が6.3万円以上7.3万円未満", () => {
        const r = judge(earlier(30, 68000), [m(4, 30, 52000), m(5, 31, 52000), m(6, 30, 52000)]);
        expect(r.average).toBe(64000);
        expect(r).toMatchObject({ status: "target", grade: 2, gradeDiff: 2 });
    });
    test("健康保険②：4〜6月が5.3万円以上なら、1等級の差では対象にならない", () => {
        const r = judge(earlier(30, 68000), [m(4, 30, 54000), m(5, 31, 54000), m(6, 30, 54000)]);
        expect(r).toMatchObject({ status: "small", gradeDiff: 1 });
    });
});

describe("前年7月〜当年3月の値を、確定した給与と勤怠から作る", () => {
    const endOfMonth = { id: 1, closing_day: 99, is_next_month: 0 }; // 末締め・当月払い
    const salary = (target_year: number, target_month: number, total_earnings: number) =>
        ({ staff_id: "A", target_year, target_month, total_earnings });
    const staff = { id: "A", wage_type: "monthly", standard_remuneration: 300000, join_date: "2025-10-15", payroll_group_id: 1 };

    test("前年7月から当年3月までの9か月。入社前の月は入れず、入社した月は途中入社、未確定の月は知らせる", () => {
        const salaries = [salary(2025, 10, 150000), salary(2025, 11, 300000), salary(2025, 12, 300000),
            salary(2026, 1, 300000), salary(2026, 3, 300000), salary(2026, 4, 999999)];
        const months = buildAnnualEarlierMonths(staff, 2026, endOfMonth, salaries, []);
        expect(months.map((x) => `${x.year}-${x.month}`)).toEqual(
            ["2025-7", "2025-8", "2025-9", "2025-10", "2025-11", "2025-12", "2026-1", "2026-2", "2026-3"]);
        expect(months[0]).toMatchObject({ amount: null, notInsured: true, unfinalized: false });
        expect(months[3]).toMatchObject({ amount: 150000, days: 31, partialJoin: true, notInsured: false });
        expect(months[4]).toMatchObject({ amount: 300000, days: 30, partialJoin: false, notInsured: false });
        expect(months[7]).toMatchObject({ amount: null, unfinalized: true });
    });
    test("標準報酬月額の履歴で社会保険に入っていない月は入れない", () => {
        const history = JSON.stringify([
            { from: "", amount: 0, reason: "shutoku" },
            { from: "2025-12", amount: 200000, reason: "shutoku" },
        ]);
        const months = buildAnnualEarlierMonths(
            { ...staff, join_date: "2020-04-01", standard_remuneration_history: history }, 2026, endOfMonth,
            [salary(2025, 11, 200000), salary(2025, 12, 200000)], []);
        expect(months[4]).toMatchObject({ month: 11, amount: 200000, notInsured: true });
        expect(months[5]).toMatchObject({ month: 12, amount: 200000, notInsured: false });
    });
});
