/**
 * 最低賃金と比べる賃金（基本給と「最低賃金に入れる」手当）と、特定最低賃金のテスト（minimumWage.ts。見直しの P12）
 * 実行方法: bun test
 *
 * 例は、厚生労働省「最低賃金額以上かどうかを確認する方法」のＡさん〜Ｄさん（最低賃金の額は、そのページの例の額）。
 * https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/roudoukijun/chingin/newpage_43899.html
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applicableMinimumWageOn,
  checkMinimumWage,
  describeMinimumWage,
  describeMinimumWagePay,
  minimumWageOn,
  minimumWagePayOf,
  nextApplicableMinimumWage,
  parseSpecificMinimumWage,
  specificMinimumWageOf,
  stringifySpecificMinimumWage,
  type MinimumWageItem,
} from "./minimumWage";

const ROOT = join(import.meta.dir, "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const fixed = (name: string, amount: number, more: Partial<MinimumWageItem> = {}): MinimumWageItem => ({ name, amount, type: "earning", fixed: true, averageWage: "month", ...more });
const variable = (name: string, amount: number, averageWage: "month" | "time" | "none"): MinimumWageItem => ({ name, amount, type: "earning", fixed: false, averageWage });

describe("厚生労働省の例", () => {
  test("Ａさん（月給）：基本給15万円＋職務手当3万円を、年250日×8時間の1か月平均で割ると1,080円（通勤手当は Q では給与項目でなく、入れない）", () => {
    const pay = minimumWagePayOf({ wageType: "monthly", baseWage: 150000, dailyHours: 8, monthlyAverageHours: (250 * 8) / 12, items: [fixed("職務手当", 30000)] })!;
    expect(pay.perHour).toBeCloseTo(1080, 9);
    expect(checkMinimumWage(null, "2026-11-01", pay.perHour)).toBeNull(); // 都道府県がわからなければ比べない
    expect(pay.perHour >= 1000).toBe(true);
  });

  test("Ｂさん（日給と月給の手当）：日給6,000円÷8時間＝750円と、職務手当25,000円×12÷(250日×8時間)＝150円を足して900円", () => {
    const pay = minimumWagePayOf({ wageType: "daily", baseWage: 6000, dailyHours: 8, monthlyAverageHours: (250 * 8) / 12, items: [fixed("職務手当", 25000)] })!;
    expect(pay.base).toBe(750);
    expect(pay.monthly).toBeCloseTo(150, 9);
    expect(pay.perHour).toBeCloseTo(900, 9);
    expect(pay.perHour < 950).toBe(true);
  });

  test("Ｃさん（完全歩合給）：歩合給168,000円÷その月に働いた200時間＝840円（基本給0円でも比べる）", () => {
    const pay = minimumWagePayOf({ wageType: "monthly", baseWage: 0, dailyHours: 8, monthlyAverageHours: 170, items: [variable("歩合給", 168000, "time")], workedHours: 200 })!;
    expect(pay).toMatchObject({ base: 0, monthly: 0, piece: 840, perHour: 840, pieceItems: ["歩合給"] });
  });

  test("Ｄさん（固定給と歩合給）：固定給136,000円÷170時間＝800円と、歩合給50,000円÷200時間＝250円で1,050円", () => {
    const pay = minimumWagePayOf({ wageType: "monthly", baseWage: 136000, dailyHours: 8, monthlyAverageHours: 170, items: [variable("歩合給", 50000, "time")], workedHours: 200 })!;
    expect(pay.perHour).toBe(1050);
    expect(describeMinimumWagePay(pay)).toBe("基本給 800円＋出来高など 250円（歩合給）");
  });
});

describe("入れる手当と入れない手当", () => {
  const base = { wageType: "hourly", baseWage: 1000, dailyHours: 8, monthlyAverageHours: 160 };

  test("「最低賃金に入れる」にしていない項目・平均賃金を「入れない」にした項目（臨時の賃金など）・控除項目・0円の項目は入れない", () => {
    const pay = minimumWagePayOf({ ...base, items: [
      fixed("役職手当", 16000),
      fixed("家族手当", 16000, { inMinimumWage: false }),
      fixed("結婚祝金", 50000, { averageWage: "none" }),
      { name: "社宅費", amount: 16000, type: "deduction", fixed: true },
      fixed("資格手当", 0),
    ] })!;
    expect(pay.perHour).toBe(1100);
    expect(pay.monthlyItems).toEqual(["役職手当"]);
  });

  test("時給の人の月で決まる手当は、1年間の1か月平均の所定労働時間で割って足す（施行規則2条1項3号・2項）", () => {
    expect(minimumWagePayOf({ ...base, items: [fixed("皆勤ではない手当", 8000)] })!.perHour).toBe(1050);
  });

  test("従業員の画面（その月に働いた時間を渡さない）では、変動の項目は入れない。給与明細では、月で決まる賃金は1か月平均で、出来高などは働いた時間で割る", () => {
    const items = [fixed("職務手当", 16000), variable("調整手当", 3200, "month"), variable("歩合給", 20000, "time")];
    expect(minimumWagePayOf({ ...base, items })!.perHour).toBe(1100);
    const pay = minimumWagePayOf({ ...base, items, workedHours: 200 })!;
    expect(pay).toMatchObject({ base: 1000, monthly: 120, piece: 100, perHour: 1220, monthlyItems: ["職務手当", "調整手当"], pieceItems: ["歩合給"] });
  });

  test("時間あたりにできない項目は入れず、名前を返す（1か月平均の所定労働時間・働いた時間がわからない）", () => {
    const pay = minimumWagePayOf({ ...base, monthlyAverageHours: null, items: [fixed("職務手当", 16000), variable("歩合給", 20000, "time")], workedHours: 0 })!;
    expect(pay.perHour).toBe(1000);
    expect(pay.skipped).toEqual(["職務手当", "歩合給"]);
  });

  test("比べられないとき：基本給も入れる手当もない、月給で1か月平均の所定労働時間がわからない", () => {
    expect(minimumWagePayOf({ ...base, baseWage: 0, items: [fixed("家族手当", 10000, { inMinimumWage: false })] })).toBeNull();
    expect(minimumWagePayOf({ ...base, wageType: "monthly", baseWage: 200000, monthlyAverageHours: null })).toBeNull();
  });

  test("基本給だけなら、内訳の文は空", () => {
    expect(describeMinimumWagePay(minimumWagePayOf({ ...base })!)).toBe("");
  });
});

describe("特定最低賃金", () => {
  const specific = { name: "○○県 ○○製造業最低賃金", wages: [{ from: "2025-12-20", amount: 1300 }, { from: "2026-12-15", amount: 1350 }] };

  test("拠点の値を読む・保存する形（発効日の順。発効日・金額のない行は捨てる。行がなければ null）", () => {
    const raw = JSON.stringify({ name: " ○○県 ○○製造業最低賃金 ", wages: [{ from: "2026-12-15", amount: "1350" }, { from: "", amount: 1 }, { from: "2025-12-20", amount: 1300 }, { from: "2026-01-01", amount: 0 }] });
    expect(parseSpecificMinimumWage(raw)).toEqual(specific);
    expect(parseSpecificMinimumWage("")).toBeNull();
    expect(parseSpecificMinimumWage("{")).toBeNull();
    expect(parseSpecificMinimumWage({ name: "名前だけ", wages: [] })).toBeNull();
    expect(stringifySpecificMinimumWage({ name: "x", wages: [] })).toBeNull();
    expect(JSON.parse(stringifySpecificMinimumWage(specific)!)).toEqual(specific);
    expect(specificMinimumWageOf([{ id: 1, specific_minimum_wage: raw }, { id: 2, specific_minimum_wage: null }], null)).toEqual(specific);
    expect(specificMinimumWageOf([{ id: 1, specific_minimum_wage: raw }, { id: 2, specific_minimum_wage: null }], 2)).toBeNull();
  });

  test("地域別と高いほうで比べる（最低賃金法6条1項）：東京の地域別 1,226円（2025年10月3日から）・1,280円（2026年10月1日から）", () => {
    expect(minimumWageOn("東京", "2025-12-19")?.amount).toBe(1226);
    expect(applicableMinimumWageOn("東京", "2025-12-19", specific)).toEqual({ from: "2025-10-03", amount: 1226, kind: "regional", name: "" });
    expect(applicableMinimumWageOn("東京", "2025-12-20", specific)).toEqual({ from: "2025-12-20", amount: 1300, kind: "specific", name: specific.name });
    expect(applicableMinimumWageOn("東京", "2026-10-01", specific)?.amount).toBe(1300);
    // 地域別が特定最低賃金より高くなったら、地域別（同じ額なら地域別）
    const low = { name: "低い", wages: [{ from: "2025-12-20", amount: 1280 }] };
    expect(applicableMinimumWageOn("東京", "2026-10-01", low)).toMatchObject({ amount: 1280, kind: "regional" });
    expect(applicableMinimumWageOn("東京", "2026-10-01", null)).toMatchObject({ amount: 1280, kind: "regional" });
  });

  test("下回るかのチェックと、知らせの文", () => {
    const check = checkMinimumWage("東京", "2026-01-31", 1250, specific)!;
    expect(check.ok).toBe(false);
    expect(describeMinimumWage("東京", check.minimum)).toBe("特定最低賃金「○○県 ○○製造業最低賃金」 1,300円（2025年12月20日から）");
    expect(checkMinimumWage("東京", "2026-01-31", 1250, null)!.ok).toBe(true);
    expect(describeMinimumWage("東京", checkMinimumWage("東京", "2026-01-31", 1250)!.minimum)).toBe("東京の最低賃金 1,226円（2025年10月3日から）");
  });

  test("次に変わる最低賃金：特定最低賃金の改正の日（地域別の改正で額が変わらない日はとばす）", () => {
    expect(nextApplicableMinimumWage("東京", "2026-01-31", specific)).toEqual({ from: "2026-12-15", amount: 1350, kind: "specific", name: specific.name });
    expect(nextApplicableMinimumWage("東京", "2025-12-01", specific)).toMatchObject({ from: "2025-12-20", amount: 1300, kind: "specific" });
    expect(nextApplicableMinimumWage("東京", "2026-01-31", null)).toMatchObject({ from: "2026-10-01", amount: 1280, kind: "regional" });
    expect(nextApplicableMinimumWage("東京", "2026-12-15", specific)).toBeNull();
  });
});

describe("画面と会社ファイルにつないでいる", () => {
  test("給与項目の「最低賃金に入れる」・拠点の特定最低賃金・従業員の「特定最低賃金から除く」", () => {
    expect(read("src/types/dbSchema.ts")).toContain("in_minimum_wage INTEGER DEFAULT 1");
    expect(read("src/utils/calcSalary.ts")).toContain("inMinimumWage: Number(r.in_minimum_wage) !== 0");
    expect(read("src/features/settings/CustomItemManager.tsx")).toContain("setMinimumWage(item.id, e.target.checked)");
    expect(read("src/features/settings/company/BranchTab.tsx")).toContain("<SpecificMinimumWageEditor");
    expect(read("src/features/settings/useCompanyManager.ts")).toContain("UPDATE branches SET specific_minimum_wage = ?");
    const staff = read("src/features/settings/useStaffManager.ts");
    expect(staff).toContain("weekday_hours=?, specific_min_wage_exempt=?");
    expect(staff).toContain("weekday_hours, specific_min_wage_exempt,");
    expect(read("src/features/settings/staff/WageSection.tsx")).toContain("minimumWagePayOf(");
  });

  test("給与明細：手当と特定最低賃金で比べ、下回れば確定の前に確かめて、このまま確定したら注意を記録する（確かめは保存より前）", () => {
    const hook = read("src/features/payroll/usePayStubModal.ts");
    expect(hook).toContain("items: extras.customItems, workedHours:");
    expect(hook).toContain("Number(staff.specific_min_wage_exempt) ? null : staff.specificMinimumWage ?? null");
    const askAt = hook.indexOf('title: "最低賃金を下回っています"');
    expect(askAt).toBeGreaterThan(0);
    expect(askAt).toBeLessThan(hook.indexOf("const result = await saveSalaryResult("));
    expect(hook).toContain('okLabel: "このまま確定する", cancelLabel: "やめる"');
    expect(hook).toContain("最低賃金を下回ったまま確定しました");
    expect(read("src/features/payroll/usePaySlipManager.ts")).toContain("specificMinimumWage: specificMinimumWageOf(branches, staff.branch_id)");
    // 基本給だけで比べていたころの関数は、画面から使わない
    expect(hook).not.toContain("baseWagePerHour(");
    expect(read("src/features/settings/staff/WageSection.tsx")).not.toContain("baseWagePerHour(");
  });
});
