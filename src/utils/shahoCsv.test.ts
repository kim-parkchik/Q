import { describe, expect, test } from "bun:test";
import {
  SHAHO_BIRTH_ERA_CODES, SHAHO_BONUS_FIELDS, SHAHO_BONUS_FORM_CODE, SHAHO_FILE_NAME, SHAHO_OFFICE_FIELDS, SHAHO_PAY_ERA_CODES,
  SHAHO_PREFECTURE_CODES, SHAHO_REPRESENTATIVE_CODE,
} from "../constants/shahoTodoke";
import {
  MY_NUMBER_PLACEHOLDER, buildShahoLines, encodeShahoFile, fieldProblem, fillMyNumbers, hasNameSpace, isShahoChar, missingMyNumbers,
  nextMediaNumber, shahoDate, shahoOfficeValues, shahoPrefectureCode, splitOfficeSymbol, toShahoKana, toShahoKanji, unusableChars,
} from "./shahoCsv";

/** 仕様書の作成例の事業所（表4.3.2.1-2） */
const OFFICE = {
  prefecture: "東京都", symbol: "01-ケイト", number: "123", zip: "100-0000", address: "東京都千代田区霞が関1-2-2",
  name: "健保サービス株式会社", owner: "健保 良一", phone: "03-1234-5678",
};

describe("仕様書から作った決まり（src/constants/shahoTodoke.ts）", () => {
  test("ファイル名・代表届書コード・賞与支払届の様式コードと21項目", () => {
    expect([SHAHO_FILE_NAME, SHAHO_REPRESENTATIVE_CODE, SHAHO_BONUS_FORM_CODE]).toEqual(["SHFD0006.CSV", "22223", "2265700"]);
    expect(SHAHO_BONUS_FIELDS).toHaveLength(21);
    expect(SHAHO_BONUS_FIELDS[0].name).toBe("様式コード");
    expect(SHAHO_BONUS_FIELDS[20].name).toBe("70歳以上被用者届のみ提出");
    expect(SHAHO_OFFICE_FIELDS).toHaveLength(12);
  });
  test("都道府県コードは年金機構の一覧（全国地方公共団体コードとは違う。東京都は 21、神奈川県は 31、沖縄県は 82）", () => {
    expect(Object.keys(SHAHO_PREFECTURE_CODES)).toHaveLength(47);
    expect([SHAHO_PREFECTURE_CODES["北海道"], SHAHO_PREFECTURE_CODES["東京都"], SHAHO_PREFECTURE_CODES["神奈川県"], SHAHO_PREFECTURE_CODES["沖縄県"]]).toEqual(["01", "21", "31", "82"]);
    expect([shahoPrefectureCode("東京"), shahoPrefectureCode("大阪府"), shahoPrefectureCode("愛知"), shahoPrefectureCode("")]).toEqual(["21", "41", "51", null]);
  });
  test("元号のコード：明治1・大正3・昭和5・平成7・令和9（賞与支払年月日は平成・令和）", () => {
    expect(SHAHO_BIRTH_ERA_CODES).toEqual({ 明治: "1", 大正: "3", 昭和: "5", 平成: "7", 令和: "9" });
    expect(SHAHO_PAY_ERA_CODES).toEqual({ 平成: "7", 令和: "9" });
  });
});

