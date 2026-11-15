import { describe, expect, test } from "bun:test";
import { SHAHO_SHUTOKU_FIELDS, SHAHO_SHUTOKU_UNION_FIELDS, SHAHO_SOSHITSU_FIELDS, SHAHO_SOSHITSU_UNION_FIELDS } from "../constants/shahoTodoke";
import type { HealthInsurer } from "./healthInsurer";
import { acquiredOnOf, buildShutokuRow, buildSoshitsuRow, estimatedInKindOf, estimatedWageOf, lossOf, shikakuDeadline, type ShutokuInput, type SoshitsuInput } from "./shikakuReport";
import { MY_NUMBER_PLACEHOLDER, buildUnionShahoLines, encodeShahoFile, fillMyNumbers, shahoOfficeValues, unionOfficeValues } from "./shahoCsv";

/** 仕様書の作成例の事業所（事業所整理記号 01-ケイト・事業所番号 123。東京都） */
const office = shahoOfficeValues({
  prefecture: "東京都", symbol: "01-ケイト", number: "123", zip: "100-0000", address: "東京都千代田区霞が関1-2-2",
  name: "健保サービス株式会社", owner: "健保 良一", phone: "03-1234-5678",
}).values;
const union: HealthInsurer = { id: 2, name: "確かめ健康保険組合", type: "union", rates: [], officeNumber: "00001", mediaSeq: 0 };
const kokuho: HealthInsurer = { id: 3, name: "確かめ建設国保", type: "kokuho", rates: [], officeNumber: "", mediaSeq: 0 };

const shutoku = (o: Partial<ShutokuInput> = {}, staff: Record<string, unknown> = {}): ShutokuInput => ({
  staff: { id: "1001", name: "厚年　一郎", furigana: "コウネン イチロウ", birthday: "1981-08-09", gender: "male", ...staff },
  acquiredOn: "2019-05-01", wage: 198000, dependents: false, certificate: false, shortTime: false, rehired: false, remarks: "",
  insurer: null, myNumber: true, today: "2019-05-02", ...o,
});
const soshitsu = (o: Partial<SoshitsuInput> = {}, staff: Record<string, unknown> = {}): SoshitsuInput => ({
  staff: { id: "1002", name: "年金　英一", furigana: "ネンキン エイイチ", birthday: "1965-05-06", gender: "male", pension_num: "6", ...staff },
  cause: "退職等", eventDate: "2019-05-07", rehired: false, remarks: "", returned: 1, unreturned: null,
  insurer: null, myNumber: true, today: "2019-05-08", ...o,
});
/** 保存するときと同じに、マイナンバーを入れた行 */
const line = (row: { staffId: string; values: string[] }, number = "") => fillMyNumbers([row], { [row.staffId]: number })[0].join(",");

