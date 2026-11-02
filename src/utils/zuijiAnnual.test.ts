/**
 * 年間報酬の平均による保険者算定（随時改定）（zuijiAnnual.ts）のテスト
 * 実行方法: bun test
 *
 * 出典：厚生労働省 保発第4号 記2(4)(5) https://www.mhlw.go.jp/web/t_doc?dataId=00tb1543&dataType=1&pageNo=1
 *       平成30年3月1日事務連絡 Q&A 別紙1 https://www.mhlw.go.jp/web/t_doc?dataId=00tc3243&dataType=1&pageNo=1
 * 等級表は協会けんぽの保険料額表（令和8年度。Excel から自動生成したデータ）を使う。
 */
import { describe, expect, test } from "bun:test";
import { judgeZuiji, type ZuijiDirection } from "./zuiji";
import { buildZuijiAnnualMonths, judgeZuijiAnnual, monthsBeforeChange, type ZuijiAnnualMonth } from "./zuijiAnnual";
import { getInsuranceMaster } from "../constants";

const table = getInsuranceMaster(2026, 7).HYOJUN_TABLE;

/** 2026年4月が変動月。前の9か月（2025年7月〜2026年3月）と、4〜6月 */
const months = (
  before: { fixed: number; nonFixed: number | null },
  after: { fixed: number; nonFixed: number | null },
  patch: Record<string, Partial<ZuijiAnnualMonth>> = {},
): ZuijiAnnualMonth[] => {
  const make = (year: number, month: number, v: { fixed: number; nonFixed: number | null }): ZuijiAnnualMonth => ({
    year, month, days: 30, amount: v.fixed + (v.nonFixed ?? 0), nonFixed: v.nonFixed,
    partialJoin: false, notInsured: false, unfinalized: false, ...patch[`${year}-${month}`],
  });
  return [
    ...monthsBeforeChange(2026, 4).map(({ year, month }) => make(year, month, before)),
    ...[4, 5, 6].map((month) => make(2026, month, after)),
  ];
};
const judge = (ms: ZuijiAnnualMonth[], previous: number, direction: ZuijiDirection = "up", short = false) => {
  const ordinary = judgeZuiji(ms.slice(9), short, previous, direction, table);
  return { ordinary, annual: judgeZuijiAnnual(ms, short, direction, ordinary, table) };
};

