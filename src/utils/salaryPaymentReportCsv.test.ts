/**
 * eLTAX に取り込む給与支払報告書の CSV（salaryPaymentReportCsv.ts）のテスト
 * 実行方法: bun test
 *
 * 項目の番号と名前は、地方税共同機構「給与支払報告書CSVレイアウト仕様書（総務省通知形式）　令和07年分～」の Excel から
 * 自動生成した constants/salaryPaymentReportCsvLayout.ts と突き合わせる（番号を取り違えていないかの確認）。
 * 源泉徴収票の金額は、国税庁「令和8年分 給与所得の源泉徴収票等の法定調書の作成と提出の手引」記載例1（withholdingSlip.test.ts と同じ）。
 */
import { describe, expect, test } from "bun:test";
import { GENSEN_2026, NENCHO_2026 } from "../constants/nencho";
import { SALARY_REPORT_CSV_FIELDS } from "../constants/salaryPaymentReportCsvLayout";
import { familyKey, myNumberError, SELF_KEY } from "./myNumber";
import { emptyDeclaration, type DeclaredDependent, type NenchoDeclaration } from "./nenchoDeclaration";
import { buildReportPerson, parseReportSetting, type ReportSetting } from "./salaryPaymentReport";
import {
  buildCsvRow, buildSalaryReportCsv, fieldError, toHankakuKana, toZenkaku, toZenkakuKatakana, type ReportCsvPerson,
} from "./salaryPaymentReportCsv";
import { buildWithholdingSlip, type SlipSource } from "./withholdingSlip";

const company = { name: "国税商事株式会社", address: "東京都千代田区霞が関3-1-1", phone: "03-0000-0000", corporateNumber: "1234567890123" };

const dep = (name: string, birthday: string, o: Partial<DeclaredDependent> = {}): DeclaredDependent => ({
  name, relation: "", birthday, totalIncome: 0, disability: "none", livingTogether: true, linealAscendant: false, ...o,
});

type Staff = SlipSource["staff"] & { id: string; resident_tax_municipality?: string | null };
const baseStaff: Staff = {
  id: "1001", name: "国税 太郎", furigana: "コクゼイ タロウ", address: "東京都千代田区霞が関", birthday: "1970-01-01",
  join_date: "2010-04-01", tax_column: "kou", resident_tax_municipality: "131016",
};

const personOf = (o: {
  staff?: Partial<Staff>; totals?: SlipSource["totals"]; declaration?: NenchoDeclaration | null; sourceDeclaration?: NenchoDeclaration | null;
  setting?: Partial<ReportSetting>; designation?: string; notReady?: string;
} = {}): ReportCsvPerson => {
  const staff = { ...baseStaff, ...o.staff };
  const slip = buildWithholdingSlip({
    year: 2026, staff, company: {},
    totals: o.totals ?? { salary: 3_000_000, socialInsurance: 450_000, withheldTax: 60_000, salaryMonths: [], bonusCount: 0 },
    declaration: o.declaration ?? null,
    sourceDeclaration: o.sourceDeclaration ?? null,
  }, NENCHO_2026, GENSEN_2026);
  const report = buildReportPerson({
    year: 2026, staff, payment: slip.payment, withholdingTax: slip.withholdingTax,
    setting: { ...parseReportSetting(null), ...o.setting },
  });
  return { report, slip, staffNumber: staff.id, designationNumber: o.designation ?? "", notReady: o.notReady };
};

/** 項目の番号で値を取り出す */
const at = (row: string[], no: number) => row[no - 1];

