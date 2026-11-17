import { describe, expect, test } from "bun:test";
import {
  buildNofuSlips, fiscalYearCodeOf, monthCode, payDateCode, taxDueDate, type NofuBonusInput, type NofuSalaryInput,
} from "./withholdingPayment";

const sal = (o: Partial<NofuSalaryInput> & { staffId: string; payDate: string }): NofuSalaryInput => ({
  executive: false, taxColumn: "kou", taxable: 300000, tax: 6000, yearEnd: 0, workDays: 20, ...o,
});
const bon = (o: Partial<NofuBonusInput> & { staffId: string; payDate: string }): NofuBonusInput => ({ executive: false, amount: 500000, tax: 20000, ...o });

describe("国税庁「納付書の記載のしかた（給与所得・退職所得等の所得税徴収高計算書）」の例", () => {
  test("納期等の区分：令和８年９月分の給料を９月25日に支給 → 「508 09」", () => {
    expect(monthCode("2026-09")).toBe("508 09");
  });
  test("年度：令和８年４月１日から令和９年３月31日までの間に納付する場合は「508」", () => {
    expect(fiscalYearCodeOf("2026-04-01")).toBe("508");
    expect(fiscalYearCodeOf("2027-01-20")).toBe("508");
    expect(fiscalYearCodeOf("2027-03-31")).toBe("508");
    expect(fiscalYearCodeOf("2026-03-10")).toBe("507");
    expect(fiscalYearCodeOf("2027-04-10")).toBe("509");
  });
  test("納期の特例：令和８年７月分から12月分の給料を７月25日から12月25日に支給 → 「自 508 07 至 508 12」、支払年月日「508 07 25 ～ 12 25」", () => {
    const salaries = [7, 8, 9, 10, 11, 12].map((m) => sal({ staffId: "1", payDate: `2026-${String(m).padStart(2, "0")}-25` }));
    const [, h2] = buildNofuSlips({ year: 2026, mode: "special", salaries, bonuses: [] });
    expect(h2.periodCodes).toEqual({ from: "508 07", to: "508 12" });
    expect(payDateCode(h2.salary, "special")).toBe("508 07 25 ～ 12 25");
    // 納期の特例の人員は、月ごとの実人員の合計数
    expect(h2.salary.persons).toBe(6);
    // 7月〜12月支払分の納期限は翌年1月20日、年度は納付する日の会計年度（令和8年度）
    expect(h2.dueDate).toBe("2027-01-20");
    expect(h2.fiscalYearCode).toBe("508");
    expect(h2.withDefense).toBe(false);
  });
});

