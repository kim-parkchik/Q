import { describe, expect, test } from "bun:test";
import { getInsuranceByAge } from "./calcSalary";
import { kaigoExemptMonth, parseKaigoExempt, recordKaigoExempt, stringifyKaigoExempt } from "./kaigoExempt";
import { companyForm, companyFormDefaults, kaigoForm, kubunForm, ninkeiForm, nijouForm, romajiForm } from "./shahoOtherForms";

const v = (f: { items: { label: string; value: string }[] }, label: string) => f.items.find((i) => i.label === label)?.value;
const staff = {
  id: "5", name: "見本 花子", furigana: "みほん はなこ", birthday: "1980-05-10", gender: "female", pension_num: "12", basic_pension_number: "1234567890",
  zip_code: "100-0001", address: "東京都千代田区千代田1-1", join_date: "2020-04-01", standard_remuneration: 300000, health_ins_num: "12345678 9",
};

describe("介護保険の適用除外", () => {
  test("該当した月の分から介護保険料をかけず、非該当になった月の分からかける（同じ月に戻れば、かける）", () => {
    const json = stringifyKaigoExempt(recordKaigoExempt(null, "該当", "2026-04-15", "1"));
    expect(kaigoExemptMonth(json, 2026, 3)).toBe(false);
    expect(kaigoExemptMonth(json, 2026, 4)).toBe(true);
    expect(kaigoExemptMonth(json, 2027, 1)).toBe(true);
    const closed = stringifyKaigoExempt(recordKaigoExempt(json, "非該当", "2026-09-20", "1"));
    expect(parseKaigoExempt(closed)).toEqual([{ reason: "1", from: "2026-04-15", to: "2026-09-20", facility: "", facilityAddress: "" }]);
    expect(kaigoExemptMonth(closed, 2026, 8)).toBe(true);
    expect(kaigoExemptMonth(closed, 2026, 9)).toBe(false);
    const sameMonth = stringifyKaigoExempt([{ reason: "3", from: "2026-05-02", to: "2026-05-20", facility: "", facilityAddress: "" }]);
    expect(kaigoExemptMonth(sameMonth, 2026, 5)).toBe(false);
  });

  test("給与・賞与の保険料の判定（getInsuranceByAge）に入る", () => {
    const json = stringifyKaigoExempt(recordKaigoExempt(null, "該当", "2026-04-15", "1"));
    expect(getInsuranceByAge("1980-05-10", 2026, 3, null, json).nursing).toBe(true);
    expect(getInsuranceByAge("1980-05-10", 2026, 4, null, json)).toEqual({ health: true, nursing: false, pension: true });
    expect(getInsuranceByAge("1980-05-10", 2026, 4, null).nursing).toBe(true);
  });

  test("届の内容：被保険者本人と被扶養者", () => {
    const f = kaigoForm({ staff, submittedOn: "2026-04-20", dependent: null, kind: "該当", reason: "1", date: "2026-04-15", lastAddress: "", facility: "", facilityAddress: "", remarks: "海外出向のため" });
    expect(v(f, "④適用除外等の理由")).toBe("1．国外居住者");
    expect(v(f, "⑤該当・非該当の別")).toBe("1．該当");
    expect(v(f, "被保険者の住所（国外へ転居したときは最後の住所）")).toBe("〒100-0001 東京都千代田区千代田1-1");
    expect(f.notes.join("")).toContain("介護保険料をかけません");
    const d = kaigoForm({ staff, submittedOn: "2026-04-20", dependent: { name: "見本 一郎", kana: "みほん いちろう", relation: "夫", birthday: "1978-01-01", zip: "", address: "" }, kind: "非該当", reason: "2", date: "2026-06-01", lastAddress: "", facility: "", facilityAddress: "", remarks: "" });
    expect(v(d, "被扶養者の氏名（フリガナ）")).toBe("見本 一郎（ミホン イチロウ）");
    expect(d.problems).toContain("入居施設の名称を入れてください");
  });
});

