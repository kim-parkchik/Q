import { describe, expect, test } from "bun:test";
import type { PayLedger } from "./legalBooks";
import { hoursLabel, payChanges, payListCell, payListColumns, payListCsv, payListRows, payTrendRows, type PayDocPerson } from "./payReports";

const ledger = (o: Partial<PayLedger>): PayLedger => ({
  periodStart: "2026-10-01", periodEnd: "2026-10-31", workDays: 20, workHours: 160, overtimeHours: 10.5, holidayHours: 0, nightHours: 0,
  earnings: [], deductions: [], totalEarnings: 0, totalDeductions: 0, netPay: 0, yearEndSettlement: 0, ...o,
});

const people: PayDocPerson[] = [
  {
    staffId: "1001", name: "山田　太郎", branchName: "本店", totalEarnings: 0, totalDeductions: 0, netPay: 0,
    ledger: ledger({
      earnings: [{ name: "基本給", amount: 300000 }, { name: "時間外手当(25%割増)", amount: 25000 }, { name: "通勤手当", amount: 10000 }],
      inKind: [{ name: "社宅", amount: 45280 }],
      deductions: [{ name: "健康保険料", amount: 17000 }, { name: "厚生年金保険料", amount: 31110 }, { name: "所得税", amount: 8000 }, { name: "住民税", amount: 12000 }],
      totalEarnings: 335000, totalDeductions: 68110, netPay: 266890,
    }),
  },
  {
    staffId: "1002", name: "時給　花子", branchName: "大阪支店", totalEarnings: 0, totalDeductions: 0, netPay: 0,
    ledger: ledger({
      workDays: 15, workHours: 90, overtimeHours: 0,
      earnings: [{ name: "時給分", amount: 108000 }, { name: "通勤手当", amount: 6000 }],
      deductions: [{ name: "雇用保険料", amount: 627 }, { name: "所得税", amount: 0 }],
      totalEarnings: 114000, totalDeductions: 627, netPay: 125373, yearEndSettlement: 12000,
    }),
  },
  { staffId: "1003", name: "古い　確定", branchName: "大阪支店", totalEarnings: 200000, totalDeductions: 30000, netPay: 170000, ledger: null },
];

describe("支給控除一覧表", () => {
  test("列：勤怠・支給の行（出てきた順）・支給合計・現物・控除の行・控除合計・年末調整・差引支給額", () => {
    const cols = payListColumns(people, true);
    expect(cols.map((c) => c.label)).toEqual([
      "出勤日数", "労働時間", "時間外", "休日労働", "深夜",
      "基本給", "時間外手当(25%割増)", "通勤手当", "時給分", "支給合計",
      "社宅（現物）",
      "健康保険料", "厚生年金保険料", "所得税", "住民税", "雇用保険料", "控除合計",
      "年末調整（＋還付／−徴収）", "差引支給額",
    ]);
    // 賞与は勤怠の列を出さない
    expect(payListColumns(people, false)[0].label).toBe("基本給");
  });
  test("拠点ごとの小計と合計（内訳がない人は合計だけ）", () => {
    const rows = payListRows(people);
    expect(rows.map((r) => [r.kind, r.label, r.count])).toEqual([
      ["person", "山田　太郎", 1], ["subtotal", "本店 小計", 1],
      ["person", "時給　花子", 1], ["person", "古い　確定", 1], ["subtotal", "大阪支店 小計", 2],
      ["total", "合計", 3],
    ]);
    const total = rows[rows.length - 1].values;
    expect([total["s:earnings"], total["s:deductions"], total["s:net"], total["e:通勤手当"], total["w:hours"], total["s:yearEnd"]])
      .toEqual([335000 + 114000 + 200000, 68110 + 627 + 30000, 266890 + 125373 + 170000, 16000, 250, 12000]);
    expect(rows[3].noLedger).toBe(true);
    const cols = payListColumns(people, true);
    expect(payListCell(cols.find((c) => c.key === "w:overtime")!, rows[0])).toBe("10.5");
    expect(payListCell(cols.find((c) => c.key === "e:基本給")!, rows[0])).toBe("300,000");
    expect(payListCell(cols.find((c) => c.key === "e:基本給")!, rows[2])).toBe("");
  });
  test("CSV：1行目は表題、2行目は見出し、金額はカンマなし", () => {
    const cols = payListColumns(people, true);
    const csv = payListCsv("2026年11月支給 支給控除一覧表", cols, payListRows(people)).split("\r\n");
    expect(csv[0]).toBe("2026年11月支給 支給控除一覧表");
    expect(csv[1].startsWith("区分,社員番号,氏名,拠点,人数,出勤日数,労働時間")).toBe(true);
    expect(csv[2].startsWith("人,1001,山田　太郎,本店,1,20,160,10.5,0,0,300000,25000,10000,,335000,45280,")).toBe(true);
    expect(csv[5].startsWith("人（内訳なし）,1003,古い　確定,大阪支店,1,")).toBe(true);
  });
  test("明細書の時間の書き方", () => {
    expect([hoursLabel(160), hoursLabel(10.5), hoursLabel(0.25)]).toEqual(["160:00", "10:30", "0:15"]);
  });
});

