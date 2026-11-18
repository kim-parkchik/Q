import { describe, expect, test } from "bun:test";
import { maikinPeriod, maikinResult } from "./maikin";

const ledger = (o: Record<string, unknown>) => JSON.stringify({
  periodStart: null, periodEnd: null, workDays: 0, workHours: 0, overtimeHours: 0, holidayHours: 0, nightHours: 0,
  earnings: [], deductions: [], totalEarnings: 0, totalDeductions: 0, netPay: 0, yearEndSettlement: 0, ...o,
});

describe("毎月勤労統計調査", () => {
  test("調査期間（記入要領の例：20日締めは12月21日〜1月20日が1月分、10日締めは1月11日〜2月10日が1月分）", () => {
    expect(maikinPeriod(2026, 1, 20)).toEqual({ from: "2025-12-21", to: "2026-01-20" });
    expect(maikinPeriod(2026, 1, 10)).toEqual({ from: "2026-01-11", to: "2026-02-10" });
    expect(maikinPeriod(2026, 2, 99)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  test("常用労働者数・出勤日数・時間・給与を男女とパートに分ける", () => {
    const staff = [
      { id: "1", gender: "male", wage_type: "monthly", scheduled_work_hours: 8, calendar_pattern_id: 1, join_date: "2020-04-01" },
      { id: "2", gender: "female", wage_type: "monthly", scheduled_work_hours: 8, calendar_pattern_id: 1, join_date: "2026-10-05" },
      { id: "3", gender: "female", wage_type: "hourly", scheduled_work_hours: 5, calendar_pattern_id: 0, work_days: "mon,wed,fri", join_date: "2024-04-01" },
      { id: "4", gender: "male", wage_type: "monthly", scheduled_work_hours: 8, calendar_pattern_id: 1, join_date: "2019-04-01", retirement_date: "2026-10-31" },
      { id: "9", gender: "male", wage_type: "monthly", scheduled_work_hours: 8, is_executive: 1, join_date: "2010-04-01" },
    ];
    const salaries = [
      { staffId: "1", totalEarnings: 330000, ledger: ledger({ workDays: 20, workHours: 172.5, overtimeHours: 12.5, earnings: [{ name: "基本給", amount: 300000 }, { name: "時間外手当(25%割増)", amount: 25000 }, { name: "通勤手当", amount: 5000 }] }) },
      { staffId: "2", totalEarnings: 200000, ledger: ledger({ workDays: 19, workHours: 152, earnings: [{ name: "基本給", amount: 200000 }] }) },
      { staffId: "3", totalEarnings: 78000, ledger: ledger({ workDays: 13, workHours: 65, earnings: [{ name: "時給分", amount: 78000 }] }) },
      { staffId: "4", totalEarnings: 280000, ledger: ledger({ workDays: 21, workHours: 168, earnings: [{ name: "基本給", amount: 280000 }] }) },
    ];
    const r = maikinResult(staff, { from: "2026-10-01", to: "2026-10-31" }, salaries, [{ staffId: "1", name: "決算賞与", amount: 150000 }]);
    expect(r.start).toEqual({ men: 2, women: 1, part: 1 });
    expect(r.increase).toEqual({ men: 0, women: 1, part: 0 });
    expect(r.decrease).toEqual({ men: 1, women: 0, part: 0 });
    expect(r.end).toEqual({ men: 1, women: 2, part: 1 });
    expect(r.days).toEqual({ men: 41, women: 32, part: 13 });
    expect(r.scheduledHours).toEqual({ men: 328, women: 217, part: 65 });
    expect(r.overtimeHours).toEqual({ men: 13, women: 0, part: 0 });
    // 330,000＋280,000 ＝ 610千円、200,000＋78,000 ＝ 278千円、超過労働給与 25千円、特別に支払われた給与 150千円
    expect(r.regularPay).toEqual({ men: 610, women: 278, part: 78 });
    expect(r.overtimePay).toEqual({ men: 25, women: 0, part: 0 });
    expect(r.specialPay).toEqual({ men: 150, women: 0, part: 0 });
    expect(r.specialItems).toEqual([{ name: "決算賞与", amount: 150000 }]);
    expect(r.missing).toEqual([]);
  });
});
