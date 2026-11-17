import { describe, expect, test } from "bun:test";
import type { PayLedger } from "./legalBooks";
import { buildBenefitCert, certMonths, defaultCertPeriod, type CertAttendance, type CertInput, type CertSalary } from "./kenpoBenefitCert";

const att = (date: string, o: Partial<CertAttendance> = {}): CertAttendance => ({ date, workType: "normal", workHours: 8, paidLeaveHours: 0, specialLeaveHours: 0, leavePaid: false, ...o });
const ledger = (earnings: { name: string; amount: number; avg?: "month" | "time" | "none" }[], inKind?: { name: string; amount: number }[]): PayLedger => ({
  periodStart: null, periodEnd: null, workDays: 0, workHours: 0, overtimeHours: 0, holidayHours: 0, nightHours: 0,
  earnings: earnings.map((e) => ({ avg: "month", ...e })), deductions: [], totalEarnings: 0, totalDeductions: 0, netPay: 0, yearEndSettlement: 0,
  ...(inKind ? { inKind: inKind.map((l) => ({ ...l, avg: "none" as const })) } : {}),
});
const sal = (periodStart: string, periodEnd: string, l: PayLedger, o: Partial<CertSalary> = {}): CertSalary => ({ periodStart, periodEnd, ledger: l, prescribedDays: 20, leavePaidDays: null, ...o });
const base = (o: Partial<CertInput>): CertInput => ({
  from: "2026-11-09", to: "2026-11-30", wageType: "monthly", scheduledHours: 8, attendance: [], salaries: [], leavePeriods: [],
  leaveProration: "workdays", absenceDeduction: "workdays", ...o,
});

describe("勤務状況", () => {
  test("申請期間のうち、働いた時間がある日を出勤した日にし、所定労働時間より短い日は「早」の候補にする。年月は出勤がなくても出す", () => {
    const months = certMonths({
      from: "2026-10-28", to: "2026-12-02", scheduledHours: 8,
      attendance: [att("2026-10-27"), att("2026-10-28"), att("2026-10-29", { workHours: 4 }), att("2026-10-30", { workType: "paid_full", workHours: 0 }),
        att("2026-11-02", { workHours: 6, paidLeaveHours: 2 }), att("2026-12-01", { workType: "absent", workHours: 0 })],
    });
    expect(months).toEqual([
      { year: 2026, month: 10, worked: [28, 29], short: [29] },
      { year: 2026, month: 11, worked: [2], short: [] },
      { year: 2026, month: 12, worked: [], short: [] },
    ]);
  });
});