describe("資格取得届（仕様書の作成例・電子申請の自動チェック）", () => {
  test("仕様書の作成例（図4.5.1-2）：厚年 一郎・令和1年5月1日取得・個人番号・報酬月額 198,000円（住所は書かない）", () => {
    const row = buildShutokuRow(shutoku(), office);
    expect(row.problems).toEqual([]);
    expect(row.values[12]).toBe(MY_NUMBER_PLACEHOLDER);
    expect(line(row, "123456789000")).toBe(
      "2200700,21,01,ｹｲﾄ,123,,ｺｳﾈﾝ ｲﾁﾛｳ,厚年　一郎,5,560809,1,1,123456789000,,,,,9,010501,0,198000,0,198000,,,,,,,,,,,,",
    );
    expect(row.values).toHaveLength(SHAHO_SHUTOKU_FIELDS.length);
    expect(row.deadline).toBe("2019-05-06");
    expect(row.union).toBeNull();
  });

  test("マイナンバーを書かない人は、基礎年金番号と住所（郵便番号・カナ・漢字）を書く。女子・被扶養者あり・資格確認書・短時間労働者", () => {
    const row = buildShutokuRow(shutoku({ myNumber: false, dependents: true, certificate: true, shortTime: true, wage: 150000 }, {
      name: "厚年　花子", furigana: "コウネン ハナコ", birthday: "1988-03-01", gender: "female", basic_pension_number: "1234-567890",
      zip_code: "168-8500", address: "東京都杉並区高井戸3-2-5", address_kana: "トウキョウト スギナミク タカイド 3-2-5",
    }), office);
    expect(row.problems).toEqual([]);
    expect(row.values.slice(10, 23)).toEqual(["2", "1", "", "", "", "1234", "567890", "9", "010501", "1", "150000", "0", "150000"]);
    expect(row.values[25]).toBe("1");
    expect(row.values.slice(29, 35)).toEqual(["168", "8500", "ﾄｳｷｮｳﾄ ｽｷﾞﾅﾐｸ ﾀｶｲﾄﾞ 3-2-5", "東京都杉並区高井戸３－２－５", "", "1"]);
  });

  test("マイナンバーを書かないのに、基礎年金番号・住所のフリガナ・郵便番号がない／性別がない／報酬月額がないときは直すところ", () => {
    const row = buildShutokuRow(shutoku({ myNumber: false, wage: null }, { gender: "unknown", address: "東京都千代田区" }), office);
    expect(row.problems).toEqual([
      "マイナンバーを書かない人は、基礎年金番号（10けた）を従業員の画面に入れてください（マイナンバーも基礎年金番号もない届書は返されます）",
      "性別を従業員の画面に入れてください（届書の「種別」に書きます）",
      "報酬月額を入れてください（資格取得時の決定：月給は月の額、時給・日給は同じ仕事の人の報酬などから。残業代などの見込みも入れます）",
      "郵便番号（7けた）を従業員の画面に入れてください（マイナンバーを書かない人は、住所を書きます）",
      "住所のフリガナを従業員の画面に入れてください（マイナンバーを書かない人は、住所をカナで書きます）",
    ]);
  });

  test("資格取得日が届け出る日より後なら、まだ届け出られない（e-Gov の自動チェック）。漢字で書けない住所は書かない", () => {
    const row = buildShutokuRow(shutoku({ today: "2019-04-30", myNumber: false }, {
      basic_pension_number: "1234567890", zip_code: "1688500", address: "東京都杉並区髙井戸3-2-5", address_kana: "ﾄｳｷｮｳﾄ ｽｷﾞﾅﾐｸ ﾀｶｲﾄﾞ 3-2-5",
    }), office);
    expect(row.problems).toEqual(["資格取得日（2019-05-01）になってから届け出ます（e-Gov は、資格取得日が届け出る日より後の届書を受け付けません）"]);
    expect(row.values[32]).toBe("");
    expect(row.notes).toContain("住所に届書に書けない字（髙）があるので、漢字の住所は書きません（カナの住所で届きます）");
  });

  test("協会けんぽの70〜74歳は、健康保険の資格取得と70歳以上被用者該当を1つの届書で（備考1に印）", () => {
    // 1954-05-01 生まれ：70歳に達する日 2024-04-30
    const row = buildShutokuRow(shutoku({ acquiredOn: "2026-04-01", today: "2026-04-02" }, { birthday: "1954-05-01" }), office);
    expect([row.over70, row.over70Only]).toEqual([true, false]);
    expect(row.values.slice(10, 12)).toEqual(["1", "1"]);
    expect([row.values[23], row.values[33]]).toEqual(["1", ""]);
  });

  test("75歳以上は「70歳以上被用者届のみ提出」（種別・取得区分・被扶養者・資格確認書は書かない）", () => {
    const row = buildShutokuRow(shutoku({ acquiredOn: "2026-04-01", today: "2026-04-02", dependents: true, certificate: true }, { birthday: "1950-05-01" }), office);
    expect([row.over70, row.over70Only]).toEqual([true, true]);
    expect(row.values.slice(10, 12)).toEqual(["", ""]);
    expect([row.values[19], row.values[23], row.values[33], row.values[34]]).toEqual(["0", "1", "1", ""]);
    expect(row.problems).toEqual([]);
  });

  test("国民健康保険組合の人は、取得区分を「健康保険適用除外承認申請書を同時に提出する者」（6）にする", () => {
    const row = buildShutokuRow(shutoku({ insurer: kokuho, dependents: true }), office);
    expect([row.values[11], row.values[19]]).toEqual(["6", "0"]);
    expect(row.notes).toContain("国民健康保険組合の人なので、「健康保険 被保険者適用除外承認申請書」も一緒に出します（事実発生から14日以内）");
    expect(row.union).toBeNull();
  });

  test("健康保険組合の人は、組合に出す行も作る（基礎年金番号・届のみは書かない。被扶養者・資格確認書は組合の行に書く。うしろに組合の項目）", () => {
    const row = buildShutokuRow(shutoku({ insurer: union, dependents: true, certificate: true }, { health_ins_num: "12-34" }), office);
    expect([row.values[19], row.values[34]]).toEqual(["0", ""]);
    expect(row.union?.values).toHaveLength(SHAHO_SHUTOKU_UNION_FIELDS.length);
    expect(row.union?.values.slice(0, 13)).toEqual(row.values.slice(0, 13));
    expect(row.union?.values.slice(15, 23)).toEqual(["", "", "9", "010501", "1", "198000", "0", "198000"]);
    expect(row.union?.values.slice(33)).toEqual(["", "1", "00001", "1234", ""]);
    expect(row.union?.problems).toEqual([]);
  });

  test("健康保険組合の70歳以上の人：年金事務所には届のみ、組合には健康保険の資格取得（種別・取得区分を書く）", () => {
    const row = buildShutokuRow(shutoku({ insurer: union, acquiredOn: "2026-04-01", today: "2026-04-02" }, { birthday: "1954-05-01" }), office);
    expect(row.over70Only).toBe(true);
    expect([row.values[10], row.values[11], row.values[33]]).toEqual(["", "", "1"]);
    expect([row.union?.values[10], row.union?.values[11], row.union?.values[23], row.union?.values[33]]).toEqual(["1", "1", "1", ""]);
  });

  test("報酬月額が1千万円以上は 9999999（仕様書の決まり）", () => {
    const row = buildShutokuRow(shutoku({ wage: 12_000_000 }), office);
    expect(row.values.slice(20, 23)).toEqual(["9999999", "0", "9999999"]);
  });
});

