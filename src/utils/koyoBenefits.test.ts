import { describe, expect, test } from "bun:test";
import { benefitUnits, buildLeaveBenefit, calendarMonths, childcareCertStart, payDateOf, reach60Date, unitFigures, type BenefitData } from "./koyoBenefits";

describe("雇用保険の給付の申請に書く内容", () => {
  test("支給単位期間：休業を始めた日から1か月ごと。最後は終わりの日まで（手引き：7月6日に育児休業開始、1歳に達する日の前日 8月8日まで）", () => {
    const units = benefitUnits("2025-07-06", "2026-08-08");
    expect(units[0]).toEqual({ from: "2025-07-06", to: "2025-08-05" });
    expect(units[1]).toEqual({ from: "2025-08-06", to: "2025-09-05" });
    expect(units[units.length - 1]).toEqual({ from: "2026-08-06", to: "2026-08-08" });
    expect(units).toHaveLength(14);
    // 応当日がない月は、その月の末日を応当日とみなす（1月31日開始 → 2月28日の前日まで）
    expect(benefitUnits("2026-01-31", "2026-04-30").slice(0, 2)).toEqual([
      { from: "2026-01-31", to: "2026-02-27" }, { from: "2026-02-28", to: "2026-03-30" },
    ]);
  });

  test("支払われた賃金額：その期間に支払日のある、休業期間の分の賃金だけ（手引き：20日締め・25日払い・4月15日に休業開始）", () => {
    const data: BenefitData = {
      staff: { id: "1", name: "育休 花子", wage_type: "hourly" },
      group: { closing_day: 20, is_next_month: 0, payment_day: 25 },
      salaries: [
        { target_year: 2026, target_month: 4, total_earnings: 150000 }, // 3/21〜4/20 の分（休業前を含む）
        { target_year: 2026, target_month: 5, total_earnings: 20000 }, // 4/21〜5/20 の分（休業中に働いた分）
      ],
      attendance: [{ work_date: "2026-05-01", work_type: "normal", work_hours: 4 }, { work_date: "2026-04-10", work_type: "normal", work_hours: 8 }],
      koyoNumber: "1301-123456-7", today: "2026-07-01",
    };
    expect(payDateOf(data.group, 2026, 4)).toBe("2026-04-25");
    const leave = { start: "2026-04-15", end: "2026-10-14" };
    const u1 = unitFigures({ from: "2026-04-15", to: "2026-05-14" }, data, leave);
    expect(u1).toMatchObject({ workDays: 1, workHours: 4, paid: 0 });
    expect(u1.note).toContain("4月25日");
    const u2 = unitFigures({ from: "2026-05-15", to: "2026-06-14" }, data, leave);
    expect(u2.paid).toBe(20000);
  });

  test("産前産後休業に続けて育児休業をしたときは、産前休業を始めた日の前日までの賃金で証明する", () => {
    const leaves = [
      { type: "maternity" as const, start: "2026-02-01", end: "2026-05-28" },
      { type: "childcare" as const, start: "2026-05-29", end: "2027-03-31", childBirthday: "2026-04-02" },
    ];
    expect(childcareCertStart(leaves, leaves[1])).toEqual({ start: "2026-02-01", fromMaternity: true });
    const doc = buildLeaveBenefit({
      staff: { id: "2", name: "母", wage_type: "monthly", leave_periods: JSON.stringify(leaves), join_date: "2020-04-01", employment_ins_num: "1301-000001-1" },
      group: { closing_day: 99, is_next_month: 1, payment_day: 25, absence_deduction_method: "none" }, salaries: [], attendance: [],
      koyoNumber: "1301-123456-7", today: "2026-11-17",
    }, leaves[1], "childcare");
    expect(doc.certEnd).toBe("2026-01-31");
    expect(doc.units[0]).toMatchObject({ from: "2026-05-29", to: "2026-06-28" });
    expect(doc.notes.join("")).toContain("産前休業を始めた日");
  });

  test("60歳に達した日は誕生日の前日・支給対象月は暦月", () => {
    expect(reach60Date("1966-11-20")).toBe("2026-11-19");
    expect(calendarMonths("2026-11-19", "2027-01-05")).toEqual([
      { from: "2026-11-01", to: "2026-11-30" }, { from: "2026-12-01", to: "2026-12-31" }, { from: "2027-01-01", to: "2027-01-31" },
    ]);
  });
});
