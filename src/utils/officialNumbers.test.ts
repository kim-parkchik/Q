/**
 * 公式の数値を手で書き写さず、公式のファイル（厚生労働省の PDF・法令の条文の XML）からスクリプトで作っていることのテスト（見直しの P8）
 * ・雇用保険料率：厚生労働省「雇用保険料率について」の PDF から scripts/import_employment_insurance_rates.py
 *   （PDF は insurance-tables/source/。GitHub には上げない）
 * ・割増賃金の率の最低・深夜の時間など：労働基準法と割増賃金令の XML から scripts/import_labor_standards.py
 * ・令和6年分の定額減税：租税特別措置法の XML から scripts/import_flat_tax_reduction.py
 * ・育児休業等の保険料の免除の14日・1か月・始まりの日：健康保険法・厚生年金保険法の XML から scripts/import_childcare_exemption.py
 * ・扶養親族等の数の数え方と線（見直しの P9）：国税庁「源泉徴収税額表」の「給与所得の源泉徴収税額の求め方」の PDF から
 *   scripts/import_withholding_dependents.py（PDF は tax-tables/source/。GitHub には上げない）
 * 作ったファイルの頭に書いた SHA-256 が、元のファイル（と README の表）と同じこと（元のファイルを取り直したのに、作り直していないことに気づく）と、
 * 数が、いままで手で書いていた数（PDF・条文に書かれた数）と同じことを確かめる
 * 実行方法: bun test
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as Master from "../constants";
import { LABOR_INSURANCE_PERIODS } from "../constants/insurance";
import { CHILDCARE_EXEMPTION, CHILDCARE_RULE_2022_START } from "../constants/insurance/childcareExemption";
import { HOURLY_PAID_LEAVE_MAX_DAYS, LEGAL_PREMIUM_PERCENT, NIGHT_HOURS, OVER60_HOURS, SME_OVER60_FROM } from "../constants/laborStandards";
import { FLAT_TAX_REDUCTION_2024 } from "../constants/tax";
import { SAME_MONTH_CHILDCARE_MIN_DAYS } from "./leaveExemption";
import { describePremiumRates, LEGAL_PREMIUM_RATES, PREMIUM_RATE_LABELS } from "./premiumRates";

const ROOT = join(import.meta.dir, "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const sha256 = (rel: string) => createHash("sha256").update(readFileSync(join(ROOT, rel))).digest("hex");
/** コメントを除いたコード */
const codeOf = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** 作ったファイルの頭に書いた「元のファイル … SHA-256 …」 */
const recordedHashes = (generated: string): { file: string; hash: string }[] =>
  [...read(generated).matchAll(/([\w./-]+\.(?:xml|pdf))[^\n]*?SHA-256 ([0-9a-f]{64})/g)].map((m) => ({ file: m[1], hash: m[2] }));