describe("資格喪失届（仕様書の作成例・電子申請の自動チェック）", () => {
  test("仕様書の作成例（図4.6.1-2）：年金 英一・令和1年5月7日退職（喪失日 5月8日）・退職等・資格確認書の添付1枚・個人番号", () => {
    const row = buildSoshitsuRow(soshitsu(), office);
    expect(row.problems).toEqual([]);
    expect(row.lostOn).toBe("2019-05-08");
    expect(line(row, "123456780900")).toBe("2201700,21,01,ｹｲﾄ,123,6,ﾈﾝｷﾝ ｴｲｲﾁ,年金　英一,5,400506,123456780900,,,9,010508,4,9,010507,,,,1,,,,,");
    expect(row.values).toHaveLength(SHAHO_SOSHITSU_FIELDS.length);
    expect(row.deadline).toBe("2019-05-13");
  });

  test("死亡は死亡日の翌日に喪失（原因 5）。マイナンバーを書かない人は基礎年金番号", () => {
    const row = buildSoshitsuRow(soshitsu({ cause: "死亡", eventDate: "2026-02-10", today: "2026-02-12", myNumber: false, returned: null }, { basic_pension_number: "0123012345" }), office);
    expect(row.values.slice(10, 18)).toEqual(["", "0123", "012345", "9", "080211", "5", "9", "080210"]);
    expect(row.problems).toEqual([]);
  });

  test("資格喪失日（退職日の翌日）より前は、まだ届け出られない。整理番号がなければ直すところ", () => {
    const row = buildSoshitsuRow(soshitsu({ today: "2019-05-07" }, { pension_num: "" }), office);
    expect(row.problems).toEqual([
      "被保険者整理番号がありません（従業員の画面の「厚生年金 整理番号」に、資格取得のときに知らされた番号を入れてください）",
      "資格喪失日（退職日の翌日 2019-05-08）になってから届け出ます（e-Gov は、資格喪失日が届け出る日より後の届書を受け付けません）",
    ]);
  });

  test("協会けんぽの70〜74歳：健康保険の喪失と、70歳不該当（不該当年月日は退職日）", () => {
    const row = buildSoshitsuRow(soshitsu({ eventDate: "2026-03-31", today: "2026-04-02" }, { birthday: "1954-05-01" }), office);
    expect([row.over70, row.over70Only]).toEqual([true, false]);
    expect(row.values.slice(13, 15)).toEqual(["9", "080401"]);
    expect(row.values.slice(23)).toEqual(["1", "9", "080331", ""]);
  });

  test("75歳以上は70歳以上被用者不該当届のみ（被保険者整理番号・資格喪失年月日・資格確認書を書かない）", () => {
    const row = buildSoshitsuRow(soshitsu({ eventDate: "2026-03-31", today: "2026-04-02" }, { birthday: "1950-05-01" }), office);
    expect(row.over70Only).toBe(true);
    expect([row.values[5], row.values[13], row.values[14], row.values[21]]).toEqual(["", "", "", ""]);
    expect(row.values.slice(23)).toEqual(["1", "9", "080331", "1"]);
    expect(row.problems).toEqual([]);
  });

  test("健康保険組合の人は、組合に出す行も作る（資格確認書の回収は組合の行に。被保険者等番号がなければ直すところ）", () => {
    const row = buildSoshitsuRow(soshitsu({ insurer: union, returned: 2, unreturned: 1 }), office);
    expect(row.values.slice(21, 23)).toEqual(["", ""]);
    expect(row.union?.values).toHaveLength(SHAHO_SOSHITSU_UNION_FIELDS.length);
    expect(row.union?.values.slice(21, 23)).toEqual(["2", "1"]);
    expect(row.union?.values.slice(27)).toEqual(["00001", "", ""]);
    expect(row.union?.problems).toEqual(["確かめ健康保険組合の被保険者等番号がありません（従業員の画面の「健康保険 被保険者番号」に、組合の被保険者証の番号を入れてください）"]);
  });
});