describe("仕様書から作った項目の並び", () => {
  test("146項目で、番号が1から順に並ぶ", () => {
    expect(SALARY_REPORT_CSV_FIELDS).toHaveLength(146);
    SALARY_REPORT_CSV_FIELDS.forEach((f, i) => expect(f.no).toBe(i + 1));
  });
  test("CSV を作るときに使う番号の名前", () => {
    const names: Record<number, string> = {
      1: "法定資料の種類", 4: "提出義務者の住所（居所）又は所在地", 5: "提出義務者の氏名又は名称", 6: "提出義務者の電話番号",
      10: "訂正表示", 11: "年分", 12: "支払を受ける者－住所又は居所", 13: "支払を受ける者－国外住所表示", 14: "支払を受ける者－氏名",
      16: "種別", 17: "支払金額", 19: "給与所得控除後の給与等の金額（調整控除後）", 20: "所得控除の額の合計額", 21: "源泉徴収税額",
      23: "（源泉）控除対象配偶者の有無", 24: "老人控除対象配偶者", 25: "配偶者（特別）控除の額",
      26: "控除対象扶養親族等の数－特定－主", 28: "控除対象扶養親族等の数－老人－主", 29: "控除対象扶養親族等の数－老人－上の内訳",
      31: "控除対象扶養親族等の数－その他－主", 33: "障害者の数－特別障害者", 34: "障害者の数－上の内訳", 35: "障害者の数－その他",
      36: "社会保険料等の金額", 37: "上の内訳", 38: "生命保険料の控除額", 39: "地震保険料の控除額", 40: "住宅借入金等特別控除等の額",
      41: "旧個人年金保険料の金額", 42: "配偶者の合計所得", 43: "旧長期損害保険料の金額",
      44: "受給者の生年月日－元号", 45: "受給者の生年月日－年", 46: "受給者の生年月日－月", 47: "受給者の生年月日－日",
      49: "未成年者", 50: "乙欄適用", 51: "本人が－特別障害者", 52: "本人が－その他の障害者", 54: "寡婦", 56: "勤労学生",
      57: "死亡退職", 58: "災害者", 59: "外国人", 60: "中途就・退職－中途就職・退職の区分", 61: "中途就・退職－年",
      64: "住所（居所）又は所在地", 65: "国外住所表示", 66: "氏名又は名称", 67: "給与等の金額", 68: "徴収した額", 69: "控除した社会保険料の金額",
      71: "他の支払者のもとを退職した年月日－年",
      74: "住宅借入金等特別控除等適用家屋居住年月日（1回目）－年", 77: "住宅借入金等特別控除適用数", 78: "住宅借入金等特別控除可能額",
      79: "住宅借入金等特別控除区分（1回目）", 80: "住宅借入金等の額（1回目）",
      81: "住宅借入金等特別控除等適用家屋居住年月日（2回目）－年", 84: "住宅借入金等特別控除区分（2回目）", 85: "住宅借入金等の額（2回目）",
      86: "摘要", 87: "新生命保険料の金額", 88: "旧生命保険料の金額", 89: "介護医療保険料の金額", 90: "新個人年金保険料の金額",
      91: "16歳未満扶養親族の数", 92: "国民年金保険料等の金額", 94: "提出義務者の個人番号又は法人番号", 95: "支払を受ける者の個人番号",
      96: "（源泉・特別）控除対象配偶者－フリガナ", 97: "（源泉・特別）控除対象配偶者－氏名", 98: "（源泉・特別）控除対象配偶者－区分",
      99: "（源泉・特別）控除対象配偶者－個人番号",
      100: "控除対象扶養親族等（1）－フリガナ", 102: "控除対象扶養親族等（1）－区分", 112: "控除対象扶養親族等（4）－フリガナ",
      116: "16歳未満の扶養親族（1）－フリガナ", 118: "16歳未満の扶養親族（1）－区分", 128: "16歳未満の扶養親族（4）－フリガナ",
      134: "普通徴収", 135: "青色専従者", 136: "条約免除", 137: "支払を受ける者のフリガナ", 138: "受給者番号",
      139: "提出先市町村コード", 140: "指定番号", 141: "基礎控除の額", 142: "所得金額調整控除額", 143: "ひとり親",
      144: "控除対象扶養親族等の数－特親－主", 146: "特定親族特別控除の額",
    };
    for (const [no, name] of Object.entries(names)) expect(SALARY_REPORT_CSV_FIELDS[Number(no) - 1].name).toBe(name);
  });
});

describe("文字の書き換え", () => {
  test("全角の項目：英数字・記号・スペースは全角、半角カナは全角カナ、カンマは「，」", () => {
    expect(toZenkaku("東京都千代田区霞が関3-1-1 Aビル")).toBe("東京都千代田区霞が関３－１－１　Ａビル");
    expect(toZenkaku("ｺｸｾﾞｲ ﾊﾟﾝ")).toBe("コクゼイ　パン");
    expect(toZenkaku("1,095,000円")).toBe("１，０９５，０００円");
  });
  test("受給者のフリガナは半角カナ（ひらがな・濁点・半濁点・小さい字・長音も）", () => {
    expect(toHankakuKana("コクゼイ　タロウ")).toBe("ｺｸｾﾞｲ ﾀﾛｳ");
    expect(toHankakuKana("こくぜい ぱんだ")).toBe("ｺｸｾﾞｲ ﾊﾟﾝﾀﾞ");
    expect(toHankakuKana("ヴァージニア・キョウコ")).toBe("ｳﾞｧｰｼﾞﾆｱ･ｷｮｳｺ");
    expect(toHankakuKana("ｺｸｾﾞｲ")).toBe("ｺｸｾﾞｲ");
  });
  test("配偶者・扶養親族のフリガナは全角カタカナ", () => {
    expect(toZenkakuKatakana("こくぜい はなこ")).toBe("コクゼイ　ハナコ");
  });
  test("文字属性・文字数・使えない文字", () => {
    expect(fieldError(14, "国税　太郎")).toBeNull();
    expect(fieldError(14, "国税 太郎")).toBe("支払を受ける者－氏名に、半角の文字があります");
    expect(fieldError(14, "")).toBe("支払を受ける者－氏名が空です");
    expect(fieldError(5, "あ".repeat(31))).toBe("提出義務者の氏名又は名称が長すぎます（30文字まで。いまは31文字）");
    expect(fieldError(137, "ｺｸｾﾞｲ 太郎")).toBe("支払を受ける者のフリガナに、カナでない文字（漢字など）があります");
    expect(fieldError(12, "東京都☆区")).toBe("支払を受ける者－住所又は居所に、eLTAX で使えない文字があります");
    expect(fieldError(17, "1,000")).toBe("支払金額は数字で書きます");
  });
});

