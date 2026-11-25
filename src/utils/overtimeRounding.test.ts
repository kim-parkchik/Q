/**
 * 残業代の端数処理（overtimeRounding.ts。見直しの P11）のテスト
 * 実行方法: bun test
 *
 * 選べるのは、四捨五入（50銭未満切り捨て・50銭以上切り上げ。基発第150号の方法）と、常に切り上げの2つだけ。
 * 前の版で選べた「50銭以下切り捨て」「切り捨て」が会社ファイルに残っていても、四捨五入で計算する。
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateSalary, type SalaryExtras } from "./calcSalary";
import { OVERTIME_ROUNDING_OPTIONS, toOvertimeRounding } from "./overtimeRounding";

const ROOT = join(import.meta.dir, "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const extras: SalaryExtras = { allowanceName: "", allowanceAmount: 0, residentTax: 0, prefecture: "東京", dependents: 0, customItems: [] };
/** 時給 1,201円・所定8時間（時間外労働の割増は 1,201円 × 25% ＝ 300.25円／時間） */
const hourly = { wage_type: "hourly", base_wage: 1201, scheduled_work_hours: 8, commute_type: "none", commute_amount: 0, standard_remuneration: 0, birthday: "1980-01-10" };
/** 2026年6月8日（月）に、hours 時間働いた勤怠（8時間を超えた分が時間外労働） */
const rows = (hours: number) => [{ work_date: "2026-06-08", work_hours: hours, night_hours: 0, work_type: "normal" }];
const overtimePay = (hours: number, round_overtime: unknown) =>
  calculateSalary(hourly, rows(hours), extras, 2026, 6, { week_start_day: 0, round_overtime, round_social_ins: "currency_law", round_emp_ins: "currency_law" })
    .standardOvertimePay;

describe("選べる端数処理", () => {
  test("四捨五入（初めの値）と常に切り上げの2つだけ", () => {
    expect(OVERTIME_ROUNDING_OPTIONS.map((o) => o.value)).toEqual(["round", "ceil"]);
    expect(OVERTIME_ROUNDING_OPTIONS[0].label).toContain("基発第150号");
  });

  test("会社ファイルの値を読む：常に切り上げのほかは、四捨五入（前の版の「50銭以下切り捨て」「切り捨て」も）", () => {
    expect(toOvertimeRounding("ceil")).toBe("ceil");
    expect(toOvertimeRounding("round")).toBe("round");
    for (const v of ["floor", "currency_law", "", null, undefined, 1]) expect(toOvertimeRounding(v)).toBe("round");
  });
});

describe("給与の計算", () => {
  test("50銭ちょうど（300.25円 × 2時間 ＝ 600.5円）は、どの値でも切り上げて601円（前の版では、50銭以下切り捨て・切り捨てなら600円）", () => {
    for (const v of ["round", "ceil", "currency_law", "floor", undefined]) expect(overtimePay(10, v)).toBe(601);
  });

  test("50銭未満（300.25円 × 1時間）は、四捨五入なら300円・常に切り上げなら301円。前の版の切り捨ては、四捨五入で300円", () => {
    expect(overtimePay(9, "round")).toBe(300);
    expect(overtimePay(9, "ceil")).toBe(301);
    expect(overtimePay(9, "floor")).toBe(300);
  });

  test("50銭を超える（300.25円 × 3時間 ＝ 900.75円）は、どの値でも901円（前の版の切り捨てなら900円）", () => {
    for (const v of ["round", "ceil", "floor", "currency_law"]) expect(overtimePay(11, v)).toBe(901);
  });
});

describe("画面と計算につないでいる", () => {
  test("会社設定の「端数処理」の残業代は2つから選び、計算と会社設定は会社ファイルの値を toOvertimeRounding で読む", () => {
    const tab = read("src/features/settings/company/RoundingTab.tsx");
    expect(tab).toContain("OVERTIME_ROUNDING_OPTIONS.map");
    expect(tab).not.toContain("常に切り捨て（⚠️未払いのリスクあり）");
    expect(tab).not.toContain("50銭以下切り捨て（50銭ちょうどは切り捨て）");
    expect(read("src/utils/calcSalary.ts")).toContain("toOvertimeRounding(companySettings?.round_overtime)");
    const manager = read("src/features/settings/useCompanyManager.ts");
    expect(manager).toContain("setRoundOvertime(toOvertimeRounding(c.round_overtime))");
    expect(manager).not.toContain('c.round_overtime || "round"');
    // 使っていない、切り捨てを含む古い選び方（constants/labor.ts）は消した
    expect(read("src/constants/labor.ts")).not.toContain("ROUNDING_OPTIONS");
  });
});
