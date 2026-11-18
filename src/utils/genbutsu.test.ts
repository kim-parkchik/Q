import { describe, expect, test } from "bun:test";
import { GENBUTSU_PERIODS } from "../constants/genbutsu";
import {
  empInKindOf, emptyInKindEntry, genbutsuPeriodOf, housingMonthValue, housingTaxOf, inKindEntryWarnings, inKindEstimateOf, inKindMonthOf, inKindOfMonth,
  mealAmount, mealTaxOf, parseInKind, parseInKindRecord, rentEquivalentOf, stringifyInKind, validateInKindEntry, type InKindEntry,
} from "./genbutsu";

const housing = (o: Partial<InKindEntry>): InKindEntry => ({ ...emptyInKindEntry("housing"), name: "社宅", start: "2019-01-01", ...o });
const meal = (o: Partial<InKindEntry>): InKindEntry => ({ ...emptyInKindEntry("meal"), name: "寮の食事", start: "2019-01-01", ...o });

describe("公式の表（src/constants/genbutsu.ts）", () => {
  test("平成31年4月から令和8年10月まで9つの期間。令和8年10月から住宅は総面積1平方メートルにつき", () => {
    expect(GENBUTSU_PERIODS.map((p) => `${p.from}:${p.housingUnit}`)).toEqual([
      "2019-04-01:tatami", "2020-04-01:tatami", "2021-04-01:tatami", "2022-04-01:tatami", "2023-04-01:tatami",
      "2024-04-01:tatami", "2025-04-01:tatami", "2026-04-01:tatami", "2026-10-01:sqm",
    ]);
    for (const p of GENBUTSU_PERIODS) expect(Object.keys(p.values)).toHaveLength(47);
  });
  test("その月分に使う表：2020年3月分は平成31年4月から、令和8年9月分は畳、10月分は平方メートル。平成31年3月分より前はない", () => {
    expect(genbutsuPeriodOf("2020-03")?.from).toBe("2019-04-01");
    expect(genbutsuPeriodOf("2020-04")?.from).toBe("2020-04-01");
    expect(genbutsuPeriodOf("2026-09")?.housingUnit).toBe("tatami");
    expect(genbutsuPeriodOf("2026-10")?.housingUnit).toBe("sqm");
    expect(genbutsuPeriodOf("2019-03")).toBeNull();
  });
});

describe("一覧表の Q&A の計算例（東京に所在する事業所）", () => {
  test("令和8年度：16畳 → 45,280円（9月分まで）、総面積40平方メートル → 53,200円（10月分から）。北海道は20畳 22,200円・51平方メートル 27,030円（Q6）", () => {
    const tatami = genbutsuPeriodOf("2026-09")!;
    const sqm = genbutsuPeriodOf("2026-10")!;
    expect(housingMonthValue({ tatami: 16, roomSqm: 0, area: 0, sharers: 1 }, tatami, tatami.values.東京.housing)).toBe(45280);
    expect(housingMonthValue({ tatami: 0, roomSqm: 0, area: 40, sharers: 1 }, sqm, sqm.values.東京.housing)).toBe(53200);
    expect(housingMonthValue({ tatami: 20, roomSqm: 0, area: 0, sharers: 1 }, tatami, tatami.values.北海道.housing)).toBe(22200);
    expect(housingMonthValue({ tatami: 0, roomSqm: 0, area: 51, sharers: 1 }, sqm, sqm.values.北海道.housing)).toBe(27030);
  });
  test("居住室部分16畳（26.4平方メートル）は 26.4 ÷ 1.65 × 2,830円 ＝ 45,280円、30平方メートルは 51,454円（Q9。令和2年度は 47,090円）", () => {
    const r8 = genbutsuPeriodOf("2026-04")!;
    expect(housingMonthValue({ tatami: 0, roomSqm: 26.4, area: 0, sharers: 1 }, r8, r8.values.東京.housing)).toBe(45280);
    const r7 = genbutsuPeriodOf("2025-04")!;
    expect(housingMonthValue({ tatami: 0, roomSqm: 30, area: 0, sharers: 1 }, r7, r7.values.東京.housing)).toBe(51454);
    const r2 = genbutsuPeriodOf("2020-04")!;
    expect(housingMonthValue({ tatami: 0, roomSqm: 30, area: 0, sharers: 1 }, r2, r2.values.東京.housing)).toBe(47090);
  });
  test("月の途中から入居：4月11日から（20日 ÷ 30日）。令和8年度16畳 30,186円・令和7年度6畳 11,320円・令和2年度6畳 10,360円（Q7）", () => {
    const april = (year: number, tatami: number) =>
      inKindOfMonth([housing({ start: `${year}-04-11`, tatami })], `${year}-04`, "東京").amount;
    expect(april(2026, 16)).toBe(30186);
    expect(april(2025, 6)).toBe(11320);
    expect(april(2020, 6)).toBe(10360);
    expect(april(2019, 6)).toBe(10360);
    // 総面積40平方メートル・30日の月の11日から（令和8年11月）：53,200円 × 20日 ÷ 30日 ＝ 35,466円
    expect(inKindOfMonth([housing({ start: "2026-11-11", area: 40 })], "2026-11", "東京").amount).toBe(35466);
  });
  test("食事の本人負担：3分の2未満なら価額から引き、3分の2以上なら0円（Q10。令和8年度 25,500円、令和7年度 24,300円、令和2年度 21,300円、平成31年度 21,000円）", () => {
    const tokyo = (ym: string, selfPay: number) => inKindOfMonth([meal({ selfPay })], ym, "東京").amount;
    expect([tokyo("2026-04", 10000), tokyo("2026-04", 17000), tokyo("2026-04", 16999)]).toEqual([15500, 0, 8501]);
    expect([tokyo("2025-04", 10000), tokyo("2025-04", 16200)]).toEqual([14300, 0]);
    expect([tokyo("2020-04", 10000), tokyo("2020-04", 14200)]).toEqual([11300, 0]);
    expect([tokyo("2019-04", 10000), tokyo("2019-04", 14000)]).toEqual([11000, 0]);
    expect([mealAmount(25500, 17000), mealAmount(25500, 0)]).toEqual([0, 25500]);
  });
});