describe("賃金支給状況", () => {
  test("時給制：有給休暇の日は、その計算期間の有給休暇手当を時間で分け、額が同じで続いている日をまとめる（手引の例：12月29日〜30日）", () => {
    const r = buildBenefitCert(base({
      from: "2026-12-28", to: "2026-12-31", wageType: "hourly",
      attendance: [att("2026-12-28"), att("2026-12-29", { workType: "paid_full", workHours: 0 }), att("2026-12-30", { workType: "paid_full", workHours: 0 }),
        att("2026-12-31", { workType: "absent", workHours: 0 }), att("2026-12-01", { workType: "paid_half", workHours: 0 })],
      salaries: [sal("2026-12-01", "2026-12-31", ledger([{ name: "時給分", amount: 150000, avg: "time" }, { name: "有給休暇手当", amount: 20000, avg: "time" }, { name: "通勤手当", amount: 6000, avg: "time" }]))],
    }));
    // 有給 20,000円 ÷ 20時間（8 + 8 + 4）＝ 1,000円/時間 → 29日・30日は 8,000円ずつ → まとめて 16,000円。日額の通勤手当は入れない
    expect(r.rows.map((x) => [x.from, x.to, x.amount, x.label, x.checked])).toEqual([["2026-12-29", "2026-12-30", 16000, "有給休暇", true]]);
  });
  test("月給制・休業（その他の休職）：休業の日の分は日割りして払わないので、手当は初めは書かない。月額の通勤手当・現物は書く", () => {
    const r = buildBenefitCert(base({
      leavePeriods: [{ type: "other", start: "2026-11-09", end: "2026-11-30" }],
      attendance: [att("2026-11-05", { workType: "paid_full", workHours: 0 })],
      salaries: [sal("2026-11-01", "2026-11-30", ledger([{ name: "基本給", amount: 75000 }, { name: "住宅手当", amount: 5000 }, { name: "通勤手当", amount: 10000 }], [{ name: "社宅", amount: 30000 }]), { leavePaidDays: 5 })],
    }));
    expect(r.rows.map((x) => [x.from, x.to, x.amount, x.label, x.checked])).toEqual([
      ["2026-11-01", "2026-11-30", 5000, "住宅手当", false],
      ["2026-11-01", "2026-11-30", 10000, "通勤手当（月額）", true],
      ["2026-11-01", "2026-11-30", 30000, "現物（社宅）", true],
    ]);
    // 申請期間の外の有給（11月5日）は書かない
    expect(r.rows.some((x) => x.label === "有給休暇")).toBe(false);
  });
  test("月給制・休業の月の日割りを「しない」：休業の日も払った基本給と手当を書く。有給は 基本給 ÷ 所定労働日数 を1日分にする", () => {
    const r = buildBenefitCert(base({
      leaveProration: "none",
      leavePeriods: [{ type: "other", start: "2026-11-09", end: "2026-11-30" }],
      attendance: [att("2026-11-09", { workType: "paid_full", workHours: 0 }), att("2026-11-10", { workType: "paid_half", workHours: 0 })],
      salaries: [sal("2026-11-01", "2026-11-30", ledger([{ name: "基本給", amount: 300000 }, { name: "家族手当", amount: 10000 }]))],
    }));
    expect(r.rows.map((x) => [x.from, x.to, x.amount, x.label, x.checked])).toEqual([
      ["2026-11-01", "2026-11-30", 300000, "基本給（休業の日も日割りせずに払った）", true],
      ["2026-11-01", "2026-11-30", 10000, "家族手当", true],
      ["2026-11-09", "2026-11-09", 15000, "有給休暇", true],
      ["2026-11-10", "2026-11-10", 7500, "有給休暇", true],
    ]);
  });
  test("休業でない欠勤：手当は引かないので書く。基本給は欠勤控除をしない完全月給のときだけ。給与が確定していない期間は知らせる", () => {
    const attendance = ["2026-11-09", "2026-11-10"].map((d) => att(d, { workType: "absent", workHours: 0 }));
    const salaries = [sal("2026-11-01", "2026-11-15", ledger([{ name: "基本給", amount: 150000 }, { name: "欠勤控除", amount: -15000 }, { name: "住宅手当", amount: 5000 }]))];
    const r = buildBenefitCert(base({ from: "2026-11-09", to: "2026-11-20", attendance, salaries }));
    expect(r.rows.map((x) => [x.label, x.amount, x.checked])).toEqual([["住宅手当", 5000, true]]);
    expect(r.notes[0]).toContain("2026-11-16〜2026-11-20");
    const full = buildBenefitCert(base({ from: "2026-11-09", to: "2026-11-15", attendance, salaries, absenceDeduction: "none" }));
    expect(full.rows.map((x) => [x.label, x.amount])).toEqual([["基本給（欠勤控除をしない完全月給）", 135000], ["住宅手当", 5000]]);
  });
  test("申請期間の初めの値：出産手当金は産前産後休業、傷病手当金はその他の休職", () => {
    const periods = [{ type: "maternity" as const, start: "2026-08-01", end: "2026-11-10" }, { type: "other" as const, start: "2026-03-01", end: "2026-04-15" }];
    expect(defaultCertPeriod("shussan", periods)).toEqual({ from: "2026-08-01", to: "2026-11-10" });
    expect(defaultCertPeriod("shoubyou", periods)).toEqual({ from: "2026-03-01", to: "2026-04-15" });
    expect(defaultCertPeriod("shoubyou", [])).toBeNull();
    const long = buildBenefitCert(base({ from: "2026-08-01", to: "2026-11-10" }));
    expect(long.notes.some((n) => n.includes("3か月を超えて"))).toBe(true);
  });
});
