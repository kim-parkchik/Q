/**
 * 郵便番号から住所を引く（日本郵便の郵便番号データ。Q の中で引く）のテスト
 * 実行方法: bun test
 *
 * データ（public/zipcode/）は scripts/import_zipcode.py が、日本郵便「住所の郵便番号（1レコード1行、UTF-8形式）」の
 * utf_ken_all.zip（2026年10月30日更新）から作る。ここでは作ったファイルをそのまま読んで確かめる。
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as Master from "../constants";
import {
  commonZipAddress, formatZip, lookupZip, normalizeZip, parseZipData, pickZipAddress,
  zipAddressKanaText, zipAddressText, zipCandidateLabel, zipDataFileOf, type ZipDataLoader,
} from "./zipcode";

const DATA_DIR = join(import.meta.dir, "../../public/zipcode");
/** Q の中のデータを、アプリと同じファイル名で読む */
const fileLoader: ZipDataLoader = async (file) => readFileSync(join(DATA_DIR, file), "utf8");
const look = (zip: string) => lookupZip(zip, fileLoader);

describe("郵便番号の入力", () => {
  test("ハイフン・全角の数字も読み、7けたでなければ null", () => {
    expect(normalizeZip("100-0001")).toBe("1000001");
    expect(normalizeZip("１００－０００１")).toBe("1000001");
    expect(normalizeZip(" 1000001 ")).toBe("1000001");
    expect(normalizeZip("100-001")).toBeNull();
    expect(normalizeZip("")).toBeNull();
    expect(normalizeZip(null)).toBeNull();
    expect(formatZip("1000001")).toBe("100-0001");
    expect(zipDataFileOf("1000001")).toBe("zip1.tsv");
    expect(zipDataFileOf("0600042")).toBe("zip0.tsv");
  });
});

describe("データのファイルの読み方", () => {
  const sample = [
    "# 見本",
    "C\t13101\t東京都\t千代田区\tトウキョウト\tチヨダク",
    "C\t13102\t東京都\t中央区\tトウキョウト\tチュウオウク",
    "1000001\t13101\t千代田\tチヨダ",
    "1040000\t13102\t\t",
    "1000002\t13101\t甲\tコウ",
    "1000002\t13101\t乙\tオツ",
    "",
  ].join("\n");

  test("「C」の行の市区町村を、郵便番号の行に付ける。町域がない郵便番号は空、いくつもあれば並べる", () => {
    const map = parseZipData(sample);
    expect(map.get("1000001")).toEqual([{
      zip: "1000001", cityCode: "13101", pref: "東京都", city: "千代田区", town: "千代田",
      prefKana: "トウキョウト", cityKana: "チヨダク", townKana: "チヨダ",
    }]);
    expect(map.get("1040000")?.[0].town).toBe("");
    expect(map.get("1000002")?.map((a) => a.town)).toEqual(["甲", "乙"]);
  });

  test("市区町村の行がない郵便番号の行があれば止まる", () => {
    expect(() => parseZipData("1000001\t13101\t千代田\tチヨダ")).toThrow("市区町村 13101 がありません");
  });

  test("読んだファイルは覚えておき、読めなかったときは次にもう一度読む", async () => {
    let calls = 0;
    const counting: ZipDataLoader = async (file) => {
      calls++;
      return fileLoader(file);
    };
    await lookupZip("1000001", counting);
    await lookupZip("1000002", counting);
    expect(calls).toBe(1); // 同じ zip1.tsv
    await lookupZip("0600042", counting);
    expect(calls).toBe(2);

    let fails = 0;
    const flaky: ZipDataLoader = async (file) => {
      if (fails++ === 0) throw new Error("読めない");
      return fileLoader(file);
    };
    await expect(lookupZip("1000001", flaky)).rejects.toThrow("読めない");
    expect((await lookupZip("1000001", flaky))[0].town).toBe("千代田");
  });
});