describe("部門ごとの集計・月ごとの推移表・前の月と変わった人", () => {
  const withDept: PayDocPerson[] = [
    { ...people[0], department: "営業部" },
    { ...people[1], department: "総務部" },
    { ...people[2], department: "営業部" },
  ];
  test("部門ごとの小計（部門の名前の順。部門がない人は後ろ）", () => {
    const rows = payListRows([...withDept, { ...people[0], staffId: "1009", name: "部門　なし" }], "department");
    expect(rows.map((r) => [r.kind, r.label, r.count])).toEqual([
      ["person", "山田　太郎", 1], ["person", "古い　確定", 1], ["subtotal", "営業部 小計", 2],
      ["person", "時給　花子", 1], ["subtotal", "総務部 小計", 1],
      ["person", "部門　なし", 1], ["subtotal", "部門なし 小計", 1],
      ["total", "合計", 4],
    ]);
    expect(payListRows(withDept, "none").filter((r) => r.kind === "subtotal")).toEqual([]);
  });
  test("月ごとの推移表：項目ごと・支給した月ごとの合計と人数", () => {
    const { rows, persons } = payTrendRows([{ month: 10, people: [people[0]] }, { month: 11, people: [people[0], people[1]] }]);
    const net = rows.find((r) => r.column.key === "s:net")!;
    expect([net.months[9], net.months[10], net.months[0], net.total]).toEqual([266890, 266890 + 125373, 0, 266890 * 2 + 125373]);
    expect(rows.find((r) => r.column.key === "w:hours")!.months.slice(9, 11)).toEqual([160, 250]);
    expect(persons.slice(9, 11)).toEqual([1, 2]);
  });
  test("前の月と変わった人：額が変わった項目と、どちらかの月にしかいない人", () => {
    const changed: PayDocPerson = { ...people[0], ledger: { ...people[0].ledger!, earnings: [{ name: "基本給", amount: 310000 }, { name: "時間外手当(25%割増)", amount: 25000 }, { name: "通勤手当", amount: 10000 }], totalEarnings: 345000, netPay: 276890 } };
    const list = payChanges([people[0], people[2]], [changed, people[1]]);
    expect(list.map((c) => [c.staffId, c.label, c.before, c.after, c.diff])).toEqual([
      ["1001", "基本給", 300000, 310000, 10000],
      ["1001", "支給合計", 335000, 345000, 10000],
      ["1001", "差引支給額", 266890, 276890, 10000],
      ["1002", "差引支給額（前の月はなし）", null, 125373, 125373],
      ["1003", "差引支給額（この月はなし）", 170000, null, -170000],
    ]);
  });
});