describe("記載例1（年末調整をした人）の1行", () => {
  const decl: NenchoDeclaration = {
    ...emptyDeclaration(),
    spouse: { name: "国税 花子", furigana: "コクゼイ ハナコ", birthday: "1972-01-01", totalIncome: 400000, disability: "none", livingTogether: true },
    dependents: [
      dep("国税 一郎", "2005-01-01", { relation: "子", totalIncome: 950000 }),
      dep("国税 次郎", "2009-02-02", { relation: "子" }),
      dep("国税 孝男", "1940-10-10", { relation: "父", linealAscendant: true, disability: "general" }),
      dep("国税 三郎", "2014-03-03", { relation: "子", furigana: "コクゼイ サブロウ" }),
    ],
    insurance: {
      ...emptyDeclaration().insurance,
      lifeGeneralNew: 200000, lifeMedical: 100000, lifePensionNew: 100000,
      earthquake: 30000, oldLongTerm: 19600, socialInsurance: 176460, nationalPension: 176460,
    },
  };
  const p = personOf({
    totals: { salary: 7620000 + 2000000, socialInsurance: 1483023, withheldTax: 135720 + 236740, salaryMonths: [], bonusCount: 1 },
    declaration: decl, designation: "AB-12345",
  });
  const row = buildCsvRow(2026, company, p);

  test("146項目", () => expect(row).toHaveLength(146));
  test("提出義務者・年分（令和8年は 08）", () => {
    expect([at(row, 1), at(row, 4), at(row, 5), at(row, 6), at(row, 10), at(row, 11)])
      .toEqual(["315", "東京都千代田区霞が関３－１－１", "国税商事株式会社", "03-0000-0000", "0", "08"]);
    expect(at(row, 94)).toBe("1234567890123");
  });
  test("受給者・金額", () => {
    expect([at(row, 12), at(row, 13), at(row, 14), at(row, 16)]).toEqual(["東京都千代田区霞が関", "0", "国税　太郎", "給与・賞与"]);
    expect([at(row, 17), at(row, 19), at(row, 20), at(row, 21)]).toEqual(["9620000", "7558000", "4564283", "206000"]);
    expect([at(row, 36), at(row, 38), at(row, 39), at(row, 141), at(row, 142), at(row, 146)])
      .toEqual(["1659483", "120000", "44800", "620000", "112000", "510000"]);
    expect([at(row, 87), at(row, 89), at(row, 90), at(row, 92), at(row, 43)]).toEqual(["200000", "100000", "100000", "176460", "19600"]);
  });
  test("配偶者・人数（控除対象配偶者あり＝1）", () => {
    expect([at(row, 23), at(row, 24), at(row, 25), at(row, 42)]).toEqual(["1", "0", "380000", "400000"]);
    expect([at(row, 28), at(row, 29), at(row, 31), at(row, 35), at(row, 91), at(row, 144)]).toEqual(["1", "1", "1", "1", "1", "1"]);
  });
  test("生年月日（昭和は 1）", () => {
    expect([at(row, 44), at(row, 45), at(row, 46), at(row, 47)]).toEqual(["1", "45", "01", "01"]);
  });
  test("配偶者・扶養親族（フリガナは全角カタカナ。特定親族は区分30。16歳未満の居住者は00。マイナンバーは空）", () => {
    expect(row.slice(95, 99)).toEqual(["コクゼイ　ハナコ", "国税　花子", "00", ""]);
    expect(row.slice(99, 103)).toEqual(["", "国税　一郎", "30", ""]);
    expect(row.slice(115, 119)).toEqual(["コクゼイ　サブロウ", "国税　三郎", "00", ""]);
    expect(at(row, 95)).toBe("");
  });
  test("摘要・特別徴収・フリガナ（半角カナ）・受給者番号・提出先・指定番号", () => {
    expect(at(row, 86)).toBe("租税特別措置法第４１条の１５の５第１項適用");
    expect([at(row, 134), at(row, 137), at(row, 138), at(row, 139), at(row, 140)])
      .toEqual(["0", "ｺｸｾﾞｲ ﾀﾛｳ", "1001", "131016", "AB-12345"]);
  });
  test("どの項目も、仕様書の文字属性・文字数に合う", () => {
    row.forEach((v, i) => expect(fieldError(i + 1, v)).toBeNull());
  });

  // マイナンバー：本人は SELF_KEY、家族は氏名と生年月日で結び付ける（番号は検査用数字が合う仮の値）
  const self = "123456789018";
  const spouse = "987654321093";
  const withNumbers: ReportCsvPerson = { ...p, myNumbers: { [SELF_KEY]: self, [familyKey("国税　花子", "1972-01-01")]: spouse } };
  test("登録したマイナンバーを、本人（項番95）・配偶者（項番99）の欄に書く", () => {
    expect([myNumberError(self), myNumberError(spouse)]).toEqual([null, null]);
    const r2 = buildCsvRow(2026, company, withNumbers);
    expect([at(r2, 95), at(r2, 99)]).toEqual([self, spouse]);
    expect([at(r2, 103), at(r2, 119)]).toEqual(["", ""]); // 登録していない家族は空
    r2.forEach((v, i) => expect(fieldError(i + 1, v)).toBeNull());
  });
  test("番号を渡したときは、登録していない人を知らせる。渡さなければ（扱えない人）知らせない", () => {
    const x = buildSalaryReportCsv(2026, company, [withNumbers]);
    expect(x.myNumbers).toBe(1);
    expect(x.notes).toEqual(["配偶者・扶養親族のマイナンバーが登録されていない人がいる人（欄は空）：国税 太郎"]);
    const y = buildSalaryReportCsv(2026, company, [{ ...p, myNumbers: {} }]);
    expect(y.myNumbers).toBe(0);
    expect(y.notes[0]).toBe("本人のマイナンバーが登録されていない人（欄は空）：国税 太郎");
    const z = buildSalaryReportCsv(2026, company, [p]);
    expect(z.notes).toEqual([]);
    expect(z.csv.split(",")[94]).toBe("");
  });
});

