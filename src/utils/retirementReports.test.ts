import { describe, expect, test } from "bun:test";
import { ETAX_LAYOUTS } from "../constants/taishoku";
import { calcRetirement, emptyRetirementHeir, emptyRetirementInput, type RetirementInput, type RetirementRecord } from "./retirementIncome";
import { encodeEtaxFile, etax316Of, etax325Of, etax339Of, etaxItemProblem, nonResidentReportOf } from "./retirementReports";

const payer = { name: "株式会社テスト", address: "東京都千代田区霞が関3-1-1", phone: "03-1234-5678", corporateNumber: "1234567890123" };
const rec = (o: Partial<RetirementRecord> & { input: Partial<RetirementInput> }): RetirementRecord => ({
  id: 1, staffId: "7", payDate: "2026-12-25", fixedDate: "2026-12-20", amount: 10_000_000, incomeTax: 0, cityTax: 0, prefTax: 0, municipality: "",
  ...o, input: { ...emptyRetirementInput(), ...o.input },
});
const resultOf = (r: RetirementRecord) => calcRetirement(Number(r.fixedDate.slice(0, 4)), r.amount, false, r.input);

describe("e-Tax の CSV の項目（レコードの内容及び記録要領から読んだもの）", () => {
  test("316・325・339 の項目の数と、決まった項目の名前・全角か半角か・文字数", () => {
    expect([ETAX_LAYOUTS["316"].length, ETAX_LAYOUTS["325"].length, ETAX_LAYOUTS["339"].length]).toEqual([41, 36, 48]);
    const at = (code: "316" | "325" | "339", no: number) => ETAX_LAYOUTS[code][no - 1];
    expect([at("316", 14).name, at("316", 15).name, at("316", 27).name, at("316", 36).name, at("316", 38).name]).toEqual([
      "氏名", "法 201 条 第 1 項第 1 号 適用分 支払金額", "退職所得控除額", "摘要", "支払を受ける者の個人番号",
    ]);
    expect(at("316", 23).name).toBe("法 201 条第 3 項適用分 支払金額");
    expect([at("316", 12).zenkaku, at("316", 12).length, at("316", 36).length, at("316", 38).fixed, at("316", 38).length]).toEqual([true, 60, 300, true, 13]);
    expect([at("325", 18).name, at("325", 23).name, at("325", 36).name, at("325", 14).length]).toEqual([
      "退職手当金等の給与金額", "受給者と退職者との続柄", "退職者の個人番号又は法人番号", 50,
    ]);
    expect([at("339", 16).name, at("339", 19).name, at("339", 23).name, at("339", 38).name, at("339", 38).length]).toEqual([
      "支払内容 (1) 区分", "支払内容 (1) 支払金額(内書)", "支払内容 (2) 支払金額", "退職所得控除額", 9,
    ]);
  });
  test("全角の項目は JIS 第1・第2水準の全角の字、半角の項目は半角の英数字・記号（カンマは区切りだけ）、文字数", () => {
    const name = ETAX_LAYOUTS["316"][13];
    const phone = ETAX_LAYOUTS["316"][5];
    const no = ETAX_LAYOUTS["316"][37];
    expect(etaxItemProblem(name, "退職　一郎")).toBeNull();
    expect(etaxItemProblem(name, "髙橋　一郎")).toContain("使えない字");
    expect(etaxItemProblem(name, "ABC")).toContain("使えない字");
    expect(etaxItemProblem(phone, "03(3581)4161")).toBeNull();
    expect(etaxItemProblem(phone, "03,3581")).toContain("半角で書けない");
    expect(etaxItemProblem(no, "123")).toContain("13文字で");
    expect(etaxItemProblem(name, "あ".repeat(31))).toContain("30文字まで");
  });
});