describe("納付書の中身", () => {
  test("同じ月に2回払ったら最後の支払年月日。人員は実人員、支給額は所得税がかかる額、税額は源泉徴収した額", () => {
    const salaries = [
      sal({ staffId: "1", payDate: "2026-09-10", taxable: 200000, tax: 4000 }),
      sal({ staffId: "1", payDate: "2026-09-25", taxable: 100000, tax: 1000 }),
      sal({ staffId: "2", payDate: "2026-09-25", taxable: 250000, tax: 5000 }),
    ];
    const sep = buildNofuSlips({ year: 2026, mode: "general", salaries, bonuses: [] }).find((s) => s.key === "2026-09")!;
    expect(payDateCode(sep.salary, "general")).toBe("508 09 25");
    expect([sep.salary.persons, sep.salary.amount, sep.salary.tax]).toEqual([2, 550000, 10000]);
    expect([sep.principal, sep.total]).toEqual([10000, 10000]);
    expect(sep.periodCodes.from).toBe("508 09");
  });
  test("一般の納期限は翌月10日（土日祝日ならその次の日）。令和8年10月10日は土曜、12日はスポーツの日なので13日", () => {
    const holidays = new Set(["2026-10-12"]);
    const slips = buildNofuSlips({ year: 2026, mode: "general", salaries: [sal({ staffId: "1", payDate: "2026-09-25" })], bonuses: [], isHoliday: (d) => holidays.has(d) });
    expect(slips.find((s) => s.key === "2026-09")!.dueDate).toBe("2026-10-13");
    expect(slips.find((s) => s.key === "2026-01")!.empty).toBe(true);
    expect(taxDueDate("2026-12-29")).toBe("2027-01-04");
  });
  test("賞与（役員賞与を除く）と役員賞与を分け、丙欄の人の給与は日雇労務者の賃金（延べ人員）", () => {
    const slips = buildNofuSlips({
      year: 2026, mode: "general",
      salaries: [
        sal({ staffId: "1", payDate: "2026-07-25" }),
        sal({ staffId: "9", payDate: "2026-07-25", taxColumn: "hei", taxable: 90000, tax: 1200, workDays: 9 }),
        sal({ staffId: "8", payDate: "2026-07-25", taxColumn: "hei", taxable: 40000, tax: 300, workDays: 4 }),
      ],
      bonuses: [bon({ staffId: "1", payDate: "2026-07-10" }), bon({ staffId: "5", payDate: "2026-07-10", executive: true, amount: 1000000, tax: 80000 })],
    });
    const jul = slips.find((s) => s.key === "2026-07")!;
    expect([jul.salary.persons, jul.salary.amount, jul.salary.tax]).toEqual([1, 300000, 6000]);
    expect([jul.daily.persons, jul.daily.amount, jul.daily.tax]).toEqual([13, 130000, 1500]);
    expect([jul.bonus.persons, jul.bonus.amount, jul.bonus.tax]).toEqual([1, 500000, 20000]);
    expect([jul.officerBonus.persons, jul.officerBonus.amount, jul.officerBonus.tax]).toEqual([1, 1000000, 80000]);
    expect(jul.principal).toBe(6000 + 1500 + 20000 + 80000);
    expect(jul.notes.some((n) => n.includes("支払確定年月日"))).toBe(true);
  });
  test("手で入れた退職手当等・税理士等の報酬も本税に入る", () => {
    const slips = buildNofuSlips({
      year: 2026, mode: "general", salaries: [sal({ staffId: "1", payDate: "2026-11-25" })], bonuses: [],
      extras: { "2026-11": { professional: { payDate: "2026-11-30", persons: 1, amount: 50000, tax: 5105 } } },
    });
    const nov = slips.find((s) => s.key === "2026-11")!;
    expect([nov.professional.persons, nov.professional.amount, nov.professional.tax]).toEqual([1, 50000, 5105]);
    expect(nov.principal).toBe(6000 + 5105);
  });
  test("年末調整：不足額は不足税額に、還付は超過税額に。差し引ききれない還付は次の納付に回す（タックスアンサー No.2675）", () => {
    const salaries = [
      // 12月：税額 6,000 + 5,000、還付 30,000（Aさん）・徴収 2,000（Bさん）
      sal({ staffId: "A", payDate: "2026-12-25", tax: 6000, yearEnd: 30000 }),
      sal({ staffId: "B", payDate: "2026-12-25", tax: 5000, yearEnd: -2000 }),
      // 翌年1月：税額 6,000 + 5,000
      sal({ staffId: "A", payDate: "2027-01-25", tax: 6000 }),
      sal({ staffId: "B", payDate: "2027-01-25", tax: 5000 }),
      sal({ staffId: "A", payDate: "2027-02-25", tax: 6000 }),
      sal({ staffId: "B", payDate: "2027-02-25", tax: 5000 }),
    ];
    const dec = buildNofuSlips({ year: 2026, mode: "general", salaries, bonuses: [] }).find((s) => s.key === "2026-12")!;
    expect([dec.shortage, dec.refunded, dec.excess, dec.carryOut, dec.principal]).toEqual([2000, 30000, 13000, 17000, 0]);
    expect(dec.notes.some((n) => n.includes("年末調整過納額還付請求書"))).toBe(true);
    const next = buildNofuSlips({ year: 2027, mode: "general", salaries, bonuses: [] });
    const jan = next.find((s) => s.key === "2027-01")!;
    expect([jan.carryIn, jan.excess, jan.carryOut, jan.principal]).toEqual([17000, 11000, 6000, 0]);
    const feb = next.find((s) => s.key === "2027-02")!;
    expect([feb.carryIn, feb.excess, feb.carryOut, feb.principal]).toEqual([6000, 6000, 0, 5000]);
    // 令和9年1月以後に支払った分は、防衛特別所得税を含む
    expect(jan.withDefense).toBe(true);
  });
  test("納期の特例：1月〜6月支払分は7月10日、年末調整の還付は7月〜12月支払分の税額から差し引く", () => {
    const salaries = [
      ...[1, 2, 3, 4, 5, 6].map((m) => sal({ staffId: "1", payDate: `2026-0${m}-25`, tax: 3000 })),
      ...[7, 8, 9, 10, 11, 12].map((m) => sal({ staffId: "1", payDate: `2026-${String(m).padStart(2, "0")}-25`, tax: 3000, yearEnd: m === 12 ? 12000 : 0 })),
    ];
    const [h1, h2] = buildNofuSlips({ year: 2026, mode: "special", salaries, bonuses: [] });
    expect([h1.dueDate, h1.salary.persons, h1.salary.tax, h1.principal]).toEqual(["2026-07-10", 6, 18000, 18000]);
    expect([h2.excess, h2.principal]).toEqual([12000, 6000]);
  });
});
