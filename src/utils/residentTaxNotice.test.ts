/**
 * 特別徴収税額通知の CSV（residentTaxNotice.ts）のテスト
 * 実行方法: bun test
 *
 * 例の行は、地方税共同機構「処分通知等（税額通知）CSVレイアウト仕様書（総務省通知形式）」の
 * 「このCSVファイルについて」シートの設定データ例（宮城県の3人）。
 */
import { describe, expect, test } from "bun:test";
import { RESIDENT_TAX_NOTICE_CSV_FIELDS } from "../constants/residentTaxNoticeCsvLayout";
import {
  compareWithSchedule, decodeNoticeFile, matchNoticeRecord, parseResidentTaxNotice, sameNoticeName, withNoticeAmounts,
} from "./residentTaxNotice";

const SAMPLE = [
  "123456789012,12345678901,041009,1000011000011000011000016,宮城県仙台市ＸＸＸ区ＸＸＸ２丁目１,申告一郎,ｼﾝｺｸｲﾁﾛｳ,123456789012,120000,10000,10000,10000,10000,10000,10000,10000,10000,10000,10000,10000,10000,,",
  "345678901234,,042021,,宮城県石巻市ＸＸＸ４丁目３,申告花子,,345678901234,230000,20000,20000,20000,20000,20000,20000,10000,20000,20000,20000,20000,20000,12,ＸＸのため変更",
  "567890123456,34567890123,042030,1000011000011000011000018,宮城県塩竈市ＸＸＸ４丁目５,申告太郎,ｼﾝｺｸﾀﾛｳ,567890123456,120000,10000,10000,10000,10000,10000,10000,10000,10000,10000,10000,10000,10000,,",
].join("\r\n");

describe("仕様書から作った項目の並び", () => {
  test("23項目。使う番号の名前", () => {
    expect(RESIDENT_TAX_NOTICE_CSV_FIELDS).toHaveLength(23);
    const names: Record<number, string> = {
      1: "指定番号", 2: "宛名番号", 3: "市町村コード", 4: "受給者番号", 6: "納税義務者－漢字氏名", 7: "納税義務者－カナ氏名",
      8: "納税義務者－個人番号", 9: "特別徴収税額（年税額）", 10: "特別徴収税額（月割額）－６月分", 16: "特別徴収税額（月割額）－１２月分",
      21: "特別徴収税額（月割額）－５月分", 22: "変更月", 23: "摘要",
    };
    for (const [no, name] of Object.entries(names)) expect(RESIDENT_TAX_NOTICE_CSV_FIELDS[Number(no) - 1].name).toBe(name);
  });
});

describe("読み方", () => {
  const { records, errors } = parseResidentTaxNotice(SAMPLE);
  test("仕様書の例の3行", () => {
    expect(errors).toEqual([]);
    expect(records.map((r) => [r.line, r.code, r.staffNumber, r.name, r.annual])).toEqual([
      [1, "041009", "1000011000011000011000016", "申告一郎", 120000],
      [2, "042021", "", "申告花子", 230000],
      [3, "042030", "1000011000011000011000018", "申告太郎", 120000],
    ]);
  });
  test("月割額は6月分〜翌年5月分。変更月・摘要", () => {
    expect(records[1].amounts).toEqual([20000, 20000, 20000, 20000, 20000, 20000, 10000, 20000, 20000, 20000, 20000, 20000]);
    expect([records[1].changeMonth, records[1].remarks]).toEqual([12, "ＸＸのため変更"]);
    expect([records[0].changeMonth, records[0].remarks]).toEqual([null, ""]);
    expect(records.every((r) => r.warnings.length === 0)).toBe(true);
  });
  test("指定番号・宛名番号は読み、個人番号は読まない", () => {
    expect([records[0].designationNumber, records[0].atenaNumber]).toEqual(["123456789012", "12345678901"]);
    // 読んだ項目はこれだけ（住所・個人番号は持たない）
    expect(Object.keys(records[0]).sort()).toEqual(
      ["amounts", "annual", "atenaNumber", "changeMonth", "code", "designationNumber", "kana", "line", "name", "remarks", "staffNumber", "warnings"],
    );
  });
  test("読めない行は、何行目かを付けて知らせる。年税額と合計が合わなければ注意", () => {
    const x = parseResidentTaxNotice("指定番号,宛名番号\n" + SAMPLE.split("\r\n")[0].replace(",120000,", ",120001,") + "\n\n");
    expect(x.errors).toEqual(["1行目：項目が2個あります（特別徴収税額通知の CSV は23個）"]);
    expect(x.records[0].warnings).toEqual(["年税額（120,001円）と、12か月の合計（120,000円）が合いません"]);
  });
  test("Shift-JIS のファイルも読む（BOM 付きの UTF-8 も）", () => {
    // 「申告」を Shift-JIS にしたもの：90 5C 8D 90
    expect(decodeNoticeFile(new Uint8Array([0x90, 0x5c, 0x8d, 0x90]))).toBe("申告");
    expect(decodeNoticeFile(new Uint8Array([0xef, 0xbb, 0xbf, 0xe7, 0x94, 0xb3]))).toBe("申");
  });
});

