import { describe, expect, test } from "bun:test";
import { DISABILITY_EMPLOYMENT_RATE, DISABILITY_EMPLOYMENT_RATE_FORM6, DISABILITY_REPORT_MIN_WORKERS_FORM6, DISABILITY_WEEKLY_HOURS, ELDERLY_AGE_BANDS } from "../constants/roumu";
import { disabilityRateFor, disabilityReport, disabilityWeight, elderlyReport, hoursClassOf, retirementAgeOf } from "./employmentStatus";

/** 週の所定労働時間 hours の人（曜日で決める：月〜金のうち days 日 × 1日 hours/days 時間） */
const person = (id: string, weeklyHours: number, o: Record<string, unknown> = {}) => ({
  id, name: `社員${id}`, join_date: "2020-04-01", calendar_pattern_id: 0, work_days: "mon,tue,wed,thu,fri", scheduled_work_hours: weeklyHours / 5,
  is_employment_ins_eligible: 1, gender: "male", birthday: "1980-01-01", ...o,
});
const dis = (kind: string, severe = false) => JSON.stringify({ kind, severe, note: "" });

describe("障害者雇用状況報告", () => {
  test("記入要領と様式から作った数", () => {
    expect(DISABILITY_WEEKLY_HOURS).toEqual({ regularMin: 20, shortBelow: 30, specifiedMin: 10 });
    expect(DISABILITY_EMPLOYMENT_RATE_FORM6).toEqual([25, 1000]);
    expect(DISABILITY_EMPLOYMENT_RATE).toEqual([27, 1000]);
    expect(DISABILITY_REPORT_MIN_WORKERS_FORM6).toBe(40);
    expect(disabilityRateFor(2026)).toEqual([25, 1000]);
    expect(disabilityRateFor(2027)).toEqual([27, 1000]);
  });

  test("数え方の表（重度×2・短時間×0.5・精神の短時間は1・特定短時間は重度と精神だけ0.5）", () => {
    const w = (kind: "physical" | "intellectual" | "mental", severe: boolean, c: "regular" | "short" | "specified") => disabilityWeight({ kind, severe, note: "" }, c);
    expect([w("physical", false, "regular"), w("physical", false, "short"), w("physical", false, "specified")]).toEqual([1, 0.5, 0]);
    expect([w("physical", true, "regular"), w("physical", true, "short"), w("physical", true, "specified")]).toEqual([2, 1, 0.5]);
    expect([w("intellectual", true, "regular"), w("intellectual", false, "short")]).toEqual([2, 0.5]);
    expect([w("mental", false, "regular"), w("mental", false, "short"), w("mental", false, "specified")]).toEqual([1, 1, 0.5]);
    expect(hoursClassOf(person("x", 30))).toBe("regular");
    expect(hoursClassOf(person("x", 25))).toBe("short");
    expect(hoursClassOf(person("x", 15))).toBe("specified");
    expect(hoursClassOf(person("x", 8))).toBe("none");
  });

  test("令和8年6月1日現在：常用雇用労働者 45人（うち短時間 10人）、障害者は重度身体1人・精神の短時間1人・知的の特定短時間（数えない）", () => {
    const staff = [
      ...Array.from({ length: 34 }, (_, i) => person(`r${i}`, 40)),
      ...Array.from({ length: 10 }, (_, i) => person(`s${i}`, 25)),
      person("d1", 40, { disability_employment: dis("physical", true) }),
      person("d2", 25, { disability_employment: dis("mental"), join_date: "2025-10-01" }),
      person("d3", 15, { disability_employment: dis("intellectual") }),
      person("old", 40, { retirement_date: "2026-05-31" }),
      person("exec", 40, { is_executive: 1, is_employment_ins_eligible: 0 }),
      person("short-contract", 40, { koyo_info: JSON.stringify({ contract: { has: true, start: "2026-04-01", end: "2026-09-30", renewal: "無" } }) }),
    ];
    const r = disabilityReport(staff, 2026, 0);
    expect([r.i, r.ro, r.ha, r.ni]).toEqual([35, 11, 40.5, 40.5]);
    expect(r.cells.ho).toEqual({ n: 1, newN: 0 });
    expect(r.cells.so).toEqual({ n: 1, newN: 1 });
    expect(r.physical).toBe(2);
    expect(r.mental).toBe(1);
    expect(r.total).toBe(3);
    // 40.5 × 2.5% ＝ 1.0125 → 1人。不足数 0
    expect(r.required).toBe(1);
    expect(r.shortage).toBe(0);
    expect(r.mustReport).toBe(true);
    expect(r.actualRate).toBe(7.41);
    // 除外率 10%：40.5 × 10% ＝ 4.05 → 4人を引いて 36.5
    expect(disabilityReport(staff, 2026, 10).ni).toBe(36.5);
    expect(disabilityReport(staff, 2026, 10).mustReport).toBe(false);
  });
});

describe("高年齢者雇用状況等報告", () => {
  test("⑮ 年齢の区分（様式第2号の絵を文字認識で読んだもの）", () => {
    expect(ELDERLY_AGE_BANDS).toEqual([[null, 44], [45, 49], [50, 54], [55, 59], [60, 64], [65, 69], [70, null]]);
  });

  test("⑮ 常用労働者数・⑯ 解雇等による離職者・⑰ 定年に達した人", () => {
    const staff = [
      person("a", 40, { birthday: "1990-05-01" }),
      person("b", 40, { birthday: "1965-06-01", gender: "female" }),            // 61歳
      person("c", 40, { birthday: "1956-06-02" }),                             // 6月1日では69歳
      person("d", 15, { birthday: "1950-01-01" }),                             // 20時間未満は数えない
      person("e", 40, { birthday: "1970-03-01", retirement_date: "2025-12-31", retirement_reason: "会社都合による退職" }),
      person("f", 40, { birthday: "1965-08-10", retirement_date: "2025-09-30", retirement_reason: "定年による退職" }), // 2025-08-09 に60歳
      person("g", 40, { birthday: "1965-10-10" }),                             // 2025-10-09 に60歳・継続雇用
    ];
    const r = elderlyReport(staff, 2026, 60);
    expect([r.total, r.women]).toEqual([4, 1]);
    expect(r.bands.map((b) => b.total)).toEqual([1, 0, 0, 0, 2, 1, 0]);
    expect(r.bands[4].women).toBe(1);
    expect(r.dismissed.names).toEqual(["社員e"]);
    expect(r.reached).toEqual([{ name: "社員f", date: "2025-08-09", outcome: "退職" }, { name: "社員g", date: "2025-10-09", outcome: "継続雇用" }]);
    expect(retirementAgeOf("有（60歳）")).toBe(60);
    expect(retirementAgeOf("無")).toBeNull();
  });
});
