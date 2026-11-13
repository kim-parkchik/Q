/**
 * 全銀協規定形式の振込データ（zengin.ts）のテスト
 * 実行方法: bun test
 */
import { describe, expect, test } from "bun:test";
import {
  bankAccountProblems, buildZenginRecords, encodeZengin, sourceAccountProblems, splitTransfer, toZenginText,
  type SourceAccount, type StaffAccount,
} from "./zengin";
import { ZENGIN_DATA, ZENGIN_END, ZENGIN_HEADER, ZENGIN_RECORD_LENGTH, ZENGIN_TRAILER } from "../constants/zengin";

const source: SourceAccount = {
  bankCode: "0005", bankName: "ミツビシユーエフジェイ", branchCode: "001", branchName: "ホンテン",
  accountType: "ordinary", accountNumber: "1234567", clientCode: "1234567890", clientName: "カ）ヤマダショウテン",
};
const account = (o: Partial<StaffAccount> = {}): StaffAccount => ({
  bankCode: "0009", bankName: "ミツイスミトモ", branchCode: "123", branchName: "シブヤ",
  accountType: "ordinary", accountNumber: "1234", holderName: "ヤマダ　タロウ", fixedAmount: null, ...o,
});

describe("名前を、振込データに書ける半角の字にする", () => {
  test("ひらがな・全角カナ・全角英数を半角にし、小さい字を大きく、長音を「-」、中点を「.」、小文字を大文字にする", () => {
    expect(toZenginText("やまだ　たろう")).toEqual({ text: "ﾔﾏﾀﾞ ﾀﾛｳ", invalid: [] });
    expect(toZenginText("キャロル・パーカー").text).toBe("ｷﾔﾛﾙ.ﾊﾟ-ｶ-");
    expect(toZenginText("ｷｬﾛﾙ").text).toBe("ｷﾔﾛﾙ");
    expect(toZenginText("カ）ヤマダショウテン").text).toBe("ｶ)ﾔﾏﾀﾞｼﾖｳﾃﾝ");
    expect(toZenginText("abc－１２３").text).toBe("ABC-123");
    expect(toZenginText("ヴィヴァルディ").text).toBe("ｳﾞｲｳﾞｱﾙﾃﾞｲ");
  });
  test("漢字や使えない記号は、使えない字として知らせる", () => {
    expect(toZenginText("山田 タロウ").invalid).toEqual(["山", "田"]);
    expect(toZenginText("ﾔﾏﾀﾞ@ﾀﾛｳ").invalid).toEqual(["@"]);
  });
});

describe("口座の入れ方", () => {
  test("金融機関コード4けた・支店コード3けた・口座番号7けたまで・名義はカナ", () => {
    expect(bankAccountProblems(account(), "ヤマダ タロウ")).toEqual([]);
    expect(bankAccountProblems(account({ bankCode: "5", branchCode: "12", accountNumber: "12345678" }), "")).toEqual([
      "金融機関コードは4けたの数字で入れてください",
      "支店コードは3けたの数字で入れてください",
      "口座番号は7けたまでの数字で入れてください",
      "口座名義（カナ）を入れてください",
    ]);
    expect(bankAccountProblems(account(), "山田太郎")[0]).toContain("口座名義に使えない字があります（山田太郎）");
  });
  test("振込元の口座は、委託者コード（10けた）と委託者名もいる", () => {
    expect(sourceAccountProblems(source)).toEqual([]);
    expect(sourceAccountProblems({ ...source, clientCode: "123", clientName: "" })).toEqual([
      "委託者コード（会社コード）は10けたの数字で入れてください（銀行から知らされた番号）",
      "委託者名（カナ）を入れてください",
    ]);
  });
});

describe("差引支給額を口座に分ける（固定額の口座に固定額、残りを「残り」の口座に）", () => {
  test("口座が1つなら全部", () => {
    expect(splitTransfer(245000, [account()]).lines.map((l) => l.amount)).toEqual([245000]);
  });
  test("固定額の口座と残りの口座", () => {
    const fixed = account({ bankCode: "9900", fixedAmount: 50000 });
    const r = splitTransfer(245000, [fixed, account()]);
    expect(r.lines.map((l) => [l.account.bankCode, l.amount])).toEqual([["9900", 50000], ["0009", 195000]]);
    // 残りが0円なら、その口座には振り込まない
    expect(splitTransfer(50000, [fixed, account()]).lines.map((l) => l.amount)).toEqual([50000]);
  });
  test("固定額が差引支給額より多い・残りの口座がないときは分けない", () => {
    expect(splitTransfer(40000, [account({ fixedAmount: 50000 }), account()]).error).toContain("固定額の合計（50,000円）が差引支給額（40,000円）より多く");
    expect(splitTransfer(40000, [account({ fixedAmount: 10000 })]).error).toContain("残りを振り込む口座を1つ決めてください");
  });
});