describe("1か月分の現物の額", () => {
  test("都道府県は拠点のもの（「東京都」も読める）。わからない・表より前の月は、価額を出せないことを知らせる", () => {
    const e = [housing({ tatami: 6 })];
    expect(inKindOfMonth(e, "2025-05", "東京都").amount).toBe(16980);
    expect(inKindOfMonth(e, "2025-05", "北海道").amount).toBe(6660);
    expect(inKindOfMonth(e, "2025-05", "").problems).toEqual(["社宅：勤務地（拠点）の都道府県がわからないので、住宅の価額を出せません（会社設定で拠点の都道府県を登録してください）"]);
    expect(inKindOfMonth(e, "2019-03", "東京").problems[0]).toContain("2019年3月分の現物給与の価額の表がありません");
  });
  test("住宅：家賃を引く。令和8年10月分から総面積で、同じ住宅に住む被保険者の数で割る。広さがない月は知らせる", () => {
    const e = housing({ tatami: 16, area: 40, sharers: 1, selfPay: 20000 });
    expect(inKindOfMonth([e], "2026-09", "東京").amount).toBe(25280);
    expect(inKindOfMonth([e], "2026-10", "東京").amount).toBe(33200);
    expect(inKindOfMonth([{ ...e, sharers: 2 }], "2026-10", "東京").amount).toBe(6600);
    expect(inKindOfMonth([housing({ tatami: 16 })], "2026-10", "東京").problems[0]).toContain("総面積");
    expect(inKindOfMonth([housing({ area: 40 })], "2026-09", "東京").problems[0]).toContain("畳数");
    expect(inKindOfMonth([housing({ tatami: 16, area: 40, selfPay: 60000 })], "2026-10", "東京").amount).toBe(0);
  });
  test("食事（毎日3食）：月の途中からは1日の額 × 日数。本人が払う額（1か月）は日数で日割りして3分の2を比べる", () => {
    const m = inKindOfMonth([meal({ start: "2026-04-21", selfPay: 9000 })], "2026-04", "東京");
    // 850円 × 10日 ＝ 8,500円、本人 9,000円 × 10 ÷ 30 ＝ 3,000円（3分の2の 5,666円より少ない）→ 5,500円
    expect(m.amount).toBe(5500);
    expect(m.lines[0].detail).toBe("1日の食事の額 850円 × 10日 ＝ 8,500円（東京の令和8年4月からの価額） − 本人が払う額 3,000円");
  });
  test("食事（出勤した日ごと）：給与の計算期間に出勤した日の数 × 選んだ食事の額。本人が払う1日の額で3分の2を比べる", () => {
    const days = Array.from({ length: 20 }, (_, i) => `2026-05-${String(i + 1).padStart(2, "0")}`);
    const lunch = (selfPay: number) => inKindOfMonth([meal({ mealPattern: "workday", lunch: true, selfPay })], "2026-05", "東京", days);
    expect(lunch(0).amount).toBe(6000);
    expect(lunch(150).amount).toBe(3000);
    expect(lunch(200).amount).toBe(0);
    expect(lunch(0).lines[0].detail).toBe("昼食 300円 × 出勤した日 20日 ＝ 6,000円（東京の令和8年4月からの価額）");
    const all = inKindOfMonth([meal({ mealPattern: "workday", breakfast: true, lunch: true, dinner: true })], "2026-05", "東京", days.slice(0, 2));
    expect(all.amount).toBe(1700);
    // 期間の外の日は数えない
    expect(inKindOfMonth([meal({ mealPattern: "workday", lunch: true, start: "2026-05-11" })], "2026-05", "東京", days).amount).toBe(3000);
    expect(lunch(150).fixed.daily).toBe(150);
  });
  test("その他（自社製品など）：時価から本人が払う額を引く。所得税がかからない印、雇用保険は入れる。食事・住宅は雇用保険に入れず、所得税は入れた額", () => {
    const m = inKindOfMonth([
      { ...emptyInKindEntry("other"), name: "自社製品", start: "2026-01-01", value: 10000, selfPay: 2000 },
      { ...emptyInKindEntry("other"), name: "制服", start: "2026-01-01", value: 3000, taxFree: true },
      housing({ tatami: 6, taxable: 5000 }),
    ], "2026-05", "東京");
    expect(m.lines.map((l) => [l.name, l.amount, l.taxable, l.emp])).toEqual([
      ["自社製品", 8000, 8000, 8000], ["制服", 3000, 0, 3000], ["社宅", 16980, 5000, 0],
    ]);
    expect([m.amount, m.taxable, m.emp]).toEqual([27980, 13000, 11000]);
  });
  test("月変のための固定的な額：月を通して出している行の1か月分。月の途中から・までの行がある月は比べない（変わった後の額が1か月分そろった月を変動月にする）", () => {
    const e = [housing({ start: "2025-04-11", end: "2025-08-20", tatami: 6, selfPay: 5000 })];
    expect(inKindOfMonth(e, "2025-03", "東京")).toMatchObject({ settled: true, fixed: { monthly: 0 } });
    expect(inKindOfMonth(e, "2025-04", "東京")).toMatchObject({ settled: false, amount: 7987 });
    expect(inKindOfMonth(e, "2025-05", "東京")).toMatchObject({ settled: true, fixed: { monthly: 11980 }, amount: 11980 });
    expect(inKindOfMonth(e, "2025-08", "東京").settled).toBe(false);
    expect(inKindOfMonth(e, "2025-09", "東京")).toMatchObject({ settled: true, fixed: { monthly: 0 }, amount: 0 });
    // 告示の改正（令和8年10月から総面積）も、価額が変わる
    const e2 = [housing({ start: "2025-01-01", tatami: 16, area: 40 })];
    expect([inKindOfMonth(e2, "2026-09", "東京").fixed.monthly, inKindOfMonth(e2, "2026-10", "東京").fixed.monthly]).toEqual([45280, 53200]);
  });
  test("説明の「いつからの価額」は、前の表と同じ額のあいだはさかのぼる（令和8年11月分の食事は令和8年4月から、住宅（畳）は令和3年4月から）", () => {
    expect(inKindOfMonth([meal({})], "2026-11", "東京").lines[0].detail).toContain("東京の令和8年4月からの価額");
    expect(inKindOfMonth([housing({ area: 40 })], "2026-11", "東京").lines[0].detail).toContain("東京の令和8年10月からの価額");
    expect(inKindOfMonth([housing({ tatami: 6 })], "2025-05", "東京").lines[0].detail).toContain("東京の令和3年4月からの価額");
    expect(inKindOfMonth([housing({ tatami: 6 })], "2020-05", "東京").lines[0].detail).toContain("東京の平成31年4月からの価額");
  });
  test("その月分は、給与の計算期間の終わりの日がある月（締め日にかかわらず1か月分）", () => {
    expect(inKindMonthOf({ start: "2026-03-16", end: "2026-04-15" }, 2026, 4)).toBe("2026-04");
    expect(inKindMonthOf({ start: "2026-04-01", end: "2026-04-30" }, 2026, 5)).toBe("2026-04");
    expect(inKindMonthOf(null, 2026, 5)).toBe("2026-05");
  });
});