describe("字", () => {
  test("1バイト文字は数字・英字・半角カナ・ハイフン・スペース、2バイト文字はシフトJISの第1・第2水準など", () => {
    expect([..."09AZaz-ｦｱﾝﾞﾟ "].every(isShahoChar)).toBe(true);
    expect([..."亜熙あア漢字　－～"].every(isShahoChar)).toBe(true);
    expect(unusableChars("髙田﨑①･@!、")).toEqual(["髙", "﨑", "①", "･", "@", "!"]);
  });
  test("シフトJISにする：半角カナは1バイト、漢字は2バイト、行は CR LF で終わる。〜（波ダッシュ）・−（マイナス）は ～・－ と同じ字", () => {
    expect([...encodeShahoFile(["ｹﾏ,亜"])].map((b) => b.toString(16))).toEqual(["b9", "cf", "2c", "88", "9f", "d", "a"]);
    expect(encodeShahoFile(["〜−"])).toEqual(encodeShahoFile(["～－"]));
    expect([...encodeShahoFile(["１－２"])].map((b) => b.toString(16))).toEqual(["82", "50", "81", "7c", "82", "51", "d", "a"]);
    expect(() => encodeShahoFile(["髙"])).toThrow("届書に書けない字があります");
  });
  test("カナの項目は半角カナ（小さい字・長音もそのまま）、漢字の項目は全角。スペースは1つにまとめる", () => {
    expect(toShahoKana("けんぽ　いちろう")).toBe("ｹﾝﾎﾟ ｲﾁﾛｳ");
    expect(toShahoKana("ジョー  ショウ")).toBe("ｼﾞｮｰ ｼｮｳ");
    expect(toShahoKanji("健保 一郎")).toBe("健保　一郎");
    expect(toShahoKanji("霞が関1-2-2")).toBe("霞が関１－２－２");
    expect([hasNameSpace("ｹﾝﾎﾟ ｲﾁﾛｳ", " "), hasNameSpace("ｹﾝﾎﾟｲﾁﾛｳ", " "), hasNameSpace("健保　一郎", "　")]).toEqual([true, false, true]);
  });
  test("項目の種別と文字数（数字・カナ・漢字、「0,12」は省略か12文字）", () => {
    const [code, , , mark, number, kana, kanji] = SHAHO_BONUS_FIELDS;
    expect(fieldProblem(code, "2265700")).toBeNull();
    expect(fieldProblem(code, "226570")).toBe("様式コードが短すぎます（7文字から。いまは6文字）");
    expect(fieldProblem(mark, "ｹﾏ")).toBeNull();
    expect(fieldProblem(number, "")).toBeNull();
    expect(fieldProblem(number, "12a")).toBe("被保険者整理番号は数字で書きます（「a」は書けません）");
    expect(fieldProblem(kana, "")).toBe("被保険者氏名(カナ)が空です");
    expect(fieldProblem(kana, "健保 一郎")).toBe("被保険者氏名(カナ)はカナで書きます（「健保一郎」は書けません）");
    expect(fieldProblem(kanji, "健保　一郎")).toBeNull();
    expect(fieldProblem(kanji, "健保 一郎")).toBe("被保険者氏名(漢字)に、半角の字があります（ ）");
    expect(fieldProblem(SHAHO_BONUS_FIELDS[14], "12345")).toBe("個人番号は12文字で書きます（いまは5文字）");
  });
  test("和暦の日付：昭和21年5月27日 → 5・210527、令和1年7月25日 → 9・010725（仕様書の例）", () => {
    expect(shahoDate("1946-05-27", SHAHO_BIRTH_ERA_CODES)).toEqual({ era: "5", ymd: "210527" });
    expect(shahoDate("2019-07-25", SHAHO_PAY_ERA_CODES)).toEqual({ era: "9", ymd: "010725" });
    expect(shahoDate("1985-03-01", SHAHO_PAY_ERA_CODES)).toBeNull();
    expect(shahoDate("", SHAHO_BIRTH_ERA_CODES)).toBeNull();
  });
});

