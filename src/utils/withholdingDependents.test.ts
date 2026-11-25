/**
 * 扶養控除等申告書の内容から数える「扶養親族等の数」（withholdingDependents.ts）のテスト（見直しの P9）
 * 実行方法: bun test
 *
 * 期待値は、国税庁「令和9年分 源泉徴収税額表」の「給与所得の源泉徴収税額の求め方」（20・21ページ）の
 * 〔扶養親族等の数の算定方法〕の図《1 配偶者に係る扶養親族等の数の算定方法（具体例）》《2 配偶者以外の扶養親族等の数の算定方法（具体例）》から。
 * 所得の見積額の線は、図と同じ線（手引から作った constants/nencho の値）を使う。
 */
import { describe, expect, test } from "bun:test";
import { GENSEN_2026, NENCHO_2026, getProvisionalSlipMaster } from "../constants/nencho";
import { WITHHOLDING_DEPENDENT_RULES } from "../constants/tax/withholdingDependentRules";
import { classifyDependentByLimits, emptyDeclaration, type DeclaredDependent, type DeclaredPerson, type NenchoDeclaration } from "./nenchoDeclaration";
import {
  checkYearDependents, compareTargetOf, countWithholdingDependents, dependentLineOn, dependentsRuleText, lineChangeDate, manYen, monthDayLabel,
  monthRanges, parseSavedDeclarations, suggestDependents, usedSummary, withholdingLinesOf,
} from "./withholdingDependents";

const Y = 2027;
const L = withholdingLinesOf(Y)!.withoutAdjustment;
/** その年の12月31日に age 歳の人の生年月日 */
const bornAge = (age: number, year = Y) => `${year - age}-06-15`;
const spouseOf = (income: number, o: Partial<DeclaredPerson> = {}): DeclaredPerson => ({
  name: "配偶者", birthday: bornAge(40), totalIncome: income, disability: "none", livingTogether: true, ...o,
});
const dep = (name: string, age: number, o: Partial<DeclaredDependent> = {}): DeclaredDependent => ({
  name, relation: "子", birthday: bornAge(age), totalIncome: 0, disability: "none", livingTogether: true, linealAscendant: false, ...o,
});
const declOf = (o: { spouse?: DeclaredPerson | null; dependents?: DeclaredDependent[]; self?: Partial<NenchoDeclaration["self"]> }): NenchoDeclaration => {
  const base = emptyDeclaration();
  return { ...base, spouse: o.spouse ?? null, dependents: o.dependents ?? [], self: { ...base.self, ...(o.self ?? {}) } };
};
const countOf = (decl: NenchoDeclaration, selfTotalIncome: number | null = 5_000_000, column: "kou" | "otsu" = "kou") =>
  countWithholdingDependents(decl, Y, { column, payDate: `${Y}-06-25`, selfTotalIncome })!.total;
/** 同居特別障害者（特別障害者で同居） */
const togetherSpecial = { disability: "special" as const, livingTogether: true };
const disabled = { disability: "general" as const };

