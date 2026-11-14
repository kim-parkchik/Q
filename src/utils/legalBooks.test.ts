/**
 * 法定三帳簿（労働者名簿・賃金台帳・出勤簿。legalBooks.ts）のテスト
 * 実行方法: bun test
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { calculateSalary, saveSalaryResult, type SalaryExtras } from "./calcSalary";
import {
  attendanceBookCsv, attendanceBookRows, attendanceBookTotals, bonusLedgerOf, hoursText, parseLedger, rosterCsv, rosterMissing, rosterRowOf,
  salaryLedgerOf, wageLedgerCsv, wageLedgerRows, type LedgerLine, type WageLedgerColumn,
} from "./legalBooks";
import { DB_SCHEMAS } from "../types/dbSchema";

const company = { week_start_day: 0, round_overtime: "round", round_social_ins: "currency_law", round_emp_ins: "currency_law" };
const extras = (o: Partial<SalaryExtras> = {}): SalaryExtras => ({
  allowanceName: "", allowanceAmount: 0, residentTax: 0, prefecture: "東京", dependents: 0, customItems: [], ...o,
});
const monthly = { wage_type: "monthly", base_wage: 300000, scheduled_work_hours: 8, commute_type: "none", commute_amount: 0, standard_remuneration: 300000, birthday: "1980-06-15", social_insurance_group_id: 1 };
const day = (date: string, hours: number, type = "normal", o: Record<string, unknown> = {}) => ({ work_date: `2026-06-${date}`, work_hours: hours, night_hours: 0, work_type: type, ...o });
const sumOf = (lines: { amount: number }[]) => lines.reduce((s, l) => s + l.amount, 0);

describe("賃金台帳の内訳（給与明細の支給・控除の行）", () => {
  test("支給の行を足すと総支給額、控除の行を足すと控除合計になる（いろいろな月で）", () => {
    const cases = [
      calculateSalary(monthly, [day("08", 10.5, "normal", { night_hours: 1.5 }), day("13", 6, "holiday_work"), day("14", 7, "statutory_holiday")], extras({ residentTax: 12000 }), 2026, 6, company),
      calculateSalary({ ...monthly, fixed_overtime_hours: 10, fixed_overtime_allowance: 20000 }, [day("08", 11)], extras({ allowanceName: "役職手当", allowanceAmount: 15000 }), 2026, 6, company),
      calculateSalary({ ...monthly, wage_type: "hourly", base_wage: 1200, standard_remuneration: 0 }, [day("08", 8), day("09", 9)],
        extras({ customItems: [{ name: "皆勤手当", amount: 5000, type: "earning" }, { name: "社内預金", amount: 3000, type: "deduction" }] }), 2026, 6, company),
      calculateSalary(monthly, [day("08", 0, "absent"), day("09", 8)], extras({ periodWorkDays: 22 }), 2026, 6, company),
    ];
    for (const r of cases) {
      const l = salaryLedgerOf(r, { wageType: "monthly", allowanceName: "役職手当", period: { start: "2026-06-01", end: "2026-06-30" } });
      expect(sumOf(l.earnings)).toBe(r.totalEarnings);
      expect(sumOf(l.deductions)).toBe(r.totalDeductions);
      expect(l.netPay).toBe(r.netPay);
    }
  });
  test("行の名前と、労働日数・時間数（時間外は法定外、休日は法定休日）", () => {
    const r = calculateSalary(monthly, [day("08", 10, "normal", { night_hours: 2 }), day("14", 7, "statutory_holiday")], extras({ allowanceName: "役職手当", allowanceAmount: 15000 }), 2026, 6, company);
    const l = salaryLedgerOf(r, { wageType: "monthly", allowanceName: "役職手当", period: { start: "2026-06-01", end: "2026-06-30" } });
    expect(l.earnings.map((e) => e.name)).toEqual(["基本給", "時間外手当(25%割増)", "休日出勤手当(35%割増)", "深夜手当", "役職手当"]);
    expect(l.deductions.map((e) => e.name)).toEqual(["健康保険料", "介護保険料", "子ども・子育て支援金", "厚生年金保険料", "雇用保険料", "所得税"]);
    expect([l.workDays, l.workHours, l.overtimeHours, l.holidayHours, l.nightHours]).toEqual([2, 17, 2, 7, 2]);
    expect([l.periodStart, l.periodEnd]).toEqual(["2026-06-01", "2026-06-30"]);
  });
  test("給与を確定すると、内訳を残す（確定した結果から読める）", async () => {
    const db = new Database(":memory:");
    for (const s of DB_SCHEMAS) db.exec(s);
    db.exec("INSERT INTO staff (id, name, base_wage) VALUES ('S001', '山田', 300000)");
    const asyncDb = { execute: async (sql: string, params: any[]) => db.prepare(sql).run(...params) };
    const r = calculateSalary(monthly, [day("08", 9)], extras(), 2026, 6, company);
    await saveSalaryResult(asyncDb, "S001", 2026, 6, r, monthly, { period: { start: "2026-06-01", end: "2026-06-30" } });
    const saved = parseLedger((db.query("SELECT ledger FROM salary_results").get() as { ledger: string }).ledger);
    expect(saved?.totalEarnings).toBe(r.totalEarnings);
    expect(saved?.earnings[0]).toEqual({ name: "基本給", amount: r.basePay, avg: "month" });
    expect(parseLedger(null)).toBeNull();
    expect(parseLedger("{壊れた")).toBeNull();
  });
});

describe("賃金台帳の表（1人の1年分）", () => {
  const salary = (label: string, base: number, overtime: number, tax: number): WageLedgerColumn => ({
    label, kind: "salary",
    ledger: {
      periodStart: "2026-06-01", periodEnd: "2026-06-30", workDays: 20, workHours: 165.5, overtimeHours: 5.5, holidayHours: 0, nightHours: 1,
      earnings: [{ name: "基本給", amount: base }, ...(overtime ? [{ name: "時間外手当(25%割増)", amount: overtime }] : [])],
      deductions: [{ name: "所得税", amount: tax }], totalEarnings: base + overtime, totalDeductions: tax, netPay: base + overtime - tax, yearEndSettlement: 0,
    },
  });
  const bonus: WageLedgerColumn = {
    label: "夏季賞与", kind: "bonus",
    ledger: bonusLedgerOf({
      earnings: [{ name: "基本賞与", amount: 400000 }], healthInsurance: 20000, nursingInsurance: 0, childSupport: 0, welfarePension: 36600,
      empInsurance: 2000, incomeTax: 15000, customDeductions: [], totalEarnings: 400000, totalDeductions: 73600, netPay: 326400,
    }),
  };
  const old: WageLedgerColumn = { label: "5月", kind: "salary", ledger: null, fallback: { totalEarnings: 300000, totalDeductions: 50000, netPay: 250000 } };
  test("項目は給与明細の順に並べ、ない月は空。時間は給与の列だけ。合計の列を足す", () => {
    const rows = wageLedgerRows([old, salary("6月", 300000, 9000, 7000), salary("7月", 300000, 0, 6500), bonus]);
    const row = (label: string) => rows.find((r) => r.label === label)!;
    expect(rows.map((r) => r.label)).toEqual([
      "賃金計算期間", "労働日数", "労働時間数", "時間外労働時間数", "休日労働時間数", "深夜労働時間数",
      "基本給", "時間外手当(25%割増)", "基本賞与", "総支給額",
      "健康保険料", "厚生年金保険料", "雇用保険料", "所得税", "控除合計", "差引支給額",
    ]);
    expect(row("時間外手当(25%割増)").cells).toEqual([null, 9000, null, null]);
    expect(row("労働時間数").cells).toEqual([null, 165.5, 165.5, null]);
    expect(row("総支給額").cells).toEqual([300000, 309000, 300000, 400000]);
    expect(row("総支給額").total).toBe(1309000);
    expect(row("差引支給額").cells).toEqual([250000, 302000, 293500, 326400]);
    expect(row("賃金計算期間").cells).toEqual([null, "6/1〜6/30", "6/1〜6/30", null]);
    // 内訳がない月だけのときは、時間の行の合計も空（0時間に見えないように）
    const onlyOld = wageLedgerRows([old]);
    expect(onlyOld.find((r) => r.label === "労働時間数")).toMatchObject({ cells: [null], total: null });
    expect(onlyOld.find((r) => r.label === "総支給額")!.total).toBe(300000);
  });
  test("あとの月にだけある項目も、給与明細の順のところに入れる", () => {
    const lines = (...names: string[]) => names.map((name) => ({ name, amount: 1000 }));
    const col = (label: string, earnings: LedgerLine[], deductions: LedgerLine[]): WageLedgerColumn => ({
      label, kind: "salary",
      ledger: { periodStart: null, periodEnd: null, workDays: 0, workHours: 0, overtimeHours: 0, holidayHours: 0, nightHours: 0, earnings, deductions,
        totalEarnings: 0, totalDeductions: 0, netPay: 0, yearEndSettlement: 0 },
    });
    const rows = wageLedgerRows([
      col("9月", lines("基本給", "時間外手当(25%割増)", "役職手当", "住宅手当"), lines("健康保険料", "厚生年金保険料", "所得税", "住民税")),
      col("10月", lines("基本給", "時間外手当(法定内)", "時間外手当(25%割増)", "役職手当", "住宅手当", "通勤手当"), lines("健康保険料", "介護保険料", "厚生年金保険料", "雇用保険料", "所得税", "住民税")),
    ]);
    expect(rows.filter((r) => r.kind === "earning").map((r) => r.label)).toEqual(["基本給", "時間外手当(法定内)", "時間外手当(25%割増)", "役職手当", "住宅手当", "通勤手当"]);
    expect(rows.filter((r) => r.kind === "deduction").map((r) => r.label)).toEqual(["健康保険料", "介護保険料", "厚生年金保険料", "雇用保険料", "所得税", "住民税"]);
  });
  test("CSV（時間は「時:分」）", () => {
    const csv = wageLedgerCsv({ name: "山田 太郎", gender: "男", year: 2026 }, [salary("6月", 300000, 9000, 7000)]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("賃金台帳（2026年）,氏名：山田 太郎,性別：男");
    expect(lines[1]).toBe("項目,6月,合計");
    expect(lines).toContain("労働時間数,165:30,165:30");
    expect(lines).toContain("基本給,300000,300000");
  });
});

describe("労働者名簿", () => {
  const staff = {
    id: "1001", name: "山田 太郎", furigana: "ヤマダ タロウ", birthday: "1980-06-15", gender: "male", zip_code: "100-0001", address: "東京都千代田区1-1",
    job_type: "一般事務", join_date: "2020-04-01", retirement_date: "2026-03-31", retirement_reason: "", career_history: "2003年3月 ○○大学 卒業\n2003年4月 株式会社△△, 入社",
  };
  test("従業員の画面の値から、名簿の項目を作る。書いていない項目を知らせる", () => {
    const r = rosterRowOf(staff);
    expect([r.gender, r.address, r.jobType, r.retirementDate]).toEqual(["男", "〒100-0001 東京都千代田区1-1", "一般事務", "2026-03-31"]);
    expect(rosterMissing(r)).toEqual(["退職の事由"]);
    expect(rosterMissing(rosterRowOf({ id: "2", name: "佐藤" }))).toEqual(["生年月日", "性別", "住所", "雇入れの年月日", "履歴"]);
  });
  test("CSV（改行や「,」がある値は \"\" で囲む）", () => {
    const lines = rosterCsv([rosterRowOf(staff)]).split("\r\n");
    expect(lines[0]).toBe("従業員ID,氏名,フリガナ,生年月日,性別,住所,従事する業務の種類,雇入れの年月日,退職の年月日,退職の事由,死亡の年月日,死亡の原因,履歴");
    // 履歴の中の改行は、"" の中にそのまま入れる（行の区切りは CR+LF）
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith(',"2003年3月 ○○大学 卒業\n2003年4月 株式会社△△, 入社"')).toBe(true);
  });
});

describe("出勤簿", () => {
  const records = [
    { work_date: "2026-06-01", work_type: "normal", entry_time: "09:05", exit_time: "18:10", csv_entry_time: "09:00", csv_exit_time: "18:00",
      breaks: JSON.stringify([{ start: "12:00", end: "13:00" }]), csv_breaks: null, work_hours: 8.08, night_hours: 0, paid_leave_hours: 0, memo: "", is_finalized: 1 },
    { work_date: "2026-06-02", work_type: "normal", entry_time: "", exit_time: "", csv_entry_time: "08:58", csv_exit_time: "22:30",
      breaks: null, csv_breaks: JSON.stringify([{ start: "12:00", end: "13:00" }, { start: "18:00", end: "18:15" }]), work_hours: 12.28, night_hours: 0.5, paid_leave_hours: 2, memo: "繁忙", is_finalized: 0 },
    { work_date: "2026-06-03", work_type: "special", leave_name: "夏季休暇", work_hours: 0, is_finalized: 1 },
    { work_date: "2026-06-04", work_type: "paid_full", work_hours: 0, is_finalized: 1 },
  ];
  test("期間の毎日に行を作り、手入力があれば手入力、なければ打刻の時刻と休憩を書く", () => {
    const rows = attendanceBookRows({ start: "2026-06-01", end: "2026-06-07" }, records);
    expect(rows).toHaveLength(7);
    expect(rows[0]).toMatchObject({ date: "2026-06-01", weekday: "月", type: "出勤（平日）", entry: "09:05", exit: "18:10", breaks: "12:00-13:00", finalized: true });
    expect(rows[1]).toMatchObject({ entry: "08:58", exit: "22:30", breaks: "12:00-13:00 18:00-18:15", nightHours: 0.5, paidLeaveHours: 2, memo: "繁忙", finalized: false });
    expect(rows[2].type).toBe("夏季休暇");
    expect(rows[3].type).toBe("全休(有給)");
    expect(rows[6]).toMatchObject({ weekday: "日", type: "", finalized: null });
    expect(attendanceBookTotals(rows)).toEqual({ workDays: 2, workHours: 8.08 + 12.28, nightHours: 0.5, paidLeaveHours: 2 });
  });
  test("確定したときに引いた決まった休憩も、休憩に書く", () => {
    const rows = attendanceBookRows({ start: "2026-06-08", end: "2026-06-09" }, [
      { work_date: "2026-06-08", work_type: "normal", csv_entry_time: "09:00", csv_exit_time: "18:00", work_hours: 8, auto_break: "12:00〜13:00", is_finalized: 1 },
      { work_date: "2026-06-09", work_type: "normal", csv_entry_time: "09:00", csv_exit_time: "18:00", csv_breaks: JSON.stringify([{ start: "15:00", end: "15:15" }]),
        work_hours: 7.5, auto_break: "45分", is_finalized: 1 },
    ]);
    expect(rows.map((r) => r.breaks)).toEqual(["決まった休憩 12:00〜13:00", "15:00-15:15 決まった休憩 45分"]);
  });
  test("CSV と時間の書き方", () => {
    expect([hoursText(8.5), hoursText(0), hoursText(null)]).toEqual(["8:30", "0:00", ""]);
    const rows = attendanceBookRows({ start: "2026-06-01", end: "2026-06-02" }, records);
    const lines = attendanceBookCsv({ name: "山田 太郎", period: { start: "2026-06-01", end: "2026-06-02" } }, rows).split("\r\n");
    expect(lines[1]).toBe("日付,曜日,区分,出勤,退勤,休憩,労働時間,深夜,時間有給,備考,確定");
    expect(lines[2]).toBe("2026-06-01,月,出勤（平日）,09:05,18:10,12:00-13:00,8:05,0:00,,,確定");
    expect(lines[4]).toBe("合計,,出勤 2日,,,,20:22,0:30,2:00,,");
  });
});

describe("出勤簿の休業の日", () => {
  test("休業・休職の日は、区分に休業の名前を書く（働いた記録がある日は、休業の期間であることを足す）", () => {
    const leaves = [{ type: "childcare" as const, start: "2026-06-03", end: "2026-06-30" }];
    const rows = attendanceBookRows({ start: "2026-06-01", end: "2026-06-05" }, [
      { work_date: "2026-06-02", work_type: "normal", csv_entry_time: "09:00", csv_exit_time: "18:00", work_hours: 8, is_finalized: 1 },
      { work_date: "2026-06-04", work_type: "absent", work_hours: 0, is_finalized: 1 },
      { work_date: "2026-06-05", work_type: "normal", csv_entry_time: "10:00", csv_exit_time: "12:00", work_hours: 2, is_finalized: 1 },
    ], leaves);
    expect(rows.map((r) => r.type)).toEqual(["", "出勤（平日）", "育児休業", "育児休業", "出勤（平日）（育児休業の期間）"]);
    expect(rows[2]).toMatchObject({ finalized: null, workHours: null });
  });
});
