/**
 * マイナンバー（myNumber.ts）のテスト
 * 実行方法: bun test
 *
 * 検査用数字は、総務省令（平成26年総務省令第85号）第5条の算式を手で計算した値と比べる。
 */
import { describe, expect, test } from "bun:test";
import { buildMyNumberList, familyKey, formatMyNumber, myNumberCheckDigit, myNumberError, normalizeMyNumber, SELF_KEY } from "./myNumber";
import { emptyDeclaration, type NenchoDeclaration } from "./nenchoDeclaration";

describe("検査用数字（12桁目）", () => {
  test("12345678901 → 8", () => {
    // 下の桁から 1,0,9,8,7,6,5,4,3,2,1 に、2,3,4,5,6,7,2,3,4,5,6 を掛けて足すと 212。212 を11で割った余りは3。11−3＝8
    expect(myNumberCheckDigit("12345678901")).toBe(8);
  });
  test("11で割った余りが0か1なら0", () => {
    expect(myNumberCheckDigit("00000000000")).toBe(0); // 余り0
    expect(myNumberCheckDigit("00000000006")).toBe(0); // 6×2＝12、余り1
  });
  test("7桁目からは掛ける数が n−5", () => {
    // 7桁目（上から5桁目）だけが1：1×2＝2、余り2 → 9
    expect(myNumberCheckDigit("00001000000")).toBe(9);
    // 11桁目（いちばん上）だけが1：1×6＝6、余り6 → 5
    expect(myNumberCheckDigit("10000000000")).toBe(5);
  });
});

describe("確かめ方", () => {
  test("正しい番号", () => {
    expect(myNumberError("123456789018")).toBeNull();
    expect(myNumberError("１２３４ ５６７８ ９０１８")).toBeNull();
    expect(myNumberError("1234-5678-9018")).toBeNull();
  });
  test("誤り", () => {
    expect(myNumberError("")).toBe("マイナンバーを入れてください");
    expect(myNumberError("12345678901a")).toBe("マイナンバーは数字で入れてください");
    expect(myNumberError("12345678901")).toBe("マイナンバーは12桁です（いまは11桁）");
    expect(myNumberError("123456789017")).toBe("マイナンバーの12桁目（検査用数字）が合いません。打ち間違いがないか確かめてください");
  });
  test("書き方をそろえる・4桁ずつ見せる", () => {
    expect(normalizeMyNumber("１２３４ ５６７８-９０１８")).toBe("123456789018");
    expect(formatMyNumber("123456789018")).toBe("1234 5678 9018");
  });
});

describe("家族の印", () => {
  test("氏名の空白（全角・半角）の違いは同じ人", () => {
    expect(familyKey("国税 花子", "1972-01-01")).toBe(familyKey("国税　花子", "1972-01-01"));
    expect(familyKey("国税 花子", "1972-01-01")).toBe("family:1972-01-01:国税花子");
  });
  test("生年月日が違えば別の人", () => {
    expect(familyKey("国税 花子", "1972-01-01")).not.toBe(familyKey("国税 花子", "1972-01-02"));
  });
});

describe("画面の一覧（本人と、申告書に入れた家族）", () => {
  const decl = (o: Partial<NenchoDeclaration>): NenchoDeclaration => ({ ...emptyDeclaration(), ...o });
  const child = { name: "国税 一郎", relation: "子", birthday: "2005-01-01", totalIncome: 0, disability: "none" as const, livingTogether: true, linealAscendant: false };
  const list = buildMyNumberList(
    [{ id: "1", name: "国税 太郎" }, { id: "2", name: "国税 次郎", retirement_date: "2026-05-31" }],
    [
      { staffId: "1", year: 2026, declaration: decl({ spouse: { name: "国税　花子", birthday: "1972-01-01", totalIncome: 0, disability: "none", livingTogether: true }, dependents: [child] }) },
      { staffId: "1", year: 2025, declaration: decl({ spouse: { name: "国税 花子", birthday: "1972-01-01", totalIncome: 0, disability: "none", livingTogether: true } }) },
    ],
    [
      { staffId: "1", person: SELF_KEY },
      { staffId: "1", person: familyKey("国税 花子", "1972-01-01"), name: "国税 花子", relation: "配偶者" },
      { staffId: "1", person: familyKey("国税 三郎", "2010-03-03"), name: "国税 三郎", relation: "子" },
    ],
  );
  test("本人を先に。家族は氏名と生年月日で1人にまとめ、新しい年の書き方で出す", () => {
    const e = list[0].entries;
    expect(e.map((x) => [x.relation, x.name, x.registered, x.orphan])).toEqual([
      ["本人", "国税 太郎", true, false],
      ["配偶者", "国税　花子", true, false],
      ["子", "国税 一郎", false, false],
      ["子", "国税 三郎", true, true], // 登録してあるが、申告書に見当たらない
    ]);
    expect(e[1].years).toEqual([2025, 2026]);
  });
  test("申告書がない人は本人だけ。退職日も出す", () => {
    expect(list[1].entries.map((x) => x.relation)).toEqual(["本人"]);
    expect(list[1].retiredOn).toBe("2026-05-31");
  });
});