describe("国税庁の資料から作った線と、Q の数え方の線・年齢", () => {
  test("令和8年分：求め方の PDF（改正前）の線は、法定調書の手引から作った「11月30日以前」の線と同じ", () => {
    const r = WITHHOLDING_DEPENDENT_RULES[2026];
    const w = GENSEN_2026.withoutAdjustment;
    expect(r.recipientIncomeLimit).toBe(w.recipientIncomeLimit);
    expect(r.spouseIncomeLimit).toBe(w.spouseIncomeLimit);
    expect(r.dependentIncomeLimit).toBe(w.earlierIncomeLimit);
    expect(r.specificRelative.over).toBe(w.earlierIncomeLimit);
    expect(r.specificRelative.sourceLimit).toBe(w.specificRelativeLimit);
    // 特定親族の上の線は、年末調整のしかたの特定親族特別控除額の表の最後の行と同じ
    expect(r.specificRelative.upTo).toBe(NENCHO_2026.specificRelative[NENCHO_2026.specificRelative.length - 1].upTo);
  });

  test("令和9年分：求め方の PDF の線は、令和8年分の手引から作った仮の書き方（1年を通して新しい線）と同じ", () => {
    const r = WITHHOLDING_DEPENDENT_RULES[2027];
    const w = getProvisionalSlipMaster(2027)!.withoutAdjustment;
    expect(r.recipientIncomeLimit).toBe(w.recipientIncomeLimit);
    expect(r.spouseIncomeLimit).toBe(w.spouseIncomeLimit);
    expect(r.dependentIncomeLimit).toBe(w.currentIncomeLimit);
    expect(r.dependentIncomeLimit).toBe(w.earlierIncomeLimit);
    expect(r.specificRelative.sourceLimit).toBe(w.specificRelativeLimit);
    // 令和8年分の12月1日以後の線と同じ
    expect(r.dependentIncomeLimit).toBe(GENSEN_2026.withoutAdjustment.currentIncomeLimit);
  });

  test("年齢の境目（その年の12月31日の年齢）は、求め方の PDF の生年月日と同じ", () => {
    for (const year of [2026, 2027]) {
      const r = WITHHOLDING_DEPENDENT_RULES[year];
      const limits = { income: r.dependentIncomeLimit, specificRelative: r.specificRelative.sourceLimit };
      const kindOn = (birthday: string, o: Partial<DeclaredDependent> = {}) => classifyDependentByLimits({ ...dep("", 0), birthday, ...o }, year, limits);
      const dayAfter = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
      const dayBefore = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
      // 控除対象扶養親族（16歳以上）：この日以前に生まれた人
      expect(kindOn(r.deductibleBornOnOrBefore)).not.toBe("young");
      expect(kindOn(dayAfter(r.deductibleBornOnOrBefore))).toBe("young");
      // 障害者を数える扶養親族に含む「○歳未満」は、控除対象扶養親族の「○歳以上」と同じ境目
      expect(r.familyIncludesUnder).toBe(r.deductibleAgeFrom);
      // 特定親族（19歳以上23歳未満）：所得の見積額が線を超え、源泉控除対象親族の線以下の人
      const sr = r.specificRelative;
      const income = { totalIncome: sr.sourceLimit };
      expect(kindOn(sr.bornFrom, income)).toBe("specificRelative");
      expect(kindOn(sr.bornTo, income)).toBe("specificRelative");
      expect(kindOn(dayBefore(sr.bornFrom), income)).toBe("none");
      expect(kindOn(dayAfter(sr.bornTo), income)).toBe("none");
      expect(kindOn(sr.bornFrom, { totalIncome: sr.sourceLimit + 1 })).toBe("none");
    }
  });

  test("令和8年分は、11月30日以前に支払う給与は前の線、12月1日以後は新しい線。令和9年分は1年を通して同じ線", () => {
    expect(dependentLineOn(GENSEN_2026, "2026-11-30")).toBe(GENSEN_2026.withoutAdjustment.earlierIncomeLimit);
    expect(dependentLineOn(GENSEN_2026, "2026-12-01")).toBe(GENSEN_2026.withoutAdjustment.currentIncomeLimit);
    const p = getProvisionalSlipMaster(2027)!;
    expect(dependentLineOn(p, "2027-01-25")).toBe(dependentLineOn(p, "2027-12-25"));
    expect(withholdingLinesOf(2025)).toBeNull();
    expect(countWithholdingDependents(emptyDeclaration(), 2025, { column: "kou", payDate: "2025-06-25" })).toBeNull();
  });
});

