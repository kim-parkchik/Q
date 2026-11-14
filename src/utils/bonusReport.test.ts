import { describe, expect, test } from "bun:test";
import { bonusReportDeadline, buildBonusReport, paymentsForBonus, type BonusPayment } from "./bonusReport";
import { reach70Date, reach75Date, splitBasicPensionNumber } from "./shahoPerson";
import { buildShahoLines, encodeShahoFile, shahoOfficeValues } from "./shahoCsv";

/** 仕様書の作成例の事業所（事業所整理記号 57-ケマ。東京都） */
const office = shahoOfficeValues({
  prefecture: "東京都", symbol: "57-ケマ", number: "8505", zip: "168-8505", address: "東京都杉並区高井戸3-5-24",
  name: "株式会社健保産業", owner: "健保 一郎", phone: "03-2345-6789",
}).values;
/** 社会保険に入っている人（標準報酬月額 30万円） */
const person = (o: Record<string, unknown> = {}) => ({
  id: "S001", name: "健保 一郎", furigana: "ケンポ イチロウ", birthday: "1946-05-27", pension_num: "1",
  standard_remuneration: 300000, join_date: "2000-04-01", ...o,
});
const pay = (o: Partial<BonusPayment> = {}): BonusPayment => ({
  settingId: 1, name: "夏季賞与", paymentDate: "2019-07-25", staffId: "S001", totalEarnings: 600000, ...o,
});

describe("届書の1人分（仕様書の作成例と同じになる）", () => {
  test("健保 一郎：整理番号1・昭和21年5月27日生まれ・令和1年7月25日に60万円 → 2265700,21,57,ｹﾏ,1,ｹﾝﾎﾟ ｲﾁﾛｳ,健保　一郎,5,210527,9,010725,600000,0,600000,,,,,,,", () => {
    // 作成例の人は73歳なので、作成例と同じにするため 70歳未満の生年月日で比べ、元号と年月日だけ作成例の値に差し替える
    const { rows } = buildBonusReport([person({ birthday: "1990-05-27" })], [pay()], office);
    expect(rows).toHaveLength(1);
    const values = [...rows[0].values];
    values[7] = "5";
    values[8] = "210527";
    expect(values.join(",")).toBe("2265700,21,57,ｹﾏ,1,ｹﾝﾎﾟ ｲﾁﾛｳ,健保　一郎,5,210527,9,010725,600000,0,600000,,,,,,,");
    expect(rows[0].problems).toEqual([]);
  });
  test("賞与額は1,000円未満を切り捨てる（600,870円 → 600,000）。1千万円以上は 9999999（合計は 9999000）", () => {
    const young = person({ birthday: "1990-05-27" });
    expect(buildBonusReport([young], [pay({ totalEarnings: 600870 })], office).rows[0].values.slice(11, 14)).toEqual(["600870", "0", "600000"]);
    const big = buildBonusReport([young], [pay({ totalEarnings: 10000000 })], office).rows[0];
    expect(big.values.slice(11, 14)).toEqual(["9999999", "0", "9999000"]);
    expect(big.notes.join("")).toContain("1千万円以上");
  });
  test("同じ月に2回払ったら合わせる：5日と25日 → 支払年月日は25日、備考の「同一月内の賞与合算」に 05", () => {
    const { rows } = buildBonusReport([person({ birthday: "1990-05-27" })], [
      pay({ settingId: 1, name: "決算賞与", paymentDate: "2026-12-05", totalEarnings: 200000 }),
      pay({ settingId: 2, name: "冬季賞与", paymentDate: "2026-12-25", totalEarnings: 400500 }),
    ], office);
    const r = rows[0];
    expect([r.paymentDate, r.firstPaymentDay, r.currency, r.total]).toEqual(["2026-12-25", "05", 600500, 600000]);
    expect([r.values[9], r.values[10], r.values[19]]).toEqual(["9", "081225", "05"]);
    expect(r.notes[0]).toContain("同じ月に払った賞与（決算賞与 12月5日・冬季賞与 12月25日）を合わせて届け出ます");
  });
  test("健康保険組合・国民健康保険組合の70歳以上の人は、70歳以上被用者賞与支払届だけ（整理番号を書かない）", () => {
    const old = person({ birthday: "1955-01-01", basic_pension_number: "1234567890" });
    const kyokai = buildBonusReport([old], [pay({ paymentDate: "2026-07-10" })], office).rows[0];
    expect([kyokai.values[4], kyokai.values[17], kyokai.values[20]]).toEqual(["1", "1", ""]);
    const union = buildBonusReport([old], [pay({ paymentDate: "2026-07-10" })], office, () => "union").rows[0];
    expect([union.values[4], union.values[17], union.values[20], union.problems]).toEqual(["", "1", "1", []]);
    expect(union.notes.join("")).toContain("健康保険組合・国民健康保険組合の70歳以上の人");
  });
  test("二以上事業所勤務者は、備考の「二以上勤務」に 1", () => {
    expect(buildBonusReport([person({ birthday: "1990-05-27", multi_office: 1 })], [pay()], office).rows[0].values[18]).toBe("1");
  });
});

