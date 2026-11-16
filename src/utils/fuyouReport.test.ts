import { describe, expect, test } from "bun:test";
import { SHAHO_FUYOU_FIELDS, SHAHO_SANGO_FIELDS } from "../constants/shahoTodoke";
import { buildFuyouRow, buildSangoRow, changeRemarks, planFuyouRows, splitPhone, type FuyouInput } from "./fuyouReport";
import { emptyDependent, isSango, markedReported, parseHealthDependents, stringifyHealthDependents, suggestFuyouKind, type HealthDependent } from "./healthDependents";
import { familyKey } from "./myNumber";
import { fillMyNumbers, shahoOfficeValues } from "./shahoCsv";

/** 仕様書の作成例の事業所（事業所整理記号 01-ケイト・事業所番号 123。東京都） */
const office = shahoOfficeValues({
  prefecture: "東京都", symbol: "01-ケイト", number: "123", zip: "100-0000", address: "東京都千代田区霞が関1-2-2",
  name: "健保サービス株式会社", owner: "健保 良一", phone: "03-1234-5678",
}).values;
/** 仕様書の作成例の被保険者（年金 正明。昭和55年10月10日生まれ・整理番号10） */
const masaaki = { id: "3001", name: "年金　正明", furigana: "ネンキン マサアキ", birthday: "1980-10-10", gender: "male", pension_num: "10", zip_code: "120-8580", address: "東京都杉並区高井戸西3-5-24" };
/** 作成例の配偶者（年金 久美。昭和56年3月26日生まれ・令和1年7月7日に婚姻で被扶養者に） */
const kumi = (o: Partial<HealthDependent> = {}): HealthDependent => ({
  ...emptyDependent(true, "kumi"), relation: "妻", name: "年金　久美", kana: "ネンキン クミ", birthday: "1981-03-26", gender: "female",
  together: true, zip: "120-8580", address: "東京都杉並区高井戸西3-5-24", phone: "03-3456-7890", phoneKind: "自宅",
  job: "無職", income: 0, from: "2019-07-07", reason: "婚姻", ...o,
});
const child = (id: string, o: Partial<HealthDependent> = {}): HealthDependent => ({
  ...emptyDependent(false, id), relation: "実子・養子", name: `年金　${id}`, kana: `ネンキン ${id === "ichiro" ? "イチロウ" : id === "jiro" ? "ジロウ" : "サブロウ"}`,
  birthday: "2026-09-01", gender: "male", together: true, zip: "120-8580", address: "東京都杉並区高井戸西3-5-24",
  job: "小・中学生以下", income: 0, from: "2026-09-01", reason: "出生", ...o,
});
const input = (o: Partial<FuyouInput> = {}): FuyouInput => ({
  staff: masaaki, kind: "該当", spouse: kumi(), others: [], receivedOn: "2019-07-08", employerChecked: true, staffIncome: 3200000,
  spouseIncome: null, myNumber: true, familyMyNumber: () => true, today: "2019-07-08", ...o,
});
/** 保存するときと同じに、本人と家族のマイナンバーを入れた行 */
const line = (row: { staffId: string; values: string[]; persons: Record<number, string> }) =>
  fillMyNumbers([row], { [row.staffId]: { self: "123456708900", [familyKey("年金　久美", "1981-03-26")]: "123456078900" } })[0].join(",");
/** 仕様書の作成例は漢字の氏名の姓と名の間を半角のように書いているが、項目説明のとおり全角スペースにする */
const zenkakuNames = (s: string) => s.replace("年金 正明", "年金　正明").replace("年金 久美", "年金　久美");

