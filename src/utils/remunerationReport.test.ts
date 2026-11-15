import { describe, expect, test } from "bun:test";
import {
  autoChangeReason, buildGeppenReport, buildGeppenReportRow, buildSanteiReport, buildSanteiReportRow, countedMonths,
  leaveRemark, payRuleText, pensionStandardOf, shahoMonth, thousandsText, type GeppenReportInput, type SanteiReportInput,
} from "./remunerationReport";
import { buildShahoLines, encodeShahoFile, shahoOfficeValues } from "./shahoCsv";
import { SHAHO_GEPPEN_FIELDS, SHAHO_GEPPEN_UNION_FIELDS, SHAHO_SANTEI_FIELDS, SHAHO_SANTEI_UNION_FIELDS } from "../constants/shahoTodoke";
import type { HealthInsurer } from "./healthInsurer";

/** 仕様書の作成例の事業所（事業所整理記号 57-ケマ。東京都） */
const office = shahoOfficeValues({
  prefecture: "東京都", symbol: "57-ケマ", number: "8505", zip: "168-8505", address: "東京都杉並区高井戸3-5-24",
  name: "株式会社健保産業", owner: "健保 一郎", phone: "03-2345-6789",
}).values;
const PENSION = { min: 88000, max: 650000 };
/** 末日締め翌月払いの計算期間（4・5・6月に払う給与は、3・4・5月の分） */
const lastDayPeriods = (year: number) => ({
  4: { startStr: `${year}-03-01`, endStr: `${year}-03-31` },
  5: { startStr: `${year}-04-01`, endStr: `${year}-04-30` },
  6: { startStr: `${year}-05-01`, endStr: `${year}-05-31` },
});
const staff = (o: Record<string, unknown> = {}) => ({
  id: "S001", name: "健保 一郎", furigana: "ケンポ イチロウ", birthday: "1990-05-27", pension_num: "1", join_date: "2010-04-01", ...o,
});
const months = (days: (number | null)[], amounts: (number | null)[], partial: boolean[] = [false, false, false]) =>
  [4, 5, 6].map((month, i) => ({ month, days: days[i], amount: amounts[i], partialJoin: partial[i] }));
const santei = (o: Partial<SanteiReportInput> = {}): SanteiReportInput => ({
  staff: staff(), year: 2026, previous: 300000, previousFrom: "2025-09",
  months: months([31, 30, 31], [300000, 300000, 300000]), kind: "general",
  ordinaryAverage: 300000, annualAverage: null, unfinalizedMonths: [], wageChange: null, retro: null,
  periods: lastDayPeriods(2026), payRule: "末日締め翌月25日払い", insurerType: "kyokai", pensionRange: PENSION, remarks: null, ...o,
});