describe("70歳以上被用者", () => {
  test("70歳に達する日（誕生日の前日）からは70歳以上被用者：備考の「70歳以上被用者」に 1、基礎年金番号を上4桁・下6桁に分けて書く", () => {
    expect([reach70Date("1956-12-11"), reach75Date("1951-12-11")]).toEqual(["2026-12-10", "2026-12-11"]);
    expect(splitBasicPensionNumber("0123-012345")).toEqual(["0123", "012345"]);
    expect(splitBasicPensionNumber("123")).toBeNull();
    const before = buildBonusReport([person({ birthday: "1956-12-12" })], [pay({ paymentDate: "2026-12-10" })], office).rows[0];
    expect(before.over70).toBe(false);
    const r = buildBonusReport([person({ birthday: "1956-12-11", basic_pension_number: "0123-012345" })], [pay({ paymentDate: "2026-12-10" })], office).rows[0];
    expect([r.over70, r.over70Only]).toEqual([true, false]);
    expect(r.values.slice(14, 21)).toEqual(["", "0123", "012345", "1", "", "", ""]);
    expect(r.problems).toEqual([]);
    expect(r.notes.join("")).toContain("70歳以上被用者なので");
  });
  test("基礎年金番号がなければ、直してもらう", () => {
    const r = buildBonusReport([person({ birthday: "1950-01-01" })], [pay({ paymentDate: "2026-12-10" })], office).rows[0];
    expect(r.problems).toEqual(["70歳以上被用者なので、基礎年金番号（10けた）を従業員の画面に入れてください"]);
  });
  test("75歳以上（健康保険の資格もない）は「70歳以上被用者届のみ提出」に 1、被保険者整理番号は書かない", () => {
    const r = buildBonusReport([person({ birthday: "1951-12-11", basic_pension_number: "1234567890", pension_num: "" })], [pay({ paymentDate: "2026-12-11" })], office).rows[0];
    expect([r.over70, r.over70Only, r.values[4], r.values[17], r.values[20]]).toEqual([true, true, "", "1", "1"]);
    expect(r.problems).toEqual([]);
  });
});

describe("届け出る人・届け出ない人", () => {
  test("社会保険に入っていない人・入社前・退職した後に払った賞与は届け出ない", () => {
    const staff = [
      person({ id: "S001", birthday: "1990-01-01" }),
      person({ id: "S002", name: "加入 なし", standard_remuneration: 0, birthday: "1990-01-01" }),
      person({ id: "S003", name: "入社 前", join_date: "2026-12-15", birthday: "1990-01-01" }),
      person({ id: "S004", name: "退職 後", retirement_date: "2026-12-05", birthday: "1990-01-01" }),
    ];
    const { rows, skipped } = buildBonusReport(staff, ["S001", "S002", "S003", "S004"].map((staffId) => pay({ staffId, paymentDate: "2026-12-10" })), office);
    expect(rows.map((r) => r.staffId)).toEqual(["S001"]);
    expect(skipped.map((s) => [s.name, s.reason])).toEqual([
      ["加入 なし", "社会保険に入っていない（標準報酬月額がない・社保規定が未加入）ので、届け出ません"],
      ["入社 前", "入社した日（2026-12-15）より前に払った賞与なので、届け出ません"],
      ["退職 後", "退職した日（2026-12-05）より後に払った賞与なので、届け出ません（資格を失ったあと）"],
    ]);
  });
  test("退職した日までに払った賞与は、資格を失う月でも届け出る（保険料はかからない）。育児休業中の賞与も届け出る", () => {
    const leaving = buildBonusReport([person({ birthday: "1990-01-01", retirement_date: "2026-12-20" })], [pay({ paymentDate: "2026-12-10" })], office).rows[0];
    expect(leaving.notes.join("")).toContain("資格を失う月（退職した月）に払った賞与なので、保険料はかかりませんが、届け出ます");
    const leave = JSON.stringify([{ type: "childcare", start: "2026-10-01", end: "2027-09-30" }]);
    const onLeave = buildBonusReport([person({ birthday: "1990-01-01", leave_periods: leave })], [pay({ paymentDate: "2026-12-10" })], office).rows[0];
    expect(onLeave.notes.join("")).toContain("育児休業等で保険料が免除される期間の賞与ですが、届け出ます");
  });
  test("整理番号・フリガナ（姓と名の間のスペース）・生年月日がなければ直してもらう。漢字の氏名は、書けない字・スペースがないときは書かない", () => {
    const r = buildBonusReport([person({ pension_num: "", furigana: "ケンポイチロウ", birthday: "", name: "髙田 一郎" })], [pay({ paymentDate: "2026-12-10" })], office).rows[0];
    expect(r.problems).toEqual([
      "被保険者整理番号がありません（従業員の画面の「厚生年金 整理番号」に、資格取得のときに知らされた番号を入れてください）",
      "フリガナの姓と名の間に、スペースを入れてください（従業員の画面）",
      "生年月日がありません（従業員の画面）",
    ]);
    expect([r.kanji, r.values[6]]).toEqual(["", ""]);
    expect(r.notes.join("")).toContain("漢字の氏名に届書に書けない字（髙）があるので、漢字の氏名は書きません");
    const noSpace = buildBonusReport([person({ birthday: "1990-01-01", name: "健保一郎" })], [pay({ paymentDate: "2026-12-10" })], office).rows[0];
    expect([noSpace.values[6], noSpace.problems]).toEqual(["", []]);
  });
  test("届書は被保険者整理番号の順（70歳以上被用者届のみの人は後ろ）", () => {
    const staff = [
      person({ id: "S001", pension_num: "12", birthday: "1990-01-01" }),
      person({ id: "S002", pension_num: "3", birthday: "1990-01-01" }),
      person({ id: "S003", pension_num: "", birthday: "1940-01-01", basic_pension_number: "1234567890" }),
    ];
    const { rows } = buildBonusReport(staff, ["S001", "S002", "S003"].map((staffId) => pay({ staffId, paymentDate: "2026-12-10" })), office);
    expect(rows.map((r) => r.staffId)).toEqual(["S002", "S001", "S003"]);
  });
  test("提出期限は、払った日から5日以内", () => {
    expect(bonusReportDeadline("2026-12-10")).toBe("2026-12-15");
    expect(bonusReportDeadline("2026-12-28")).toBe("2027-01-02");
  });
});