describe("被扶養者（異動）届／国民年金第3号被保険者関係届（協会けんぽ）", () => {
  test("仕様書の作成例（図4.10.1-2）：年金 正明の配偶者 年金 久美を、令和1年7月7日に婚姻で被扶養者に（第3号被保険者も兼ねる）", () => {
    const row = buildFuyouRow(input(), office);
    expect(row.problems).toEqual([]);
    expect(row.values).toHaveLength(SHAHO_FUYOU_FIELDS.length);
    expect(line(row)).toBe(zenkakuNames(
      "2202700,21,01,ｹｲﾄ,1,9,010708,10,ﾈﾝｷﾝ ﾏｻｱｷ,年金 正明,5,551010,1,123456708900,,,3200000,,,,1,9,010708,ﾈﾝｷﾝ ｸﾐ,年金 久美,5,560326,2,123456078900,,,,,,1,,120,8580,東京都杉並区高井戸西３－５－２４,1,03,3456,7890,9,010707,2,,1,0,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,",
    ));
    expect(row.deadline).toBe("2019-07-12");
    expect(row.notes.join("")).toContain("国民年金第3号被保険者関係届を兼ねます");
    expect(row.reported.kumi).toMatchObject({ kind: "該当", name: "年金　久美", sango: true });
  });

  test("子2人を出生で被扶養者に（その他の被扶養者1・2）。3人目からは次の行。マイナンバーを書かない被保険者は基礎年金番号と住所", () => {
    const kids = [child("ichiro"), child("jiro", { gender: "female" }), child("saburo")];
    const plans = planFuyouRows(kids, "kyokai", "2026-09-05");
    expect(plans.map((p) => [p.kind, p.spouse?.id ?? null, p.others.map((d) => d.id)])).toEqual([
      ["該当", null, ["ichiro", "jiro"]], ["該当", null, ["saburo"]],
    ]);
    const row = buildFuyouRow(input({
      staff: { ...masaaki, basic_pension_number: "1234-567890" }, spouse: null, others: plans[0].others, receivedOn: "2026-09-05", today: "2026-09-05",
      myNumber: false, familyMyNumber: () => false, employerChecked: false, staffIncome: 4500000, spouseIncome: 1500000,
    }), office);
    expect(row.problems).toEqual([]);
    // 被保険者：基礎年金番号・郵便番号・住所。異動の別「1」。被扶養者でない配偶者の年間収入
    expect(row.values.slice(13, 21)).toEqual(["", "1234", "567890", "4500000", "120", "8580", "東京都杉並区高井戸西３－５－２４", "1"]);
    expect(row.values[4]).toBe("0");
    expect(row.values[68]).toBe("1500000");
    // その他の被扶養者1（年金 一郎）：氏名・生年月日（令和8年9月1日）・男・実子（01）・同居・住所・なった日・小中学生以下・収入0・出生
    expect(row.values.slice(70, 82)).toEqual(["ﾈﾝｷﾝ ｲﾁﾛｳ", "年金　ichiro".replace("ichiro", "ｉｃｈｉｒｏ"), "9", "080901", "1", "01", "", "", "1", "120", "8580", "東京都杉並区高井戸西３－５－２４"]);
    expect(row.values.slice(89, 96)).toEqual(["9", "080901", "4", "", "0", "1", ""]);
    // その他の被扶養者2（年金 二郎。女）
    expect([row.values[103], row.values[107], row.values[108]]).toEqual(["ﾈﾝｷﾝ ｼﾞﾛｳ", "2", "01"]);
    expect(row.deadline).toBe("2026-09-06");
  });

  test("配偶者が就職で被扶養者でなくなった（非該当）：でなくなった日・理由。整理番号は必ず書く。被保険者の収入は書かない", () => {
    const sp = kumi({ until: "2026-10-01", endReason: "就職・収入増加", reported: markedReported(kumi()) });
    expect(suggestFuyouKind(sp)).toBe("非該当");
    const row = buildFuyouRow(input({ kind: "非該当", spouse: sp, receivedOn: "2026-10-03", today: "2026-10-03" }), office);
    expect(row.problems).toEqual([]);
    expect([row.values[4], row.values[16], row.values[20]]).toEqual(["", "", "2"]);
    expect(row.values.slice(43, 53)).toEqual(["", "", "", "", "", "", "9", "081001", "3", ""]);
    expect(row.values[34]).toBe("");
    const noNumber = buildFuyouRow(input({ kind: "非該当", spouse: sp, staff: { ...masaaki, pension_num: "" }, receivedOn: "2026-10-03" }), office);
    expect(noNumber.problems.join("")).toContain("被保険者整理番号がありません");
  });

  test("75歳到達で被扶養者でなくなったら、住所地の都道府県コード（表4.10.1-2。東京都は 13）。死亡は死亡年月日も", () => {
    const old = child("chichi", { relation: "父母・養父母", name: "年金　太郎", kana: "ネンキン タロウ", birthday: "1951-12-11", job: "年金受給者", reported: markedReported(child("chichi")) });
    const row = buildFuyouRow(input({ kind: "非該当", spouse: null, others: [{ ...old, until: "2026-12-11", endReason: "75歳到達" }], receivedOn: "2026-12-14" }), office);
    expect(row.problems).toEqual([]);
    expect(row.values.slice(92, 93)).toEqual(["13"]);
    expect(row.values.slice(96, 100)).toEqual(["9", "081211", "4", ""]);
    const dead = buildFuyouRow(input({ kind: "非該当", spouse: kumi({ until: "2026-11-02", endReason: "死亡", deathDate: "2026-11-01", reported: markedReported(kumi()) }), receivedOn: "2026-11-04" }), office);
    expect(dead.values.slice(49, 55)).toEqual(["9", "081102", "1", "", "9", "081101"]);
  });

  test("60歳以上の配偶者は第3号被保険者にならないので、備考に「扶養届のみ」", () => {
    const sp = kumi({ birthday: "1964-01-01", from: "2026-04-01" });
    expect(isSango(sp, "2026-04-01")).toBe(false);
    expect(isSango(kumi(), "2019-07-07")).toBe(true);
    const row = buildFuyouRow(input({ spouse: sp, receivedOn: "2026-04-03", today: "2026-04-03" }), office);
    expect(row.values[55]).toBe("扶養届のみ");
    expect(row.notes.join("")).toContain("扶養届のみ");
  });

  test("氏名を直したら変更（備考に変更前の氏名）", () => {
    const sp = kumi({ name: "厚年　久美", kana: "コウネン クミ", reported: markedReported(kumi()) });
    expect(suggestFuyouKind(sp)).toBe("変更");
    expect(changeRemarks(sp)).toBe("氏名変更前：年金　久美");
    const row = buildFuyouRow(input({ kind: "変更", spouse: sp, receivedOn: "2026-05-10", today: "2026-05-10" }), office);
    expect(row.problems).toEqual([]);
    expect([row.values[20], row.values[23], row.values[55]]).toEqual(["3", "ｺｳﾈﾝ ｸﾐ", "氏名変更前：年金　久美"]);
  });

  test("入れていないもの（収入・続柄・なった日など）は直すところ", () => {
    const row = buildFuyouRow(input({ staffIncome: null, spouse: kumi({ relation: "", income: null, from: "" }) }), office);
    const text = row.problems.join("\n");
    expect(text).toContain("被保険者の今後1年間の年間収入の見込み");
    expect(text).toContain("続柄（夫・妻）");
    expect(text).toContain("今後1年間の年間収入の見込み");
    expect(text).toContain("被扶養者になった日");
  });
});

