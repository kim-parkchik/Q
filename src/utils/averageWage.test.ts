/**
 * 平均賃金（労働基準法12条）と、それを使う額（utils/averageWage.ts）
 * 計算例の数字は、神奈川労働局「平均賃金について」の例と同じ（月で決まる賃金 21,000円 ÷ 91日 ＝ 230円76銭、
 * 日で決まる賃金 393,600円 ÷ 41日 × 60% ＝ 5,760円00銭、休業手当 5,504.28円 → 5,504円）
 */
import { describe, expect, test } from "bun:test";
import {
  averageWageAmount, averageWageKindOfLine, averageWagePeriods, calcAverageWage, closingDateBefore, dismissalAllowanceDays, dismissalNoticeDays,
  formatSen, injuryWaitingDays, shutdownEventDates, toAverageWageKind, toShutdownRate, type AverageWageInput, type AverageWageSalary,
} from "./averageWage";
import type { LedgerLine, PayLedger } from "./legalBooks";

const ledger = (earnings: LedgerLine[], o: Partial<PayLedger> = {}): string => JSON.stringify({
  periodStart: null, periodEnd: null, workDays: 0, workHours: 0, overtimeHours: 0, holidayHours: 0, nightHours: 0,
  earnings, deductions: [], totalEarnings: earnings.reduce((s, l) => s + l.amount, 0), totalDeductions: 0, netPay: 0, yearEndSettlement: 0, ...o,
});
const salary = (payYear: number, payMonth: number, earnings: LedgerLine[], o: Partial<AverageWageSalary> = {}, l: Partial<PayLedger> = {}): AverageWageSalary => ({
  payYear, payMonth, ledger: ledger(earnings, l), totalEarnings: earnings.reduce((s, x) => s + x.amount, 0), leavePaidDays: null, ...o,
});
/** その月の平日（月〜金）に hours 時間ずつ働いた勤怠 */
const weekdaysOf = (year: number, month: number, hours = 8, limit = 99) => {
  const rows: { work_date: string; work_type: string; work_hours: number }[] = [];
  for (let d = new Date(year, month - 1, 1); d.getMonth() === month - 1 && rows.length < limit; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    rows.push({ work_date: `${year}-${String(month).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, work_type: "normal", work_hours: hours });
  }
  return rows;
};
const monthlyLines = (overtime = 20000): LedgerLine[] => [
  { name: "基本給", amount: 300000, avg: "month" },
  { name: "時間外手当(25%割増)", amount: overtime, avg: "time" },
  { name: "通勤手当", amount: 10000, avg: "month" },
];
/** 末日締め・翌月払いの会社の月給の人（2026年11月10日のできごと → 8〜10月の分。9〜11月支給の給与） */
const input = (o: Partial<AverageWageInput> = {}): AverageWageInput => ({
  eventDate: "2026-11-10",
  staff: { join_date: "2020-04-01", wage_type: "monthly" },
  closingDay: 99, isNextMonth: true,
  salaries: [salary(2026, 9, monthlyLines()), salary(2026, 10, monthlyLines()), salary(2026, 11, monthlyLines())],
  attendance: [...weekdaysOf(2026, 8), ...weekdaysOf(2026, 9), ...weekdaysOf(2026, 10)],
  ...o,
});

describe("3か月（直前の締日から数える。労働基準法12条2項）", () => {
  test("末日締め：できごとの日の前の締日。できごとの日が締日なら、その前の締日", () => {
    expect(closingDateBefore("2026-11-10", 99)).toBe("2026-10-31");
    expect(closingDateBefore("2026-11-01", 99)).toBe("2026-10-31");
    expect(closingDateBefore("2026-10-31", 99)).toBe("2026-09-30");
    expect(closingDateBefore("2026-03-01", 99)).toBe("2026-02-28");
  });
  test("15日締め", () => {
    expect(closingDateBefore("2026-11-16", 15)).toBe("2026-11-15");
    expect(closingDateBefore("2026-11-15", 15)).toBe("2026-10-15");
    expect(closingDateBefore("2026-11-10", 15)).toBe("2026-10-15");
  });
  test("3つの賃金計算期間と、その給与を払う月（翌月払い・当月払い）", () => {
    expect(averageWagePeriods("2026-11-10", 99, true)).toEqual([
      { start: "2026-08-01", end: "2026-08-31", payYear: 2026, payMonth: 9 },
      { start: "2026-09-01", end: "2026-09-30", payYear: 2026, payMonth: 10 },
      { start: "2026-10-01", end: "2026-10-31", payYear: 2026, payMonth: 11 },
    ]);
    expect(averageWagePeriods("2026-11-10", 15, false)).toEqual([
      { start: "2026-07-16", end: "2026-08-15", payYear: 2026, payMonth: 8 },
      { start: "2026-08-16", end: "2026-09-15", payYear: 2026, payMonth: 9 },
      { start: "2026-09-16", end: "2026-10-15", payYear: 2026, payMonth: 10 },
    ]);
  });
});

describe("平均賃金（原則と最低保障）", () => {
  test("月給の人：3か月の賃金の総額 ÷ 暦日数（1銭未満切り捨て）。最低保障より高い", () => {
    const r = calcAverageWage(input());
    expect([r.from, r.to, r.totalDays]).toEqual(["2026-08-01", "2026-10-31", 92]);
    expect([r.monthWages, r.timeWages]).toEqual([930000, 60000]);
    // 990,000円 ÷ 92日 ＝ 10,760.869… → 10,760円86銭
    expect(r.principleSen).toBe(1076086);
    expect(r.minimumSen).toBeLessThan(r.principleSen!);
    expect(r.amountSen).toBe(1076086);
    expect(formatSen(r.amountSen!)).toBe("10,760円86銭");
    expect(r.error).toBeNull();
  });
  test("神奈川労働局の例：月で決まる賃金 21,000円 ÷ 91日 ＋ 日で決まる賃金 393,600円 ÷ 41日 × 60% ＝ 5,990円76銭", () => {
    // 4〜6月（30 ＋ 31 ＋ 30 ＝ 91日）。毎月、月額の手当 7,000円と日給の分 131,200円。働いた日は 14 ＋ 14 ＋ 13 ＝ 41日
    const lines: LedgerLine[] = [{ name: "日給", amount: 131200, avg: "time" }, { name: "皆勤手当", amount: 7000, avg: "month" }];
    const r = calcAverageWage(input({
      eventDate: "2026-07-10", staff: { join_date: "2020-04-01", wage_type: "daily" },
      salaries: [salary(2026, 5, lines), salary(2026, 6, lines), salary(2026, 7, lines)],
      attendance: [...weekdaysOf(2026, 4, 8, 14), ...weekdaysOf(2026, 5, 8, 14), ...weekdaysOf(2026, 6, 8, 13)],
    }));
    expect([r.totalDays, r.monthWages, r.timeWages, r.workedDays]).toEqual([91, 21000, 393600, 41]);
    expect(r.principleSen).toBe(455604); // 414,600円 ÷ 91日 ＝ 4,556円04銭
    expect(r.minimumSen).toBe(23076 + 576000); // 230円76銭 ＋ 5,760円00銭
    expect(formatSen(r.amountSen!)).toBe("5,990円76銭");
  });
  test("給与項目の扱い：入れない項目（臨時の賃金）と休業手当・休業補償は入れない", () => {
    const lines: LedgerLine[] = [...monthlyLines(0), { name: "結婚祝金", amount: 50000, avg: "none" }, { name: "休業手当", amount: 11009, avg: "none" }];
    const r = calcAverageWage(input({ salaries: [salary(2026, 9, monthlyLines(0)), salary(2026, 10, lines), salary(2026, 11, monthlyLines(0))] }));
    expect(r.monthWages).toBe(930000);
    expect(r.periods[1].notIncluded).toBe(61009);
  });
  test("分け方を残していない内訳（前に確定した給与）は、行の名前で決める", () => {
    expect(averageWageKindOfLine({ name: "時給分", amount: 1 }, "hourly")).toBe("time");
    expect(averageWageKindOfLine({ name: "欠勤控除", amount: -1 }, "monthly")).toBe("month");
    expect(averageWageKindOfLine({ name: "遅刻早退控除", amount: -1 }, "daily")).toBe("time");
    expect(averageWageKindOfLine({ name: "休業補償(労災の待期)", amount: 1 }, "monthly")).toBe("none");
    expect(averageWageKindOfLine({ name: "住宅手当", amount: 1 }, "monthly")).toBe("month");
    // 給与項目の設定がなければ、固定の項目は月で決まる賃金、変動の項目は日・時間・出来高で決まる賃金
    expect([toAverageWageKind(null, "fixed"), toAverageWageKind(null, "variable"), toAverageWageKind("none", "fixed")]).toEqual(["month", "time", "none"]);
  });
  test("内訳がない給与は、総支給額を月で決まる賃金にして知らせる", () => {
    const r = calcAverageWage(input({ salaries: [salary(2026, 9, monthlyLines()), { ...salary(2026, 10, monthlyLines()), ledger: null }, salary(2026, 11, monthlyLines())] }));
    expect(r.monthWages).toBe(930000 + 20000);
    expect(r.periods[1].notes[0]).toContain("総支給額");
  });
});

describe("除く期間（労働基準法12条3項）", () => {
  test("育児休業の日と、その期間の賃金を除く（月給は日割りしているので、払った賃金をそのまま使う）", () => {
    const r = calcAverageWage(input({
      staff: { join_date: "2020-04-01", wage_type: "monthly", leave_periods: JSON.stringify([{ type: "childcare", start: "2026-09-21", end: "2026-10-10" }]) },
      salaries: [
        salary(2026, 9, monthlyLines(0)),
        salary(2026, 10, [{ name: "基本給", amount: 200000, avg: "month" }], { leavePaidDays: 14 }),
        salary(2026, 11, [{ name: "基本給", amount: 250000, avg: "month" }], { leavePaidDays: 15 }),
      ],
    }));
    expect(r.periods.map((p) => p.excludedReasons)).toEqual([[], ["育児休業 10日"], ["育児休業 10日"]]);
    expect(r.totalDays).toBe(72);
    // (310,000 ＋ 200,000 ＋ 250,000) ÷ 72日 ＝ 10,555.55… → 10,555円55銭
    expect(r.amountSen).toBe(1055555);
  });
  test("私傷病などのその他の休職は除かない（日数に入れ、賃金は払った分）", () => {
    const r = calcAverageWage(input({
      staff: { join_date: "2020-04-01", wage_type: "monthly", leave_periods: JSON.stringify([{ type: "other", start: "2026-10-01", end: "2026-10-31" }]) },
    }));
    expect(r.totalDays).toBe(92);
  });
  test("会社都合で休ませた日：その日と休業手当を除く。月給の人が働いた日は、月給を払っているので除かない", () => {
    const att = [...weekdaysOf(2026, 8), ...weekdaysOf(2026, 9), ...weekdaysOf(2026, 10)]
      .map((a) => (a.work_date === "2026-10-05" || a.work_date === "2026-10-06" ? { ...a, work_type: "company_leave", work_hours: 0 }
        : a.work_date === "2026-10-07" ? { ...a, work_type: "company_leave", work_hours: 3 } : a));
    const oct: LedgerLine[] = [...monthlyLines(), { name: "休業の日の控除", amount: -27272, avg: "month" }, { name: "休業手当", amount: 12913, avg: "none" }];
    const r = calcAverageWage(input({ attendance: att, salaries: [salary(2026, 9, monthlyLines()), salary(2026, 10, monthlyLines()), salary(2026, 11, oct)] }));
    expect(r.periods[2].excludedReasons).toEqual(["会社都合の休業 2日"]);
    expect(r.periods[2].monthWages).toBe(310000 - 27272);
    expect(r.totalDays).toBe(90);
  });
  test("時給の人が会社都合の休業の日に少し働いた分は、その日を除くので、賃金も除く", () => {
    const att = weekdaysOf(2026, 10, 6).map((a) => (a.work_date === "2026-10-07" ? { ...a, work_type: "company_leave", work_hours: 2 } : a));
    const lines: LedgerLine[] = [{ name: "時給分", amount: 150000, avg: "time" }];
    const r = calcAverageWage(input({
      staff: { join_date: "2020-04-01", wage_type: "hourly" }, attendance: [...weekdaysOf(2026, 8, 6), ...weekdaysOf(2026, 9, 6), ...att],
      salaries: [salary(2026, 9, lines), salary(2026, 10, lines), salary(2026, 11, lines, {}, { shutdownWorkedPay: 2400 })],
    }));
    expect(r.periods[2].timeWages).toBe(150000 - 2400);
    expect(r.periods[2].workedDays).toBe(21); // 10月の平日22日のうち、休業の日を除く
  });
  test("試用期間：できごとが試用期間の後なら、試用期間の日と賃金（またぐ期間は暦日数で分ける）を除く", () => {
    const staff = { join_date: "2026-07-01", probation_end: "2026-08-15", wage_type: "monthly" };
    const r = calcAverageWage(input({ staff }));
    expect(r.periods[0].excludedReasons).toEqual(["試用期間 15日"]);
    // 8月の 310,000円のうち、試用期間の15日分（310,000 × 15 ÷ 31 ＝ 150,000）を除く
    expect(r.periods[0].monthWages).toBe(310000 - 150000);
    expect(r.periods[0].notes[0]).toContain("試用期間");
    // 試用期間の中のできごとなら、試用期間を除かない（労働基準法施行規則3条）
    const during = calcAverageWage(input({ eventDate: "2026-08-10", staff: { ...staff, probation_end: "2026-09-30" },
      salaries: [salary(2026, 8, monthlyLines())], attendance: weekdaysOf(2026, 7) }));
    expect(during.periods.map((p) => p.excludedDays)).toEqual([0]);
  });
  test("3か月がすべて除く期間なら、都道府県労働局長が決めるので計算しない（労働基準法施行規則4条）", () => {
    const r = calcAverageWage(input({
      staff: { join_date: "2020-04-01", wage_type: "monthly", leave_periods: JSON.stringify([{ type: "childcare", start: "2026-01-10", end: "2026-11-09" }]) },
      salaries: [],
    }));
    expect(r.amountSen).toBeNull();
    expect(r.error).toContain("施行規則4条");
  });
});

describe("入社して3か月たたない人・確定していない給与", () => {
  test("入社した日から数える（労働基準法12条6項）", () => {
    const r = calcAverageWage(input({ staff: { join_date: "2026-09-20", wage_type: "monthly" }, salaries: [salary(2026, 10, monthlyLines()), salary(2026, 11, monthlyLines())] }));
    expect([r.from, r.totalDays]).toEqual(["2026-09-20", 11 + 31]);
    expect(r.periods.map((p) => p.from)).toEqual(["2026-09-20", "2026-10-01"]);
  });
  test("直前の締日までが、ひとつの賃金計算期間に満たないときは、Q では計算しない（手で入れる）", () => {
    const r = calcAverageWage(input({ staff: { join_date: "2026-10-05", wage_type: "monthly" } }));
    expect(r.amountSen).toBeNull();
    expect(r.error).toContain("ひとつの賃金計算期間に満たない");
    expect(calcAverageWage(input({ staff: { join_date: "2026-11-10" } })).error).toContain("入社した日");
  });
  test("給与を確定していない月があれば、計算しない（どの給与かを知らせる）", () => {
    const r = calcAverageWage(input({ salaries: [salary(2026, 9, monthlyLines()), salary(2026, 10, monthlyLines())] }));
    expect(r.amountSen).toBeNull();
    expect(r.error).toContain("2026年11月支給の給与（10月1日〜10月31日の分）");
  });
});

describe("平均賃金を使う額（1円未満は四捨五入）", () => {
  test("休業手当：平均賃金 × 60% × 日数（神奈川労働局の例：9,173円80銭 × 60% ＝ 5,504.28円 → 5,504円）", () => {
    expect(averageWageAmount(917380, 60, 1)).toBe(5504);
    expect(averageWageAmount(1198152, 60, 1)).toBe(7189); // 7,188.912円 → 7,189円
    expect(averageWageAmount(917380, 60, 3)).toBe(16513); // 16,512.84円
  });
  test("少し働いた日は、その日の賃金との差額（マイナスにはしない）", () => {
    expect(averageWageAmount(1000000, 60, 0, [2000])).toBe(4000);
    expect(averageWageAmount(1000000, 60, 1, [7000])).toBe(6000);
  });
  test("休業手当の率は60%以上（入っていない・60未満なら60%）", () => {
    expect([toShutdownRate(null), toShutdownRate(50), toShutdownRate(80), toShutdownRate(120)]).toEqual([60, 60, 80, 100]);
  });
  test("解雇予告手当：予告の日数は、伝えた日の翌日から解雇の日まで（8月31日に解雇するなら、8月1日までに伝える）", () => {
    expect(dismissalNoticeDays("2026-08-01", "2026-08-31")).toBe(30);
    expect(dismissalAllowanceDays(30)).toBe(0);
    expect(dismissalAllowanceDays(dismissalNoticeDays("2026-08-11", "2026-08-31")!)).toBe(10);
    expect(dismissalAllowanceDays(dismissalNoticeDays("2026-08-31", "2026-08-31")!)).toBe(30); // その日に解雇
    expect(dismissalNoticeDays("2026-09-01", "2026-08-31")).toBeNull();
  });
});

describe("給与に入れる日", () => {
  test("会社都合の休業：休日だけをはさんで続く休業は、初めの日で平均賃金を数える", () => {
    const isWorkDay = (d: string) => ![0, 6].includes(new Date(`${d}T00:00:00`).getDay());
    // 11/6(金)・11/9(月)は続いている。11/11(水)は、あいだの11/10(火)が所定労働日なので別の休業
    expect(shutdownEventDates(["2026-11-09", "2026-11-06", "2026-11-11"], isWorkDay)).toEqual({
      "2026-11-06": "2026-11-06", "2026-11-09": "2026-11-06", "2026-11-11": "2026-11-11",
    });
  });
  test("労災の待期：休業の最初の3日（休日も数える）。同じ事故なら、期間を分けても通算して3日", () => {
    expect(injuryWaitingDays([{ type: "injury", start: "2026-11-07", end: "" }])).toEqual([
      { date: "2026-11-07", eventDate: "2026-11-07" }, { date: "2026-11-08", eventDate: "2026-11-07" }, { date: "2026-11-09", eventDate: "2026-11-07" },
    ]);
    expect(injuryWaitingDays([
      { type: "injury", start: "2026-11-12", end: "2026-11-20", accident: "2026-11-06" },
      { type: "injury", start: "2026-11-07", end: "2026-11-07", accident: "2026-11-06" },
      { type: "childcare", start: "2026-11-01", end: "" },
    ])).toEqual([
      { date: "2026-11-07", eventDate: "2026-11-06" }, { date: "2026-11-12", eventDate: "2026-11-06" }, { date: "2026-11-13", eventDate: "2026-11-06" },
    ]);
  });
});
