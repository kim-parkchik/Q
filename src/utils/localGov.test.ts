/**
 * 市区町村（全国地方公共団体コード）を探す（localGov.ts）のテスト
 * 実行方法: bun test
 *
 * 一覧は総務省「都道府県コード及び市区町村コード」の Excel から自動生成（constants/localGovCodes.ts）
 */
import { describe, expect, test } from "bun:test";
import { findLocalGovByAddress, localGovByCode, localGovLabel, LOCAL_GOVS, PREFECTURE_NAMES } from "./localGov";

describe("一覧", () => {
    test("47都道府県・1,747市区町村（令和6年1月1日現在）", () => {
        expect(PREFECTURE_NAMES).toHaveLength(47);
        expect(LOCAL_GOVS).toHaveLength(1747);
    });
    test("6桁目は検査数字（上5桁に 6・5・4・3・2 を掛けて足し、11で割った余りを11から引いた数の1の位）", () => {
        for (const { code } of LOCAL_GOVS) {
            const sum = [6, 5, 4, 3, 2].reduce((s, w, i) => s + Number(code[i]) * w, 0);
            expect(Number(code[5])).toBe((11 - (sum % 11)) % 10);
        }
    });
    test("政令指定都市は市だけ（区は入れない）。東京都の特別区は区", () => {
        expect(localGovLabel(localGovByCode("141003"))).toBe("神奈川県横浜市");
        expect(LOCAL_GOVS.some((g) => g.name.startsWith("横浜市") && g.name !== "横浜市")).toBe(false);
        expect(localGovLabel(localGovByCode("131016"))).toBe("東京都千代田区");
        expect(localGovByCode("999999")).toBeNull();
    });
});

describe("住所から市区町村を探す", () => {
    const find = (address: string) => localGovLabel(findLocalGovByAddress(address));
    test("都道府県から書いた住所", () => {
        expect(find("東京都千代田区丸の内1-1-1")).toBe("東京都千代田区");
        expect(find("京都府京都市中京区寺町通御池上る")).toBe("京都府京都市");
    });
    test("政令指定都市は、区まで書いてあっても市", () => {
        expect(find("神奈川県横浜市中区日本大通1")).toBe("神奈川県横浜市");
        expect(find("大阪府堺市北区")).toBe("大阪府堺市");
    });
    test("郡は飛ばす", () => {
        expect(find("北海道虻田郡ニセコ町富士見")).toBe("北海道ニセコ町");
        expect(find("山梨県西八代郡市川三郷町")).toBe("山梨県市川三郷町");
    });
    test("いちばん長く一致する名前（市川市・市川三郷町、郡山市・大和郡山市）", () => {
        expect(find("千葉県市川市八幡")).toBe("千葉県市川市");
        expect(find("福島県郡山市朝日")).toBe("福島県郡山市");
        expect(find("奈良県大和郡山市北郡山町")).toBe("奈良県大和郡山市");
    });
    test("ヶとケ、空白の違いはそろえる", () => {
        expect(find("千葉県 鎌ヶ谷市")).toBe("千葉県鎌ケ谷市");
    });
    test("都道府県がない住所は、全国で1つに決まるときだけ", () => {
        expect(find("札幌市中央区北1条西2丁目")).toBe("北海道札幌市");
        expect(find("府中市寿町")).toBe(""); // 東京都と広島県にある
        expect(find("")).toBe("");
        expect(find("どこか")).toBe("");
    });
});