describe("年間平均額 ＝ 変動月から3か月の固定的賃金の平均 ＋ 12か月の非固定的賃金の平均", () => {
    test("4月に昇給（30万→32万）、4〜6月は例年の繁忙期で残業代6万円（ほかの月は1万円）", () => {
        const { ordinary, annual } = judge(months({ fixed: 300000, nonFixed: 10000 }, { fixed: 320000, nonFixed: 60000 }), 300000);
        // 通常の随時改定：38万円の平均で38万円（26等級）。従前30万円（22等級）から4等級
        expect(ordinary).toMatchObject({ status: "target", average: 380000, grade: 26 });
        expect(annual.fixedTotal).toBe(960000);
        expect(annual.fixedAverage).toBe(320000);
        expect(annual.nonFixedTotal).toBe(10000 * 9 + 60000 * 3);
        expect(annual.nonFixedAverage).toBe(22500);
        expect(annual).toMatchObject({
            status: "target", average: 342500, standard: 340000, grade: 24, gradeDiffFromOrdinary: -2, gradeDiffFromPrevious: 2,
        });
        expect(annual.usedMonths).toHaveLength(12);
    });
    test("1円未満は、固定的賃金・非固定的賃金のそれぞれの月平均額で切り捨てる", () => {
        const ms = months({ fixed: 300000, nonFixed: 10001 }, { fixed: 320001, nonFixed: 60000 }, { "2026-6": { amount: 380002 } });
        const { annual } = judge(ms, 300000);
        expect(annual.fixedTotal).toBe(320001 * 2 + 320002);
        expect(annual.fixedAverage).toBe(320001);
        expect(annual.nonFixedAverage).toBe(Math.floor((10001 * 9 + 60000 * 3) / 12));
        expect(annual.average).toBe(320001 + 22500);
    });
    test("年間平均の等級が従前と1等級の差でも、昇給の向きなら改定する（記2(5)）", () => {
        // 30万2千円に昇給。3か月の平均36万2千円（25等級）、年間平均32万4,500円（23等級）、従前30万円（22等級）
        const { annual } = judge(months({ fixed: 300000, nonFixed: 10000 }, { fixed: 302000, nonFixed: 60000 }), 300000);
        expect(annual).toMatchObject({ status: "target", standard: 320000, gradeDiffFromOrdinary: -2, gradeDiffFromPrevious: 1 });
    });
    test("昇給なのに年間平均の等級が従前と同じなら、申し立てると改定しない（記2(5)ただし書）", () => {
        // 従前32万円（23等級）。3か月の平均36万5千円（25等級）、年間平均32万7,500円（23等級）
        const { ordinary, annual } = judge(months({ fixed: 300000, nonFixed: 10000 }, { fixed: 305000, nonFixed: 60000 }), 320000);
        expect(ordinary.status).toBe("target");
        expect(annual).toMatchObject({ status: "keep", average: 327500, grade: 23, gradeDiffFromPrevious: 0 });
    });
    test("降給で、4〜6月が例年の閑散期（残業なし）：年間平均の等級が従前より下なら改定する", () => {
        // 従前38万円（26等級）。32万→30万に降給。3か月の平均30万円（22等級）、年間平均34万5千円（24等級）
        const { ordinary, annual } = judge(months({ fixed: 320000, nonFixed: 60000 }, { fixed: 300000, nonFixed: 0 }), 380000, "down");
        expect(ordinary).toMatchObject({ status: "target", grade: 22 });
        expect(annual).toMatchObject({ status: "target", average: 345000, standard: 340000, gradeDiffFromOrdinary: 2, gradeDiffFromPrevious: -2 });
    });
    test("3か月の平均と年間平均の差が1等級なら、年間平均にはできない", () => {
        const { annual } = judge(months({ fixed: 300000, nonFixed: 30000 }, { fixed: 320000, nonFixed: 40000 }), 300000);
        expect(annual.status).toBe("small");
        expect(Math.abs(annual.gradeDiffFromOrdinary!)).toBeLessThan(2);
    });
    test("通常の随時改定に当たらなければ、年間平均も使えない", () => {
        const { ordinary, annual } = judge(months({ fixed: 300000, nonFixed: 10000 }, { fixed: 305000, nonFixed: 10000 }), 300000);
        expect(ordinary.status).toBe("small");
        expect(annual).toMatchObject({ status: "not_zuiji", average: null });
    });
});

