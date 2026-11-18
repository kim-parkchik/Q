import { describe, expect, test } from "bun:test";
import { retirementDeclarationOf } from "./retirementDeclaration";
import { calcRetirement, emptyOtherRetirement, emptyPriorRetirement, emptyRetirementInput, type RetirementInput, type RetirementRecord } from "./retirementIncome";

const rec = (amount: number, o: Partial<RetirementInput>): RetirementRecord => ({
  id: 1, staffId: "1", payDate: "2026-04-25", fixedDate: "2026-03-31", amount, incomeTax: 0, cityTax: 0, prefTax: 0, municipality: "",
  input: { ...emptyRetirementInput(), ...o },
});
const declOf = (r: RetirementRecord, executive = false) => retirementDeclarationOf(r, calcRetirement(2026, r.amount, executive, r.input));

describe("退職所得の受給に関する申告書の下書き", () => {
  test("A 欄だけ（他の退職手当等・前年以前の退職手当等なし）：①の日・③の勤続期間と年数（1年未満は切り上げ）", () => {
    const d = declOf(rec(8_000_000, { serviceFrom: "2016-04-01", serviceTo: "2026-05-31" }));
    expect([d.fixedDate, d.disability, d.a.service, d.a.officer, d.a.short, d.b, d.c, d.d, d.e]).toEqual([
      "2026-03-31", false, { label: "平成28年4月1日～令和8年5月31日", years: 11 }, null, null, null, null, null, [],
    ]);
  });
  test("役員の期間を分けて払う：③の内書きに特定役員等勤続期間。B 欄に他の退職手当等（④⑤と重複・全重複）と E 欄", () => {
    const r = rec(15_000_000, {
      serviceFrom: "2010-04-01", serviceTo: "2026-03-31", parts: [
        { kind: "general", amount: 10_000_000, from: "2010-04-01", to: "2023-03-31" },
        { kind: "officer", amount: 5_000_000, from: "2023-04-01", to: "2026-03-31" },
      ],
      others: [{ ...emptyOtherRetirement(), payer: "A社", payerAddress: "大阪市北区1-1", kind: "short", amount: 2_000_000, from: "2024-04-01", to: "2026-03-31", paidOn: "2026-03-31", incomeTax: 1_000 }],
    });
    const d = declOf(r, true);
    expect(d.a.service).toEqual({ label: "平成22年4月1日～令和8年3月31日", years: 16 });
    expect(d.a.officer).toEqual({ label: "令和5年4月1日～令和8年3月31日", years: 3 });
    expect([d.a.officerGeneral, d.a.officerShort, d.a.short]).toEqual([null, null, null]);
    expect(d.b!.other).toEqual({ label: "令和6年4月1日～令和8年3月31日", years: 2 });
    expect(d.b!.otherShort).toEqual({ label: "令和6年4月1日～令和8年3月31日", years: 2 });
    expect(d.b!.total).toEqual({ label: "平成22年4月1日～令和8年3月31日", years: 16 });
    // 特定役員等勤続期間と短期勤続期間の重複（2年）。一般との重複・全重複はない
    expect([d.b!.officerShort, d.b!.officerGeneral, d.b!.full, d.b!.shortGeneral]).toEqual([{ label: "令和6年4月1日～令和8年3月31日", years: 2 }, null, null, null]);
    expect(d.e).toEqual([{
      section: "B", kind: "short", paidOn: "2026-03-31", amount: 2_000_000, incomeTax: 1_000, cityTax: 0, prefTax: 0, payer: "A社", payerAddress: "大阪市北区1-1", dc: false,
    }]);
    expect(d.notes.some((x) => x.includes("源泉徴収票（特別徴収票）か、その写し"))).toBe(true);
  });
  test("C 欄（前年以前4年内の退職手当等と重複。年数は切り捨て）と D 欄（通算した前の勤務先の期間）", () => {
    const c = declOf(rec(3_000_000, {
      serviceFrom: "2020-04-01", serviceTo: "2026-03-31",
      priors: [{ ...emptyPriorRetirement(), payer: "前", paidOn: "2024-03-31", amount: 5_000_000, from: "2020-04-01", to: "2024-03-31", incomeTax: 0 }],
    }));
    expect(c.c).toEqual({
      prior: { label: "令和2年4月1日～令和6年3月31日", years: null }, overlap: { label: "令和2年4月1日～令和6年3月31日", years: 4 }, officer: null, short: null,
    });
    expect(c.e.map((x) => [x.section, x.paidOn, x.amount])).toEqual([["C", "2024-03-31", 5_000_000]]);
    const d = declOf(rec(8_000_000, {
      serviceFrom: "2010-04-01", serviceTo: "2026-03-31",
      priors: [{ ...emptyPriorRetirement(), payer: "前の会社", amount: 1_000_000, from: "2010-04-01", to: "2013-09-30", included: true }],
    }));
    expect(d.d!.included).toEqual({ label: "平成22年4月1日～平成25年9月30日", years: 3 });
    expect(d.d!.only).toEqual({ label: "平成22年4月1日～平成25年9月30日", years: 3 });
    expect(d.d!.total).toEqual({ label: "平成22年4月1日～平成25年9月30日", years: 3 });
    expect(d.c).toBeNull();
  });
});
