import { describe, expect, test } from "bun:test";
import { addressChangeForm, age70Form, leaveEndForm, nameChangeForm, youikuForm, type PrintForm } from "./printForms";

const valueOf = (form: PrintForm, label: string) => form.items.find((it) => it.label.startsWith(label))?.value;

describe("70歳到達届（厚生年金保険 被保険者資格喪失届／70歳以上被用者該当届）", () => {
  // 記入例：年金 一郎（昭和30年5月4日生まれ）・喪失年月日 令和7年5月3日・報酬月額 129,100円
  const ichiro = (o: Record<string, unknown> = {}) => ({
    id: "4001", name: "年金　一郎", furigana: "ネンキン イチロウ", birthday: "1955-05-04", pension_num: "7",
    basic_pension_number: "4321-567890", join_date: "2010-04-01", standard_remuneration: 150000, ...o,
  });
  test("記入例：喪失年月日・該当年月日は70歳の誕生日の前日（令和7年5月3日）、喪失原因は「6. 70歳到達（厚生年金保険のみ喪失）」", () => {
    const form = age70Form({ staff: ichiro(), submittedOn: "2025-05-07", wage: 129100, inKind: 0, shortTime: false, remarks: "", myNumber: false });
    expect(form.problems).toEqual([]);
    expect(form.reachedOn).toBe("2025-05-03");
    expect(valueOf(form, "喪失年月日")).toBe("令和7年5月3日");
    expect(valueOf(form, "喪失原因")).toBe("6. 70歳到達（厚生年金保険のみ喪失）");
    expect(valueOf(form, "該当年月日")).toBe("令和7年5月3日");
    expect(valueOf(form, "報酬月額")).toBe("㋐ 129,100円・㋑ 0円・㋒ 129,100円");
    expect(valueOf(form, "個人番号")).toBe("基礎年金番号 4321-567890");
  });
  test("標準報酬月額相当額が前日の標準報酬月額と違うときだけ届ける（同じなら年金機構が処理する）", () => {
    const differ = age70Form({ staff: ichiro(), submittedOn: "2025-05-07", wage: 129100, inKind: 0, shortTime: false, remarks: "", myNumber: false });
    expect([differ.equivalent, differ.previous, differ.needed]).toEqual([126000, 150000, true]);
    const same = age70Form({ staff: ichiro(), submittedOn: "2025-05-07", wage: 150000, inKind: 0, shortTime: false, remarks: "", myNumber: false });
    expect(same.needed).toBe(false);
    expect(same.notes.join("")).toContain("届出は要りません");
    const none = age70Form({ staff: ichiro({ basic_pension_number: "" }), submittedOn: "2025-05-07", wage: null, inKind: 0, shortTime: false, remarks: "", myNumber: false });
    expect(none.needed).toBeNull();
    expect(none.problems.join("\n")).toContain("報酬月額");
    expect(none.problems.join("\n")).toContain("基礎年金番号");
  });
});

describe("育児休業等終了時報酬月額変更届", () => {
  test("記入例：12月・1月（30日・31日）の平均 263,550円、従前 280千円から降給、改定年月は4か月目", () => {
    const form = leaveEndForm({
      staff: { id: "5001", name: "年金　花子", furigana: "ネンキン ハナコ", birthday: "1993-07-11", pension_num: "11", basic_pension_number: "1234567890", address: "東京都杉並区浜田川1-2-3", phone: "03-1234-5678" },
      type: "childcare", leaveEnd: "2025-10-31", childName: "年金　太郎", childBirthday: "2024-10-11",
      months: [
        { year: 2025, month: 11, days: 10, amount: 90000 },
        { year: 2025, month: 12, days: 30, amount: 275000 },
        { year: 2026, month: 1, days: 31, amount: 252100 },
      ],
      usedIndexes: [1, 2], average: 263550, previous: 280000, pensionRange: { min: 88000, max: 650000 }, gradeDiff: -1,
      revisionFrom: "2026-02", payRule: "末日締め翌月10日払い", short: false, part: false, submittedOn: "2026-01-13", appliedOn: "2026-01-13", myNumber: true,
    });
    expect(form.problems).toEqual([]);
    expect(valueOf(form, "総計")).toBe("527,100円");
    expect(valueOf(form, "平均額")).toBe("263,550円");
    expect(valueOf(form, "従前の標準報酬月額")).toBe("280千円・280千円");
    expect(valueOf(form, "昇（降）給")).toBe("2. 降給");
    expect(valueOf(form, "改定年月")).toBe("令和8年2月");
    expect(valueOf(form, "給与支給月 11月")).toBe("基礎日数 10日・㋐通貨 90,000円・㋑現物 0円・㋒合計 90,000円");
    expect(valueOf(form, "月変該当の確認")).toContain("産前産後休業を開始していません");
    expect(valueOf(form, "個人番号")).toBe("マイナンバーを書く（印刷しません）");
  });
});

