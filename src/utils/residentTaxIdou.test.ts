import { describe, expect, test } from "bun:test";
import { IDOU_CSV_FIELDS } from "../constants/residentTaxIdouCsvLayout";
import {
  buildIdouCsv, buildIdouRow, idouForms, parseIdouInputs, resolveIdou, ruleOf, staffCollectionOf, stringifyIdouInputs,
  type IdouInput, type IdouPerson, type IdouSalary,
} from "./residentTaxIdou";

// 2026年度（令和8年度）：6月分 1,300円・7月分〜翌年5月分 1,200円（年税額 14,500円）。東京都千代田区（131016）
const staff = {
  id: "1001",
  resident_tax_municipality: "131016",
  resident_tax_schedule: JSON.stringify([{ fiscalYear: 2026, amounts: [1300, ...Array(11).fill(1200)], municipality: "131016", atena: "12345678901" }]),
};
const person: IdouPerson = { staffId: "1001", name: "山田　太郎", furigana: "ヤマダ タロウ", birthday: "1980-04-01", address: "東京都千代田区千代田1-1" };
/** 支給した月の住民税（25日払い） */
const paid = (list: [number, number, number][]): IdouSalary[] =>
  list.map(([year, month, residentTax]) => ({ year, month, residentTax, payDate: `${year}-${String(month).padStart(2, "0")}-25` }));
const v = (values: string[], no: number) => values[no - 1];