describe("e-Tax の CSV", () => {
  test("316 退職所得の源泉徴収票（手引の見本：1,000万円・20年・上段）：項目の位置と、マイナンバーは書くときだけ", () => {
    const r0 = rec({ input: { serviceFrom: "2007-04-01", serviceTo: "2026-12-20", address: "東京都港区1-2-3", position: "部長", slipNumber: "1" } });
    const result = resultOf(r0);
    const r = { ...r0, incomeTax: result.incomeTax, cityTax: result.cityTax, prefTax: result.prefTax };
    const f = etax316Of([{ record: r, result, person: { name: "退職 一郎", deathDate: "" } }], payer, { 7: "123456789012" });
    expect(f.problems).toEqual([]);
    const row = f.rows[0];
    expect(row.length).toBe(41);
    expect(row.slice(0, 15)).toEqual([
      "316", "", "", "東京都千代田区霞が関３－１－１", "株式会社テスト", "03-1234-5678", "", "", "", "0", "08", "東京都港区１－２－３", "0", "退職　一郎", "10000000",
    ]);
    expect(row.slice(15, 26)).toEqual(["51050", "60000", "40000", "", "", "", "", "", "", "", ""]);
    expect(row.slice(26, 38)).toEqual(["800", "20", "19", "04", "01", "08", "12", "20", "部長", "", "1234567890123", "0123456789012"]);
    expect(row.slice(38)).toEqual(["1", "", " "]);
    // 書かないとき・下段（申告書なし）
    const lower0 = rec({ input: { serviceFrom: "2007-04-01", serviceTo: "2026-12-20", declared: false } });
    const lowerRes = resultOf(lower0);
    const g = etax316Of([{ record: { ...lower0, incomeTax: lowerRes.incomeTax }, result: lowerRes, person: { name: "退職 一郎", deathDate: "" } }], payer, null);
    expect([g.rows[0][14], g.rows[0][22], g.rows[0][23], g.rows[0][37], g.rows[0][40]]).toEqual(["", "10000000", "2042000", "", " "]);
    // シフトJIS・CR LF
    const { bytes, unknown } = encodeEtaxFile(f);
    expect(unknown).toEqual([]);
    expect([bytes[bytes.length - 2], bytes[bytes.length - 1]]).toEqual([0x0d, 0x0a]);
    expect(new TextDecoder("shift_jis").decode(bytes)).toBe(`${row.join(",")}\r\n`);
  });
  test("325 退職手当金等受給者別支払調書：受給者ごとに1行（100万円以下の受給者は出さない）。受給者の個人番号は空", () => {
    const r = rec({
      payDate: "2026-07-10", amount: 5_000_000,
      input: {
        death: true, serviceTo: "2026-06-30", address: "東京都港区1-2-3", position: "課長", benefitKind: "退職金",
        heirs: [
          { ...emptyRetirementHeir(), name: "退職 花子", address: "東京都港区1-2-3", relation: "妻", amount: 4_500_000 },
          { ...emptyRetirementHeir(), name: "退職 一郎", address: "大阪市北区1-1", relation: "子", amount: 500_000 },
        ],
      },
    });
    const f = etax325Of([{ record: r, person: { name: "退職 太郎", deathDate: "2026-06-30" } }], payer, "2026-08-10", { 7: "123456789012" });
    expect([f.problems, f.rows.length]).toEqual([[], 1]);
    const row = f.rows[0];
    expect(row.length).toBe(36);
    expect(row.slice(9, 36)).toEqual([
      "0", "東京都港区１－２－３", "0", "退職　太郎", "東京都港区１－２－３", "0", "退職　花子", "退職金", "4500000", "08", "06", "30", "課長", "妻",
      "08", "07", "10", "08", "06", "30", "08", "08", "10", "", "1234567890123", "", "0123456789012",
    ]);
  });
  test("339 非居住者等の支払調書：区分は退職手当等、支払金額は国内源泉所得、退職所得控除額は万円", () => {
    const r0 = rec({
      input: {
        serviceFrom: "2007-04-01", serviceTo: "2026-12-20", nonResident: true, domesticAmount: 8_000_000, unpaid: 1_000_000, abroad: true,
        address: "Singapore", taxAgent: { name: "代理 次郎", address: "東京都港区4-5-6" }, treatyNote: "租税条約の適用なし",
      },
    });
    const result = resultOf(r0);
    const r = { ...r0, incomeTax: result.incomeTax };
    const rep = nonResidentReportOf(r, { name: "退職 一郎", deathDate: "" }, result);
    expect([rep.kubun, rep.basis, rep.amount, rep.unpaid, rep.tax, rep.deductionMan, rep.years]).toEqual([
      "退職手当等", "総額10,000,000円のうち居住者期間の勤務分", 8_000_000, 1_000_000, 1_633_600, 800, 20,
    ]);
    const f = etax339Of([{ record: r, result, person: { name: "退職 一郎", deathDate: "" } }], payer, null);
    expect(f.problems).toEqual([]);
    const row = f.rows[0];
    expect(row.length).toBe(48);
    expect(row.slice(10, 20)).toEqual(["08", "Ｓｉｎｇａｐｏｒｅ", "1", "", "退職　一郎", "退職手当等", "総額１０，０００，０００円のうち居住者期間の勤務分", "8000000", "1000000", "1633600"]);
    expect(row.slice(20, 35).every((x) => x === "")).toBe(true);
    expect(row.slice(35, 48)).toEqual(["東京都港区４－５－６", "代理　次郎", "800", "20", "19", "04", "01", "08", "12", "20", "租税条約の適用なし", "1234567890123", " "]);
  });
});
