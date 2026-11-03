/**
 * eLTAX の納付情報発行依頼（個人住民税（特別徴収））の CSV（residentTaxPaymentCsv.ts）のテスト
 * 実行方法: bun test
 *
 * 形は、地方税共同機構「個人住民税（特別徴収）CSVレイアウト仕様書（CSVフォーマット）」の
 * 「このCSVファイルについて」シートの設定データ例（3つの市区町村・各10万円）と同じになるか確かめる。
 */
import { describe, expect, test } from "bun:test";
import { RESIDENT_TAX_PAYMENT_CSV } from "../constants/residentTaxPaymentCsvLayout";
import { localGovByCode } from "./localGov";
import type { PaymentGroup } from "./residentTaxPayment";
import { buildResidentTaxPaymentCsv, paymentMonthCode } from "./residentTaxPaymentCsv";

const group = (code: string, designation: string, amounts: number[], specialDue = false): PaymentGroup => ({
  code, municipality: localGovByCode(code), setting: { designation, atena: "", specialDue },
  months: [[2026, 6]], people: amounts.map((a, i) => ({ staffId: `${code}-${i}`, name: `人${i}`, byMonth: [a], total: a })),
  total: amounts.reduce((s, a) => s + a, 0), statutoryDue: "2026-07-10", due: "2026-07-10",
});

describe("仕様書から作った項目の並び", () => {
  test("レコードごとの項目の数と、決まった値", () => {
    expect(Object.fromEntries(Object.entries(RESIDENT_TAX_PAYMENT_CSV).map(([k, v]) => [k, v.length]))).toEqual({ header: 10, data: 12, trailer: 8, end: 2 });
    expect([RESIDENT_TAX_PAYMENT_CSV.header[0].fixed, RESIDENT_TAX_PAYMENT_CSV.header[1].fixed, RESIDENT_TAX_PAYMENT_CSV.data[0].fixed,
      RESIDENT_TAX_PAYMENT_CSV.trailer[0].fixed, RESIDENT_TAX_PAYMENT_CSV.end[0].fixed]).toEqual(["1", "99", "3", "8", "9"]);
    const d = RESIDENT_TAX_PAYMENT_CSV.data.map((f) => f.name);
    expect(d.slice(0, 10)).toEqual(["データ区分", "市区町村コード", "納付月分", "指定番号", "給与税額（件数）", "給与税額（金額）",
      "督促手数料（金額）", "延滞金（金額）", "合計税額（件数）", "合計税額（金額）"]);
  });
});

describe("納付月分", () => {
  test("令和の年2桁と月2桁", () => {
    expect(paymentMonthCode(2026, 6)).toBe("0806");
    expect(paymentMonthCode(2027, 1)).toBe("0901");
    expect(paymentMonthCode(2028, 12)).toBe("1012");
    expect(paymentMonthCode(2029, 1)).toBeNull(); // 令和11年は仕様書の表にない
  });
});

describe("CSV", () => {
  test("仕様書の例と同じ形（3つの市区町村・各1人・10万円。ヘッダー・データ・トレーラー・エンド）", () => {
    // 例：「1,99,,,,,,,,」「3,041009,0205,123456789098764,1,100000,0,0,1,100000,,」…「8,3,300000,0,0,3,300000,」「9,」
    const r = buildResidentTaxPaymentCsv([
      group("041009", "123456789098", [100000]), group("042021", "", [100000]), group("042030", "AB-1", [100000]),
    ], 2026, 6);
    expect(r.error).toBeNull();
    expect(r.csv.split("\r\n")).toEqual([
      "1,99,,,,,,,,",
      "3,041009,0806,123456789098,1,100000,0,0,1,100000,,",
      "3,042021,0806,,1,100000,0,0,1,100000,,",
      "3,042030,0806,AB-1,1,100000,0,0,1,100000,,",
      "8,3,300000,0,0,3,300000,",
      "9,",
      "",
    ]);
    expect([r.municipalities, r.people, r.total]).toEqual([3, 3, 300000]);
  });
  test("件数は人数、金額は合計", () => {
    const r = buildResidentTaxPaymentCsv([group("131016", "AB-12345", [10700, 8100, 5000])], 2026, 9);
    expect(r.csv.split("\r\n")[1]).toBe("3,131016,0809,AB-12345,3,23800,0,0,3,23800,,");
    expect(r.csv.split("\r\n")[2]).toBe("8,3,23800,0,0,3,23800,");
  });
  test("納付先が未設定・納期の特例の市区町村は入れずに知らせる。書くものがなければ空", () => {
    const r = buildResidentTaxPaymentCsv([
      { ...group("131016", "", [5000]), code: "", municipality: null },
      group("271004", "", [6100], true),
    ], 2026, 9);
    expect(r.csv).toBe("");
    expect(r.skipped).toEqual([
      "納付先が未設定（1人）：納付先の市区町村を選んでください",
      "大阪府大阪市：納期の特例の市区町村なので入れていません（PCdesk で入れてください）",
    ]);
  });
  test("納付月分を書けない月は作らない", () => {
    expect(buildResidentTaxPaymentCsv([group("131016", "", [5000])], 2029, 6).error).toBe("2029年6月は、納付月分（令和の年2桁）で書けません");
  });
});
