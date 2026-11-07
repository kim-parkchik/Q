/**
 * 従業員の拠点の都道府県（branchPrefecture.ts）のテスト
 * 実行方法: bun test
 */
import { describe, expect, test } from "bun:test";
import { branchPrefectureOf } from "./branchPrefecture";

const branches = [
    { id: 1, name: "本店", prefecture: "東京都" },
    { id: 2, name: "大阪支店", prefecture: "大阪" },
    { id: 3, name: "名古屋営業所", prefecture: "" },
    { id: 4, name: "札幌出張所", prefecture: "Hokkaido" },
];

describe("拠点の都道府県", () => {
    test("保険料率と同じ書き方にする（東京都 → 東京、大阪 → 大阪）", () => {
        expect(branchPrefectureOf(branches, 1)).toEqual({ prefecture: "東京", problem: null });
        expect(branchPrefectureOf(branches, 2)).toEqual({ prefecture: "大阪", problem: null });
    });
    test("拠点を選んでいない人は本店（番号 1）", () => {
        for (const id of [null, undefined, 0, ""]) {
            expect(branchPrefectureOf(branches, id).prefecture).toBe("東京");
        }
    });
    test("都道府県が登録されていない・読み取れない・拠点が見つからないときは null（京都などで仮に計算しない）", () => {
        expect(branchPrefectureOf(branches, 3)).toEqual({
            prefecture: null,
            problem: "拠点「名古屋営業所」の都道府県が登録されていません。会社の設定で、拠点の都道府県を登録してください。",
        });
        expect(branchPrefectureOf(branches, 4)).toEqual({
            prefecture: null,
            problem: "拠点「札幌出張所」の都道府県（Hokkaido）を読み取れません。会社の設定で、拠点の都道府県を選び直してください。",
        });
        expect(branchPrefectureOf(branches, 9)).toEqual({
            prefecture: null,
            problem: "この人の拠点（番号 9）が見つかりません。従業員の設定で拠点を選び直してください。",
        });
        expect(branchPrefectureOf([], null).prefecture).toBeNull();
    });
});
