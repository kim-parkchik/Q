import { describe, expect, test } from "bun:test";
import { KOYO_EXAMPLES, KOYO_FORM_VERSIONS, KOYO_RISHOKU_FIELDS, KOYO_SOSHITSU_FIELDS } from "../constants/koyoTodoke";
import { buildKoyoLines, koyoOfficeValues, sameCharsAsShaho, splitKoyoNumber } from "./koyoCsv";
import { buildKoyoBango, buildKoyoShutoku, buildKoyoSoshitsu, buildKoyoTenkin, soshitsuDeadline, shutokuDeadline, type KoyoPlace } from "./koyoReport";
import { certificateRequired, estimatedKoyoWage, weeklyMinutesOf } from "./koyoInfo";
import { fillMyNumbers, MY_NUMBER_PLACEHOLDER } from "./shahoCsv";
import type { WageCertResult } from "./wageCertificate";

/** 仕様書の作成例の氏名は「田中 太郎」と書いてあるが、漢字の項目なので姓と名の間は全角スペース */
const zenkakuSpace = (values: string[], fields: number[]) => values.map((v, i) => (fields.includes(i) ? v.replace(/ /g, "　") : v));
const fill = (staffId: string, values: string[]) => fillMyNumbers([{ staffId, values }], { [staffId]: "123456789123" })[0];

const place = (over: Partial<KoyoPlace> = {}): KoyoPlace => ({
  key: "company", name: "東京株式会社", koyoNumber: "9999-999999-9", helloWork: "新宿", prefecture: "東京都", zip: "1310999",
  address: "東京都新宿区西新宿９－９９－９９９", phone: "03-9999-9999", ...over,
});