describe("養育期間標準報酬月額特例申出書・終了届", () => {
  const hanako = { id: "5001", name: "年金　花子", furigana: "ネンキン ハナコ", birthday: "1993-07-11", gender: "female", pension_num: "11", basic_pension_number: "1234567890" };
  test("申出書：過去の申出・事業所の確認・養育開始年月日・養育特例開始年月日（A欄）", () => {
    const form = youikuForm({
      staff: hanako, kind: "申出", childName: "年金　太郎", childKana: "ネンキン タロウ", childBirthday: "2024-10-18", careStart: "2024-10-18", start: "2025-10-01",
      end: "", first: true, sameOffice: false, previousOffice: "東京都千代田区 株式会社前職", submittedOn: "2025-10-21", appliedOn: "2025-10-21", myNumber: false,
    });
    expect(form.problems).toEqual([]);
    expect(valueOf(form, "A. 過去の申出の確認")).toBe("1. はい");
    expect(valueOf(form, "A. 事業所の確認")).toBe("2. いいえ（その月に勤めていた事業所：東京都千代田区 株式会社前職）");
    expect(valueOf(form, "A. 養育特例開始年月日")).toBe("令和7年10月1日");
    expect(valueOf(form, "性別")).toBe("女");
  });
  test("終了届：養育特例終了年月日がなければ直すところ（B欄）", () => {
    const form = youikuForm({
      staff: hanako, kind: "終了", childName: "年金　太郎", childKana: "", childBirthday: "2024-10-18", careStart: "", start: "2025-10-01",
      end: "", first: true, sameOffice: true, previousOffice: "", submittedOn: "2026-03-01", appliedOn: "", myNumber: false,
    });
    expect(form.problems).toEqual(["養育特例終了年月日を入れてください"]);
    expect(form.items.some((it) => it.label.startsWith("B. 養育特例終了年月日"))).toBe(true);
  });
});

describe("住所変更届・氏名変更（訂正）届", () => {
  const taro = { id: "6001", name: "厚年　太郎", furigana: "コウネン タロウ", birthday: "1995-02-04", pension_num: "123", zip_code: "123-0001", address: "東京都東京区東京1-1-1", address_kana: "トウキョウト トウキョウク トウキョウ" };
  test("住所変更届：新しい住所と変わった日。同居の被扶養配偶者は、配偶者の住所欄を書かなくてよい", () => {
    const form = addressChangeForm({ staff: taro, submittedOn: "2023-04-05", changedOn: "2023-04-01", remark: "", myNumber: true, spouse: { name: "厚年　花子", kana: "コウネン ハナコ", birthday: "1997-01-01", together: true, zip: "", address: "" } });
    expect(form.problems).toEqual([]);
    expect(valueOf(form, "住所（変更後")).toBe("東京都東京区東京1-1-1（トウキョウト トウキョウク トウキョウ）");
    expect(valueOf(form, "住所変更年月日")).toBe("令和5年4月1日");
    expect(valueOf(form, "被扶養配偶者の住所変更")).toContain("同居している");
    expect(form.items.some((it) => it.label.startsWith("配偶者の郵便番号"))).toBe(false);
  });
  test("氏名変更届：変更後と変更前の氏名", () => {
    const form = nameChangeForm({ staff: { ...taro, name: "厚年　陽子", furigana: "コウネン ヨウコ" }, submittedOn: "2025-04-03", oldName: "健保　陽子", remark: "", myNumber: false });
    expect(form.problems).toEqual(["マイナンバーか基礎年金番号を書きます（従業員の画面に基礎年金番号を入れるか、マイナンバーを書いてください）"]);
    expect(valueOf(form, "被保険者の氏名（変更後")).toBe("厚年　陽子（コウネン ヨウコ）");
    expect(valueOf(form, "変更前の氏名")).toBe("健保　陽子");
  });
});
