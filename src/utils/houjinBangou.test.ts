/**
 * 法人番号のチェックと国税庁の法人番号公表サイトのページ、Q の窓が外につなぐ先・ブラウザで開くページのテスト
 * 実行方法: bun test
 *
 * 法人番号から商号・所在地を Q が読みに行くことはしない（国税庁のページをブラウザで開く）。郵便番号の住所は Q の中のデータで引く。
 * なので、Q の窓が外につなぐのは祝日の CSV（内閣府）だけ（src-tauri/capabilities/default.json）。
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HOLIDAY_CSV_URL_DEFAULT } from "../constants/appConfig";
import { houjinBangouPageUrl, isValidCorporateNumber } from "./houjinBangou";

/** 国税庁の法人番号（国税庁法人番号公表サイトに出ている番号） */
const NTA = "7000012050002";

describe("法人番号", () => {
  test("1けためのチェックディジットを確かめる", () => {
    expect(isValidCorporateNumber(NTA)).toBe(true);
    expect(isValidCorporateNumber("7000012050003")).toBe(false); // 最後のけたを変えた
    expect(isValidCorporateNumber("6000012050002")).toBe(false); // チェックディジットを変えた
    expect(isValidCorporateNumber(NTA.slice(0, 12))).toBe(false); // 12けた
    expect(isValidCorporateNumber("70000120500０2")).toBe(false); // 全角の数字
  });

  test("国税庁の法人番号公表サイトの、その番号のページ", () => {
    expect(houjinBangouPageUrl(NTA)).toBe("https://www.houjin-bangou.nta.go.jp/henkorireki-johoto.html?selHouzinNo=7000012050002");
  });
});

describe("Q の窓の権限（src-tauri/capabilities/default.json）", () => {
  const capability = JSON.parse(readFileSync(join(import.meta.dir, "../../src-tauri/capabilities/default.json"), "utf8"));
  const scopeOf = (identifier: string): string[] =>
    capability.permissions
      .filter((p: unknown) => typeof p === "object" && (p as { identifier: string }).identifier === identifier)
      .flatMap((p: { allow: { url: string }[] }) => p.allow.map((a) => a.url));
  /** opener の範囲の比べ方（glob。* は / や ? を含む何文字にでも当たる） */
  const globMatch = (pattern: string, url: string) =>
    new RegExp(`^${pattern.split("*").map((s) => s.replace(/[.+^${}()|[\]\\?]/g, "\\$&")).join(".*")}$`).test(url);

  test("外につなぐのは祝日の CSV（内閣府）だけ。郵便番号・法人番号のサイトにはつながない", () => {
    expect(scopeOf("http:allow-fetch")).toEqual([HOLIDAY_CSV_URL_DEFAULT]);
  });

  test("ブラウザで開けるのは、Q の GitHub と国税庁の法人番号のページだけ", () => {
    const opener = scopeOf("opener:allow-open-url");
    expect(opener).toEqual(["https://github.com/kim-parkchik/Q/*", "https://www.houjin-bangou.nta.go.jp/henkorireki-johoto.html*"]);
    expect(opener.some((p) => globMatch(p, houjinBangouPageUrl(NTA)))).toBe(true);
    expect(opener.some((p) => globMatch(p, "https://www.houjin-bangou.nta.go.jp/webapi/"))).toBe(false);
  });
});
