/**
 * 給与支払報告書を出す人と出す先（salaryPaymentReport.ts）のテスト
 * 実行方法: bun test
 *
 * 出す人・出す先：地方税法317条の6第1項・第3項
 * 普通徴収の符号：東京都主税局「普通徴収切替理由書（兼仕切書（紙））」
 * 指定番号：地方税共同機構「給与支払報告書CSVレイアウト仕様書（総務省通知形式）」項番140
 */
import { describe, expect, test } from "bun:test";
import {
  buildReportPerson, designationNumberError, groupByMunicipality, normalizeDesignationNumber, parseReportSetting,
  reportKindOf, type ReportSource,
} from "./salaryPaymentReport";

const NO_SETTING = parseReportSetting(null);
const source = (staff: Partial<ReportSource["staff"]>, o: Partial<ReportSource> = {}): ReportSource => ({
  year: 2026,
  staff: {
    id: "S001", name: "山田太郎", furigana: "ヤマダタロウ", birthday: "1990-04-01", address: "神奈川県横浜市中区日本大通1",
    retirement_date: null, tax_column: "kou", resident_tax_municipality: "141003", ...staff,
  },
  payment: 4_000_000,
  withholdingTax: 80_000,
  setting: NO_SETTING,
  ...o,
});

describe("1月1日に在職しているか、年の途中で退職したか", () => {
  test("退職日が翌年1月1日より前なら退職（12月31日に退職した人も）", () => {
    expect(reportKindOf(null, 2026)).toBe("employed");
    expect(reportKindOf("", 2026)).toBe("employed");
    expect(reportKindOf("2027-01-01", 2026)).toBe("employed");
    expect(reportKindOf("2027-03-31", 2026)).toBe("employed");
    expect(reportKindOf("2026-12-31", 2026)).toBe("retired");
    expect(reportKindOf("2026-06-30", 2026)).toBe("retired");
    // 12月末に退職して、翌年1月に最後の給与を支払った人の、翌年分
    expect(reportKindOf("2026-12-31", 2027)).toBe("retired");
  });
});

describe("出すかどうか（30万円以下の退職者は出さなくてよい）", () => {
  test("1月1日に在職している人は、額にかかわらず出す", () => {
    const p = buildReportPerson(source({}, { payment: 50_000 }));
    expect(p.kind).toBe("employed");
    expect(p.required).toBe(true);
    expect(p.submit).toBe(true);
  });
  test("退職した人は、30万円を超えたら出す。30万円以下は出さなくてよい", () => {
    const over = buildReportPerson(source({ retirement_date: "2026-08-31" }, { payment: 300_001 }));
    expect(over.required).toBe(true);
    expect(over.retiredOn).toBe("2026-08-31");
    const under = buildReportPerson(source({ retirement_date: "2026-08-31" }, { payment: 300_000 }));
    expect(under.required).toBe(false);
    expect(under.submit).toBe(false);
    expect(under.warnings).toEqual([]); // 出さない人には注意を出さない
  });
  test("出さなくてよい退職者も、「出す」にすれば出す", () => {
    const p = buildReportPerson(source({ retirement_date: "2026-08-31" }, { payment: 200_000, setting: { ...NO_SETTING, submit: true } }));
    expect(p.required).toBe(false);
    expect(p.submit).toBe(true);
  });
});

