/**
 * 年末調整・源泉徴収票・源泉徴収簿・給与支払報告書の一覧に出す人（buildNenchoRows）のテスト
 * 実行方法: bun test
 */
import { describe, expect, test } from "bun:test";
import { NENCHO_2026 } from "../../constants/nencho";
import { buildNenchoRows, EMPTY_NENCHO_DATA, NENCHO_SCREEN_YEARS, NENCHO_YEARS, settleOptionsFor, type NenchoData } from "./useNenchoManager";
import { OFFICIAL_SLIP_YEARS, SLIP_YEARS } from "./useWithholdingSlipManager";
import { REPORT_YEARS } from "./useSalaryPaymentReportManager";
import { MID_YEAR_EXCLUSION } from "../../utils/nenchoDeclaration";

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
    expect(retired.exclusion).toBe(MID_YEAR_EXCLUSION);
  });
});

describe("年の途中で退職した人の年末調整（死亡退職・選んだ理由の人は、退職のときにする）", () => {
  // 8月31日に死亡退職。給与は毎月25日払い（当月払い）。9月25日に払う8月分の残りなどは、死亡した後の支払
  const died = { ...staff("5", "2020-04-01", "2026-08-31"), death_date: "2026-08-31" };
  const paid = (month: number) => ({ ...salary("5", month), payment_day: 25 });
  const data: NenchoData = {
    ...EMPTY_NENCHO_DATA,
    salaries: [1, 2, 3, 4, 5, 6, 7, 8, 9].map(paid),
    bonuses: [
      { staff_id: "5", payment_date: "2026-07-10", total_earnings: 300_000, health_insurance: 15_000, nursing_insurance: 0, child_support: 300, welfare_pension: 27_450, emp_insurance: 1_500, income_tax: 20_000 },
      { staff_id: "5", payment_date: "2026-12-10", total_earnings: 300_000, health_insurance: 0, nursing_insurance: 0, child_support: 0, welfare_pension: 0, emp_insurance: 0, income_tax: 0 },
    ],
  };
  test("死亡した人：対象で、死亡した日より後に支払日が来る給与（9月25日）・賞与（12月10日）は入れない（所得税基本通達9-17）", () => {
    const [row] = buildNenchoRows([died], data, 2026, NENCHO_2026);
    expect(row.exclusion).toBeNull();
    expect(row.totals.salaryMonths).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(row.totals.salary).toBe(250_000 * 8 + 300_000);
    expect(row.totals.withheldTax).toBe(5_000 * 8 + 20_000);
    expect(row.note).toContain("死亡の日（2026-08-31）の現況");
  });
  test("精算する給与の候補は、退職した月から12月と翌年1月。初めの値は、その年に確定した最後の給与の月", () => {
    const [row] = buildNenchoRows([died], data, 2026, NENCHO_2026);
    expect(settleOptionsFor(row, 2026).map((o) => `${o.year}-${o.month}`)).toEqual(["2026-8", "2026-9", "2026-10", "2026-11", "2026-12", "2027-1"]);
    expect(row.saved).toBeNull();
    // 対象外の人・12月まで在籍した人は、いままでどおり12月と翌年1月
    const [plain] = buildNenchoRows([staff("1", "2020-04-01", null)], EMPTY_NENCHO_DATA, 2026, NENCHO_2026);
    expect(settleOptionsFor(plain, 2026).map((o) => `${o.year}-${o.month}`)).toEqual(["2026-12", "2027-1"]);
  });
  test("心身の障害で6月に退職した人：申告書に理由を残すと対象（残していなければ対象外）", () => {
    const retired = staff("6", "2020-04-01", "2026-06-30");
    const saved = { staff_id: "6", year: 2026, declaration: JSON.stringify({ midYearReason: "disability" }), result: null, settle_year: null, settle_month: null };
    expect(buildNenchoRows([retired], EMPTY_NENCHO_DATA, 2026, NENCHO_2026)[0].exclusion).toBe(MID_YEAR_EXCLUSION);
    const [row] = buildNenchoRows([retired], { ...EMPTY_NENCHO_DATA, saved: [saved] }, 2026, NENCHO_2026);
    expect(row.exclusion).toBeNull();
    expect(row.note).toContain("著しい心身の障害");
  });
});

describe("選べる年分（令和9年分は、国税庁の手引が出るまで、年末調整をしない人だけ）", () => {
  test("年末調整の画面：年末調整の表がある令和8年分と、令和9年分（年の途中で退職した人などの扶養控除等申告書だけ）", () => {
    expect(NENCHO_YEARS).toEqual([2026]);
    expect(NENCHO_SCREEN_YEARS).toEqual([2026, 2027]);
  });
  test("源泉徴収票の画面は令和9年分も選べる。給与支払報告書は令和8年分だけ（出すのは翌年1月31日までなので、手引が出てから）", () => {
    expect(OFFICIAL_SLIP_YEARS).toEqual([2026]);
    expect(SLIP_YEARS).toEqual([2026, 2027]);
    expect(REPORT_YEARS).toEqual([2026]);
  });
  test("令和9年分の一覧：年の途中で退職した人は、年末調整をしない人（源泉徴収票を作れる）", () => {
    const rows = buildNenchoRows([staff("1", "2020-04-01", null), staff("2", "2020-04-01", "2027-03-31")], EMPTY_NENCHO_DATA, 2027, null);
    expect(rows.map((r) => r.exclusion)).toEqual([null, MID_YEAR_EXCLUSION]);
  });
});