describe("日本郵便の郵便番号データから作った住所", () => {
  test("100-0001 は東京都千代田区千代田。住所のフリガナは都道府県・市区町村・町域をスペースで区切る", async () => {
    const [a] = await look("100-0001");
    expect(zipAddressText(a)).toBe("東京都千代田区千代田");
    expect(zipAddressKanaText(a)).toBe("トウキョウト チヨダク チヨダ");
    expect(a.cityCode).toBe("13101");
  });

  test("かっこ書き（丁目の範囲・次のビルを除く）は除く", async () => {
    expect(zipAddressText((await look("0600042"))[0])).toBe("北海道札幌市中央区大通西"); // 大通西（１〜１９丁目）
    expect(zipAddressKanaText((await look("0600042"))[0])).toBe("ホッカイドウ サッポロシチュウオウク オオドオリニシ");
    expect(zipAddressText((await look("1000005"))[0])).toBe("東京都千代田区丸の内"); // 丸の内（次のビルを除く）
  });

  test("「以下に掲載がない場合」「○○の次に番地がくる場合」「○○一円」は町域なし（市区町村まで）", async () => {
    const igai = (await look("0600000"))[0];
    expect(zipAddressText(igai)).toBe("北海道札幌市中央区");
    expect(zipAddressKanaText(igai)).toBe("ホッカイドウ サッポロシチュウオウク");
    expect(zipAddressText((await look("3060433"))[0])).toBe("茨城県猿島郡境町"); // 境町の次に番地がくる場合
    expect(zipAddressText((await look("1000301"))[0])).toBe("東京都利島村"); // 利島村一円
  });

  test("市区町村でない名前の「次に番地がくる場合」はその名前、多賀町の「一円」は町域の名前のまま", async () => {
    expect(zipAddressText((await look("8572427"))[0])).toBe("長崎県西海市大島町"); // 大島町の次に番地がくる場合
    expect(zipAddressText((await look("5220317"))[0])).toBe("滋賀県犬上郡多賀町一円");
  });

  test("「、」で並べた町域と、地割の範囲（「〜」）は、1つずつの町域にする", async () => {
    expect((await look("7614103")).map((a) => a.town)).toEqual(["甲", "乙"]); // 甲、乙（大木戸）
    const chiwari = (await look("0295523")).map((a) => a.town);
    expect(chiwari.slice(0, 3)).toEqual(["越中畑６４地割", "越中畑６５地割", "越中畑６６地割"]); // 越中畑６４地割〜越中畑６６地割
    expect(chiwari).toContain("桂子沢７６地割");
    const tane = await look("0287915"); // 種市第１５地割〜第２１地割（…）
    expect(tane.map((a) => a.town)).toEqual(["種市第１５地割", "種市第１６地割", "種市第１７地割", "種市第１８地割", "種市第１９地割", "種市第２０地割", "種市第２１地割"]);
    expect(tane[0].townKana).toBe("タネイチダイ１５チワリ");
  });

  test("データにない郵便番号は空", async () => {
    expect(await look("0000000")).toEqual([]);
    expect(await look("12345")).toEqual([]);
  });

  test("都道府県の名前は、どれも Q の都道府県の一覧にある（会社の画面の都道府県の欄に入る）", () => {
    const names = new Set(Master.PREFECTURE_MASTER.map((p) => p.name));
    const prefs = new Set<string>();
    let zips = 0;
    for (const d of "0123456789") {
      const map = parseZipData(readFileSync(join(DATA_DIR, `zip${d}.tsv`), "utf8"));
      zips += map.size;
      for (const list of map.values()) for (const a of list) prefs.add(a.pref);
    }
    expect([...prefs].filter((p) => !names.has(p))).toEqual([]);
    expect(prefs.size).toBe(47);
    expect(zips).toBeGreaterThan(100_000);
  });
});

describe("町域がいくつもある郵便番号", () => {
  test("選ぶ窓には町域と読みを出す（同じ字で読みが違う町域もある）", async () => {
    const list = await look("6730012");
    expect(list.map((a) => zipCandidateLabel(a, list))).toEqual(["和坂（カニガサカ）", "和坂（ワサカ）"]);
  });

  test("市区町村が違う候補は市区町村も出し、選ばなければ都道府県だけ入れる", async () => {
    const list = await look("0040000"); // 札幌市厚別区・清田区の「以下に掲載がない場合」
    expect(list.map((a) => zipCandidateLabel(a, list))).toEqual(["札幌市厚別区", "札幌市清田区"]);
    const common = commonZipAddress(list)!;
    expect(zipAddressText(common)).toBe("北海道");
    expect(zipAddressKanaText(common)).toBe("ホッカイドウ");
  });

  test("選ばなければ、市区町村がみな同じなら市区町村まで入れる", async () => {
    const common = commonZipAddress(await look("7614103"))!;
    expect(zipAddressText(common)).toBe("香川県小豆郡土庄町");
    expect(zipAddressKanaText(common)).toBe("カガワケン ショウズグントノショウチョウ");
  });

  test("候補が1つなら聞かない。いくつもあれば選んだもの、選ばなければ null", async () => {
    let asked: string[] | null = null;
    const one = await pickZipAddress(await look("1000001"), async (labels) => { asked = labels; return 0; });
    expect(one?.town).toBe("千代田");
    expect(asked).toBeNull();

    const many = await look("7614103");
    expect((await pickZipAddress(many, async (labels) => { asked = labels; return 1; }))?.town).toBe("乙");
    expect(asked).toEqual(["甲（コウ）", "乙（オツ）"]);
    expect(await pickZipAddress(many, async () => null)).toBeNull();
    expect(await pickZipAddress([], async () => 0)).toBeNull();
  });
});