describe("年の途中で退職した人（普通徴収・普F）", () => {
  const p = personOf({
    staff: { retirement_date: "2026-05-31", resident_tax_municipality: "141003" },
    totals: { salary: 1_500_000, socialInsurance: 220_000, withheldTax: 30_000, salaryMonths: [1, 2, 3, 4, 5], bonusCount: 0 },
  });
  const row = buildCsvRow(2026, company, p);
  test("中途退職（2）と退職日（令和8年5月31日）", () => {
    expect([at(row, 60), at(row, 61), at(row, 62), at(row, 63)]).toEqual(["2", "08", "05", "31"]);
  });
  test("普通徴収に1、摘要に理由の符号（普Ｆ）", () => {
    expect(at(row, 134)).toBe("1");
    expect(at(row, 86)).toBe("普Ｆ");
  });
  test("年末調整をしないので、控除対象配偶者の有無・年末調整の欄は空", () => {
    expect([at(row, 19), at(row, 20), at(row, 23), at(row, 24), at(row, 141)]).toEqual(["", "", "", "", ""]);
    expect([at(row, 17), at(row, 21), at(row, 36)]).toEqual(["1500000", "30000", "220000"]);
  });
});

describe("CSV のファイル", () => {
  const people = [
    personOf({ staff: { id: "3", name: "大阪 花子", furigana: "オオサカ ハナコ", resident_tax_municipality: "271004" } }),
    personOf({ staff: { id: "1" }, designation: "12345" }),
    personOf({ staff: { id: "2", name: "国税 次郎", furigana: "コクゼイ ジロウ" }, designation: "12345" }),
  ];
  const r = buildSalaryReportCsv(2026, company, people);

  test("1行に1人、項目名の行なし、改行は CRLF、値を \"\" で囲まない、団体コードの順", () => {
    expect(r.errors).toEqual([]);
    expect(r.skipped).toEqual([]);
    expect(r.count).toBe(3);
    expect(r.municipalities).toBe(2);
    expect(r.csv.endsWith("\r\n")).toBe(true);
    const lines = r.csv.split("\r\n").slice(0, -1);
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line.split(",")).toHaveLength(146);
      expect(line.includes('"')).toBe(false);
      expect(line.startsWith("315,")).toBe(true);
    }
    expect(lines.map((l) => [l.split(",")[137], l.split(",")[138], l.split(",")[139]]))
      .toEqual([["1", "131016", "12345"], ["2", "131016", "12345"], ["3", "271004", ""]]);
  });

  test("会社の名称・所在地がなければ、作らない", () => {
    const x = buildSalaryReportCsv(2026, { name: "", address: "" }, people);
    expect(x.csv).toBe("");
    expect(x.errors).toEqual([
      "提出義務者の住所（居所）又は所在地が空です（会社の設定で直してください）",
      "提出義務者の氏名又は名称が空です（会社の設定で直してください）",
    ]);
  });

  test("直すところがある人は入れない（理由を出す）。出さなくてよい退職者は数えない", () => {
    const x = buildSalaryReportCsv(2026, company, [
      personOf({ staff: { id: "1", birthday: null } }),
      personOf({ staff: { id: "2", name: "国税 次郎", resident_tax_municipality: null } }),
      personOf({ staff: { id: "3", name: "国税 三郎" }, setting: { ordinary: true, reason: "" } }),
      personOf({ staff: { id: "4", name: "国税 四郎" }, notReady: "年末調整がまだです" }),
      personOf({ staff: { id: "5", name: "国税 五郎", furigana: "国税 五郎" } }),
      personOf({ staff: { id: "6", name: "国税 六郎", address: "東京都千代田区★1" } }),
      personOf({
        staff: { id: "7", name: "国税 七郎", retirement_date: "2026-02-28" },
        totals: { salary: 280_000, socialInsurance: 40_000, withheldTax: 2_000, salaryMonths: [1, 2], bonusCount: 0 },
      }),
      personOf({ staff: { id: "8", name: "国税 八郎" } }),
    ]);
    expect(x.count).toBe(1);
    expect(x.skipped).toEqual([
      { name: "国税 太郎", reasons: ["生年月日が入っていません"] },
      { name: "国税 次郎", reasons: ["市区町村を選んでいません"] },
      { name: "国税 三郎", reasons: ["普通徴収にする理由がありません"] },
      { name: "国税 四郎", reasons: ["年末調整がまだです"] },
      { name: "国税 五郎", reasons: ["支払を受ける者のフリガナに、カナでない文字（漢字など）があります"] },
      { name: "国税 六郎", reasons: ["支払を受ける者－住所又は居所に、eLTAX で使えない文字があります"] },
    ]);
  });

  test("従業員IDに使えない記号があれば、受給者番号は空にして知らせる", () => {
    const x = buildSalaryReportCsv(2026, company, [personOf({ staff: { id: "A_01" } })]);
    expect(x.count).toBe(1);
    expect(x.csv.split(",")[137]).toBe("");
    expect(x.notes).toEqual(["国税 太郎：従業員ID（A_01）に使えない記号があるので、受給者番号は空にしました"]);
  });
});