describe("所得税（国税庁の決まり。タックスアンサー No.2594・2597・2600）と雇用保険（手引き 第2編）", () => {
  test("食事：本人が半分以上を払い、消費税を除いた会社の負担が月7,500円以下なら0円。No.2594 の例（13,000円・本人 6,000円 → 7,000円が課税）", () => {
    expect(mealTaxOf(13_000, 6_000, 8)).toMatchObject({ taxable: 7_000, half: false, ok: false });
    // 13,000円・本人 6,500円：6,500円 ÷ 1.08 ＝ 6,018円 → 6,010円（10円未満切り捨て）≦ 7,500円
    expect(mealTaxOf(13_000, 6_500, 8)).toMatchObject({ taxable: 0, excl: 6_010, ok: true });
    // 20,000円・本人 10,000円：10,000円 ÷ 1.08 ＝ 9,259円 → 9,250円 ＞ 7,500円 → 10,000円が課税。8,100円 ÷ 1.08 ＝ 7,500円ちょうどは0円
    expect(mealTaxOf(20_000, 10_000, 8)).toMatchObject({ taxable: 10_000, excl: 9_250 });
    expect(mealTaxOf(16_200, 8_100, 8)).toMatchObject({ taxable: 0, excl: 7_500 });
    expect(mealTaxOf(16_500, 8_250, 10).excl).toBe(7_500);
  });
  test("社宅（使用人）：賃貸料相当額 ＝ 建物 × 0.2％ ＋ 12円 × 総床面積 ÷ 3.3㎡ ＋ 敷地 × 0.22％。No.2597 の例（10,000円で本人 3,000円 → 7,000円、6,000円 → 0円）", () => {
    // 1,000,000円 × 0.2％ ＝ 2,000円、12円 × 40㎡ ÷ 3.3㎡ ＝ 145.45…円、2,000,000円 × 0.22％ ＝ 4,400円 → 6,545円（1円未満切り捨て）
    const e = { bldgBase: 1_000_000, landBase: 2_000_000, floorArea: 40, longLife: false, leasedRent: 0 };
    expect(rentEquivalentOf(e, false).value).toBe(6_545);
    expect(rentEquivalentOf({ ...e, floorArea: 33 }, false).value).toBe(6_520);
    expect(housingTaxOf(10_000, 3_000, false)).toBe(7_000);
    expect(housingTaxOf(10_000, 6_000, false)).toBe(0);
    expect(housingTaxOf(10_000, 4_999, false)).toBe(5_001);
  });
  test("社宅（役員）：小規模な住宅は同じ式で差額が課税。それ以外は（建物 × 12％（30年超は10％）＋ 敷地 × 6％）÷ 12、借り上げは家賃の50％と多い方。240㎡超は知らせる", () => {
    const big = { bldgBase: 10_000_000, landBase: 20_000_000, floorArea: 150, longLife: false, leasedRent: 0 };
    expect(rentEquivalentOf(big, true).value).toBe(200_000); // （1,200,000 ＋ 1,200,000）÷ 12
    expect(rentEquivalentOf({ ...big, longLife: true }, true).value).toBe(183_333); // （1,000,000 ＋ 1,200,000）÷ 12
    expect(rentEquivalentOf({ ...big, leasedRent: 500_000 }, true).value).toBe(250_000);
    expect(rentEquivalentOf({ ...big, leasedRent: 300_000 }, true).value).toBe(200_000);
    // 132㎡以下（30年超の建物は99㎡以下）は小規模な住宅
    expect(rentEquivalentOf({ ...big, floorArea: 132 }, true).formula).toStartWith("小規模な住宅（132㎡以下）");
    expect(rentEquivalentOf({ ...big, floorArea: 100, longLife: true }, true).formula).not.toStartWith("小規模");
    expect(rentEquivalentOf({ ...big, floorArea: 250 }, true).notes[0]).toContain("豪華社宅");
    expect(housingTaxOf(10_000, 6_000, true)).toBe(4_000);
  });
  test("雇用保険：無償なら実際費用、徴収金額が実際費用の3分の1を下回れば「3分の1 − 徴収金額」、3分の1以上なら0円", () => {
    expect(empInKindOf(30_000, 0)).toBe(30_000);
    expect(empInKindOf(30_000, 9_000)).toBe(1_000);
    expect(empInKindOf(30_000, 10_000)).toBe(0);
  });
  test("1か月分の行に入る：令和8年4月分から決まりで計算し、それより前は入れた額。雇用保険は印を付けた行だけ", () => {
    const e = housing({
      tatami: 16, area: 40, selfPay: 3_000, taxable: 1_234, taxMode: "auto", bldgBase: 1_000_000, landBase: 2_000_000, floorArea: 40,
      empWage: true, actualCost: 60_000,
    });
    const nov = inKindOfMonth([e], "2026-11", "東京");
    expect([nov.lines[0].taxable, nov.lines[0].emp]).toEqual([3_545, 17_000]); // 6,545 − 3,000（50％未満）、60,000 ÷ 3 − 3,000
    expect(nov.lines[0].detail).toContain("所得税：賃貸料相当額 6,545円");
    const mar = inKindOfMonth([e], "2026-03", "東京");
    expect(mar.lines[0].taxable).toBe(1_234);
    expect(mar.lines[0].detail).toContain("2026年4月分より前は入れた額");
    // 役員は差額（50％の決まりがない）
    expect(inKindOfMonth([{ ...e, selfPay: 4_000 }], "2026-11", "東京", [], { executive: true }).lines[0].taxable).toBe(2_545);
    // 出勤した日ごとの食事：1日 600円 × 20日 ＝ 12,000円、本人 300円 × 20日 ＝ 6,000円（半分以上）・会社の負担 6,000円 ÷ 1.08 → 5,550円 ≦ 7,500円 → 0円
    const lunch = meal({ mealPattern: "workday", lunch: true, selfPay: 300, taxMode: "auto", taxPrice: 600 });
    const days = Array.from({ length: 20 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`);
    expect(inKindOfMonth([lunch], "2026-11", "東京", days).lines[0].taxable).toBe(0);
    expect(inKindOfMonth([{ ...lunch, selfPay: 200 }], "2026-11", "東京", days).lines[0].taxable).toBe(8_000);
    // 決まりで計算するのに額がない月は、確定できないように知らせる
    expect(inKindOfMonth([{ ...lunch, taxPrice: 0 }], "2026-11", "東京", days).problems[0]).toContain("食事の価額");
    expect(parseInKind(stringifyInKind([e]))[0]).toEqual(e);
  });
});

describe("資格取得届の見込み・入れる欄", () => {
  test("資格取得日にしている行の1か月分（出勤した日ごとの食事は、1か月の所定労働日数で数える）", () => {
    const e = [housing({ start: "2026-11-01", area: 40, selfPay: 20000 }), meal({ start: "2026-11-01", mealPattern: "workday", lunch: true })];
    expect(inKindEstimateOf(e, "2026-11-16", "東京", 20).amount).toBe(33200 + 6000);
    expect(inKindEstimateOf(e, "2026-10-31", "東京", 20).amount).toBe(0);
  });
  test("入れた行の間違いと注意", () => {
    expect(validateInKindEntry(housing({ start: "" }))).toBe("始めた日を入れてください");
    expect(validateInKindEntry(housing({ start: "2026-05-01", end: "2026-04-30" }))).toBe("やめた日が、始めた日より前です");
    expect(validateInKindEntry(meal({ mealPattern: "workday", lunch: false }))).toBe("出す食事（朝食・昼食・夕食）を選んでください");
    expect(validateInKindEntry({ ...emptyInKindEntry("other"), start: "2026-01-01" })).toBe("時価（1か月の額）を入れてください");
    expect(validateInKindEntry(housing({ tatami: 6 }))).toBeNull();
    expect(inKindEntryWarnings(housing({ start: "2026-01-01", tatami: 6 }))).toEqual(["令和8年10月分からの価額は、住宅の総面積（平方メートル）で決まるので、入れてください"]);
    expect(inKindEntryWarnings(housing({ start: "2026-11-01", area: 40 }))).toEqual([]);
    expect(inKindEntryWarnings(housing({ start: "2026-01-01", end: "2026-08-31" }))).toEqual(["令和8年9月分までの価額は、居住用の室の畳数（洋室は平方メートル）で決まるので、入れてください"]);
  });
  test("保存する JSON と、確定した給与の記録", () => {
    const e = [housing({ tatami: 4.5, roomSqm: 9.9, area: 32.5, sharers: 2, selfPay: 10000 })];
    expect(parseInKind(stringifyInKind(e))).toEqual(e);
    expect(stringifyInKind([])).toBe("");
    expect(parseInKind("こわれた")).toEqual([]);
    expect(parseInKind(JSON.stringify([{ kind: "x", sharers: 0, value: -5 }]))).toEqual([{ ...emptyInKindEntry("housing"), lunch: false, sharers: 1 }]);
    expect(parseInKindRecord(JSON.stringify({ month: "2026-05", lines: [], fixed: { monthly: 100, daily: 0 }, settled: false })))
      .toEqual({ month: "2026-05", lines: [], fixed: { monthly: 100, daily: 0 }, settled: false });
    expect(parseInKindRecord(null)).toBeNull();
  });
});