describe("《1 配偶者に係る扶養親族等の数の算定方法（具体例）》", () => {
  const over = L.spouseIncomeLimit + 1; // 95万円超
  const source = L.spouseIncomeLimit; // 95万円以下
  const middle = L.currentIncomeLimit + 1; // 62万円超95万円以下
  const same = L.currentIncomeLimit; // 62万円以下（同一生計配偶者）

  test("給与所得者の合計所得金額が900万円以下", () => {
    expect(countOf(declOf({ spouse: spouseOf(over) }))).toBe(0);
    expect(countOf(declOf({ spouse: spouseOf(over, disabled) }))).toBe(0);
    expect(countOf(declOf({ spouse: spouseOf(source) }))).toBe(1);
    expect(countOf(declOf({ spouse: spouseOf(middle, disabled) }))).toBe(1);
    expect(countOf(declOf({ spouse: spouseOf(same, disabled) }))).toBe(2);
    expect(countOf(declOf({ spouse: spouseOf(same, togetherSpecial) }))).toBe(3);
    // 900万円ちょうどは「以下」
    expect(countOf(declOf({ spouse: spouseOf(source) }), L.recipientIncomeLimit)).toBe(1);
  });

  test("給与所得者の合計所得金額が900万円超（配偶者は源泉控除対象配偶者にならず、同一生計配偶者の障害者だけを数える）", () => {
    const rich = L.recipientIncomeLimit + 1;
    expect(countOf(declOf({ spouse: spouseOf(same) }), rich)).toBe(0);
    expect(countOf(declOf({ spouse: spouseOf(middle) }), rich)).toBe(0);
    expect(countOf(declOf({ spouse: spouseOf(middle, disabled) }), rich)).toBe(0);
    expect(countOf(declOf({ spouse: spouseOf(same, disabled) }), rich)).toBe(1);
    expect(countOf(declOf({ spouse: spouseOf(same, togetherSpecial) }), rich)).toBe(2);
  });

  test("本人の合計所得金額がわからないときは、900万円以下として数え、そのことを知らせる", () => {
    const c = countWithholdingDependents(declOf({ spouse: spouseOf(source) }), Y, { column: "kou", payDate: `${Y}-06-25`, selfTotalIncome: null })!;
    expect(c.total).toBe(1);
    expect(c.notes.join("")).toContain(`${manYen(L.recipientIncomeLimit)}以下として`);
    const rich = countWithholdingDependents(declOf({ spouse: spouseOf(source) }), Y, { column: "kou", payDate: `${Y}-06-25`, selfTotalIncome: L.recipientIncomeLimit + 1 })!;
    expect(rich.notes.join("")).toContain("源泉控除対象配偶者になりません");
  });
});

