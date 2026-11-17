import { describe, expect, test } from "bun:test";
import { noticeMonths, remunerationNotices } from "./remunerationNotice";

const history = (list: [string, number, string][]) => JSON.stringify(list.map(([from, amount, reason]) => ({ from, amount, reason })));
const staffList = [
  { id: "1001", name: "山田　太郎", birthday: "1980-04-01", branch_id: 1, social_insurance_group_id: 1,
    standard_remuneration_history: history([["", 300000, "shutoku"], ["2026-09", 340000, "teiji"]]) },
  { id: "1002", name: "長寿　一郎", birthday: "1955-05-05", branch_id: 1, social_insurance_group_id: 1,
    standard_remuneration_history: history([["", 260000, "shutoku"], ["2026-09", 280000, "teiji"]]) },
  { id: "1003", name: "変更　なし", birthday: "1990-01-01", branch_id: 1, social_insurance_group_id: 1,
    standard_remuneration_history: history([["", 200000, "shutoku"]]) },
];
const ctx = { insurers: new Map(), prefectureOf: () => "東京", rounding: "currency_law" };

describe("標準報酬月額の決定・改定の通知書（健康保険法49条2項・厚生年金保険法29条2項）", () => {
  test("その月から標準報酬月額が変わる人だけ。決定後・従前と等級、その月の分の本人負担の保険料", () => {
    expect(noticeMonths(staffList)).toEqual(["2026-09"]);
    const [a, b] = remunerationNotices(staffList, "2026-09", ctx);
    expect([a.staffId, a.reasonLabel, a.health, a.healthGrade, a.pension, a.pensionGrade, a.previousHealth, a.previousPension])
      .toEqual(["1001", "定時決定（算定）", 340000, 24, 340000, 21, 300000, 300000]);
    // 東京（令和8年度）：健康保険 9.85%、介護 1.62%、子ども・子育て支援金 0.23%、厚生年金 18.3% の折半（50銭以下切り捨て）
    expect(a.premiums).toEqual({ health: 16745, nursing: 2754, childSupport: 391, pension: 31110, total: 51000 });
    // 70歳以上は厚生年金保険の保険料がかからない（65歳以上なので介護保険料もない）
    expect([b.staffId, b.pension, b.premiums?.pension, b.premiums?.nursing]).toEqual(["1002", null, 0, 0]);
    expect(b.notes.some((n) => n.includes("70歳以上"))).toBe(true);
    expect(remunerationNotices(staffList, "2026-10", ctx)).toEqual([]);
  });
  test("都道府県がわからなければ、保険料を出さずに知らせる", () => {
    const [a] = remunerationNotices(staffList, "2026-09", { ...ctx, prefectureOf: () => null });
    expect(a.premiums).toBe(null);
    expect(a.notes[0]).toContain("都道府県");
  });
});
