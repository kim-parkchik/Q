import { describe, expect, test } from "bun:test";
import { parseBonusPlanMonths, planChangeMonths, planMonthStatuses, stringifyBonusPlanMonths } from "./bonusNonPayment";
import type { BonusPayment } from "./bonusReport";

const insured = { id: "S001", name: "健保 一郎", furigana: "ケンポ イチロウ", birthday: "1990-05-27", pension_num: "1", standard_remuneration: 300000, join_date: "2020-04-01" };
const notInsured = { id: "S002", name: "短時間 花子", furigana: "タンジカン ハナコ", birthday: "1995-01-01", standard_remuneration: 0, join_date: "2020-04-01" };
const pay = (o: Partial<BonusPayment> = {}): BonusPayment => ({ settingId: 1, name: "夏季賞与", paymentDate: "2026-07-10", staffId: "S001", totalEarnings: 300000, ...o });

describe("賞与不支給報告書", () => {
  test("賞与支払予定月を読む・書く（1〜12月だけ、重ねず、小さい順に4つまで）", () => {
    expect(parseBonusPlanMonths("12,7")).toEqual([7, 12]);
    expect(parseBonusPlanMonths("７、12, 12, 0, 13, x")).toEqual([7, 12]);
    expect(parseBonusPlanMonths("1,3,5,7,9")).toEqual([1, 3, 5, 7]);
    expect(parseBonusPlanMonths(null)).toEqual([]);
    expect(stringifyBonusPlanMonths([12, 7, 7])).toBe("7,12");
    expect(stringifyBonusPlanMonths([])).toBe("");
  });

  test("予定月ごとに、被保険者に賞与を払ったか（社会保険に入っていない人だけに払った月は、払っていない）", () => {
    const list = planMonthStatuses(2026, [7, 12], [insured, notInsured], [pay(), pay({ staffId: "S002", paymentDate: "2026-12-10", name: "冬季賞与" })], "2026-12-20");
    expect(list).toEqual([
      { month: 7, ym: "2026-07", status: "paid", bonuses: ["夏季賞与"] },
      { month: 12, ym: "2026-12", status: "unpaid", bonuses: [] },
    ]);
    expect(planMonthStatuses(2026, [12], [insured], [], "2026-11-14")[0].status).toBe("upcoming");
  });

  test("予定月の変更：変更後と変更前の月。予定がなくなったら変更後はすべて 00。変えないときは空", () => {
    expect(planChangeMonths([7, 12], [8, 12])).toEqual({ after: ["08", "12"], before: ["07", "12"] });
    expect(planChangeMonths([7, 12], [])).toEqual({ after: ["00", "00", "00", "00"], before: ["07", "12"] });
    expect(planChangeMonths([7, 12], null)).toEqual({ after: [], before: [] });
  });
});