describe("雇用保険の届書のファイル", () => {
  test("使える字は社会保険の届書と同じ（シフトJIS の決まりを使い回す）", () => {
    expect(sameCharsAsShaho()).toBe(true);
  });

  test("番号を4けた・6けた・1けたに分ける", () => {
    expect(splitKoyoNumber("1301-123456-7")).toEqual(["1301", "123456", "7"]);
    expect(splitKoyoNumber("0101-1234-1")).toEqual(["0101", "001234", "1"]);
    expect(splitKoyoNumber("13011234567")).toEqual(["1301", "123456", "7"]);
    expect(splitKoyoNumber("1301-12345")).toBeNull();
  });

  test("資格取得届：仕様書の作成例（図4.1.5-3）と同じ行", () => {
    const staff = {
      id: "1", name: "田中　太郎", furigana: "タナカ タロウ", gender: "male", birthday: "1975-05-31", employment_ins_num: "1111-100001-6",
      join_date: "2015-11-01", wage_type: "monthly", base_wage: 200000, scheduled_work_hours: 8,
      koyo_info: JSON.stringify({
        acquireKind: "2", cause: "3", employmentForm: "6", occupation: "09", route: "1", weeklyMinutes: 2400,
        contract: { has: true, start: "2010-11-19", end: "2011-11-20", renewal: "有" },
      }),
      foreign_info: JSON.stringify({ romaji: "Romaji Name", nationality: "フランス", status: "29", statusText: "", periodEnd: "2020-12-31", permission: "有", card: "aa12345678aa", dispatch: "該当" }),
    };
    const row = buildKoyoShutoku({ staff, place: place(), myNumber: true, fixedItems: 0, today: "2015-11-05" });
    expect(row.problems).toEqual([]);
    expect(row.values[2]).toBe(MY_NUMBER_PLACEHOLDER);
    expect(fill("1", row.values)).toEqual(zenkakuSpace(KOYO_EXAMPLES.shutoku, [7]));
    expect(row.deadline).toBe("2015-12-10");
  });

  test("資格喪失届（離職票交付なし）：仕様書の作成例（図4.1.6-3）と同じ行（離職票交付希望は、表の決まりどおり「2」）", () => {
    const staff = {
      id: "2", name: "漢字　太郎", furigana: "カンジ タロウ", gender: "male", birthday: "1965-05-31", employment_ins_num: "1111-200001-7",
      join_date: "1987-04-01", retirement_date: "2010-11-19", address: "東京都新宿区", scheduled_work_hours: 8,
      koyo_info: JSON.stringify({
        weeklyMinutes: 2400, registeredName: "漢字　次郎", registeredKana: "カンジ ジロウ", nameChangedOn: "2010-06-30",
        loss: { cause: "3", replacement: "無", certificate: false },
      }),
      foreign_info: JSON.stringify({ romaji: "ROMAJI NAME", nationality: "フランス", status: "29", statusText: "", periodEnd: "2020-12-31", permission: "", card: "AA12345678AA", dispatch: "該当" }),
    };
    const row = buildKoyoSoshitsu({
      staff, place: place({ name: "新宿事務所", helloWork: "飯田橋公共職業安定所" }), lossDate: "2010-11-19", myNumber: true, cert: null,
      employer: { name: "", address: "", owner: "" }, today: "2010-11-20",
    });
    expect(row.form).toBe("soshitsu");
    expect(row.problems).toEqual([]);
    const expected = zenkakuSpace(KOYO_EXAMPLES.soshitsu, [21, 24]);
    // 仕様書の作成例は離職票交付希望が「1」だが、表4.1.6-1 は「“2”「無」を設定する（離職票交付希望が有“1”は入力不可）」
    expected[18] = "2";
    expect(fill("2", row.values)).toEqual(expected);
    expect(row.deadline).toBe("2010-11-30");
  });

  test("転勤届：仕様書の作成例（図4.1.8-3）と同じ行", () => {
    const staff = {
      id: "3", name: "漢字　太郎", furigana: "カンジ タロウ", birthday: "1965-05-31", employment_ins_num: "1111-300001-8", join_date: "1987-04-01",
      koyo_info: JSON.stringify({ registeredName: "旧名　太郎", registeredKana: "キュウメイ タロウ", nameChangedOn: "2019-12-31" }),
    };
    const row = buildKoyoTenkin({
      staff, on: "2010-11-15", today: "2010-11-16",
      from: place({ key: "branch:2", name: "新宿事務所", address: "新宿区", koyoNumber: "8888-888888-8" }),
      to: place({ key: "company" }),
    });
    expect(row.problems).toEqual([]);
    expect(row.values).toEqual(zenkakuSpace(KOYO_EXAMPLES.tenkin, [9, 28]));
  });

  test("個人番号登録届：仕様書の作成例（図4.1.9-1）と同じ行", () => {
    const staff = {
      id: "4", name: "田中　太郎", furigana: "タナカ タロウ", gender: "male", birthday: "1987-04-01", employment_ins_num: "9999-999999-9",
      koyo_info: JSON.stringify({
        registeredName: "変更　太郎", registeredKana: "ヘンコウ タロウ", nameChangedOn: "2019-12-31",
      }),
      foreign_info: JSON.stringify({ romaji: "TANAKA TAROU", nationality: "", status: "", statusText: "", periodEnd: "", permission: "", card: "", dispatch: "" }),
    };
    const row = buildKoyoBango({ staff, place: place(), today: "2026-11-17" });
    expect(row.problems).toEqual([]);
    expect(fill("4", row.values)).toEqual(zenkakuSpace(KOYO_EXAMPLES.bango, [13]));
  });

  test("資格喪失届（離職票交付あり）：作成例（図4.1.7-1）の喪失届・離職証明書・離職理由の項目", () => {
    const staff = {
      id: "5", name: "労働　太郎", furigana: "ロウドウ タロウ", gender: "male", birthday: "1960-05-31", employment_ins_num: "0101-001234-1",
      join_date: "1987-04-01", retirement_date: "2020-06-12", address: "東京都新宿区西新宿１－２３－４", zip_code: "185-0024", phone: "090-1234-5678",
      scheduled_work_hours: 8,
      koyo_info: JSON.stringify({
        weeklyMinutes: 2400,
        loss: {
          cause: "2", certificate: true, replacement: "無", reason: "2", circumstances: "定年による退職",
          details: { "選択２（定年年齢）": "60", "選択２（定年後の継続雇用）": "0", "選択２（継続雇用の事由）": "1" },
        },
      }),
    };
    const cert: WageCertResult = { nextDay: "2020-06-13", insured: [], wages: [], fullMonths: 0, fullWageMonths: 0, problems: [], notes: [] };
    const row = buildKoyoSoshitsu({
      staff, place: place({ name: "新宿事務所", address: "東京都新宿区西新宿８－８８－８", phone: "03-1234-5678", koyoNumber: "1111-012345-1" }),
      lossDate: "2020-06-12", myNumber: false, cert, employer: { name: "事業　太郎", address: "", owner: "事業　次郎" }, today: "2020-06-15",
    });
    expect(row.form).toBe("rishoku");
    const ex = KOYO_EXAMPLES.rishoku;
    const at = (name: string) => KOYO_RISHOKU_FIELDS.findIndex((f) => f.name === name);
    // 離職証明書の欄（被保険者番号から事業主氏名まで）は作成例と同じ
    // （年・月・日は、作成例は「2」、Q は「02」と書く。どちらも1〜2文字で、前の0は省いてもよい）
    const same = (name: string, v: string) => (/（[年月日]）$/.test(name) ? String(Number(v)) : v);
    for (let i = at("被保険者番号4桁（離職証明書）"); i <= at("事業主氏名（下段）"); i++) {
      const name = KOYO_RISHOKU_FIELDS[i].name;
      expect([name, same(name, row.values[i])]).toEqual([name, same(name, ex[i].replace(/^(労働|事業) /, "$1　"))]);
    }
    // 離職理由：定年（選択２）・定年年齢 60・継続雇用を希望していた（0）・事由 b（1）
    for (let i = at("選択１－１"); i <= at("選択２（継続雇用の事由）"); i++) expect(row.values[i]).toBe(ex[i]);
    expect(row.values[at("離職票交付希望")]).toBe("1");
    expect(row.values[at("具体的事情記載欄")]).toBe("定年による退職");
  });

  test("退職のほかのできごとで資格を失う：週20時間未満は「3以外の離職」（2）、出向元への復帰は「離職以外の理由」（1）。原因の字はできごとの名前", () => {
    const base = {
      id: "7", name: "週二　十郎", furigana: "シュウニ ジュウロウ", gender: "male", birthday: "1980-01-10", employment_ins_num: "1111-200001-7",
      join_date: "2015-04-01", address: "東京都新宿区", scheduled_work_hours: 8,
    };
    const info = (kind: string) => JSON.stringify({ weeklyMinutes: 2400, lossEvent: { kind, date: "2026-10-31" }, loss: { replacement: "無" } });
    const row = buildKoyoSoshitsu({
      staff: { ...base, koyo_info: info("週の所定労働時間が20時間未満") }, place: place({ name: "新宿事務所", helloWork: "新宿" }), lossDate: "2026-10-31",
      myNumber: true, cert: null, employer: { name: "", address: "", owner: "" }, today: "2026-11-02",
    });
    const at = (name: string) => KOYO_SOSHITSU_FIELDS.findIndex((f) => f.name === name);
    expect(row.values[at("喪失原因")]).toBe("2");
    expect(row.values[at("被保険者でなくなったことの原因")]).toBe("週の所定労働時間が20時間未満");
    expect(row.notes.join("")).toContain("退職ではなく");
    const back = buildKoyoSoshitsu({
      staff: { ...base, koyo_info: info("出向元への復帰") }, place: place({ name: "新宿事務所", helloWork: "新宿" }), lossDate: "2026-10-31",
      myNumber: true, cert: null, employer: { name: "", address: "", owner: "" }, today: "2026-11-02",
    });
    expect(back.values[at("喪失原因")]).toBe("1");
  });

  test("短期雇用特例被保険者の離職証明書：⑧は B 欄の月（1行目は離職月なので書かない）と基礎日数", () => {
    const staff = {
      id: "8", name: "季節　春子", furigana: "キセツ ハルコ", gender: "female", birthday: "1990-03-03", employment_ins_num: "0101-001234-1",
      join_date: "2026-05-10", retirement_date: "2026-11-20", address: "東京都新宿区西新宿１－２３－４", zip_code: "185-0024", phone: "090-1234-5678",
      scheduled_work_hours: 8, koyo_info: JSON.stringify({ weeklyMinutes: 2400, employmentForm: "5", loss: { cause: "2", certificate: true, replacement: "無", reason: "2", circumstances: "契約期間の満了" } }),
    };
    const cert: WageCertResult = {
      nextDay: "2026-11-21", fullMonths: 2, fullWageMonths: 0, problems: [], notes: [], wages: [],
      insured: [{ from: "2026-11-01", to: "2026-11-20", days: 15, hours: 120, complete: false, note: "", month: 11 }, { from: "2026-10-01", to: "2026-10-31", days: 22, hours: 176, complete: true, note: "", month: 10 }],
    };
    const row = buildKoyoSoshitsu({
      staff, place: place({ name: "新宿事務所", address: "東京都新宿区西新宿８－８８－８", phone: "03-1234-5678", koyoNumber: "1111-012345-1" }),
      lossDate: "2026-11-20", myNumber: false, cert, employer: { name: "事業　太郎", address: "", owner: "事業　次郎" }, today: "2026-11-21",
    });
    const at = (name: string) => KOYO_RISHOKU_FIELDS.findIndex((f) => f.name === name);
    expect([row.values[at("被保険者期間算定対象期間開始（月）01")], row.values[at("賃金支払基礎日数01")]]).toEqual(["", "15"]);
    expect([row.values[at("被保険者期間算定対象期間開始（月）02")], row.values[at("短期雇用特例被保険者（月）02")], row.values[at("賃金支払基礎日数02")]]).toEqual(["", "10", "22"]);
  });

  test("ファイルの行：項目行とデータ行（ＦＤ管理レコードの作成例 図4.1.1-2 と同じ形）", () => {
    const office = koyoOfficeValues({
      symbol: "01-テスト", number: "99999", prefecture: "東京都", zip: "131-0999", address: "東京都新宿区西新宿９－９９－９９９",
      name: "テスト会社", owner: "申請　太郎", phone: "03-9999-9999", koyoNumber: "9999-999999-9",
    });
    expect(office.problems).toEqual([]);
    const lines = buildKoyoLines("shutoku", office.values, 1, "2010-11-22", true, [["10101", ...Array(62).fill("")]]);
    expect(lines[0]).toBe("郡市区符号,事業所記号,ＦＤ通番,作成年月日,代表届書コード,連記式項目バージョン,XML返戻希望の有無");
    expect(lines[1]).toBe("01,ﾃｽﾄ,001,20101122,22223,07,有");
    expect(lines[2]).toBe("[kanri]");
    expect(lines[3]).toBe("社会保険労務士氏名,事業所情報数");
    expect(lines[4]).toBe(",001");
    expect(lines[6]).toBe("01,ﾃｽﾄ,99999,131,0999,東京都新宿区西新宿９－９９－９９９,テスト会社,申請　太郎,03-9999-9999,9999,999999,9");
    expect(lines[7]).toBe("[data]");
    expect(lines[8].startsWith("帳票種別,安定所番号,個人番号,被保険者番号4桁")).toBe(true);
    expect(KOYO_FORM_VERSIONS).toEqual({ shutoku: "07", soshitsu: "05", rishoku: "01", tenkin: "05", bango: "03" });
  });
});