describe("《2 配偶者以外の扶養親族等の数の算定方法（具体例）》", () => {
  const specificIncome = L.currentIncomeLimit + 1; // 62万円超100万円以下（特定親族で、源泉控除対象親族）
  const young = (o: Partial<DeclaredDependent> = {}) => dep("年少", 10, o);
  const source = (o: Partial<DeclaredDependent> = {}) => dep("源泉", 17, o);

  test("0人", () => {
    expect(countOf(declOf({}))).toBe(0);
    expect(countOf(declOf({ dependents: [young()] }))).toBe(0);
  });

  test("1人", () => {
    expect(countOf(declOf({ dependents: [source()] }))).toBe(1);
    // 特定親族（62万円超100万円以下）は源泉控除対象親族。扶養親族ではないので、障害者でも足さない
    expect(countOf(declOf({ dependents: [dep("特定", 20, { totalIncome: specificIncome, ...disabled })] }))).toBe(1);
    expect(countOf(declOf({ dependents: [young()], self: { singleParent: true } }))).toBe(1);
    expect(countOf(declOf({ self: { disability: "general" } }))).toBe(1);
    expect(countOf(declOf({ self: { workingStudent: true } }))).toBe(1);
    expect(countOf(declOf({ dependents: [young(disabled)] }))).toBe(1);
    expect(countOf(declOf({ dependents: [source(), young()] }))).toBe(1);
  });

  test("2人", () => {
    expect(countOf(declOf({ dependents: [source()], self: { singleParent: true } }))).toBe(2);
    expect(countOf(declOf({ dependents: [source(disabled)] }))).toBe(2);
    expect(countOf(declOf({ dependents: [source(), young(disabled)] }))).toBe(2);
    expect(countOf(declOf({ dependents: [young(togetherSpecial)] }))).toBe(2);
  });

  test("3人", () => {
    expect(countOf(declOf({ dependents: [source(togetherSpecial)] }))).toBe(3);
    expect(countOf(declOf({ dependents: [source(), source(disabled)] }))).toBe(3);
    expect(countOf(declOf({ dependents: [source(), young(togetherSpecial)] }))).toBe(3);
  });

  test("4人", () => {
    expect(countOf(declOf({ dependents: [source(), source(togetherSpecial)] }))).toBe(4);
    expect(countOf(declOf({ dependents: [dep("特定", 20, { totalIncome: specificIncome, ...togetherSpecial }), source(togetherSpecial)] }))).toBe(4);
  });

  test("寡婦・勤労学生・特別障害者（同居でない）も1つずつ。所得の見積額が線を超える扶養親族・特定親族の上の人は数えない", () => {
    expect(countOf(declOf({ self: { disability: "special", widow: true, workingStudent: true } }))).toBe(3);
    expect(countOf(declOf({ dependents: [source({ disability: "special", livingTogether: false })] }))).toBe(2);
    const c = countWithholdingDependents(declOf({
      dependents: [dep("所得が多い", 30, { totalIncome: L.currentIncomeLimit + 1 }), dep("特定の上", 20, { totalIncome: L.specificRelativeLimit + 1 }), young()],
    }), Y, { column: "kou", payDate: `${Y}-06-25` })!;
    expect(c.total).toBe(0);
    expect(c.details.join("")).toContain(
      `数えない人：所得が多い（所得の見積額が${manYen(L.currentIncomeLimit)}を超える）・特定の上（所得の見積額が${manYen(L.specificRelativeLimit)}を超える）・年少（16歳未満）`);
  });
});

describe("乙欄・生年月日がない人・内訳", () => {
  test("乙欄（従たる給与についての扶養控除等申告書）は、源泉控除対象配偶者と源泉控除対象親族だけ（障害者などは足さない）", () => {
    const decl = declOf({
      spouse: spouseOf(L.currentIncomeLimit, togetherSpecial),
      dependents: [dep("源泉", 17, disabled), dep("年少", 10, disabled)],
      self: { disability: "general", singleParent: true },
    });
    expect(countOf(decl)).toBe(1 + 1 + 2 + 2 + 1 + 1);
    expect(countOf(decl, 5_000_000, "otsu")).toBe(2);
    expect(countWithholdingDependents(decl, Y, { column: "hei", payDate: `${Y}-06-25` })).toBeNull();
  });

  test("生年月日がない扶養親族は数えず、知らせる", () => {
    const c = countWithholdingDependents(declOf({ dependents: [dep("名なし", 17, { birthday: "" })] }), Y, { column: "kou", payDate: `${Y}-06-25` })!;
    expect(c.total).toBe(0);
    expect(c.notes.join("")).toContain("生年月日が入っていない人（名なし）");
  });

  test("内訳：配偶者・源泉控除対象親族・本人・家族の障害者", () => {
    const c = countWithholdingDependents(declOf({
      spouse: spouseOf(L.currentIncomeLimit, { name: "花子", ...togetherSpecial }),
      dependents: [dep("太郎", 20), dep("次郎", 21, { totalIncome: L.currentIncomeLimit + 1 }), dep("三郎", 8)],
      self: { workingStudent: true },
    }), Y, { column: "kou", payDate: `${Y}-06-25`, selfTotalIncome: 3_000_000 })!;
    expect(c).toMatchObject({ total: 6, spouse: 1, relatives: 2, self: 1, family: 2 });
    expect(c.details).toEqual([
      "源泉控除対象配偶者 1人：花子",
      "源泉控除対象親族 2人：太郎（特定扶養親族）・次郎（特定親族）",
      "本人 1人：勤労学生",
      "家族の障害者 2人：花子（同居特別障害者。障害者と同居特別障害者で2つ）",
      "数えない人：三郎（16歳未満）",
    ]);
  });
});