describe("特別徴収か普通徴収か", () => {
  test("初めの値：在職している甲欄の人は特別徴収", () => {
    const p = buildReportPerson(source({}));
    expect(p.ordinary).toBe(false);
    expect(p.reason).toBe("");
    expect(p.defaultWhy).toBe("");
  });
  test("初めの値：退職した人は普F、乙欄の人は普B", () => {
    const retired = buildReportPerson(source({ retirement_date: "2026-08-31" }));
    expect([retired.ordinary, retired.reason, retired.defaultWhy]).toEqual([true, "普F", "退職した人"]);
    const otsu = buildReportPerson(source({ tax_column: "otsu" }));
    expect([otsu.ordinary, otsu.reason, otsu.defaultWhy]).toEqual([true, "普B", "乙欄の人"]);
  });
  test("設定した値が初めの値より優先", () => {
    const special = buildReportPerson(source({ tax_column: "otsu" }, { setting: { ordinary: false, reason: "普B", submit: false } }));
    expect([special.ordinary, special.reason, special.defaultWhy]).toEqual([false, "", ""]);
    const c = buildReportPerson(source({}, { setting: { ordinary: true, reason: "普C", submit: false } }));
    expect([c.ordinary, c.reason]).toEqual([true, "普C"]);
  });
  test("普通徴収で理由がないときは注意を出す（CSV では摘要に理由が要る）", () => {
    const p = buildReportPerson(source({}, { setting: { ordinary: true, reason: "", submit: false } }));
    expect(p.warnings).toContain("普通徴収にする理由を入れてください（摘要に書きます）");
  });
  test("5月末日までに退職する人で特別徴収なら、普Fにできることを出す", () => {
    const p = buildReportPerson(source({ retirement_date: "2027-05-31" }));
    expect(p.kind).toBe("employed");
    expect(p.warnings).toContain("5月末日までに退職する人です。普通徴収（普F）にできます");
    expect(buildReportPerson(source({ retirement_date: "2027-06-01" })).warnings).toEqual([]);
  });
  test("設定の読み込み：空の列は初めの値", () => {
    expect(parseReportSetting({ ordinary_collection: null, ordinary_reason: null, submit: null })).toEqual({ ordinary: null, reason: "", submit: false });
    expect(parseReportSetting({ ordinary_collection: 1, ordinary_reason: " 普D ", submit: 1 })).toEqual({ ordinary: true, reason: "普D", submit: true });
    expect(parseReportSetting({ ordinary_collection: 0 })).toEqual({ ordinary: false, reason: "", submit: false });
  });
});

describe("出す先の市区町村", () => {
  test("従業員の画面で選んだ市区町村", () => {
    const p = buildReportPerson(source({}));
    expect(p.municipality?.name).toBe("横浜市");
    expect(p.suggested).toBeNull();
    expect(p.warnings).toEqual([]);
  });
  test("未設定なら注意を出し、住所から探した市区町村を出す", () => {
    const p = buildReportPerson(source({ resident_tax_municipality: null }));
    expect(p.municipality).toBeNull();
    expect(p.suggested?.code).toBe("141003");
    expect(p.warnings[0]).toContain("市区町村を選んでいません");
  });
  test("一覧にないコードは注意を出す", () => {
    const p = buildReportPerson(source({ resident_tax_municipality: "999999" }));
    expect(p.municipality).toBeNull();
    expect(p.warnings[0]).toContain("団体コード 999999 は一覧にありません");
  });
  test("住所・フリガナ・生年月日が足りないときは注意を出す", () => {
    const p = buildReportPerson(source({ address: "", furigana: null, birthday: null, resident_tax_municipality: "141003" }));
    expect(p.missing).toEqual(["住所", "フリガナ", "生年月日"]);
    expect(p.warnings).toContain("住所・フリガナ・生年月日が入っていません（従業員の画面で入れてください）");
  });
  test("市区町村ごとにまとめ、特別徴収・普通徴収・出さない人を数える（未設定の人が先）", () => {
    const groups = groupByMunicipality([
      buildReportPerson(source({ id: "1" })),
      buildReportPerson(source({ id: "2", tax_column: "otsu" })),
      buildReportPerson(source({ id: "3", retirement_date: "2026-03-31" }, { payment: 100_000 })),
      buildReportPerson(source({ id: "4", resident_tax_municipality: "131016" })),
      buildReportPerson(source({ id: "5", resident_tax_municipality: "" })),
      buildReportPerson(source({ id: "6", resident_tax_municipality: "999999" })),
    ]);
    expect(groups.map((g) => g.code)).toEqual(["", "131016", "141003"]);
    expect(groups[0].people.map((p) => p.staffId)).toEqual(["5", "6"]);
    const yokohama = groups[2];
    expect([yokohama.special, yokohama.ordinary, yokohama.skipped]).toEqual([1, 1, 1]);
  });
});

describe("指定番号", () => {
  test("半角の英数字とハイフンで12文字まで。空でもよい", () => {
    expect(designationNumberError("")).toBeNull();
    expect(designationNumberError("12345678")).toBeNull();
    expect(designationNumberError("AB-1234-5678")).toBeNull();
    expect(designationNumberError("1234567890123")).toBe("指定番号は12文字までです");
    expect(designationNumberError("1234 5678")).toBe("指定番号は、半角の英数字とハイフンで入れてください");
    expect(designationNumberError("第123号")).toBe("指定番号は、半角の英数字とハイフンで入れてください");
  });
  test("全角の数字・ハイフンは半角にそろえる", () => {
    expect(normalizeDesignationNumber(" １２３－４５ ")).toBe("123-45");
    expect(designationNumberError("１２３４５６７８")).toBeNull();
  });
});
