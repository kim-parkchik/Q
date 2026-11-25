/**
 * 標準報酬月額の入れ忘れ（remunerationMissing.ts。見直しの P10）のテスト
 * 実行方法: bun test
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as Master from "../constants";
import { REMUNERATION_MISSING_TITLE, remunerationMissingLines, remunerationMissingOf } from "./remunerationMissing";
import { lookupGrade } from "./santei";

const history = (...rows: [string, number][]) => JSON.stringify(rows.map(([from, amount]) => ({ from, amount, reason: "shutoku" })));
/** 社保規定「全社」(1) を選び、標準報酬月額を入れていない月給30万円の人（2026年4月入社・1990年生まれ） */
const staffOf = (o: Record<string, unknown> = {}) => ({
  id: "1", name: "入社 太郎", birthday: "1990-05-05", join_date: "2026-04-01", retirement_date: null,
  social_insurance_group_id: 1, standard_remuneration_history: history(["", 0]),
  wage_type: "monthly", base_wage: 300000, fixed_overtime_allowance: 0, commute_type: "none", commute_amount: 0, commute_setting: null,
  ...o,
});
const ROOT = join(import.meta.dir, "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("入れ忘れとして知らせる人", () => {
  test("社保規定を選んでいて、標準報酬月額が一度も入っていない月給の人：見込みの等級も出す", () => {
    const m = remunerationMissingOf(staffOf(), 2026, 11);
    expect(m).not.toBeNull();
    expect(m!.estimatedWage).toBe(300000);
    expect(m!.suggested).toEqual(lookupGrade(Master.getInsuranceMaster(2026, 11).HYOJUN_TABLE, 300000));
    // 固定残業代と通勤手当（月額）も見込みに入れる（資格取得届の画面と同じ）
    expect(remunerationMissingOf(staffOf({ fixed_overtime_allowance: 30000, commute_type: "monthly", commute_amount: 10000 }), 2026, 11)!.estimatedWage).toBe(340000);
  });

  test("時給・日給の人は、見込みを出さない（知らせだけ）", () => {
    const m = remunerationMissingOf(staffOf({ wage_type: "hourly", base_wage: 1200 }), 2026, 11);
    expect(m).toEqual({ estimatedWage: null, suggested: null });
  });

  test("社保規定の項目がない古い形は、選んでいるとみなす（給与の計算と同じ）", () => {
    const { social_insurance_group_id: _, ...old } = staffOf();
    expect(remunerationMissingOf(old, 2026, 11)).not.toBeNull();
  });

  test("70歳以上75歳未満の人は、健康保険がかかるので知らせる", () => {
    expect(remunerationMissingOf(staffOf({ birthday: "1954-05-05" }), 2026, 11)).not.toBeNull();
  });
});