describe("電子申請用ファイル", () => {
  test("マイナンバーは保存するときに入れる（番号がない人がいれば止める）", () => {
    const row = buildShutokuRow(shutoku(), office);
    expect(() => fillMyNumbers([row], {})).toThrow("マイナンバーを読めない人がいます");
    expect(fillMyNumbers([row], { "1001": "123456789000" })[0][12]).toBe("123456789000");
  });

  test("健康保険組合に出すファイル（KPFD0006.CSV）：媒体管理レコード・事業所情報が組合のもの（仕様書の作成例 図4.1.2-2・図4.3.2.2-2）", () => {
    const unionOffice = unionOfficeValues(office, "00001");
    expect(unionOffice.problems).toEqual([]);
    expect(unionOffice.values.join(",")).toBe("00001,100,0000,東京都千代田区霞が関１－２－２,健保サービス株式会社,健保　良一,03,1234,5678");
    const lines = buildUnionShahoLines(unionOffice.values, 1, "2017-01-01", ["DATA"]);
    expect(lines.slice(0, 5)).toEqual(["00001,001,20170101,,,,,", "[kanri]", ",001", unionOffice.values.join(","), "[data]"]);
    expect(unionOfficeValues(office, "").problems).toEqual(["健康保険組合の事業所番号がありません（会社設定の「社会保険規定」で、その健康保険組合の事業所番号を入れてください）"]);
    expect(encodeShahoFile(lines).length).toBeGreaterThan(0);
  });

  test("提出期限は事実発生から5日以内", () => {
    expect(shikakuDeadline("2026-03-30")).toBe("2026-04-04");
  });
});