describe("令和8年分：11月30日以前と12月1日以後で線が変わる", () => {
  const w = GENSEN_2026.withoutAdjustment;
  const between = w.earlierIncomeLimit + 1; // 58万円超62万円以下
  const decl = declOf({ spouse: spouseOf(between, disabled), dependents: [dep("子", 17, { totalIncome: between, birthday: bornAge(17, 2026) })] });
  const on = (payDate: string) => countWithholdingDependents(decl, 2026, { column: "kou", payDate, selfTotalIncome: 5_000_000 })!.total;

  test("11月30日以前に支払う給与：子は扶養親族でなく、配偶者は源泉控除対象配偶者だが同一生計配偶者ではない", () => {
    expect(on("2026-11-25")).toBe(1);
  });

  test("12月1日以後に支払う給与：子は控除対象扶養親族、配偶者は同一生計配偶者の障害者", () => {
    expect(on("2026-12-10")).toBe(3);
  });

  test("線が変わる日は12月1日（令和9年分は1年を通して同じ線）。従業員の画面は、変わる前なら、変わった後の人数も出す", () => {
    expect(lineChangeDate(GENSEN_2026, 2026)).toBe("2026-12-01");
    expect(monthDayLabel("2026-12-01")).toBe("12月1日");
    expect(lineChangeDate(getProvisionalSlipMaster(2027)!, 2027)).toBeNull();
    const saved = [{ year: 2026, declaration: decl, selfTotalIncome: 5_000_000 }];
    expect(suggestDependents(saved, 2026, "kou", "2026-11-25")).toMatchObject({ total: 1, later: { from: "2026-12-01", total: 3 } });
    expect(suggestDependents(saved, 2026, "kou", "2026-12-01")).toMatchObject({ total: 3, later: null });
    // 線が変わっても人数が同じなら出さない
    expect(suggestDependents([{ year: 2026, declaration: declOf({}), selfTotalIncome: null }], 2026, "kou", "2026-11-25")?.later).toBeNull();
  });

  test("年末調整の画面の照らし合わせ：支払った日の線で数え、11月30日以前の人数も出す", () => {
    const used = [
      ...Array.from({ length: 11 }, (_, i) => ({ month: i + 1, payDate: `2026-${String(i + 1).padStart(2, "0")}-25`, used: 1 })),
      { month: 12, payDate: "2026-12-25", used: 1 },
    ];
    const check = checkYearDependents(decl, 2026, "kou", used, 5_000_000)!;
    expect(check.latest.total).toBe(3);
    expect(check.earlier?.total).toBe(1);
    expect(check.different).toEqual([{ month: 12, payDate: "2026-12-25", used: 1, counted: 3 }]);
    expect(usedSummary(check.used)).toBe("1〜12月 1人");
    // 違う月がなければ空。11月30日以前と人数が同じなら earlier は null
    expect(checkYearDependents(declOf({}), 2026, "kou", used.map((u) => ({ ...u, used: 0 })), null)).toMatchObject({ earlier: null, different: [] });
  });

  test("説明の文：令和8年11月30日以前に支払う給与は前の線と、12月1日からの線", () => {
    const join = (r: ReturnType<typeof dependentsRuleText>) => [r!.intro, ...r!.items, r!.note ?? ""].join("\n");
    const text = join(dependentsRuleText(2026, "kou", "2026-11-25"));
    expect(text).toContain(`所得の見積額が${manYen(w.earlierIncomeLimit)}以下（12月1日以後に支払う給与からは${manYen(w.currentIncomeLimit)}）の扶養親族`);
    expect(text).toContain(`本人の所得の見積額が${manYen(w.recipientIncomeLimit)}以下のときの、所得の見積額が${manYen(w.spouseIncomeLimit)}以下の配偶者`);
    expect(text).toContain(`${WITHHOLDING_DEPENDENT_RULES[2026].specificRelative.ageFrom}歳以上${WITHHOLDING_DEPENDENT_RULES[2026].specificRelative.ageUntil}歳未満`);
    expect(text).toContain("同居特別障害者なら、もう1人を足す");
    expect(text).toContain(`所得の見積額がその線を超え${manYen(w.specificRelativeLimit)}以下の親族（特定親族）`);
    expect(text).toContain(`所得の見積額が${manYen(w.earlierIncomeLimit)}以下（12月1日以後に支払う給与からは${manYen(w.currentIncomeLimit)}）の配偶者（同一生計配偶者）`);
    const december = join(dependentsRuleText(2026, "kou", "2026-12-10"));
    expect(december).toContain(`所得の見積額が${manYen(w.currentIncomeLimit)}以下の扶養親族`);
    expect(december).not.toContain("以後に支払う給与からは");
    const otsu = join(dependentsRuleText(2026, "otsu", "2026-12-10"));
    expect(otsu).toContain("障害者などの足し算はしません");
    expect(otsu).not.toContain("勤労学生");
    expect(dependentsRuleText(2026, "hei", "2026-12-10")).toBeNull();
    expect(dependentsRuleText(2025, "kou", "2025-12-10")).toBeNull();
  });
});

