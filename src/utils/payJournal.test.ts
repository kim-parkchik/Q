import { describe, expect, test } from "bun:test";
import type { PayLedger } from "./legalBooks";
import { buildPayJournal, DEFAULT_JOURNAL_SETTINGS, journalCsv, journalTotals, parseJournalSettings, type JournalPerson } from "./payJournal";

const ledger = (o: Partial<PayLedger>): PayLedger => ({
  periodStart: null, periodEnd: null, workDays: 0, workHours: 0, overtimeHours: 0, holidayHours: 0, nightHours: 0,
  earnings: [], deductions: [], totalEarnings: 0, totalDeductions: 0, netPay: 0, yearEndSettlement: 0, ...o,
});
const people: JournalPerson[] = [
  {
    staffId: "1001", name: "山田　太郎", executive: false, department: "営業部", payDate: "2026-12-25", totalEarnings: 0, totalDeductions: 0, netPay: 0,
    ledger: ledger({
      earnings: [{ name: "基本給", amount: 300000 }, { name: "欠勤控除", amount: -10000 }, { name: "通勤手当", amount: 10000 }],
      deductions: [{ name: "健康保険料", amount: 15000 }, { name: "厚生年金保険料", amount: 27450 }, { name: "雇用保険料", amount: 1650 }, { name: "所得税", amount: 7000 }, { name: "住民税", amount: 12000 }, { name: "社宅家賃", amount: 20000 }],
      totalEarnings: 300000, totalDeductions: 83100, netPay: 300000 - 83100 + 15000, yearEndSettlement: 15000,
    }),
  },
  {
    staffId: "1002", name: "役員　一人", executive: true, department: "", payDate: "2026-12-25", totalEarnings: 0, totalDeductions: 0, netPay: 0,
    ledger: ledger({
      earnings: [{ name: "基本給", amount: 600000 }],
      deductions: [{ name: "健康保険料", amount: 30000 }, { name: "所得税", amount: 50000 }],
      totalEarnings: 600000, totalDeductions: 80000, netPay: 600000 - 80000 - 4000, yearEndSettlement: -4000,
    }),
  },
];

describe("給与・賞与の仕訳データ", () => {
  test("借方：給与手当・役員報酬と年末調整の還付、貸方：預り金（社会保険料・雇用保険料・源泉所得税・住民税・そのほか）と普通預金。借方と貸方は同じ", () => {
    const { lines } = buildPayJournal("salary", "2026年12月支給 給与", people, DEFAULT_JOURNAL_SETTINGS);
    expect(lines.map((l) => [l.side, l.account, l.sub, l.amount])).toEqual([
      ["debit", "給与手当", "", 300000],
      ["debit", "預り金", "源泉所得税", 15000],
      ["debit", "役員報酬", "", 600000],
      ["credit", "預り金", "社会保険料", 72450],
      ["credit", "預り金", "雇用保険料", 1650],
      ["credit", "預り金", "源泉所得税", 61000],
      ["credit", "預り金", "住民税", 12000],
      ["credit", "預り金", "社宅家賃", 20000],
      ["credit", "普通預金", "", 231900 + 516000],
    ]);
    const t = journalTotals(lines);
    expect(t.debit).toBe(t.credit);
    expect(lines.every((l) => l.date === "2026-12-25" && l.voucher === 1 && l.memo === "2026年12月支給 給与（2人）")).toBe(true);
  });
  test("通勤手当を別の勘定科目にし、部門ごとに分ける（部門ごとに伝票を分ける）", () => {
    const st = { ...DEFAULT_JOURNAL_SETTINGS, commute: "旅費交通費", byDepartment: true };
    const { lines } = buildPayJournal("salary", "給与", people, st);
    expect(lines.filter((l) => l.side === "debit").map((l) => [l.voucher, l.department, l.account, l.amount])).toEqual([
      [1, "", "役員報酬", 600000],
      [2, "営業部", "給与手当", 290000],
      [2, "営業部", "旅費交通費", 10000],
      [2, "営業部", "預り金", 15000],
    ]);
    for (const v of [1, 2]) {
      const t = journalTotals(lines.filter((l) => l.voucher === v));
      expect(t.debit).toBe(t.credit);
    }
  });
  test("CSV と設定の読み込み", () => {
    const { lines } = buildPayJournal("bonus", "冬季賞与", [people[1]], DEFAULT_JOURNAL_SETTINGS);
    const csv = journalCsv(lines).split("\r\n");
    expect(csv[0]).toBe("日付,伝票番号,借方勘定科目,借方補助科目,借方部門,借方金額,貸方勘定科目,貸方補助科目,貸方部門,貸方金額,摘要");
    expect(csv[1]).toBe("2026/12/25,1,役員賞与,,,600000,,,,,冬季賞与（1人）");
    expect(parseJournalSettings(JSON.stringify({ salary: "給料", byDepartment: 1 }))).toEqual({ ...DEFAULT_JOURNAL_SETTINGS, salary: "給料", byDepartment: true });
    expect(parseJournalSettings("壊れた")).toEqual(DEFAULT_JOURNAL_SETTINGS);
  });
});
