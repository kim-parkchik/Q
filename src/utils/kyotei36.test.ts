import { describe, expect, test } from "bun:test";
import { KYOTEI36_LIMITS } from "../constants/roumu";
import {
  check36, emptyKyotei36, kyotei36Problems, limitsOf, parseKyotei36Settings, stringifyKyotei36Settings, type MonthHours,
} from "./kyotei36";

const month = (ym: string, overtime: number, holiday = 0): MonthHours => ({ ym, periodEnd: `${ym}-25`, overtime, holiday });

describe("36協定", () => {
  test("条文から作った上限", () => {
    expect(KYOTEI36_LIMITS).toEqual({
      monthly: 45, annual: 360, monthlyVariable: 42, annualVariable: 320, specialMonthlyBelow: 100, specialAnnual: 720, specialMonthsMax: 6,
      actualMonthlyBelow: 100, averageMax: 80, averageMonths: [2, 3, 4, 5, 6],
    });
  });

  test("協定の中身の決まり：限度時間・特別条項の上限・入れていない欄", () => {
    const k = emptyKyotei36();
    k.overtime = [{ ...k.overtime[0], work: "営業", month: "50", year: "400" }, { ...k.overtime[0], work: "製造", month: "42", year: "320", variable: true }];
    k.special = true;
    k.specialRows = [{ ...k.specialRows[0], work: "営業", times: "7", month: "100", year: "750" }];
    const p = kyotei36Problems(k).join("\n");
    expect(p).toContain("1箇月は45時間までです（50時間）");
    expect(p).toContain("1年は360時間までです（400時間）");
    expect(p).not.toContain("2行目");
    expect(p).toContain("100時間未満です（100時間）");
    expect(p).toContain("720時間以内です（750時間）");
    expect(p).toContain("6回以内です（7回）");
    expect(p).toContain("起算日を入れてください");
    expect(p).toContain("協定の当事者");
    expect(p).toContain("臨時的に限度時間を超えて労働させることができる場合");
  });

  test("協定がなければ法律の限度時間、特別条項があればその時間と回数", () => {
    expect(limitsOf(null)).toEqual({ month: 45, year: 360, special: null, agreed: false });
    const k = emptyKyotei36();
    k.overtime = [{ ...k.overtime[0], month: "30", year: "300" }];
    k.special = true;
    k.specialRows = [{ ...k.specialRows[0], times: "6", month: "80", year: "600" }];
    expect(limitsOf(k)).toEqual({ month: 30, year: 300, special: { month: 80, year: 600, times: 6 }, agreed: true });
  });

  test("実際の時間：100時間以上・2〜6か月平均80時間超・特別条項の回数・1年の合計", () => {
    const limits = { month: 45, year: 360, special: { month: 95, year: 600, times: 2 }, agreed: true };
    const checks = check36([
      month("2026-04", 50, 10), // 合計60（限度超え1回目）
      month("2026-05", 90, 15), // 合計105 → 100時間以上。2か月平均 82.5
      month("2026-06", 46),     // 限度超え3回目 → 回数（2回）を超える
      month("2026-07", 10),
    ], limits, "2026-04-01");
    expect(checks.map((c) => c.total)).toEqual([60, 105, 46, 10]);
    expect(checks[0].violations).toEqual([]);
    expect(checks[1].violations).toContain("時間外労働と休日労働の合計が100時間以上です（法律違反）");
    expect(checks[1].violations).toContain("2か月の平均が80時間を超えています（法律違反）");
    expect(checks[1].violations).toContain("時間外労働と休日労働の合計が特別条項の1か月の時間（95時間）以上です");
    expect(checks[2].violations).toContain("限度時間を超えた月が、特別条項の回数（2回）を超えています");
    expect(checks[2].maxAverage).toEqual({ months: 2, average: 75.5 });
    expect(checks[3].yearToDate).toBe(196);
  });

  test("起算日で1年の合計を数え直し、間に給与のない月があれば平均を出さない", () => {
    const limits = { month: 45, year: 100, special: null, agreed: true };
    const checks = check36([month("2026-02", 40), month("2026-03", 70), month("2026-04", 40), month("2026-06", 40)], limits, "2026-04-01");
    expect(checks[1].yearToDate).toBe(110);
    expect(checks[1].violations).toContain("起算日からの時間外労働の合計が協定の1年の時間（100時間）を超えています");
    expect(checks[1].violations).toContain("時間外労働が協定の1か月の時間（45時間）を超えています");
    expect(checks[2].yearToDate).toBe(40);
    expect(checks[3].maxAverage).toBeNull();
  });

  test("残す形", () => {
    const k = emptyKyotei36();
    k.businessType = "その他の各種事業";
    k.special = true;
    const s = parseKyotei36Settings(stringifyKyotei36Settings({ "1": k }));
    expect(s["1"].businessType).toBe("その他の各種事業");
    expect(s["1"].special).toBe(true);
    expect(s["1"].overtime.length).toBe(1);
    expect(parseKyotei36Settings("こわれた")).toEqual({});
  });
});