describe("振込データのレコード（1レコード120バイト）", () => {
  const records = buildZenginRecords({
    kind: "salary", source, transferDate: "2026-11-25",
    lines: [
      { account: account(), amount: 245000, staffCode: "1001" },
      { account: account({ bankCode: "9900", bankName: "ﾕｳﾁﾖ", branchCode: "018", branchName: "", accountNumber: "1234567", holderName: "サトウ ハナコ" }), amount: 180500, staffCode: "A-12" },
    ],
  });
  test("ヘッダー・データ・トレーラー・エンドの順で、どのレコードも120バイト", () => {
    expect(records).toHaveLength(5);
    for (const r of records) expect(r.length).toBe(ZENGIN_RECORD_LENGTH);
    for (const fields of [ZENGIN_HEADER, ZENGIN_DATA, ZENGIN_TRAILER, ZENGIN_END]) {
      expect(fields.reduce((sum, f) => sum + f.length, 0)).toBe(ZENGIN_RECORD_LENGTH);
    }
  });
  test("ヘッダー：データ区分1・給与振込11・JIS・委託者コード・委託者名・振込指定日（月日）・振込元の口座", () => {
    expect(records[0]).toBe(
      "1" + "11" + "0" + "1234567890" + "ｶ)ﾔﾏﾀﾞｼﾖｳﾃﾝ".padEnd(40) + "1125"
      + "0005" + "ﾐﾂﾋﾞｼﾕ-ｴﾌｼﾞｴｲ".padEnd(15) + "001" + "ﾎﾝﾃﾝ".padEnd(15) + "1" + "1234567" + " ".repeat(17),
    );
  });
  test("データ：振込先の口座（口座番号は前を0で埋める）・名義・金額・新規コード・社員番号（数字でなければ空）", () => {
    expect(records[1]).toBe(
      "2" + "0009" + "ﾐﾂｲｽﾐﾄﾓ".padEnd(15) + "123" + "ｼﾌﾞﾔ".padEnd(15) + "    " + "1" + "0001234"
      + "ﾔﾏﾀﾞ ﾀﾛｳ".padEnd(30) + "0000245000" + "0" + "0000001001" + " ".repeat(10) + " ".repeat(9),
    );
    expect(records[2].slice(91, 101)).toBe(" ".repeat(10)); // 社員番号「A-12」は数字でないので空
  });
  test("トレーラー：件数と合計金額。エンド", () => {
    expect(records[3]).toBe("8" + "000002" + "000000425500" + " ".repeat(101));
    expect(records[4]).toBe("9" + " ".repeat(119));
  });
  test("賞与振込は種別コード12", () => {
    const bonus = buildZenginRecords({ kind: "bonus", source, transferDate: "2026-12-10", lines: [] });
    expect(bonus[0].slice(0, 3)).toBe("112");
    expect(bonus[0].slice(54, 58)).toBe("1210");
  });
});

describe("ファイルの中身（Shift_JIS の1バイトの字）", () => {
  test("半角カナは 0xA1〜0xDF、改行ありなら CR+LF を付ける", () => {
    const bytes = encodeZengin(["ｱﾝ1 "], false);
    expect([...bytes]).toEqual([0xb1, 0xdd, 0x31, 0x20]);
    expect([...encodeZengin(["1", "9"], true)]).toEqual([0x31, 0x0d, 0x0a, 0x39, 0x0d, 0x0a]);
  });
  test("全部のレコードを書くと、改行なしは120バイトずつ、改行ありは122バイトずつ", () => {
    const records = buildZenginRecords({ kind: "salary", source, transferDate: "2026-11-25", lines: [{ account: account(), amount: 1, staffCode: "1" }] });
    expect(encodeZengin(records, false).length).toBe(120 * 4);
    expect(encodeZengin(records, true).length).toBe(122 * 4);
  });
  test("書けない字があれば止める", () => {
    expect(() => encodeZengin(["山"], false)).toThrow("振込データに書けない字があります（山）");
  });
});
