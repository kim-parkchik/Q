/**
 * 通勤手当の非課税限度額（utils/commuteAllowance.ts と、国税庁の資料から作った constants/tax/commuteLimits.ts）のテスト
 * 期待値は、国税庁「通勤手当の非課税限度額の改正に関するＱ＆Ａ」（令和8年4月）の計算例（ケースＡ〜Ｅ・Ｑ４－２）
 * 実行方法: bun test
 */
import { describe, expect, test } from "bun:test";
import {
    commuteLimitOf, commuteLimitPeriodOf, describeCommuteLimit, nonTaxableCommuteOf, parseCommuteSetting, stringifyCommuteSetting,
    DEFAULT_COMMUTE_SETTING, type CommuteSetting,
} from "./commuteAllowance";
import { COMMUTE_LIMIT_PERIODS } from "../constants/tax/commuteLimits";

const vehicle = (o: Partial<CommuteSetting>): CommuteSetting => ({ ...DEFAULT_COMMUTE_SETTING, method: "vehicle", ...o });

describe("国税庁のＱ＆Ａ（令和8年4月）の計算例と同じになる（令和8年4月以後に支払う通勤手当）", () => {
    test("ケースＡ：片道50km・駐車場8,000円、支給40,300円 → 限度額37,300円（駐車場は5,000円まで）、3,000円が課税", () => {
        const s = vehicle({ distanceKm: 50, parking: 8000 });
        expect(commuteLimitOf(s, 2026, 4)).toEqual({ limit: 37300, distanceLimit: 32300, parkingAddition: 5000, capped: false });
        expect(40300 - nonTaxableCommuteOf(40300, s, 2026, 4)).toBe(3000);
    });
    test("ケースＢ：支給36,000円は限度額37,300円を下回るので、全額非課税", () => {
        expect(nonTaxableCommuteOf(36000, vehicle({ distanceKm: 50, parking: 8000 }), 2026, 4)).toBe(36000);
    });
    test("ケースＣ：駐車場4,400円、支給37,400円 → 限度額36,700円、700円が課税", () => {
        const s = vehicle({ distanceKm: 50, parking: 4400 });
        expect(commuteLimitOf(s, 2026, 4).limit).toBe(36700);
        expect(37400 - nonTaxableCommuteOf(37400, s, 2026, 4)).toBe(700);
    });
    test("ケースＤ：区分せずに35,000円を支給 → 限度額36,700円を下回るので、全額非課税", () => {
        expect(nonTaxableCommuteOf(35000, vehicle({ distanceKm: 50, parking: 4400 }), 2026, 4)).toBe(35000);
    });
    test("ケースＥ：定期代115,000円＋片道50km＋駐車場4,000円、支給151,300円 → 最高限度150,000円、1,300円が課税", () => {
        const s: CommuteSetting = { ...DEFAULT_COMMUTE_SETTING, method: "both", distanceKm: 50, transitFare: 115000, parking: 4000 };
        expect(commuteLimitOf(s, 2026, 4)).toEqual({ limit: 150000, distanceLimit: 32300, parkingAddition: 4000, capped: true });
        expect(151300 - nonTaxableCommuteOf(151300, s, 2026, 4)).toBe(1300);
    });
    test("Ｑ４－２：会社が負担した駐車場代6,000円も通勤手当として計算 → 支給38,300円、限度額37,300円、1,000円が課税", () => {
        expect(38300 - nonTaxableCommuteOf(38300, vehicle({ distanceKm: 50, parking: 6000 }), 2026, 4)).toBe(1000);
    });
    test("Ｑ３－４：片道2km未満の人は、駐車場等の料金も非課税にならない（全額課税）", () => {
        expect(commuteLimitOf(vehicle({ distanceKm: 1.5, parking: 3000 }), 2026, 4).limit).toBe(0);
    });
});