describe("事業所と、ファイルの形", () => {
  test("事業所整理記号は、上2桁が郡市区符号、残りが事業所記号（半角カナ）", () => {
    expect(splitOfficeSymbol("57-ケマ")).toEqual({ district: "57", mark: "ｹﾏ" });
    expect(splitOfficeSymbol("０１－イロハ")).toEqual({ district: "01", mark: "ｲﾛﾊ" });
    expect(splitOfficeSymbol("12 あいう")).toEqual({ district: "12", mark: "ｱｲｳ" });
    expect(splitOfficeSymbol("ケマ")).toBeNull();
  });
  test("仕様書の作成例の事業所情報と、媒体管理レコード（図4.3.2.1-2・図4.1.1-2）", () => {
    const o = shahoOfficeValues(OFFICE);
    expect(o.problems).toEqual([]);
    const lines = buildShahoLines(o.values, 1, "2017-01-01", ["2265700,21,01,ｹｲﾄ,123"]);
    expect(lines).toEqual([
      "21,01,ｹｲﾄ,001,20170101,22223",
      "[kanri]",
      ",001",
      "21,01,ｹｲﾄ,123,100,0000,東京都千代田区霞が関１－２－２,健保サービス株式会社,健保　良一,03,1234,5678",
      "[data]",
      "2265700,21,01,ｹｲﾄ,123",
    ]);
    // 所在地に都道府県名がなければ、頭に付ける
    expect(shahoOfficeValues({ ...OFFICE, address: "千代田区霞が関1-2-2" }).values[6]).toBe("東京都千代田区霞が関１－２－２");
  });
  test("事業所の直すところ：都道府県・事業所整理記号・郵便番号・代表者の姓と名の間・電話番号のハイフン・書けない字", () => {
    const o = shahoOfficeValues({ prefecture: "", symbol: "", number: "", zip: "100", address: "髙島屋ビル", name: "健保サービス株式会社", owner: "健保良一", phone: "0312345678" });
    expect(o.problems).toEqual([
      "本店の拠点の都道府県がわかりません（会社設定の「本店の都道府県」）",
      "事業所整理記号がないか、書き方が違います（納入告知書の「01-イロハ」のような記号を、会社設定で入れてください）",
      "事業所番号がありません（納入告知書の番号を、会社設定で入れてください）",
      "会社の郵便番号がないか、7けたではありません",
      "代表者の氏名の、姓と名の間にスペースを入れてください（会社設定）",
      "会社の電話番号は「03-1234-5678」のように、ハイフンで3つに区切って入れてください",
      "事業所の事業所所在地に、届書に書けない字があります（髙）",
    ]);
  });
  test("媒体通番は、前の番号の次（初めは001、999 の次は 001）", () => {
    expect([nextMediaNumber(0), nextMediaNumber(null), nextMediaNumber(23), nextMediaNumber(999)]).toEqual([1, 1, 24, 1]);
  });
});

describe("届書に書くマイナンバー", () => {
  // 見本の行（2列目が個人番号の項目）。1 と 2 は番号を書く人（2 は2行）、3 は書かない人
  const rows = [
    { staffId: "1", values: ["a", MY_NUMBER_PLACEHOLDER] },
    { staffId: "2", values: ["b", MY_NUMBER_PLACEHOLDER] },
    { staffId: "2", values: ["c", MY_NUMBER_PLACEHOLDER] },
    { staffId: "3", values: ["d", ""] },
  ];
  test("保存する前に、番号を読めない人（ない・12桁でない）を見つける。番号を書かない人は見ない", () => {
    expect(missingMyNumbers(rows, { "1": "123456789018", "2": "234567890123" })).toEqual([]);
    // 番号を消した人（読んだ番号にない）は、同じ人の行が2つあっても1回だけ
    expect(missingMyNumbers(rows, { "1": "123456789018" })).toEqual(["2"]);
    // 12桁でない番号（区切りの字は除いて数える）
    expect(missingMyNumbers(rows, { "1": "1234 5678 9018", "2": "23456789012" })).toEqual(["2"]);
    expect(missingMyNumbers(rows, {})).toEqual(["1", "2"]);
    expect(missingMyNumbers([{ staffId: "3", values: ["d", ""] }], {})).toEqual([]);
  });
  test("読めた番号を個人番号の項目に入れる。読めない人がいれば止める", () => {
    expect(fillMyNumbers(rows, { "1": "123456789018", "2": "234567890123" }).map((v) => v[1]))
      .toEqual(["123456789018", "234567890123", "234567890123", ""]);
    expect(() => fillMyNumbers(rows, { "1": "123456789018" })).toThrow("マイナンバーを読めない人がいます");
  });
});
