/**
 * 標準報酬月額の履歴（standardRemuneration.ts）のテスト
 * 実行方法: bun test
 *
 * 出典：日本年金機構 https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/20121017.html （定時決定は9月分から）
 *       https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/20150515-02.html （随時改定は4か月目の分から）
 */
import { describe, expect, test } from "bun:test";
import {
    getStandardRemuneration, latestStandardRemuneration, parseRemunerationHistory, remunerationHistoryOf,
    stringifyRemunerationHistory, validateRemunerationHistory, type RemunerationEntry,
} from "./standardRemuneration";

const history: RemunerationEntry[] = [
    { from: "", amount: 280000, reason: "shutoku" },
    { from: "2025-09", amount: 300000, reason: "teiji" },
    { from: "2026-07", amount: 360000, reason: "zuiji" },
];
const staff = { standard_remuneration: 360000, standard_remuneration_history: stringifyRemunerationHistory(history) };

describe("その月の分の標準報酬月額", () => {
    test("その月までに始まった、いちばん新しい行の金額を使う", () => {
        expect(getStandardRemuneration(staff, 2025, 8)).toBe(280000);
        expect(getStandardRemuneration(staff, 2025, 9)).toBe(300000); // 定時決定は9月分から
        expect(getStandardRemuneration(staff, 2026, 6)).toBe(300000);
        expect(getStandardRemuneration(staff, 2026, 7)).toBe(360000); // 4月に昇給 → 7月分から（随時改定）
        expect(getStandardRemuneration(staff, 2030, 1)).toBe(360000);
    });
    test("最初の行は「入社したときから」なので、どんなに前の月でも使う", () => {
        expect(getStandardRemuneration(staff, 2020, 1)).toBe(280000);
    });
    test("履歴がまだない人（以前の会社ファイル）は、今の標準報酬月額をずっと使う", () => {
        const old = { standard_remuneration: 300000, join_date: "2024-04-01" };
        expect(getStandardRemuneration(old, 2024, 4)).toBe(300000);
        expect(getStandardRemuneration(old, 2026, 9)).toBe(300000);
        expect(remunerationHistoryOf(old)).toEqual([{ from: "", amount: 300000, reason: "shutoku" }]);
        expect(getStandardRemuneration({}, 2026, 6)).toBe(0);
    });
    test("いちばん新しい標準報酬月額（従業員一覧などで使う）", () => {
        expect(latestStandardRemuneration(history)).toBe(360000);
        expect(latestStandardRemuneration([])).toBe(0);
    });
});

describe("入力と保存", () => {
    test("保存すると適用開始月の順に並び、読み直すと同じになる", () => {
        const shuffled = [history[2], history[0], history[1]];
        expect(parseRemunerationHistory(stringifyRemunerationHistory(shuffled))).toEqual(history);
    });
    test("空・壊れた JSON は履歴なし、知らない理由は「その他」として読む", () => {
        expect(parseRemunerationHistory(null)).toEqual([]);
        expect(parseRemunerationHistory("")).toEqual([]);
        expect(parseRemunerationHistory("[")).toEqual([]);
        expect(parseRemunerationHistory('[{"from":"2026-09","amount":300000,"reason":"xxx"}]'))
            .toEqual([{ from: "2026-09", amount: 300000, reason: "other" }]);
    });
    test("2件目から「何年何月分から」が空・同じ月が2回あるときは、入力の誤り", () => {
        expect(validateRemunerationHistory(history)).toBeNull();
        expect(validateRemunerationHistory([...history, { from: "", amount: 0, reason: "other" }])).not.toBeNull();
        expect(validateRemunerationHistory([...history, { from: "2026-07", amount: 380000, reason: "other" }])).not.toBeNull();
    });
});