describe("算定基礎届（仕様書の作成例・ガイドブックの例と同じになる）", () => {
  test("仕様書の作成例（図4.7.1-1）：健保 一郎・令和1年9月の定時決定・従前30万円（平成30年9月から）・4〜6月に30万円ずつ", () => {
    // 作成例の人は73歳なので、作成例と同じにするため 70歳未満の生年月日で比べ、元号と年月日だけ作成例の値に差し替える
    const row = buildSanteiReportRow(santei({ year: 2019, previousFrom: "2018-09", periods: lastDayPeriods(2019) }), office);
    const values = [...row.values];
    values[7] = "5";
    values[8] = "210527";
    expect(values.join(",")).toBe(
      "2225700,21,57,ｹﾏ,1,ｹﾝﾎﾟ ｲﾁﾛｳ,健保　一郎,5,210527,9,01,09,0300,0300,7,30,09,,,,,04,05,06,31,30,31,300000,300000,300000,0,0,0,300000,300000,300000,900000,300000,,,,,,,,,,,,,,,",
    );
    expect(row.problems).toEqual([]);
    expect(row.values).toHaveLength(SHAHO_SANTEI_FIELDS.length);
  });

  test("ケース①：従前 健保680千円・厚年650千円（厚生年金の上限）", () => {
    const row = buildSanteiReportRow(santei({ previous: 680000 }), office);
    expect(row.values.slice(12, 14)).toEqual(["0680", "0650"]);
    expect([row.previousHealth, row.previousPension]).toEqual([680000, 650000]);
  });

  test("ケース⑤ 途中入社：4月1日入社・20日締め翌月10日払い → 総計 348,000・平均額 174,000・修正平均額 200,000、備考4と資格取得日・締め日", () => {
    const row = buildSanteiReportRow(santei({
      staff: staff({ join_date: "2026-04-01" }), previous: 200000, previousFrom: "2026-04",
      months: months([null, 20, 30], [null, 148000, 200000], [false, true, false]), ordinaryAverage: 200000,
      payRule: "20日締め翌月10日払い",
      periods: {
        4: { startStr: "2026-02-21", endStr: "2026-03-20" }, 5: { startStr: "2026-03-21", endStr: "2026-04-20" }, 6: { startStr: "2026-04-21", endStr: "2026-05-20" },
      },
    }), office);
    expect(row.values.slice(14, 17)).toEqual(["9", "08", "04"]);
    expect(row.values.slice(24, 39)).toEqual(["00", "20", "30", "0", "148000", "200000", "0", "0", "0", "0", "148000", "200000", "348000", "174000", "200000"]);
    expect(row.values[46]).toBe("1");
    expect(row.remarks).toBe("令和８年４月１日取得　２０日締め翌月１０日払い");
    expect(row.values[51]).toBe(row.remarks);
    expect(row.problems).toEqual([]);
  });

  test("ケース⑥ 算定の期間の途中で70歳：昭和31年4月10日生まれ・末日締め翌月15日払い → 70歳算定基礎月 06、厚年は書かない", () => {
    const row = buildSanteiReportRow(santei({
      staff: staff({ name: "健保 康夫", furigana: "ケンポ ヤスオ", birthday: "1956-04-10", pension_num: "77", basic_pension_number: "1234-567890" }),
      previous: 320000, months: months([31, 30, 31], [326500, 284550, 282140]), ordinaryAverage: 297730, payRule: "末日締め翌月15日払い",
    }), office);
    expect(row.values.slice(12, 14)).toEqual(["0320", ""]);
    expect(row.values.slice(36, 38)).toEqual(["893190", "297730"]);
    expect(row.values.slice(40, 44)).toEqual(["1234", "567890", "1", "06"]);
    expect(row.over70Months).toEqual([6]);
    expect(row.remarks).toBe("末日締め翌月１５日払い");
    expect(row.problems).toEqual([]);
  });

  test("ケース⑩ 3月以前の昇給の差額を4月に払った：遡及支払 04・20,000円、修正平均額は差額を除いた 267,000", () => {
    const row = buildSanteiReportRow(santei({
      previous: 240000, months: months([31, 30, 31], [287000, 267000, 267000]), ordinaryAverage: 267000,
      wageChange: { month: 4, direction: "up" }, retro: { month: 4, amount: 20000 },
    }), office);
    expect(row.values.slice(17, 21)).toEqual(["04", "1", "04", "20000"]);
    expect(row.values.slice(36, 39)).toEqual(["821000", "273666", "267000"]);
  });

  test("パート：17日以上の月がなければ15日以上の月（16・15・16日）で、備考7（記入例の3人目）", () => {
    const row = buildSanteiReportRow(santei({
      kind: "part", previous: 118000, months: months([16, 15, 16], [124800, 117000, 124800]), ordinaryAverage: 122200,
    }), office);
    expect(row.values.slice(36, 39)).toEqual(["366600", "122200", ""]);
    expect(row.values[49]).toBe("1");
  });

  test("短時間労働者は11日以上の月（備考6）。17日に足りない月は総計に入れない（13日の月：記入例の1人目）", () => {
    expect(countedMonths([12, 10, 11], "short")).toEqual([true, false, true]);
    expect(countedMonths([16, 15, 14], "part")).toEqual([true, true, false]);
    expect(countedMonths([17, 16, 15], "part")).toEqual([true, false, false]);
    const row = buildSanteiReportRow(santei({ months: months([19, 13, 20], [125200, 118800, 129100]), ordinaryAverage: 127150 }), office);
    expect(row.values.slice(36, 39)).toEqual(["254300", "127150", ""]);
    expect(buildSanteiReportRow(santei({ kind: "short", months: months([12, 10, 11], [100000, 90000, 100000]), ordinaryAverage: 100000 }), office).values[48]).toBe("1");
  });

  test("年間平均で申し立てる：修正平均額に年間平均 320,875、備考8（ガイドブックの例）", () => {
    const row = buildSanteiReportRow(santei({
      previous: 380000, months: months([31, 30, 31], [380000, 380000, 380000]), ordinaryAverage: 380000, annualAverage: 320875,
    }), office);
    expect(row.values.slice(36, 39)).toEqual(["1140000", "380000", "320875"]);
    expect(row.values[50]).toBe("1");
  });

  test("健康保険組合の人は健保を書かない。75歳以上は70歳以上被用者届のみ（整理番号・健保・厚年を書かない）", () => {
    const union = buildSanteiReportRow(santei({ insurerType: "union" }), office);
    expect(union.values.slice(12, 14)).toEqual(["", "0300"]);
    expect(union.notes.join("")).toContain("健康保険組合");
    const old = buildSanteiReportRow(santei({ staff: staff({ birthday: "1950-03-01", basic_pension_number: "0123012345" }) }), office);
    expect([old.values[4], old.values[12], old.values[13], old.values[42], old.values[52]]).toEqual(["", "", "", "1", "1"]);
    expect(old.values.slice(40, 42)).toEqual(["0123", "012345"]);
    expect(old.problems).toEqual([]);
  });

  test("健康保険組合の70歳以上の人は、70歳以上被用者算定基礎届だけ（整理番号・健保・厚年を書かない）", () => {
    const row = buildSanteiReportRow(santei({ insurerType: "union", staff: staff({ birthday: "1954-01-01", basic_pension_number: "1234567890" }) }), office);
    expect([row.values[4], row.values[12], row.values[13], row.values[42], row.values[52], row.problems]).toEqual(["", "", "", "1", "1", []]);
  });

  test("70歳以上で基礎年金番号がない・従前の改定月がない・給与が未確定は、直すところ", () => {
    const row = buildSanteiReportRow(santei({
      staff: staff({ birthday: "1955-01-01", join_date: null }), previousFrom: null, unfinalizedMonths: [5, 6],
    }), office);
    expect(row.problems.join("\n")).toContain("基礎年金番号");
    expect(row.problems.join("\n")).toContain("従前の改定月");
    expect(row.problems.join("\n")).toContain("5・6月の給与が確定していません");
  });

  test("6月に70歳になった人は、備考の70歳以上被用者算定に印を付けない（厚年も書かない）", () => {
    const row = buildSanteiReportRow(santei({ staff: staff({ birthday: "1956-06-15" }) }), office);
    expect([row.values[13], row.values[42], row.values[43]]).toEqual(["", "", ""]);
    expect(row.notes.join("")).toContain("6月に70歳以上被用者になった");
  });

  test("休業・休職は備考5と備考欄に書く。1千万円以上は 9999999。直した備考欄はそのまま使う（全角にする）", () => {
    const leave = buildSanteiReportRow(santei({
      staff: staff({ leave_periods: JSON.stringify([{ type: "childcare", start: "2026-04-10", end: "2026-04-30" }]) }),
    }), office);
    expect([leave.values[47], leave.remarks]).toEqual(["1", "８年４月〜８年４月育児休業"]);
    const big = buildSanteiReportRow(santei({ months: months([31, 30, 31], [10000000, 10000000, 10000000]), ordinaryAverage: 10000000 }), office);
    expect(big.values.slice(27, 30)).toEqual(["9999999", "9999999", "9999999"]);
    expect(big.values.slice(36, 38)).toEqual(["9999999", "9999999"]);
    expect(buildSanteiReportRow(santei({ remarks: "住宅 R8.4" }), office).remarks).toBe("住宅　Ｒ８．４");
  });

  test("届書は被保険者整理番号の順", () => {
    const rows = buildSanteiReport([
      santei({ staff: staff({ id: "A", pension_num: "12" }) }),
      santei({ staff: staff({ id: "B", pension_num: "3" }) }),
    ], office);
    expect(rows.map((r) => r.pensionNumber)).toEqual(["3", "12"]);
  });
});