describe("どの期間の表を使うか（給与を支払う年月で選ぶ）", () => {
    test("令和8年4月から：片道65km以上の段が増え、駐車場等の料金を足せる", () => {
        expect(commuteLimitPeriodOf(2026, 4).from).toBe("2026-04-01");
        expect(commuteLimitPeriodOf(2026, 4).parkingAdditionMax).toBe(5000);
        expect(commuteLimitPeriodOf(2026, 4).distanceBands.at(-1)).toEqual({ fromKm: 95, toKm: null, limit: 66400 });
    });
    test("令和8年3月までは令和7年の表：駐車場等の料金は足さず、55km以上はひとまとめ", () => {
        const p = commuteLimitPeriodOf(2026, 3);
        expect(p.from).toBe("2025-04-01");
        expect(p.parkingAdditionMax).toBeNull();
        expect(commuteLimitOf(vehicle({ distanceKm: 50, parking: 8000 }), 2026, 3).limit).toBe(32300);
        expect(commuteLimitOf(vehicle({ distanceKm: 100 }), 2026, 3).limit).toBe(38700);
        expect(commuteLimitOf(vehicle({ distanceKm: 100 }), 2026, 4).limit).toBe(66400);
    });
    test("令和7年3月までは改正前の表（片道10km以上15km未満は 7,100円 → 令和7年4月から 7,300円）", () => {
        expect(commuteLimitOf(vehicle({ distanceKm: 12 }), 2025, 3).limit).toBe(7100);
        expect(commuteLimitOf(vehicle({ distanceKm: 12 }), 2025, 4).limit).toBe(7300);
        expect(commuteLimitPeriodOf(2020, 1).from).toBe("");
    });
    test("表は国税庁の資料から自動で作ったもの（3期間・区分は0kmから切れ目なく、2km未満は全額課税）", () => {
        expect(COMMUTE_LIMIT_PERIODS.map((p) => p.from)).toEqual(["", "2025-04-01", "2026-04-01"]);
        for (const p of COMMUTE_LIMIT_PERIODS) {
            expect(p.maxPerMonth).toBe(150000);
            expect(p.distanceBands[0]).toEqual({ fromKm: 0, toKm: 2, limit: 0 });
            p.distanceBands.slice(1).forEach((b, i) => expect(b.fromKm).toBe(p.distanceBands[i].toKm as number));
        }
    });
});

describe("通勤の方法ごとの限度額", () => {
    test("電車・バスなどだけ：支給額を最高限度15万円まで非課税（これまでの計算と同じ）", () => {
        expect(nonTaxableCommuteOf(30000, DEFAULT_COMMUTE_SETTING, 2026, 6)).toBe(30000);
        expect(nonTaxableCommuteOf(200000, DEFAULT_COMMUTE_SETTING, 2026, 6)).toBe(150000);
    });
    test("マイカーなどで有料道路も使う：距離の区分の額＋有料道路の料金（最高限度15万円）", () => {
        expect(commuteLimitOf(vehicle({ distanceKm: 20, toll: 10000 }), 2026, 6).limit).toBe(13500 + 10000);
    });
    test("両方で、マイカーなどの距離が2km未満：電車・バスなどの運賃等だけ（距離の区分の額・駐車場等は足さない）", () => {
        const s: CommuteSetting = { ...DEFAULT_COMMUTE_SETTING, method: "both", distanceKm: 1.2, transitFare: 9000, parking: 3000 };
        expect(commuteLimitOf(s, 2026, 6).limit).toBe(9000);
    });
    test("距離の区分の境目：10kmちょうどは「10km以上15km未満」", () => {
        expect(commuteLimitOf(vehicle({ distanceKm: 9.9 }), 2026, 6).limit).toBe(4200);
        expect(commuteLimitOf(vehicle({ distanceKm: 10 }), 2026, 6).limit).toBe(7300);
        expect(commuteLimitOf(vehicle({ distanceKm: 2 }), 2026, 6).limit).toBe(4200);
        expect(commuteLimitOf(vehicle({ distanceKm: 1.99 }), 2026, 6).limit).toBe(0);
    });
    test("説明の文", () => {
        expect(describeCommuteLimit(vehicle({ distanceKm: 50, parking: 8000 }), 2026, 4))
            .toBe("マイカー・自転車など：片道50km 32,300円 ＋ 駐車場等 5,000円 ＝ 37,300円");
        expect(describeCommuteLimit(DEFAULT_COMMUTE_SETTING, 2026, 4)).toBe("電車・バスなど：支給額を最高限度 150,000円 まで");
    });
});

describe("保存（従業員の commute_setting）", () => {
    test("空・壊れているときは、電車・バスなどだけ（いまの会社ファイルの人は、これまでどおりの計算）", () => {
        expect(parseCommuteSetting(null)).toEqual(DEFAULT_COMMUTE_SETTING);
        expect(parseCommuteSetting("{壊れた")).toEqual(DEFAULT_COMMUTE_SETTING);
    });
    test("保存して読み直すと同じ（知らない方法は電車・バスなど、負の数は0）", () => {
        const s: CommuteSetting = { method: "both", distanceKm: 12.5, transitFare: 9000, toll: 0, parking: 3000 };
        expect(parseCommuteSetting(stringifyCommuteSetting(s))).toEqual(s);
        expect(parseCommuteSetting(JSON.stringify({ method: "taxi", distanceKm: -3 }))).toEqual(DEFAULT_COMMUTE_SETTING);
    });
});
