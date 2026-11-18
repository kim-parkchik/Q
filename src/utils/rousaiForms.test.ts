import { describe, expect, test } from "bun:test";
import { calcAverageWage, type AverageWageSalary } from "./averageWage";
import type { LedgerLine } from "./legalBooks";
import { besshi1Of, senText, shishobyoForm, youshiki8Form, besshi1NonWorkOf, besshi2Of } from "./rousaiForms";

const ledger = (earnings: LedgerLine[]) => JSON.stringify({
  periodStart: null, periodEnd: null, workDays: 0, workHours: 0, overtimeHours: 0, holidayHours: 0, nightHours: 0,
  earnings, deductions: [], totalEarnings: earnings.reduce((s, l) => s + l.amount, 0), totalDeductions: 0, netPay: 0, yearEndSettlement: 0,
});
const salary = (payYear: number, payMonth: number, earnings: LedgerLine[]): AverageWageSalary => ({
  payYear, payMonth, ledger: ledger(earnings), totalEarnings: earnings.reduce((s, x) => s + x.amount, 0), leavePaidDays: null,
});
const weekdays = (year: number, month: number, hours = 8) => {
  const rows: { work_date: string; work_type: string; work_hours: number }[] = [];
  for (let d = new Date(year, month - 1, 1); d.getMonth() === month - 1; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    rows.push({ work_date: `${year}-${String(month).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, work_type: "normal", work_hours: hours });
  }
  return rows;
};

describe("労災の書類", () => {
  test("平均賃金算定内訳（別紙1）：月給の人は A に基本賃金と手当、残業代は B", () => {
    const lines: LedgerLine[] = [
      { name: "基本給", amount: 300000, avg: "month" },
      { name: "時間外手当(25%割増)", amount: 20000, avg: "time" },
      { name: "通勤手当", amount: 10000, avg: "month" },
    ];
    const r = calcAverageWage({
      eventDate: "2026-11-10", staff: { join_date: "2020-04-01", wage_type: "monthly" }, closingDay: 99, isNextMonth: true,
      salaries: [salary(2026, 9, lines), salary(2026, 10, lines), salary(2026, 11, lines)],
      attendance: [...weekdays(2026, 8), ...weekdays(2026, 9), ...weekdays(2026, 10)],
    });
    const b = besshi1Of(r);
    expect(b.a.map((x) => [x.days, x.base, x.allowance, x.total])).toEqual([[31, 300000, 10000, 310000], [30, 300000, 10000, 310000], [31, 300000, 10000, 310000]]);
    expect(b.b.map((x) => [x.base, x.allowance, x.total])).toEqual([[0, 20000, 20000], [0, 20000, 20000], [0, 20000, 20000]]);
    expect([b.i, b.ro, b.ni, b.ho]).toEqual([92, 930000, 60000, 990000]);
    // 990,000 ÷ 92 ＝ 10,760円86銭（1銭未満切り捨て）
    expect(senText(b.principleSen)).toBe("10,760円86銭");
    expect(b.hasB).toBe(true);
    // (ヘ) 930,000 ÷ 92 ＝ 10,108円69銭、(ト) 60,000 ÷ 65日（8〜10月の平日） × 60% ＝ 553円84銭
    expect(senText(b.heSen)).toBe("10,108円69銭");
    expect(b.ha).toBe(65);
    expect(senText(b.toSen)).toBe("553円84銭");
    expect(b.amountSen).toBe(b.principleSen);
  });

  test("時給の人は B の基本賃金が時給分", () => {
    const lines: LedgerLine[] = [{ name: "時給分", amount: 160000, avg: "time" }, { name: "通勤手当", amount: 8000, avg: "month" }];
    const r = calcAverageWage({
      eventDate: "2026-11-10", staff: { join_date: "2020-04-01", wage_type: "hourly" }, closingDay: 99, isNextMonth: true,
      salaries: [salary(2026, 9, lines), salary(2026, 10, lines), salary(2026, 11, lines)],
      attendance: [...weekdays(2026, 8), ...weekdays(2026, 9), ...weekdays(2026, 10)],
    });
    const b = besshi1Of(r);
    expect(b.b[0]).toMatchObject({ base: 160000, allowance: 0, total: 160000 });
    expect(b.a[0]).toMatchObject({ base: 0, allowance: 8000, total: 8000 });
  });

  test("様式第8号の事業主の証明と、労働者死傷病報告", () => {
    const staff = { id: "3", name: "見本 次郎", furigana: "みほん じろう", birthday: "1990-06-01", gender: "male", join_date: "2024-04-01", job_type: "倉庫作業", scheduled_in: "09:00", scheduled_work_hours: 8 };
    const input = {
      staff, company: { name: "サンプル物流", address: "東京都", phone: "03", representative: "代表取締役 見本 太郎", labor_ins_num: "13101123456000" },
      date: "2026-10-20", time: "14時30分", witness: "主任 見本 三郎", cause: "倉庫で荷物を運んでいるときに転んだ", leaveFrom: "2026-10-21", leaveTo: "2026-11-05",
      unpaidDays: "16", reportedOn: "2026-10-25", certifiedOn: "2026-11-06",
    };
    const f = youshiki8Form(input, { amountSen: 1076086 } as any);
    const v = (label: string) => f.items.find((i) => i.label === label)?.value;
    expect(v("⑰ 平均賃金（別紙1のとおり）")).toBe("10,760円86銭");
    expect(v("⑲ 療養のため労働できなかった期間")).toBe("令和8年10月21日から令和8年11月5日まで（16日間）");
    expect(v("所定労働時間")).toBe("9時00分から（1日 8時間）");
    const s = shishobyoForm({ ...input, industry: "4711 普通倉庫業", workers: 12, expected: "2週", occupation: "", injury: "骨折", part: "右足", place: "東京都", writer: "総務 見本", submittedOn: "2026-10-25" });
    const sv = (label: string) => s.items.find((i) => i.label === label)?.value;
    expect(sv("生年月日（年齢）・性別")).toBe("平成2年6月1日（36歳）　男");
    expect(sv("経験期間（その職種の経験。1年以上は年数、1年未満は月数）")).toBe("2年（この会社に入ってから。前の経験があれば足す）");
    expect(sv("職種（日本標準職業分類の小分類の3桁）")).toBe("倉庫作業");
    expect(s.problems).toEqual([]);
  });
});

describe("別紙1の①②と別紙2", () => {
  test("別紙1 ②：賃金計算期間ごとの業務外の傷病で休業した日数(チ)と賃金(リ)、表面①は（(ホ) − (リ)）÷（(イ) − (チ)）", () => {
    const b = {
      a: [
        { from: "2026-08-21", to: "2026-09-20", days: 31, workedDays: 0, base: 300000, allowance: 0, total: 300000 },
        { from: "2026-07-21", to: "2026-08-20", days: 31, workedDays: 0, base: 300000, allowance: 0, total: 300000 },
        { from: "2026-06-21", to: "2026-07-20", days: 30, workedDays: 0, base: 200000, allowance: 0, total: 200000 },
      ],
      b: [], i: 92, ro: 800000, ha: 0, ni: 0, ho: 800000, principleSen: 869565, heSen: null, toSen: null, minimumSen: null, amountSen: 869565, hasB: false,
    };
    const r = besshi1NonWorkOf(b, [{ start: "2026-07-01", end: "2026-07-10" }], "私傷病", () => null)!;
    expect(r.rows.map((x) => x.days)).toEqual([0, 0, 10]);
    expect([r.chi, r.ri]).toEqual([10, 0]);
    // 800,000円 ÷ 82日 ＝ 9,756円09銭
    expect(r.sen).toBe(975609);
    expect(besshi1NonWorkOf(b, [{ start: "2026-01-01", end: "2026-01-10" }], "私傷病")).toBeNull();
  });
  test("別紙2：働いた時間がある日・有給休暇は部分算定日、ほかは全部休業日（休日も数える）。時給は働いた時間 × 時給", () => {
    const rows = [
      { work_date: "2026-10-05", work_type: "normal", work_hours: 3 },
      { work_date: "2026-10-06", work_type: "paid_full", work_hours: 0 },
    ];
    const r = besshi2Of("2026-10-04", "2026-10-07", rows, { wage_type: "hourly", base_wage: 1200, scheduled_work_hours: 8 });
    expect([r.whole, r.partial, r.worked]).toEqual([2, 2, 0]);
    // 所定労働時間を働いた日は休業していないので、②③に入れない
    expect(besshi2Of("2026-10-05", "2026-10-05", [{ work_date: "2026-10-05", work_type: "normal", work_hours: 8 }], { wage_type: "hourly", base_wage: 1200, scheduled_work_hours: 8 }).worked).toBe(1);
    expect(r.days.filter((d) => d.kind === "partial").map((d) => [d.date, d.amount])).toEqual([["2026-10-05", 3600], ["2026-10-06", 9600]]);
    // 月給で休業した日にも払ったときは、月額 ÷ 30
    const m = besshi2Of("2026-10-04", "2026-10-05", [], { wage_type: "monthly", base_wage: 300000 }, true);
    expect(m.days.map((d) => [d.kind, d.amount])).toEqual([["partial", 10000], ["partial", 10000]]);
  });
});