describe("記載要領・CSVレイアウト仕様書の決まり", () => {
  test("仕様書の68項目の書く条件を、どの場合でも読める", () => {
    expect(IDOU_CSV_FIELDS.length).toBe(68);
    for (const f of IDOU_CSV_FIELDS) {
      for (const mode of ["tokucho", "ikkatsu", "futsu", "newYear"] as const) {
        for (const sample of [Array(68).fill(""), Array(68).fill("1")]) {
          expect(["必須", "任意", "設定不可"]).toContain(ruleOf(f, mode, sample));
        }
      }
    }
  });

  test("10月31日に退職（6月〜10月に徴収済）：現年度分・普通徴収（理由1：一括徴収希望なし。年は賦課年度）", () => {
    const salaries = paid([[2026, 6, 1300], [2026, 7, 1200], [2026, 8, 1200], [2026, 9, 1200], [2026, 10, 1200]]);
    const c = staffCollectionOf(staff, "2026-10-31", salaries);
    expect([c.annual, c.collected, c.uncollected, c.collectedFrom, c.collectedTo, c.uncollectedFrom, c.uncollectedTo])
      .toEqual([14500, 6100, 8400, "2026-06", "2026-10", "2026-11", "2027-05"]);
    const input: IdouInput = { date: "2026-10-31", reason: "1" };
    const r = resolveIdou(input, c);
    expect([r.method, r.ordinaryReason, r.nextYearReported]).toEqual(["3", "1", false]);
    const forms = idouForms(c, r.nextYearReported, "131016");
    expect(forms.map((f) => [f.yearKind, f.municipality])).toEqual([["1", "131016"]]);
    const row = buildIdouRow(forms[0], person, r, "1234567890", "1001");
    expect(row.problems).toEqual([]);
    const x = row.values;
    expect([v(x, 1), v(x, 2), v(x, 3), v(x, 4), v(x, 5), v(x, 6)]).toEqual(["L01", "1", "1234567890", "12345678901", "ヤマダ　タロウ", "山田　太郎"]);
    // 生年月日：昭和は「1」（記載要領・仕様書の元号の数字）
    expect([v(x, 7), v(x, 8), v(x, 9), v(x, 10)]).toEqual(["1", "55", "04", "01"]);
    expect([v(x, 12), v(x, 13), v(x, 14)]).toEqual(["1001", "", "東京都千代田区千代田１－１"]);
    expect([v(x, 15), v(x, 16), v(x, 17), v(x, 18), v(x, 19), v(x, 20), v(x, 21), v(x, 22)]).toEqual(["14500", "5", "08", "06", "5", "08", "10", "6100"]);
    expect([v(x, 23), v(x, 24), v(x, 25), v(x, 26), v(x, 27), v(x, 28), v(x, 29)]).toEqual(["5", "08", "11", "5", "09", "05", "8400"]);
    expect([v(x, 30), v(x, 31), v(x, 32), v(x, 33), v(x, 34), v(x, 36)]).toEqual(["5", "08", "10", "31", "1", "3"]);
    expect([v(x, 63), v(x, 64), v(x, 65), v(x, 66), v(x, 67), v(x, 68)]).toEqual(["1", "5", "08", "", "", "131016"]);
    // 特別徴収継続・一括徴収の欄は書かない
    expect(x.slice(36, 62).every((s) => s === "")).toBe(true);
    expect(buildIdouCsv([row])).toBe(x.join(",") + "\r\n");
  });

  test("2月15日に退職し、最後の給与で残り（3月〜5月分）を一括徴収：理由2（年は賦課年度＋1）・両年度分", () => {
    const salaries = paid([
      [2026, 6, 1300], [2026, 7, 1200], [2026, 8, 1200], [2026, 9, 1200], [2026, 10, 1200], [2026, 11, 1200], [2026, 12, 1200],
      [2027, 1, 1200], [2027, 2, 1200 + 3600],
    ]);
    const c = staffCollectionOf(staff, "2027-02-15", salaries);
    expect([c.collected, c.uncollected, c.lump, c.lumpPayDate, c.collectedTo, c.uncollectedFrom]).toEqual([10900, 3600, 3600, "2027-02-25", "2027-02", "2027-03"]);
    const r = resolveIdou({ date: "2027-02-15", reason: "1" }, c);
    expect([r.method, r.lumpReason, r.lumpDate, r.lumpAmount, r.lumpPayMonth, r.nextYearReported]).toEqual(["2", "2", "2027-02-25", 3600, 3, true]);
    // 次の年度の給与支払報告書も同じ市区町村に出した → 両年度分
    const forms = idouForms(c, r.nextYearReported, "131016");
    expect(forms.map((f) => f.yearKind)).toEqual(["3"]);
    const x = buildIdouRow(forms[0], person, r, "1234567890", "1001");
    expect(x.problems).toEqual([]);
    expect([v(x.values, 2), v(x.values, 36), v(x.values, 52), v(x.values, 53), v(x.values, 55), v(x.values, 56)]).toEqual(["3", "2", "2", "", "5", "09"]);
    expect([v(x.values, 57), v(x.values, 58), v(x.values, 59), v(x.values, 60), v(x.values, 61), v(x.values, 62)]).toEqual(["5", "09", "02", "25", "3600", "03"]);
  });

  test("住所が変わって、次の年度の給与支払報告書を別の市区町村に出した：現年度分と新年度分を別々に出す", () => {
    const salaries = paid([[2026, 6, 1300], [2026, 7, 1200], [2026, 8, 1200], [2026, 9, 1200], [2026, 10, 1200], [2026, 11, 1200], [2026, 12, 1200], [2027, 1, 1200], [2027, 2, 4800]]);
    const c = staffCollectionOf(staff, "2027-02-15", salaries);
    const r = resolveIdou({ date: "2027-02-15", reason: "1" }, c);
    const forms = idouForms(c, true, "271004");
    expect(forms.map((f) => [f.yearKind, f.municipality, f.fiscalYear])).toEqual([["1", "131016", 2026], ["2", "271004", 2027]]);
    const second = buildIdouRow(forms[1], person, r, "", "1001");
    expect(second.problems).toEqual([]);
    // 新年度分は、年税額・徴収済額・未徴収税額・徴収方法を書かない
    expect(second.values.slice(14, 29).every((s) => s === "")).toBe(true);
    expect([v(second.values, 2), v(second.values, 36), v(second.values, 4), v(second.values, 68)]).toEqual(["2", "", "", "271004"]);
  });

  test("特別徴収をしていない人は、次の年度の給与支払報告書を出していなければ作らない", () => {
    const c = staffCollectionOf({ id: "2", resident_tax_municipality: "131016" }, "2026-09-30", []);
    expect(c.annual).toBe(0);
    expect(idouForms(c, false, "131016")).toEqual([]);
    expect(idouForms(c, true, "131016").map((f) => f.yearKind)).toEqual(["2"]);
  });

  test("死亡した人は普通徴収（理由3：死亡退職）", () => {
    const c = staffCollectionOf(staff, "2026-08-20", paid([[2026, 6, 1300], [2026, 7, 1200]]));
    const r = resolveIdou({ date: "2026-08-20", reason: "4" }, c);
    expect([r.method, r.ordinaryReason]).toEqual(["3", "3"]);
    const x = buildIdouRow(idouForms(c, false, "131016")[0], person, r, "1234567890", "1001");
    expect(x.problems).toEqual([]);
    expect([v(x.values, 34), v(x.values, 63), v(x.values, 64), v(x.values, 66)]).toEqual(["4", "3", "", ""]);
  });

  test("1月〜4月に退職して、最後の給与で残りを引いていないときは知らせ、徴収予定月日がなければ CSV に入れない", () => {
    const c = staffCollectionOf(staff, "2027-01-31", paid([[2026, 6, 1300], [2026, 7, 1200], [2026, 8, 1200], [2026, 9, 1200], [2026, 10, 1200], [2026, 11, 1200], [2026, 12, 1200], [2027, 1, 1200]]));
    const r = resolveIdou({ date: "2027-01-31", reason: "1", nextYearReported: false }, c);
    expect([r.method, r.lumpReason, r.lumpAmount]).toEqual(["2", "2", 4800]);
    expect(r.defaults.notes[0]).toContain("地方税法321条の5第2項");
    const x = buildIdouRow(idouForms(c, false, "131016")[0], person, r, "1234567890", "1001");
    expect(x.problems).toContain("徴収予定月日－元号（一括徴収の場合）を入れてください");
    expect(buildIdouCsv([x])).toBe("\r\n");
  });

  test("特別徴収を続けるときは、新しい勤務先の欄が必須（指定番号が新規なら納入書の要否）", () => {
    const c = staffCollectionOf(staff, "2026-10-31", paid([[2026, 6, 1300], [2026, 7, 1200], [2026, 8, 1200], [2026, 9, 1200], [2026, 10, 1200]]));
    const empty = buildIdouRow(idouForms(c, false, "131016")[0], person, resolveIdou({ date: "2026-10-31", reason: "1", method: "1" }, c), "1234567890", "1001");
    expect(empty.problems).toEqual(expect.arrayContaining([
      "新しい勤務先の特別徴収義務者指定番号（特別徴収継続の場合）を入れてください",
      "新しい勤務先の所在地（特別徴収継続の場合）を入れてください",
      "月割額（特別徴収継続の場合）を入れてください",
    ]));
    const ok = buildIdouRow(idouForms(c, false, "131016")[0], person, resolveIdou({
      date: "2026-10-31", reason: "1", method: "1",
      newEmployer: {
        isNew: true, address: "大阪府大阪市北区梅田1-1", kana: "ツギノ カイシャ", name: "次の会社株式会社", dept: "総務部", contactName: "担当 一郎",
        phone: "06-1111-2222", monthly: 1200, startMonth: 12, slip: "2",
      },
    }, c), "1234567890", "1001");
    expect(ok.problems).toEqual([]);
    expect([v(ok.values, 36), v(ok.values, 37), v(ok.values, 38), v(ok.values, 41), v(ok.values, 48), v(ok.values, 49), v(ok.values, 51)])
      .toEqual(["1", "", "1", "大阪府大阪市北区梅田１－１", "1200", "12", "2"]);
  });

  test("入れたものの保存（異動の日ごと）", () => {
    const map = { "2026-10-31": { date: "2026-10-31", reason: "1", method: "3" as const, reportedOn: "2026-11-05" } };
    expect(parseIdouInputs(stringifyIdouInputs(map))).toEqual(map);
    expect(parseIdouInputs("壊れた")).toEqual({});
    expect(stringifyIdouInputs({})).toBe(null);
  });
});