describe("社会保険のそのほかの届書", () => {
  test("ローマ字氏名届", () => {
    const s = { ...staff, foreign_info: JSON.stringify({ romaji: "Hong Kildong", nationality: "韓国", status: "35", statusText: "", periodEnd: "", permission: "", card: "", dispatch: "", checkedOn: "" }) };
    const f = romajiForm({ staff: s, submittedOn: "2026-04-03", resident: "有", usedName: "romaji", kanjiName: "洪 吉童", kanjiKana: "", commonName: "", commonKana: "", reason: "" });
    expect(v(f, "①基礎年金番号")).toBe("1234-567890");
    expect(v(f, "③生年月日（西暦）")).toBe("1980年5月10日");
    expect(v(f, "④住民登録の有無")).toBe("2．有");
    expect(v(f, "⑤ローマ字氏名（ローマ字。大文字）")).toBe("HONG KILDONG");
    expect(f.problems).toEqual([]);
    const none = romajiForm({ staff, submittedOn: "2026-04-03", resident: "", usedName: "romaji", kanjiName: "", kanjiKana: "", commonName: "", commonKana: "", reason: "" });
    expect(none.problems.join("")).toContain("ローマ字氏名がありません");
  });

  test("二以上事業所勤務届・区分変更届", () => {
    const ours = { symbol: "杉並 ケマ", insuredNumber: "12", name: "サンプル商事", address: "東京都", acquiredOn: "2020-04-01", lostOn: "", currency: 260000, inKind: 0, fund: "" };
    const other = { symbol: "池袋 ケクシ", insuredNumber: "3", name: "見本サービス", address: "東京都豊島区", acquiredOn: "2026-02-12", lostOn: "", currency: 70000, inKind: 0, fund: "" };
    const n = nijouForm({ staff, submittedOn: "2026-02-20", myNumber: false, oursSelected: true, ours, other });
    expect(v(n, "選択事業所 事業所名称")).toBe("サンプル商事");
    expect(v(n, "非選択事業所 報酬月額（通貨・現物・合計）")).toBe("通貨 70,000円・現物 0円・合計 70,000円");
    const k = kubunForm({ staff, submittedOn: "2026-10-02", myNumber: false, after: "1", changedOn: "2026-10-01", remarks: "" });
    expect(v(k, "⑥変更後区分")).toBe("１．短時間労働者（3/4未満）");
    expect(v(k, "⑤処理区分")).toBe("（書かない）");
    const old = kubunForm({ staff: { ...staff, birthday: "1955-01-01" }, submittedOn: "2026-10-02", myNumber: false, after: "2", changedOn: "2026-10-01", remarks: "" });
    expect(old.title).toBe("厚生年金保険 70歳以上被用者区分変更届");
    expect(old.problems.join("")).toContain("特定減額特例対象者は70歳以上被用者に当たらない");
  });

  test("任意継続の申出書：資格喪失日は退職日の翌日、提出期限は20日以内", () => {
    const f = ninkeiForm({ staff: { ...staff, retirement_date: "2026-10-31" }, company: { name: "サンプル商事", address: "東京都", phone: "03", representative: "見本 太郎" }, certifiedOn: "2026-11-05", dependents: [] });
    expect(v(f, "資格喪失年月日（退職日の翌日）")).toBe("令和8年11月1日");
    expect(f.notes[0]).toContain("令和8年11月20日まで");
  });

  test("会社の届書：新規適用届の初めの値と、変更届は入れた欄だけ", () => {
    const ctx = {
      company: { name: "サンプル商事株式会社", zip_code: "100-0005", address: "東京都千代田区丸の内1-1-1", phone: "03-0000-0000", representative: "代表取締役 見本 太郎", corporate_number: "1234567890123", bonus_plan_months: "7,12" },
      groups: [{ closing_day: 20, is_next_month: 0, payment_day: 25 }], allowanceNames: ["役職手当", "家族手当"], unionNames: [],
      staffList: [{ ...staff, wage_type: "monthly", scheduled_work_hours: 8, social_insurance_group_id: 1 }, { id: "6", wage_type: "hourly", standard_remuneration: 0 }],
      today: "2026-11-18",
    };
    const d = companyFormDefaults("shinki", ctx);
    expect(d.corporateNumber).toBe("１．法人番号 1234567890123");
    expect(d.closing).toBe("20日");
    expect(d.payDay).toBe("当月25日");
    expect(d.bonusMonths).toBe("7月・12月");
    expect(d.wageForms).toBe("１．月給・５．時間給");
    expect(d.workers).toContain("従業員数（役員を含む）2人");
    expect(d.workers).toContain("社会保険に加入する従業員数 1人");
    const f = companyForm("shinki", d, ctx.company);
    expect(f.problems.join("")).toContain("業態区分");
    const h = companyForm("henko", { submittedOn: "2026-11-18", phone: "03-1111-2222" }, ctx.company);
    expect(h.items.map((i) => i.label)).toEqual(["届書提出日", "④事業所電話番号（変更後）"]);
    expect(h.problems).toEqual([]);
  });
});