describe("電子申請用のファイル（SHFD0006.CSV）", () => {
  test("媒体管理レコード・[kanri]・事業所数情報・事業所情報・[data]・1人1行。シフトJISで CR LF", () => {
    const { rows } = buildBonusReport([person({ birthday: "1990-05-27" })], [pay({ paymentDate: "2026-12-10" })], office);
    const lines = buildShahoLines(office, 24, "2026-12-11", rows.map((r) => r.values.join(",")));
    expect(lines).toEqual([
      "21,57,ｹﾏ,024,20261211,22223",
      "[kanri]",
      ",001",
      "21,57,ｹﾏ,8505,168,8505,東京都杉並区高井戸３－５－２４,株式会社健保産業,健保　一郎,03,2345,6789",
      "[data]",
      "2265700,21,57,ｹﾏ,1,ｹﾝﾎﾟ ｲﾁﾛｳ,健保　一郎,7,020527,9,081210,600000,0,600000,,,,,,,",
    ]);
    const bytes = encodeShahoFile(lines);
    expect(new TextDecoder("shift_jis").decode(bytes)).toBe(lines.map((l) => `${l}\r\n`).join(""));
  });
});

describe("選んだ賞与の届書に入れる支払い", () => {
  const payments: BonusPayment[] = [
    pay({ settingId: 1, name: "冬季賞与", paymentDate: "2026-12-10", staffId: "S001", totalEarnings: 400000 }),
    pay({ settingId: 1, name: "冬季賞与", paymentDate: "2026-12-10", staffId: "S002", totalEarnings: 250500 }),
    pay({ settingId: 2, name: "決算賞与", paymentDate: "2026-12-25", staffId: "S002", totalEarnings: 100000 }),
    pay({ settingId: 3, name: "寸志", paymentDate: "2026-11-30", staffId: "S001", totalEarnings: 30000 }),
  ];
  test("12月10日の賞与：その日に払った人だけ。あとで払う決算賞与は入れない", () => {
    expect(paymentsForBonus(payments, 1, "2026-12-10").map((p) => [p.staffId, p.totalEarnings])).toEqual([["S001", 400000], ["S002", 250500]]);
  });
  test("12月25日の賞与：その日に払った人だけを、同じ月に前に払った分と合わせる（ほかの月の賞与は入れない）", () => {
    const list = paymentsForBonus(payments, 2, "2026-12-25");
    expect(list.map((p) => [p.staffId, p.totalEarnings])).toEqual([["S002", 250500], ["S002", 100000]]);
    const r = buildBonusReport([person({ id: "S002", birthday: "1990-01-01" })], list, office).rows[0];
    expect([r.currency, r.total, r.paymentDate, r.firstPaymentDay]).toEqual([350500, 350000, "2026-12-25", "10"]);
  });
});