describe("乙欄の人（従たる給与についての扶養控除等申告書）", () => {
  const source: NenchoDeclaration = {
    ...emptyDeclaration(),
    spouse: { name: "乙欄 花子", birthday: "1982-04-01", totalIncome: 0, disability: "none", livingTogether: true },
    dependents: [dep("乙欄 一郎", "2009-05-01", { relation: "子" }), dep("乙欄 孝男", "1950-07-01", { relation: "父", linealAscendant: true })],
  };
  test("配偶者の有無は「従たる給与：有」の3。人数は「従」の項番（27・30・32）に書く", () => {
    const row = buildCsvRow(2026, company, personOf({ staff: { tax_column: "otsu" }, sourceDeclaration: source }));
    expect([at(row, 23), at(row, 24), at(row, 50)]).toEqual(["3", "0", "1"]);
    expect([at(row, 26), at(row, 27), at(row, 28), at(row, 30), at(row, 31), at(row, 32), at(row, 144), at(row, 145)])
      .toEqual(["", "", "", "1", "", "1", "", ""]);
    expect([at(row, 97), at(row, 101), at(row, 105)]).toEqual(["乙欄　花子", "乙欄　一郎", "乙欄　孝男"]);
  });
  test("配偶者がいなければ4", () => {
    const row = buildCsvRow(2026, company, personOf({ staff: { tax_column: "otsu" }, sourceDeclaration: { ...source, spouse: null } }));
    expect(at(row, 23)).toBe("4");
  });
});