describe("国民年金第3号被保険者関係届（健康保険組合などの被保険者の配偶者）", () => {
  test("仕様書の作成例（図4.11.1-2）：年金 正明の配偶者 年金 久美が、令和1年7月7日に婚姻で第3号被保険者に", () => {
    const row = buildSangoRow(input(), office);
    expect(row.problems).toEqual([]);
    expect(row.values).toHaveLength(SHAHO_SANGO_FIELDS.length);
    expect(line(row)).toBe(zenkakuNames(
      "4300700,21,01,ｹｲﾄ,9,010708,ﾈﾝｷﾝ ﾏｻｱｷ,年金 正明,5,551010,1,123456708900,,,,,,9,010708,ﾈﾝｷﾝ ｸﾐ,年金 久美,5,560326,2,123456078900,,,,,,1,120,8580,東京都杉並区高井戸西３－５－２４,1,03,3456,7890,1,9,010707,2,,31,,,,,,,,,,,,,,,,,,,",
    ));
  });

  test("健康保険組合の人は、第3号被保険者の配偶者だけ3号関係届（子や60歳以上の配偶者は組合に出す）", () => {
    const plans = planFuyouRows([kumi(), child("ichiro")], "union", "2019-07-08");
    expect(plans.map((p) => [p.form, p.spouse?.id])).toEqual([["sango", "kumi"]]);
    expect(planFuyouRows([kumi({ birthday: "1960-01-01", from: "2026-04-01" })], "union", "2026-04-03")).toEqual([]);
  });

  test("離婚で第3号被保険者でなくなった（非該当）。マイナンバーを書かないときは基礎年金番号が要る", () => {
    const sp = kumi({ until: "2026-06-15", endReason: "離婚", reported: { ...markedReported(kumi()), sango: true } });
    const row = buildSangoRow(input({ kind: "非該当", spouse: sp, familyMyNumber: () => false, receivedOn: "2026-06-17" }), office);
    expect(row.problems.join("")).toContain("基礎年金番号");
    const ok = buildSangoRow(input({ kind: "非該当", spouse: { ...sp, basicPensionNumber: "9876543210" }, familyMyNumber: () => false, receivedOn: "2026-06-17" }), office);
    expect(ok.problems).toEqual([]);
    expect(ok.values.slice(24, 27)).toEqual(["", "9876", "543210"]);
    expect(ok.values.slice(38, 50)).toEqual(["2", "", "", "", "", "", "9", "080615", "2", "", "", ""]);
  });
});

describe("被扶養者のデータ", () => {
  test("保存して読み直すと同じ。電話番号はハイフンで分ける", () => {
    const list = [kumi({ reported: markedReported(kumi()) }), child("ichiro")];
    expect(parseHealthDependents(stringifyHealthDependents(list))).toEqual(list);
    expect(parseHealthDependents("壊れた")).toEqual([]);
    expect(splitPhone("03-3456-7890")).toEqual(["03", "3456", "7890"]);
    expect(splitPhone("0334567890")).toBeNull();
  });
});
