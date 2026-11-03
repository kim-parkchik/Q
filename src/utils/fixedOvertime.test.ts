/**
 * 固定残業代の時間の目安（fixedOvertime.ts）のテスト
 * 実行方法: bun test
 */
import { describe, expect, test } from "bun:test";
import { fixedOvertimeCoverageHours, overtimeHourlyRateOf, overtimePayFor } from "./fixedOvertime";

describe("残業代の時給", () => {
  test("（月給 ＋ 残業代の時給に入れる手当）÷ 月平均所定労働時間", () => {
    // 年245日 × 8時間 ÷ 12 ＝ 163.33…時間
    const hours = (245 * 8) / 12;
    expect(overtimeHourlyRateOf(300000, 20000, hours)).toBeCloseTo(320000 / hours, 6);
    expect(overtimeHourlyRateOf(300000, 0, 160)).toBe(1875);
    expect(overtimeHourlyRateOf(300000, 0, 0)).toBe(0);
  });
});

describe("固定残業代の時間", () => {
  const rate = 2000; // 時給2,000円：1時間の割増賃金は2,500円（25%）、60時間を超えた分は3,000円（50%）
  test("割増賃金：60時間までは1.25倍、超えた分は1.5倍", () => {
    expect(overtimePayFor(20, rate)).toBe(50000);
    expect(overtimePayFor(60, rate)).toBe(150000);
    expect(overtimePayFor(70, rate)).toBe(180000);
  });
  test("固定残業代が何時間分か（割増賃金の逆）", () => {
    expect(fixedOvertimeCoverageHours(50000, rate)).toBe(20);
    expect(fixedOvertimeCoverageHours(150000, rate)).toBe(60);
    expect(fixedOvertimeCoverageHours(180000, rate)).toBe(70);
  });
  test("手当を時給に入れると、同じ額でも時間は短くなる", () => {
    const withoutAllowance = fixedOvertimeCoverageHours(50000, overtimeHourlyRateOf(300000, 0, 160))!;
    const withAllowance = fixedOvertimeCoverageHours(50000, overtimeHourlyRateOf(300000, 30000, 160))!;
    expect(withoutAllowance).toBeCloseTo(21.33, 2);
    expect(withAllowance).toBeCloseTo(19.39, 2);
  });
  test("時給が分からなければ出さない", () => {
    expect(fixedOvertimeCoverageHours(50000, 0)).toBeNull();
  });
});