describe("届書の画面の初めの値", () => {
  test("資格取得日は入社日。標準報酬月額の履歴で、入社した月より後から加入した人は、その月の1日", () => {
    expect(acquiredOnOf({ join_date: "2026-04-10", standard_remuneration: 200000 })).toEqual({ date: "2026-04-10", fromHistory: false });
    const later = {
      join_date: "2025-10-06",
      standard_remuneration_history: JSON.stringify([{ from: "", amount: 0, reason: "shutoku" }, { from: "2026-04", amount: 104000, reason: "shutoku" }]),
    };
    expect(acquiredOnOf(later)).toEqual({ date: "2026-04-01", fromHistory: true });
  });
  test("報酬月額は、月給の人だけ基本給＋固定残業代＋通勤手当（月額）", () => {
    expect(estimatedWageOf({ wage_type: "monthly", base_wage: 250000, fixed_overtime_allowance: 30000, commute_type: "monthly", commute_amount: 12000 })).toBe(292000);
    expect(estimatedWageOf({ wage_type: "monthly", base_wage: 250000, commute_type: "daily", commute_amount: 500 })).toBe(250000);
    expect(estimatedWageOf({ wage_type: "hourly", base_wage: 1200 })).toBeNull();
    // 定期券などを現物で渡す通勤手当は、通貨に入れない（現物の見込みに入れる）
    expect(estimatedWageOf({ wage_type: "monthly", base_wage: 250000, commute_type: "monthly", commute_amount: 12000, commute_setting: JSON.stringify({ inKind: true }) })).toBe(250000);
  });
  test("報酬月額の現物は、資格取得日にしている「現物で払う報酬」の1か月分と、定期券などで渡す通勤手当（勤務地の都道府県の価額）", () => {
    const staff = {
      commute_type: "monthly", commute_amount: 12000, commute_setting: JSON.stringify({ inKind: true }),
      in_kind: JSON.stringify([{ kind: "housing", name: "社宅", start: "2026-11-01", area: 40, selfPay: 20000 }]),
    };
    // 東京 1,330円 × 40平方メートル ＝ 53,200円 − 家賃 20,000円 ＝ 33,200円 ＋ 通勤手当 12,000円
    expect(estimatedInKindOf(staff, "2026-11-16", "東京", 21)).toEqual({ amount: 45200, problems: [] });
    expect(estimatedInKindOf(staff, "2026-11-16", null, 21).problems).toHaveLength(1);
    expect(estimatedInKindOf({}, "2026-11-16", "東京", 21)).toEqual({ amount: 0, problems: [] });
  });
  test("資格取得届の報酬月額に、通貨・現物・合計を書く", () => {
    const row = buildShutokuRow(shutoku({ wage: 198000, inKind: 33200 }), office);
    expect(row.values.slice(20, 23)).toEqual(["198000", "33200", "231200"]);
  });
  test("喪失の原因：死亡日が退職日より前か同じなら死亡、そうでなければ退職等", () => {
    expect(lossOf({ retirement_date: "2026-03-31" })).toEqual({ cause: "退職等", date: "2026-03-31" });
    expect(lossOf({ retirement_date: "2026-03-31", death_date: "2026-03-20" })).toEqual({ cause: "死亡", date: "2026-03-20" });
    expect(lossOf({ retirement_date: "2026-03-31", death_date: "2026-05-01" })).toEqual({ cause: "退職等", date: "2026-03-31" });
    expect(lossOf({})).toBeNull();
  });
});
