import { describe, expect, test } from "bun:test";
import dayjs from "dayjs";
import { buildWageCertificate, wageAmountsOf, type WageCertDay, type WageCertSalary } from "./wageCertificate";

/** from〜to の平日に働いた勤怠（except の日は欠勤） */
const weekdays = (from: string, to: string, hours = 8, except: string[] = []): WageCertDay[] => {
  const out: WageCertDay[] = [];
  for (let d = dayjs(from); !d.isAfter(dayjs(to), "day"); d = d.add(1, "day")) {
    const date = d.format("YYYY-MM-DD");
    if (d.day() === 0 || d.day() === 6) continue;
    out.push(except.includes(date) ? { work_date: date, work_type: "absent", work_hours: 0 } : { work_date: date, work_type: "normal", work_hours: hours });
  }
  return out;
};

const ledger = (start: string, end: string, earnings: { name: string; amount: number; avg?: "month" | "time" | "none" }[]) =>
  JSON.stringify({ periodStart: start, periodEnd: end, workDays: 0, workHours: 0, overtimeHours: 0, holidayHours: 0, nightHours: 0, earnings, deductions: [] });

describe("離職証明書の賃金の欄（⑧〜⑬）", () => {
  test("⑧ 離職日の翌日に応当する日がない月は月末（手引きの記入例(4)：10月30日に離職）", () => {
    // 2月は10日しか働いていない（⑨が11日以上の完全月が足りないので、資格取得日（前の年の10月20日）までさかのぼる）
    const feb = weekdays("2026-02-01", "2026-02-28").map((r, i) => (i >= 10 ? { ...r, work_type: "absent", work_hours: 0 } : r));
    const attendance = [...weekdays("2025-10-20", "2026-01-31"), ...feb, ...weekdays("2026-03-01", "2026-10-30")];
    const r = buildWageCertificate({
      endDate: "2026-10-30", acquiredOn: "2025-10-20", elderly: false, staff: { wage_type: "daily", scheduled_work_hours: 8 },
      group: { closing_day: 20, is_next_month: 0 }, salaries: [], attendance,
    });
    expect(r.nextDay).toBe("2026-10-31");
    expect(r.insured.map((x) => [x.from.slice(5), x.to.slice(5)])).toEqual([
      ["09-30", "10-30"], ["08-31", "09-29"], ["07-31", "08-30"], ["06-30", "07-30"], ["05-31", "06-29"], ["04-30", "05-30"],
      ["03-31", "04-29"], ["02-28", "03-30"], ["01-31", "02-27"], ["12-31", "01-30"], ["11-30", "12-30"], ["10-31", "11-29"],
      ["10-20", "10-30"],
    ]);
    // 1月31日（土）〜2月27日は10日（記入例と同じ）。11日以上の完全月が11か月なので、10日の月は時間数（80時間）を備考に書く
    expect(r.insured[8]).toMatchObject({ from: "2026-01-31", to: "2026-02-27", days: 10, complete: true, note: "80時間" });
    expect(r.insured[12]).toMatchObject({ from: "2025-10-20", complete: false });
    expect(r.fullMonths).toBe(11);
  });

  test("⑧ 1か月ずつの区切り（手引きの記入例(1)：8月31日に離職 → 8月1日〜離職日、7月1日〜7月31日 …）と、完全月給の⑨は暦日数", () => {
    const r = buildWageCertificate({
      endDate: "2026-08-31", acquiredOn: "2020-04-01", elderly: false, staff: { wage_type: "monthly", scheduled_work_hours: 8 },
      group: { closing_day: 99, is_next_month: 1, absence_deduction_method: "none" }, salaries: [], attendance: [],
    });
    expect(r.insured.slice(0, 3).map((x) => [x.from, x.to, x.days])).toEqual([
      ["2026-08-01", "2026-08-31", 31], ["2026-07-01", "2026-07-31", 31], ["2026-06-01", "2026-06-30", 30],
    ]);
    expect(r.insured).toHaveLength(12);
  });

  test("高年齢被保険者は⑨が11日以上の完全月が6か月まで", () => {
    const r = buildWageCertificate({
      endDate: "2026-08-31", acquiredOn: "2020-04-01", elderly: true, staff: { wage_type: "monthly" },
      group: { closing_day: 99, is_next_month: 1, absence_deduction_method: "none" }, salaries: [], attendance: [],
    });
    expect(r.insured).toHaveLength(6);
  });

  test("日給月給で欠勤した月は、欠勤した日を除いた日数（手引きの記入例(5)）。⑩⑫は確定した給与の額と、備考に欠勤の日数", () => {
    const absent = ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24"];
    const attendance = weekdays("2025-09-01", "2026-09-30", 8, absent);
    const salaries: WageCertSalary[] = [];
    for (let m = 0; m < 13; m++) {
      const start = dayjs("2025-09-01").add(m, "month");
      const end = start.endOf("month");
      const july = start.format("YYYY-MM") === "2026-07";
      salaries.push({
        target_year: end.add(1, "month").year(), target_month: end.add(1, "month").month() + 1, total_earnings: july ? 193182 : 250000,
        ledger: ledger(start.format("YYYY-MM-DD"), end.format("YYYY-MM-DD"), july
          ? [{ name: "基本給", amount: 250000 }, { name: "欠勤控除", amount: -56818 }]
          : [{ name: "基本給", amount: 250000 }]),
      });
    }
    const r = buildWageCertificate({
      endDate: "2026-09-30", acquiredOn: "2020-04-01", elderly: false, staff: { wage_type: "monthly", scheduled_work_hours: 8 },
      group: { closing_day: 99, is_next_month: 1, absence_deduction_method: "workdays" }, salaries, attendance,
    });
    const julyRow = r.insured.find((x) => x.from === "2026-07-01")!;
    expect(julyRow.days).toBe(23 - 5);
    const julyWage = r.wages.find((x) => x.from === "2026-07-01")!;
    expect(julyWage).toMatchObject({ days: 18, a: 193182, b: 0, total: 193182, note: "欠勤5日" });
    expect(r.wages[0]).toMatchObject({ from: "2026-09-01", to: "2026-09-30", a: 250000 });
    // ⑪が11日以上の完全月が6か月になるまで
    expect(r.wages).toHaveLength(6);
  });

  test("日給・時給の人：日給・時給の分と残業代は B、月額の手当は A（手引きの記入例(3)）。休業手当は入れ、臨時の賃金は入れない", () => {
    const s: WageCertSalary = {
      target_year: 2026, target_month: 9, total_earnings: 230000,
      ledger: ledger("2026-08-21", "2026-09-20", [
        { name: "日給", amount: 180000 }, { name: "時間外手当", amount: 17000 }, { name: "通勤手当", amount: 8000 },
        { name: "家族手当", amount: 10000, avg: "month" }, { name: "休業手当", amount: 5000 }, { name: "結婚祝金", amount: 10000, avg: "none" },
      ]),
    };
    expect(wageAmountsOf(s, "daily")).toMatchObject({ a: 18000, b: 202000, shutdownPay: 5000, excluded: 10000 });
    // 月給の人は、残業代も A
    expect(wageAmountsOf({ ...s, ledger: ledger("2026-08-21", "2026-09-20", [{ name: "基本給", amount: 210000 }, { name: "時間外手当", amount: 15000 }]) }, "monthly"))
      .toMatchObject({ a: 225000, b: 0 });
  });

  test("給与を払わない休業で賃金がない1か月は、書かずにさかのぼり、古い方の行の備考に期間を書く（手引きの記入例(7)）", () => {
    const attendance = [...weekdays("2024-01-01", "2026-01-31"), ...weekdays("2026-05-01", "2026-08-31")];
    const r = buildWageCertificate({
      endDate: "2026-08-31", acquiredOn: "2020-04-01", elderly: false,
      staff: { wage_type: "daily", scheduled_work_hours: 8, leave_periods: JSON.stringify([{ type: "injury", start: "2026-02-01", end: "2026-04-30" }]) },
      group: { closing_day: 99, is_next_month: 1 }, salaries: [], attendance,
    });
    const froms = r.insured.map((x) => x.from);
    expect(froms).not.toContain("2026-02-01");
    expect(froms).not.toContain("2026-03-01");
    expect(froms).not.toContain("2026-04-01");
    expect(r.insured).toHaveLength(12);
    const after = r.insured.find((x) => x.from === "2026-01-01")!;
    expect(after.note).toContain("賃金なし");
    expect(r.notes.join("")).toContain("2026-02-01〜2026-04-30");
  });

  test("離職日を含む給与を確定していなければ知らせる", () => {
    const r = buildWageCertificate({
      endDate: "2026-08-31", acquiredOn: "2026-04-01", elderly: false, staff: { wage_type: "monthly" },
      group: { closing_day: 99, is_next_month: 1, absence_deduction_method: "none" }, salaries: [], attendance: [],
    });
    expect(r.problems.join("")).toContain("離職日（2026-08-31）を含む給与");
  });
});