describe("平均に入れる月（Q&A 別紙1 Q7・Q8・Q11）", () => {
    test("17日未満の月・途中入社の月・資格を取得する前の月・給与がない月は、非固定的賃金の平均に入れない", () => {
        const ms = months({ fixed: 300000, nonFixed: 10000 }, { fixed: 320000, nonFixed: 60000 }, {
            "2025-7": { amount: null, days: null, nonFixed: null, notInsured: true },
            "2025-8": { partialJoin: true, nonFixed: 90000 },
            "2025-9": { days: 16, nonFixed: 90000 },
            "2025-10": { amount: null, days: null, nonFixed: null },
        });
        const { annual } = judge(ms, 300000);
        expect(annual.usedMonths).toEqual(["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]);
        expect(annual.nonFixedTotal).toBe(10000 * 5 + 60000 * 3);
        expect(annual.nonFixedAverage).toBe(28750);
    });
    test("特定適用事業所の短時間労働者は11日以上の月", () => {
        const ms = months({ fixed: 150000, nonFixed: 5000 }, { fixed: 170000, nonFixed: 40000 }, {
            "2025-7": { days: 10 }, "2026-4": { days: 11 }, "2026-5": { days: 11 }, "2026-6": { days: 12 },
        });
        const { annual } = judge(ms, 150000, "up", true);
        expect(annual.minDays).toBe(11);
        expect(annual.usedMonths).toHaveLength(11);
    });
    test("変動月の前の9か月に入れる月がなければ対象にならない（1か月あればよい）", () => {
        const none = months({ fixed: 0, nonFixed: null }, { fixed: 320000, nonFixed: 60000 },
            Object.fromEntries(monthsBeforeChange(2026, 4).map(({ year, month }) => [`${year}-${month}`, { amount: null, days: null }])));
        expect(judge(none, 300000).annual.status).toBe("no_earlier");
        const one = months({ fixed: 0, nonFixed: null }, { fixed: 320000, nonFixed: 60000 }, {
            ...Object.fromEntries(monthsBeforeChange(2026, 4).map(({ year, month }) => [`${year}-${month}`, { amount: null, days: null }])),
            "2026-3": { amount: 310000, days: 31, nonFixed: 10000 },
        });
        const { annual } = judge(one, 300000);
        expect(annual.usedMonths).toEqual(["2026-03", "2026-04", "2026-05", "2026-06"]);
        expect(annual.nonFixedAverage).toBe(47500);
    });
    test("平均に入れる月の非固定的賃金がわからなければ、入れてもらう", () => {
        const ms = months({ fixed: 300000, nonFixed: 10000 }, { fixed: 320000, nonFixed: 60000 }, { "2025-11": { nonFixed: null } });
        expect(judge(ms, 300000).annual).toMatchObject({ status: "split_missing", average: null });
        // 平均に入れない月（17日未満）なら、わからなくてもよい
        const ok = months({ fixed: 300000, nonFixed: 10000 }, { fixed: 320000, nonFixed: 60000 }, { "2025-11": { nonFixed: null, days: 10 } });
        expect(judge(ok, 300000).annual.status).toBe("target");
    });
    test("非固定的賃金が報酬より多く入っていたら、報酬の額までにする", () => {
        const ms = months({ fixed: 300000, nonFixed: 10000 }, { fixed: 320000, nonFixed: 60000 }, { "2026-4": { nonFixed: 999999 } });
        const { annual } = judge(ms, 300000);
        expect(annual.fixedTotal).toBe(0 + 320000 * 2);
    });
});

describe("12か月の値を、確定した給与から作る", () => {
    const endOfMonth = { id: 1, closing_day: 99, is_next_month: 0 };
    const staff = { id: "A", wage_type: "monthly", standard_remuneration: 300000, join_date: "2020-04-01", payroll_group_id: 1 };
    test("変動月の9か月前から、変動月から3か月目まで。非固定的賃金がない給与（DB v13 より前）は null", () => {
        const salaries = [
            { staff_id: "A", target_year: 2025, target_month: 7, total_earnings: 310000, non_fixed_earnings: 10000 },
            { staff_id: "A", target_year: 2025, target_month: 8, total_earnings: 310000, non_fixed_earnings: null },
            { staff_id: "A", target_year: 2026, target_month: 6, total_earnings: 380000, non_fixed_earnings: 60000 },
        ];
        const ms = buildZuijiAnnualMonths(staff, 2026, 4, endOfMonth, salaries, []);
        expect(ms.map((m) => `${m.year}-${m.month}`)).toEqual([
            "2025-7", "2025-8", "2025-9", "2025-10", "2025-11", "2025-12", "2026-1", "2026-2", "2026-3", "2026-4", "2026-5", "2026-6",
        ]);
        expect(ms[0]).toMatchObject({ amount: 310000, days: 31, nonFixed: 10000 });
        expect(ms[1]).toMatchObject({ amount: 310000, nonFixed: null });
        expect(ms[2]).toMatchObject({ amount: null, nonFixed: null, unfinalized: true });
        expect(ms[11]).toMatchObject({ amount: 380000, nonFixed: 60000 });
    });
});