describe("知らせない人・月", () => {
  test("社保規定が「未加入 / 適用除外」（空・0）", () => {
    expect(remunerationMissingOf(staffOf({ social_insurance_group_id: null }), 2026, 11)).toBeNull();
    expect(remunerationMissingOf(staffOf({ social_insurance_group_id: 0 }), 2026, 11)).toBeNull();
  });

  test("標準報酬月額の履歴に0でない行がある（加入する前・資格を失った後の0は入れ忘れではない）", () => {
    expect(remunerationMissingOf(staffOf({ standard_remuneration_history: history(["", 300000]) }), 2026, 11)).toBeNull();
    expect(remunerationMissingOf(staffOf({ standard_remuneration_history: history(["", 0], ["2026-10", 300000]) }), 2026, 5)).toBeNull();
    // 履歴がない古い形は、いまの標準報酬月額を見る
    expect(remunerationMissingOf(staffOf({ standard_remuneration_history: null, standard_remuneration: 300000 }), 2026, 11)).toBeNull();
    expect(remunerationMissingOf(staffOf({ standard_remuneration_history: null, standard_remuneration: 0 }), 2026, 11)).not.toBeNull();
  });

  test("社会保険料がかからない月：入社した月より前、資格喪失日（退職日の翌日）がある月から", () => {
    expect(remunerationMissingOf(staffOf(), 2026, 3)).toBeNull();
    expect(remunerationMissingOf(staffOf(), 2026, 4)).not.toBeNull();
    const retired = staffOf({ retirement_date: "2026-09-30" });
    expect(remunerationMissingOf(retired, 2026, 9)).not.toBeNull();
    expect(remunerationMissingOf(retired, 2026, 10)).toBeNull();
  });

  test("健康保険も厚生年金も対象でない月（75歳以上・社会保障協定などで両方の資格を失った月から）", () => {
    expect(remunerationMissingOf(staffOf({ birthday: "1950-05-05" }), 2026, 11)).toBeNull();
    // 社会保障協定で、健康保険と厚生年金の両方の資格を失った月の分からは知らせない（年金だけなら、健康保険がかかるので知らせる）
    const lost = JSON.stringify({ cause: "社会保障協定", date: "2026-07-01", pensionOnly: false });
    expect(remunerationMissingOf(staffOf({ shaho_loss: lost }), 2026, 6)).not.toBeNull();
    expect(remunerationMissingOf(staffOf({ shaho_loss: lost }), 2026, 7)).toBeNull();
    const pensionOnly = JSON.stringify({ cause: "社会保障協定", date: "2026-07-01", pensionOnly: true });
    expect(remunerationMissingOf(staffOf({ shaho_loss: pensionOnly }), 2026, 7)).not.toBeNull();
  });

  test("従業員がない", () => {
    expect(remunerationMissingOf(null, 2026, 11)).toBeNull();
  });
});

describe("知らせの文", () => {
  test("社保規定の名前と、加入する・しないときにすること。月給の人だけ見込みの等級", () => {
    const m = remunerationMissingOf(staffOf(), 2026, 11)!;
    const text = remunerationMissingLines(m, "全社").join("\n");
    expect(text).toContain("社保規定は「全社」を選んでいますが、標準報酬月額が一度も入っていない");
    expect(text).toContain("社保規定を「未加入 / 適用除外」にしてください");
    expect(text).toContain(`300,000円で決めると、${m.suggested!.grade}級 ${m.suggested!.standard.toLocaleString()}円です`);
    const hourly = remunerationMissingLines({ estimatedWage: null, suggested: null }, "全社");
    expect(hourly).toHaveLength(2);
    expect(remunerationMissingLines(m, "")[0]).toContain("「（名前なし）」");
    expect(REMUNERATION_MISSING_TITLE).toBe("社会保険の標準報酬月額が入っていません");
  });
});

describe("画面につないでいる", () => {
  test("給与明細は確定の前に確かめ（このまま確定する・やめる）、確定したら操作の記録に注意を残す。明細・給与の一覧・従業員の画面に知らせを出す", () => {
    const hook = read("src/features/payroll/usePayStubModal.ts");
    expect(hook).toContain("remunerationMissingOf(staff, year, month)");
    expect(hook).toMatch(/if \(remunerationMissing\) \{\s*const ok = await ask\(/);
    expect(hook).toContain('okLabel: "このまま確定する", cancelLabel: "やめる"');
    expect(hook).toContain('writeLog(db, "WARN", "salary"');
    // 確かめは、保存（saveSalaryResult）より前
    expect(hook.indexOf("if (remunerationMissing) {")).toBeLessThan(hook.indexOf("const result = await saveSalaryResult("));
    expect(read("src/features/payroll/PayStubModal.tsx")).toContain('remunerationMissingLines(remunerationMissing, extras.healthInsurer?.name ?? "")');
    expect(read("src/features/payroll/PaySlipManager.tsx")).toContain("remunerationMissingOf(s, year, month)");
    expect(read("src/features/settings/staff/InsuranceSection.tsx")).toContain("remunerationMissingLines(cm.remunerationMissing");
  });
});