describe("雇用保険の届書に書くこと", () => {
  test("1週間の所定労働時間：出勤する曜日の数 × 1日の所定労働時間（カレンダーは週5日）", () => {
    expect(weeklyMinutesOf({ calendar_pattern_id: 0, work_days: "mon,wed,fri", scheduled_work_hours: 6 })).toBe(18 * 60);
    expect(weeklyMinutesOf({ calendar_pattern_id: 1, scheduled_work_hours: 7.5 })).toBe(37.5 * 60);
    expect(weeklyMinutesOf({ scheduled_work_hours: 8, koyo_info: JSON.stringify({ weeklyMinutes: 1500 }) })).toBe(1500);
  });

  test("賃金月額：月給は基本給、時給は時給 × 週の時間 × 52 ÷ 12。通勤手当（月額）と固定の手当を足す", () => {
    expect(estimatedKoyoWage({ wage_type: "monthly", base_wage: 250000, commute_type: "monthly", commute_amount: 12000 }, 10000)).toBe(272000);
    // 時給 1,200円 × 週20時間 × 52 ÷ 12 = 104,000円
    expect(estimatedKoyoWage({ wage_type: "hourly", base_wage: 1200, calendar_pattern_id: 0, work_days: "mon,tue,wed,thu,fri", scheduled_work_hours: 4 })).toBe(104000);
  });

  test("59歳以上は離職票を必ず交付する（誕生日の前日に年齢が1つ増える）", () => {
    expect(certificateRequired({ birthday: "1967-04-01" }, "2026-03-30")).toBe(false);
    expect(certificateRequired({ birthday: "1967-04-01" }, "2026-03-31")).toBe(true);
  });

  test("提出期限：資格取得届は翌月10日、資格喪失届は離職日の翌日の翌日から10日", () => {
    expect(shutokuDeadline("2026-04-01")).toBe("2026-05-10");
    expect(shutokuDeadline("2026-12-25")).toBe("2027-01-10");
    // 3月31日に離職 → 4月1日に被保険者でなくなり、4月2日から数えて10日目の4月11日まで
    expect(soshitsuDeadline("2026-03-31")).toBe("2026-04-11");
  });
});