describe("算定基礎届・月額変更届の部品", () => {
  test("千円で4文字・年月の和暦・厚生年金の上限下限・締め日と支払日", () => {
    expect([thousandsText(300000), thousandsText(1390000), thousandsText(58000)]).toEqual(["0300", "1390", "0058"]);
    expect(shahoMonth("2019-09")).toEqual({ era: "9", year: "01", month: "09" });
    expect(shahoMonth("2018-09")).toEqual({ era: "7", year: "30", month: "09" });
    expect(shahoMonth(null)).toBeNull();
    expect([pensionStandardOf(58000, PENSION), pensionStandardOf(1390000, PENSION), pensionStandardOf(300000, PENSION)]).toEqual([88000, 650000, 300000]);
    expect(payRuleText({ closing_day: 99, is_next_month: 1, payment_day: 25 })).toBe("末日締め翌月25日払い");
    expect(payRuleText({ closing_day: 15, is_next_month: 0, payment_day: 31 })).toBe("15日締め当月末日払い");
  });
  test("休業・休職の備考：期間に重なるものだけ。終わっていなければ始まりだけ", () => {
    const s = { leave_periods: JSON.stringify([
      { type: "maternity", start: "2026-02-01", end: "2026-04-15" },
      { type: "childcare", start: "2026-04-16", end: "" },
      { type: "other", start: "2025-01-01", end: "2025-02-01" },
    ]) };
    expect(leaveRemark(s, "2026-03-01", "2026-05-31")).toBe("8年2月〜8年4月産前産後休業　8年4月〜育児休業");
  });
  test("昇給・降給の理由の初めの文", () => {
    expect(autoChangeReason("monthly", { before: 250000, after: 260000 }, { before: null, after: null })).toBe("基本給の変更");
    expect(autoChangeReason("hourly", { before: 1100, after: 1200 }, { before: null, after: null })).toBe("時給の変更");
    expect(autoChangeReason("monthly", { before: 250000, after: 260000 }, { before: 20000, after: 25000 })).toBe("基本給・固定残業代の変更");
    expect(autoChangeReason("monthly", { before: null, after: null }, { before: 0, after: 30000 })).toBe("固定残業代の支給");
    expect(autoChangeReason("monthly", { before: null, after: null }, { before: 30000, after: 0 })).toBe("固定残業代の廃止");
    expect(autoChangeReason("monthly", { before: null, after: null }, { before: null, after: null })).toBe("固定的賃金の変更");
    // 現物で払う報酬（社宅・食事など）の価額の変動
    const none = { monthly: 0, daily: 0 };
    const nobase = { before: null, after: null };
    expect(autoChangeReason("monthly", nobase, nobase, { before: none, after: { monthly: 45280, daily: 0 } })).toBe("現物給与の支給");
    expect(autoChangeReason("monthly", nobase, nobase, { before: { monthly: 45280, daily: 0 }, after: none })).toBe("現物給与の廃止");
    expect(autoChangeReason("monthly", nobase, nobase, { before: { monthly: 45280, daily: 0 }, after: { monthly: 53200, daily: 0 } })).toBe("現物給与の価額の変更");
    expect(autoChangeReason("monthly", { before: 250000, after: 260000 }, nobase, { before: { monthly: 45280, daily: 0 }, after: { monthly: 53200, daily: 0 } }))
      .toBe("基本給の変更・現物給与の価額の変更");
  });
  test("報酬月額の「通貨によるもの」「現物によるもの」「合計」：現物は確定した給与の現物で払った報酬（社宅など）", () => {
    const withInKind = [4, 5, 6].map((month) => ({ month, days: 30, amount: 325280, inKind: 25280, partialJoin: false }));
    const row = buildSanteiReportRow(santei({ months: withInKind, ordinaryAverage: 325280 }), office);
    expect(row.values.slice(27, 38)).toEqual(["300000", "300000", "300000", "25280", "25280", "25280", "325280", "325280", "325280", "975840", "325280"]);
    expect(row.months.map((m) => [m.currency, m.inKind, m.total])).toEqual([[300000, 25280, 325280], [300000, 25280, 325280], [300000, 25280, 325280]]);
    // 月額変更届も同じ（画面で報酬を現物より少なく直したときは、現物はその額まで）
    const g = buildGeppenReportRow(geppen({
      months: [{ year: 2019, month: 9, days: 31, amount: 345280, inKind: 45280 }, { year: 2019, month: 10, days: 30, amount: 345280, inKind: 45280 }, { year: 2019, month: 11, days: 31, amount: 20000, inKind: 45280 }],
      ordinaryAverage: 236853,
    }), office);
    expect(g.values.slice(27, 36)).toEqual(["300000", "300000", "0", "45280", "45280", "20000", "345280", "345280", "20000"]);
  });
});