describe("作ったファイルと、元のファイル", () => {
  const generated: [string, string, string[]][] = [
    // [作ったファイル, 作るスクリプト, リポジトリの中にある元のファイル]
    ["src/constants/laborStandards.ts", "import_labor_standards.py", ["roumu-forms/labor-standards-act.xml", "roumu-forms/wage-premium-order.xml"]],
    ["src/constants/workHours.ts", "import_work_hours.py", ["roumu-forms/labor-standards-act.xml", "roumu-forms/labor-standards-rule-25-2.xml"]],
    ["src/constants/tax/flatTaxReduction.ts", "import_flat_tax_reduction.py",
      ["tax-tables/special-taxation-act-41-3-3.xml", "tax-tables/special-taxation-act-41-3-7.xml"]],
    ["src/constants/insurance/childcareExemption.ts", "import_childcare_exemption.py",
      ["roumu-forms/health-insurance-act-159.xml", "roumu-forms/employees-pension-act-81-2.xml"]],
  ];

  test("条文の XML から作ったファイルは、スクリプトで作ったと書き、頭の SHA-256 がリポジトリの中の XML と同じ", () => {
    for (const [file, script, sources] of generated) {
      const text = read(file);
      expect(text).toMatch(new RegExp(`scripts/${script.replace(".", "\\.")} で[^\\n]*作る`));
      expect(text).toContain("手で書き換えない");
      const recorded = recordedHashes(file);
      for (const source of sources) {
        const hit = recorded.find((r) => source.endsWith(r.file));
        expect(hit?.hash).toBe(sha256(source));
      }
    }
  });

  test("GitHub に上げない元のファイル（雇用保険料率の PDF・健康保険法の全文）は、README の表と同じ SHA-256。手元にあれば、その中身とも同じ", () => {
    const pdfs = recordedHashes("src/constants/insurance/laborInsuranceRates.ts");
    expect(pdfs.map((p) => p.file)).toEqual([3, 4, 5, 6, 7, 8].map((y) => `insurance-tables/source/koyou-ryouritsu-r0${y}.pdf`));
    const insuranceReadme = read("insurance-tables/README.md");
    for (const p of pdfs) {
      expect(insuranceReadme).toContain(`| ${p.file.replace("insurance-tables/", "")} |`);
      expect(insuranceReadme).toContain(p.hash);
      if (existsSync(join(ROOT, p.file))) expect(sha256(p.file)).toBe(p.hash);
    }
    const full = recordedHashes("src/constants/insurance/childcareExemption.ts").find((r) => r.file.endsWith("source/health-insurance-act.xml"));
    expect(full).toBeDefined();
    expect(read("roumu-forms/README.md")).toContain(full!.hash);
    if (existsSync(join(ROOT, full!.file))) expect(sha256(full!.file)).toBe(full!.hash);
    // GitHub に上げない（.gitignore）
    const ignore = read(".gitignore");
    expect(ignore).toContain("insurance-tables/source/");
    expect(ignore).toContain("roumu-forms/source/");
  });

  test("扶養親族等の数の数え方は、国税庁の「給与所得の源泉徴収税額の求め方」の PDF から作り、SHA-256 が README の表と同じ。手元にあれば、その中身とも同じ", () => {
    const file = "src/constants/tax/withholdingDependentRules.ts";
    const text = read(file);
    expect(text).toContain("scripts/import_withholding_dependents.py で");
    expect(text).toContain("手で書き換えない");
    const pdfs = recordedHashes(file);
    expect(pdfs.map((p) => p.file)).toEqual([2026, 2027].map((y) => `tax-tables/source/zeigakuhyo${y}-19-22.pdf`));
    const readme = read("tax-tables/README.md");
    for (const p of pdfs) {
      expect(readme).toContain(`| ${p.file.replace("tax-tables/", "")} |`);
      expect(readme).toContain(p.hash);
      if (existsSync(join(ROOT, p.file))) expect(sha256(p.file)).toBe(p.hash);
    }
    expect(read(".gitignore")).toContain("tax-tables/source/");
  });
});

describe("雇用保険料率（厚生労働省の PDF から作った数）", () => {
  test("年度ごとの PDF から作り、令和5年度は令和5年度の PDF（前は令和6年度の PDF の下の段から書いていた）", () => {
    const text = read("src/constants/insurance/laborInsuranceRates.ts");
    expect(text).toContain("scripts/import_employment_insurance_rates.py で");
    expect(text).not.toContain("手やAIで書き写すとき");
    expect(LABOR_INSURANCE_PERIODS.map((p) => `${p.from.year}-${p.from.month}`)).toEqual([
      "2020-4", "2021-4", "2022-4", "2022-10", "2023-4", "2024-4", "2025-4", "2026-4",
    ]);
    const sourceOf = (y: number, m: number) => LABOR_INSURANCE_PERIODS.find((p) => p.from.year === y && p.from.month === m)?.source;
    expect(sourceOf(2020, 4)).toBe("https://www.mhlw.go.jp/content/000739455.pdf"); // 令和3年度の PDF の下の段
    expect(sourceOf(2023, 4)).toBe("https://www.mhlw.go.jp/content/001050206.pdf");
    expect(sourceOf(2026, 4)).toBe("https://www.mhlw.go.jp/content/001692566.pdf");
    // どの出典も、スクリプトの SOURCES と README の表にある
    const script = read("scripts/import_employment_insurance_rates.py");
    const readme = read("insurance-tables/README.md");
    for (const p of LABOR_INSURANCE_PERIODS) {
      expect(script).toContain(`"${p.source}"`);
      expect(readme).toContain(p.source);
    }
  });
});