describe("従業員の画面：比べる年と、保存した申告書", () => {
  test("比べる年は、きょうか、扶養人数のいちばん新しい行の始まりの遅いほう", () => {
    expect(compareTargetOf("", "2026-11-25")).toEqual({ year: 2026, payDate: "2026-11-25" });
    expect(compareTargetOf("2025-04", "2026-11-25")).toEqual({ year: 2026, payDate: "2026-11-25" });
    expect(compareTargetOf("2026-12", "2026-11-25")).toEqual({ year: 2026, payDate: "2026-12-01" });
    expect(compareTargetOf("2027-01", "2026-12-10")).toEqual({ year: 2027, payDate: "2027-01-01" });
  });

  test("その年分の申告書がなければ、前の年分の申告書から、年齢をその年で数え直した見込み", () => {
    // 令和8年に15歳（年少）の子は、令和9年には16歳で控除対象扶養親族
    const decl2026 = declOf({ dependents: [dep("子", 15, { birthday: bornAge(15, 2026) })] });
    const saved = parseSavedDeclarations([
      { year: 2026, declaration: JSON.stringify(decl2026), result: JSON.stringify({ totalIncome: 4_000_000 }) },
      { year: 2025, declaration: "", result: null },
    ]);
    expect(saved).toHaveLength(1);
    expect(saved[0].selfTotalIncome).toBe(4_000_000);
    expect(suggestDependents(saved, 2026, "kou", "2026-11-25")).toMatchObject({ year: 2026, sourceYear: 2026, total: 0 });
    expect(suggestDependents(saved, 2027, "kou", "2027-01-01")).toMatchObject({ year: 2027, sourceYear: 2026, total: 1 });
    // 2年前の申告書は使わない
    expect(suggestDependents(saved, 2028, "kou", "2028-01-01")).toBeNull();
    // こわれた計算結果は、合計所得金額がわからないとして読む
    expect(parseSavedDeclarations([{ year: 2026, declaration: "{}", result: "{" }])[0].selfTotalIncome).toBeNull();
  });

  test("月の並びの書き方", () => {
    expect(monthRanges([1, 2, 3, 5, 7, 8])).toBe("1〜3月・5月・7〜8月");
    expect(usedSummary([{ month: 12, payDate: "", used: 3 }, ...[1, 2, 3].map((m) => ({ month: m, payDate: "", used: 2 }))])).toBe("1〜3月 2人・12月 3人");
  });
});