const geppen = (o: Partial<GeppenReportInput> = {}): GeppenReportInput => ({
  staff: staff({ name: "厚年 三郎", furigana: "コウネン サブロウ", birthday: "1990-07-08", pension_num: "17" }),
  changeYear: 2019, changeMonth: 9, direction: "up", revisionFrom: "2019-12", previous: 260000, previousFrom: "2019-09",
  months: [{ year: 2019, month: 9, days: 31, amount: 300000 }, { year: 2019, month: 10, days: 30, amount: 300000 }, { year: 2019, month: 11, days: 31, amount: 300000 }],
  short: false, ordinaryAverage: 300000, annualAverage: null, retro: null, reason: null, autoReason: "基本給の変更", remarks: null,
  insurerType: "kyokai", pensionRange: PENSION, ...o,
});

describe("月額変更届（仕様書の作成例・記入例と同じになる）", () => {
  test("仕様書の作成例（図4.8.1-2）：厚年 三郎・令和1年9月に昇給・12月改定・従前26万円（令和1年9月から）", () => {
    const row = buildGeppenReportRow(geppen(), office);
    const values = [...row.values];
    values[7] = "5";
    values[8] = "350708";
    expect(values.join(",")).toBe(
      "2221700,21,57,ｹﾏ,17,ｺｳﾈﾝ ｻﾌﾞﾛｳ,厚年　三郎,5,350708,9,01,12,0260,0260,9,01,09,09,1,,,09,10,11,31,30,31,300000,300000,300000,0,0,0,300000,300000,300000,900000,300000,,,,,,,,基本給の変更,,,",
    );
    expect(row.problems).toEqual([]);
    expect(row.values).toHaveLength(SHAHO_GEPPEN_FIELDS.length);
  });

  test("記入例の2人目：昇給の差額18,000円を10月に払った → 総計 720,000・平均額 240,000・修正平均額 234,000", () => {
    const row = buildGeppenReportRow(geppen({
      changeYear: 2025, changeMonth: 10, revisionFrom: "2026-01", previous: 200000, previousFrom: "2025-09",
      months: [{ year: 2025, month: 10, days: 30, amount: 252000 }, { year: 2025, month: 11, days: 31, amount: 234000 }, { year: 2025, month: 12, days: 30, amount: 234000 }],
      ordinaryAverage: 234000, retro: { index: 0, amount: 18000 },
    }), office);
    expect(row.values.slice(9, 21)).toEqual(["9", "08", "01", "0200", "0200", "9", "07", "09", "10", "1", "10", "18000"]);
    expect(row.values.slice(36, 39)).toEqual(["720000", "240000", "234000"]);
    expect(row.problems).toEqual([]);
  });

  test("年間平均で申し立てる：修正平均額に年間平均額、備考欄に「年間平均」", () => {
    const row = buildGeppenReportRow(geppen({ annualAverage: 280000 }), office);
    expect([row.values[38], row.values[47]]).toEqual(["280000", "年間平均"]);
  });

  test("降給は区分 2。理由を直すと備考欄項目4に書く。短時間労働者は11日からで備考3", () => {
    const down = buildGeppenReportRow(geppen({ direction: "down", reason: "役付手当の廃止" }), office);
    expect([down.values[18], down.values[45]]).toEqual(["2", "役付手当の廃止"]);
    const short = buildGeppenReportRow(geppen({
      short: true, months: [{ year: 2019, month: 9, days: 12, amount: 150000 }, { year: 2019, month: 10, days: 11, amount: 150000 }, { year: 2019, month: 11, days: 13, amount: 150000 }],
      ordinaryAverage: 150000,
    }), office);
    expect([short.values[44], short.problems]).toEqual(["1", []]);
  });

  test("17日に足りない月・確定していない月・改定年月が合わないときは、直すところ", () => {
    const row = buildGeppenReportRow(geppen({
      revisionFrom: "2020-01",
      months: [{ year: 2019, month: 9, days: 16, amount: 300000 }, { year: 2019, month: 10, days: 30, amount: null }, { year: 2019, month: 11, days: 31, amount: 300000 }],
    }), office);
    const text = row.problems.join("\n");
    expect(text).toContain("17日から31日");
    expect(text).toContain("確定していない月");
    expect(text).toContain("改定年月の前の3か月");
  });

  test("70歳以上被用者：変動月より前に70歳なら備考1と基礎年金番号。改定年月の前3か月の間に70歳なら付けない", () => {
    const before = buildGeppenReportRow(geppen({ staff: staff({ birthday: "1949-01-15", pension_num: "17", basic_pension_number: "1234567890" }) }), office);
    expect([before.values[13], before.values[40], before.values[41], before.values[42], before.values[48]]).toEqual(["", "1234", "567890", "1", ""]);
    const within = buildGeppenReportRow(geppen({ staff: staff({ birthday: "1949-10-20", pension_num: "17" }) }), office);
    expect([within.values[13], within.values[42]]).toEqual(["", ""]);
    expect(within.notes.join("")).toContain("前3か月の間に70歳以上被用者になった");
  });

  test("届書のファイル：算定基礎届と月額変更届の行も、賞与支払届と同じ形のファイルに書ける（シフトJIS・CR LF）", () => {
    const rows = buildGeppenReport([geppen()], office);
    const lines = buildShahoLines(office, 5, "2026-11-14", rows.map((r) => r.values.join(",")));
    expect(lines[0]).toBe("21,57,ｹﾏ,005,20261114,22223");
    const bytes = encodeShahoFile(lines);
    const text = new TextDecoder("shift_jis").decode(bytes);
    expect(text.split("\r\n")[5]).toBe(rows[0].values.join(","));
    expect(buildSanteiReport([santei()], office)[0].values[0]).toBe("2225700");
  });
});