describe("従業員との結び付け", () => {
  const { records } = parseResidentTaxNotice(SAMPLE);
  const staff = [
    { id: "1000011000011000011000016", name: "申告 一郎" },
    { id: "2", name: "申告 花子" },
    { id: "3", name: "申告 太郎" },
    { id: "4", name: "申告　太郎" },
  ];
  test("受給者番号が従業員IDと同じで、氏名も同じ人", () => {
    expect(matchNoticeRecord(records[0], staff)).toEqual({ staffId: "1000011000011000011000016", how: "number", candidates: [], numberNameMismatch: null });
  });
  test("受給者番号がなければ、氏名（空白を除く）が同じ人が1人だけのとき", () => {
    expect(matchNoticeRecord(records[1], staff)).toEqual({ staffId: "2", how: "name", candidates: [], numberNameMismatch: null });
  });
  test("同じ氏名が2人以上なら決めずに候補を出す", () => {
    expect(matchNoticeRecord(records[2], staff)).toEqual({ staffId: null, how: null, candidates: ["3", "4"], numberNameMismatch: null });
  });
  test("受給者番号が従業員IDと同じでも、氏名が違えば結び付けない（前のソフトの番号が、ほかの人のIDと同じだったときなど）", () => {
    // 申告一郎さんの受給者番号が、Q では別の人（山田 次郎）の従業員IDになっている
    const other = [{ id: "1000011000011000011000016", name: "山田 次郎" }, { id: "9", name: "申告 一郎" }];
    expect(matchNoticeRecord(records[0], other)).toEqual({ staffId: null, how: null, candidates: ["9"], numberNameMismatch: "1000011000011000011000016" });
    // 氏名が同じ人がいなくても、結び付けない
    expect(matchNoticeRecord(records[0], [other[0]])).toEqual({ staffId: null, how: null, candidates: [], numberNameMismatch: "1000011000011000011000016" });
  });
  test("どちらかの氏名が空なら比べられないので、受給者番号で結び付ける", () => {
    expect(matchNoticeRecord(records[0], [{ id: "1000011000011000011000016", name: "" }]).staffId).toBe("1000011000011000011000016");
    expect(sameNoticeName("申告　一郎", "申告一郎")).toBe(true);
    expect(sameNoticeName("ｼﾝｺｸ ｲﾁﾛｳ", "シンコクイチロウ")).toBe(true);
    expect(sameNoticeName("申告一郎", "申告次郎")).toBe(false);
    expect(sameNoticeName("", "申告一郎")).toBeNull();
  });
});

describe("年度の12か月に入れる", () => {
  const old = [{ fiscalYear: 2025, amounts: Array(12).fill(9000) }];
  const next = Array(12).fill(10000);
  test("通知をした市区町村を、その年度の納付先にする", () => {
    expect(withNoticeAmounts(old, 2026, next, "041009")).toEqual([{ fiscalYear: 2025, amounts: Array(12).fill(9000) }, { fiscalYear: 2026, amounts: next, municipality: "041009" }]);
  });
  test("その年度だけ入れ替え、ほかの年度はそのまま", () => {
    expect(withNoticeAmounts(old, 2026, next)).toEqual([{ fiscalYear: 2025, amounts: Array(12).fill(9000) }, { fiscalYear: 2026, amounts: next }]);
    expect(withNoticeAmounts(old, 2025, next)).toEqual([{ fiscalYear: 2025, amounts: next }]);
  });
  test("いまの額と比べる", () => {
    expect(compareWithSchedule(old, 2026, next)).toBe("new");
    expect(compareWithSchedule(old, 2025, Array(12).fill(9000))).toBe("same");
    expect(compareWithSchedule(old, 2025, next)).toBe("changed");
  });
});