describe("割増賃金の率・深夜の時間など（労働基準法・割増賃金令の条文から作った数）", () => {
  test("いままで手で書いていた数と同じ：時間外25%・休日35%・月60時間超50%・深夜25%（22時〜5時）、中小事業主は2023年4月1日から、時間単位の年休は5日まで", () => {
    expect(LEGAL_PREMIUM_PERCENT).toEqual({ overtime: 25, holiday: 35, over60: 50, night: 25 });
    expect(OVER60_HOURS).toBe(60);
    expect(NIGHT_HOURS).toEqual({ start: 22, end: 5 });
    expect(SME_OVER60_FROM).toBe("2023-04-01");
    expect(HOURLY_PAID_LEAVE_MAX_DAYS).toBe(5);
    // constants/labor.ts（Master）は、作った数をそのまま出す
    expect([Master.NIGHT_START_HOUR, Master.NIGHT_END_HOUR, Master.OVER60_HOURS, Master.HOURLY_PAID_LEAVE_MAX_DAYS]).toEqual([22, 5, 60, 5]);
    expect(Master.LEGAL_PREMIUM_PERCENT).toBe(LEGAL_PREMIUM_PERCENT);
    expect(Master.SME_OVER60_FROM).toBe(SME_OVER60_FROM);
  });

  test("給与規定グループの法律の率と、画面に出す字は、作った数から（字はいままでと同じ）", () => {
    expect(LEGAL_PREMIUM_RATES).toEqual({ overtime: 25, overLimitMonth: 25, over60: 50, overLimitYear: 25, holiday: 35, night: 25, statutory: 0 });
    expect(describePremiumRates(LEGAL_PREMIUM_RATES)).toBe("法律の率（時間外25%・月60時間超50%・休日35%・深夜25%）");
    expect(PREMIUM_RATE_LABELS.overtime).toBe("時間外労働（1日8時間・週40時間を超えた時間）");
    expect(PREMIUM_RATE_LABELS.over60).toBe("1か月の時間外労働が60時間を超えた分");
    expect(PREMIUM_RATE_LABELS.night).toBe("深夜（22時〜5時）の労働");
    expect(PREMIUM_RATE_LABELS.statutory).toBe("法定内残業（所定労働時間を超えて、1日8時間・週40時間までの時間）");
  });
});

describe("定額減税（租税特別措置法の条文から作った数）", () => {
  test("いままで手で書いていた数と同じ：2024年、6月1日に在籍する人の6月以後の給与から、1人30,000円", () => {
    expect(FLAT_TAX_REDUCTION_2024).toEqual({ YEAR: 2024, FROM_MONTH: 6, BASE_DATE: "2024-06-01", PER_PERSON: 30000 });
  });
});

describe("育児休業等の保険料の免除（健康保険法・厚生年金保険法の条文から作った数）", () => {
  test("いままで手で書いていた数と同じ：同じ月の育児休業等は14日以上、1か月以下なら賞与は免除しない、2022年10月1日以後に開始したものから", () => {
    expect(CHILDCARE_EXEMPTION).toEqual({ sameMonthMinDays: 14, bonusMonths: 1 });
    expect(CHILDCARE_RULE_2022_START).toBe("2022-10-01");
    expect(SAME_MONTH_CHILDCARE_MIN_DAYS).toBe(14);
  });
});

describe("手で書いた公式の数が、コードに残っていない", () => {
  test("constants/labor.ts には数を書かない（作った数を出すだけ。OVER60_HOURS のような名前の中の数字は数えない）", () => {
    expect(codeOf(read("src/constants/labor.ts")).match(/(^|[^\w$])\d/g)).toBeNull();
  });

  test("割増率・14日・1か月・始まりの日を、計算のコードに直接書かない", () => {
    const premium = codeOf(read("src/utils/premiumRates.ts"));
    for (const literal of ["25%", "35%", "50%", "22時", "5時", "8時間", "40時間", "60時間"]) expect(premium).not.toContain(literal);
    const leave = codeOf(read("src/utils/leaveExemption.ts"));
    expect(leave).not.toContain("'2022-10-01'");
    expect(leave).not.toMatch(/=\s*14;/);
    expect(leave).not.toContain("add(1, 'month')");
  });

  test("扶養親族等の数の数え方と、それを出す画面は、所得の線・年齢を直接書かない（国税庁の資料から作った数を使う）", () => {
    for (const file of [
      "src/utils/withholdingDependents.ts", "src/features/settings/staff/DependentsCheck.tsx", "src/features/nencho/DependentsYearCheck.tsx",
    ]) {
      const code = codeOf(read(file));
      expect(code).not.toMatch(/\d+万円/);
      expect(code).not.toMatch(/\d+歳/);
      // 6けた以上の数（950000 など。色の #166534 は数えない）
      expect(code).not.toMatch(/(^|[^\w$#])\d{6,}/);
    }
  });

  test("勤怠のまとめの画面と給与明細は、法律の率・限度時間を直接書かない", () => {
    const board = codeOf(read("src/features/attendance/manager/SummaryBoard.tsx"));
    expect(board).not.toMatch(/\?\?\s*(25|35|50)\b/);
    const stub = codeOf(read("src/features/payroll/PayStubModal.tsx"));
    for (const literal of ["猶予で25%", "月45h超", "年360h超"]) expect(stub).not.toContain(literal);
  });
});
