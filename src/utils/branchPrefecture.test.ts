/**
 * 従業員の拠点の都道府県（branchPrefecture.ts）のテスト
 * 実行方法: bun test
 */
import { describe, expect, test } from "bun:test";
import { branchPrefectureOf, isSeparateShahoOffice, kenpoPrefectureOf } from "./branchPrefecture";

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

describe("協会けんぽの健康保険料率の都道府県（その人が入っている社会保険の適用事業所の都道府県。健康保険法160条）", () => {
    const withOffices = [
        { id: 1, name: "本店", prefecture: "東京都", health_ins_num: "" },
        { id: 2, name: "大阪支店", prefecture: "大阪", health_ins_num: null },
        { id: 3, name: "福岡支店", prefecture: "福岡", health_ins_num: " 01-ハイフ " },
        { id: 4, name: "名古屋営業所", prefecture: "愛知", health_ins_num: "  " },
    ];
    test("支店に社会保険番号がなければ、本店の適用事業所に入っている人として本店の都道府県（働く場所の都道府県は支店のまま）", () => {
        expect(kenpoPrefectureOf(withOffices, 2)).toEqual({ prefecture: "東京", problem: null, officeBranchId: 1, separate: false });
        expect(kenpoPrefectureOf(withOffices, 4).prefecture).toBe("東京");
        expect(branchPrefectureOf(withOffices, 2).prefecture).toBe("大阪");
    });
    test("社会保険番号が入っている支店は、本店とは別の適用事業所なので、その支店の都道府県", () => {
        expect(kenpoPrefectureOf(withOffices, 3)).toEqual({ prefecture: "福岡", problem: null, officeBranchId: 3, separate: true });
        expect(withOffices.filter(isSeparateShahoOffice).map((b) => b.name)).toEqual(["福岡支店"]);
    });
    test("本店で働く人・拠点を選んでいない人は本店。本店の都道府県がわからなければ null（ほかの都道府県で仮に計算しない）", () => {
        expect(kenpoPrefectureOf(withOffices, 1).prefecture).toBe("東京");
        expect(kenpoPrefectureOf(withOffices, null).prefecture).toBe("東京");
        expect(kenpoPrefectureOf([{ id: 1, name: "本店", prefecture: "" }, { id: 2, name: "大阪支店", prefecture: "大阪" }], 2)).toEqual({
            prefecture: null,
            problem: "拠点「本店」の都道府県が登録されていません。会社の設定で、拠点の都道府県を登録してください。",
            officeBranchId: 1, separate: false,
        });
        expect(kenpoPrefectureOf(withOffices, 9).prefecture).toBeNull();
    });
});