describe("健康保険組合に出す行（KPFD0006.CSV。仕様書の 4.7.2・4.8.2）", () => {
  const union: HealthInsurer = { id: 2, name: "確かめ健康保険組合", type: "union", rates: [], officeNumber: "00001", mediaSeq: 0 };
  test("算定基礎届：組合の行には健保の従前の標準報酬月額を書き、個人番号・基礎年金番号・届のみは書かない。うしろに組合の項目", () => {
    const row = buildSanteiReportRow(santei({ insurerType: "union", insurer: union, staff: staff({ health_ins_num: "123" }) }), office);
    expect(row.values[12]).toBe("");
    expect(row.union?.values).toHaveLength(SHAHO_SANTEI_UNION_FIELDS.length);
    expect(row.union?.values[12]).toBe("0300");
    expect(row.union?.values.slice(0, 12)).toEqual(row.values.slice(0, 12));
    expect(row.union?.values.slice(13, 39)).toEqual(row.values.slice(13, 39));
    expect(row.union?.values.slice(39, 42)).toEqual(["", "", ""]);
    expect(row.union?.values.slice(52)).toEqual(["", "00001", "123", ""]);
    expect(row.union?.problems).toEqual([]);
  });
  test("算定基礎届：組合の70歳以上の人は、年金事務所には届のみ（整理番号なし）、組合には整理番号と健保を書く。75歳以上は組合の行がない", () => {
    const row = buildSanteiReportRow(santei({ insurerType: "union", insurer: union, staff: staff({ birthday: "1954-05-27", basic_pension_number: "1234567890", health_ins_num: "45" }) }), office);
    expect([row.over70Only, row.values[4], row.values[12], row.values[13]]).toEqual([true, "", "", ""]);
    expect([row.union?.values[4], row.union?.values[12], row.union?.values[13], row.union?.values[42]]).toEqual(["1", "0300", "", "1"]);
    const old = buildSanteiReportRow(santei({ insurerType: "union", insurer: union, staff: staff({ birthday: "1949-05-27", basic_pension_number: "1234567890" }) }), office);
    expect(old.union).toBeNull();
    expect(buildSanteiReportRow(santei(), office).union).toBeNull();
  });
  test("月額変更届も同じ（被保険者等番号がなければ直すところ）", () => {
    const row = buildGeppenReportRow(geppen({ insurerType: "union", insurer: union }), office);
    expect(row.union?.values).toHaveLength(SHAHO_GEPPEN_UNION_FIELDS.length);
    expect([row.values[12], row.union?.values[12]]).toEqual(["", "0260"]);
    expect(row.union?.values.slice(48)).toEqual(["", "00001", "", ""]);
    expect(row.union?.problems).toEqual(["確かめ健康保険組合の被保険者等番号がありません（従業員の画面の「健康保険 被保険者番号」に、組合の被保険者証の番号を入れてください）"]);
  });
});
