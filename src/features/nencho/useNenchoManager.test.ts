/**
 * 年末調整・源泉徴収票・源泉徴収簿・給与支払報告書の一覧に出す人（buildNenchoRows）のテスト
 * 実行方法: bun test
 */
import { describe, expect, test } from "bun:test";
import { NENCHO_2026 } from "../../constants/nencho";
import { buildNenchoRows, EMPTY_NENCHO_DATA, type NenchoData } from "./useNenchoManager";

const staff = (id: string, join_date: string | null, retirement_date: string | null) => ({ id, name: `従業員${id}`, join_date, retirement_date, tax_column: "kou" });
const salary = (staff_id: string, target_month: number) => ({ staff_id, target_month, taxable_amount: 250_000, social_ins_total: 36_000, income_tax: 5_000 });

describe("一覧に出す人", () => {
  const list = [
    staff("1", "2020-04-01", null),         // 在籍している
    staff("2", "2027-01-10", null),         // 翌年に入社
    staff("3", "2020-04-01", "2025-06-30"), // 前の年に退職
    staff("4", "2020-04-01", "2025-12-31"), // 前の年の12月末に退職して、この年の1月に最後の給与を支払った
  ];
  test("その年に在籍した人だけを出す（支払がない人も）", () => {
    expect(buildNenchoRows(list, EMPTY_NENCHO_DATA, 2026, NENCHO_2026).map((r) => r.staff.id)).toEqual(["1"]);
  });
  test("前の年に退職した人でも、その年に給与・賞与を支払ったら出す", () => {
    const data: NenchoData = { ...EMPTY_NENCHO_DATA, salaries: [salary("4", 1)] };
    const rows = buildNenchoRows(list, data, 2026, NENCHO_2026);
    expect(rows.map((r) => r.staff.id)).toEqual(["1", "4"]);
    const retired = rows[1];
    expect(retired.totals.salary).toBe(250_000);
    expect(retired.exclusion).toBe("年の途中で退職した人は、年末調整をしません（本人が確定申告します）");
  });
});
