import { describe, expect, test } from "bun:test";
import * as Master from "../constants";
import { SHOYO_HOUSHU } from "../constants/shoyoHoushu";
import {
  bonusHoushuStatus, houshuAmountFor, houshuClassificationOf, houshuForRevision, houshuLookback, houshuMonthlyOf, houshuRemark,
  parseHoushuOverrides, stringifyHoushuOverrides, teijiYearOf, unmarkedBonusMonths, withHoushu, NO_HOUSHU,
  type HoushuResult, type HoushuSetting,
} from "./shoyoHoushu";
import { decideTeiji } from "./santei";
import { buildGeppenReportRow, buildSanteiReportRow } from "./remunerationReport";
import { shahoOfficeValues } from "./shahoCsv";
import { parseRemunerationHistory, stringifyRemunerationHistory } from "./standardRemuneration";
import { buildBonusReport, type BonusPayment } from "./bonusReport";
import { planMonthStatuses } from "./bonusNonPayment";
import { estimatedWageOf } from "./shikakuReport";

/**
 * 日本年金機構「算定基礎届の記入・提出ガイドブック（令和8年度）」のケース⑦（賞与などが年4回以上支給されたとき）：
 * 前年7月からその年の6月までに、9月 120,000円・12月 380,000円・3月 150,000円・6月 250,000円の賞与（合計 900,000円）
 * → 各月に足す賞与の額 900,000円 ÷ 12 ＝ 75,000円。4〜6月の報酬 270,000円（基本給 255,000円・通勤手当 15,000円）に足して 345,000円。
 * 総計 1,035,000円・平均額 345,000円。備考は「9.その他」に「賞与 9.12.3.6月 75,000円」
 * （名前は違っても、同じ性質の四半期ごとの賞与として、どれにも印を付けた）
 */
const guide: HoushuSetting[] = [
  { id: 1, name: "第2四半期賞与", payment_date: "2025-09-25", shaho_houshu: 1, is_closed: 1 },
  { id: 2, name: "第3四半期賞与", payment_date: "2025-12-25", shaho_houshu: 1, is_closed: 1 },
  { id: 3, name: "第4四半期賞与", payment_date: "2026-03-25", shaho_houshu: 1, is_closed: 1 },
  { id: 4, name: "第1四半期賞与", payment_date: "2026-06-25", shaho_houshu: 1, is_closed: 1 },
];
const guideResults: HoushuResult[] = [
  { bonus_setting_id: 1, staff_id: "S032", total_earnings: 120000, in_kind: 0 },
  { bonus_setting_id: 2, staff_id: "S032", total_earnings: 380000, in_kind: 0 },
  { bonus_setting_id: 3, staff_id: "S032", total_earnings: 150000, in_kind: 0 },
  { bonus_setting_id: 4, staff_id: "S032", total_earnings: 250000, in_kind: 0 },
];

describe("年4回以上払う賞与の決まり（通知から作った数）", () => {
  test("4回以上・12で割る・7月1日前の1年間・7〜9月の随時改定は計算し直す", () => {
    expect(SHOYO_HOUSHU).toEqual({ minTimes: 4, divisor: 12, baseMonth: 7, baseDay: 1, recalcMonths: [7, 8, 9] });
    expect(houshuLookback(2026)).toEqual({ from: "2025-07-01", to: "2026-06-30" });
    expect(houshuLookback(2028)).toEqual({ from: "2027-07-01", to: "2028-06-30" });
  });

  test("支給日の月が入る定時決定の期間（9月〜翌年8月）", () => {
    expect(teijiYearOf("2026-08-31")).toBe(2025);
    expect(teijiYearOf("2026-09-01")).toBe(2026);
    expect(teijiYearOf("2027-03-15")).toBe(2026);
    expect(teijiYearOf("")).toBeNull();
  });
});

describe("報酬として扱うか（7月1日前の1年間に払った回数・画面で決めた扱い）", () => {
  test("ガイドブックのケース⑦：前年9月・12月・3月・6月の4回 → その年の定時決定から報酬", () => {
    const c = houshuClassificationOf(2026, guide, {});
    expect(c.months).toEqual(["2025-09", "2025-12", "2026-03", "2026-06"]);
    expect([c.auto, c.override, c.houshu]).toEqual([true, null, true]);
  });

  test("3回なら賞与。確定していない賞与・印のない賞与・7月1日前の1年間の外の賞与は数えず、同じ月に2つ払っても1回", () => {
    const three = guide.slice(0, 3);
    expect(houshuClassificationOf(2026, three, {}).houshu).toBe(false);
    const others: HoushuSetting[] = [
      ...three,
      { id: 5, name: "第1四半期賞与（未確定）", payment_date: "2026-06-25", shaho_houshu: 1, is_closed: 0 },
      { id: 6, name: "決算賞与", payment_date: "2026-05-20", shaho_houshu: 0, is_closed: 1 },
      { id: 7, name: "第1四半期賞与（7月）", payment_date: "2026-07-01", shaho_houshu: 1, is_closed: 1 },
      { id: 8, name: "第3四半期賞与（別の部署）", payment_date: "2025-12-10", shaho_houshu: 1, is_closed: 1 },
    ];
    const c = houshuClassificationOf(2026, others, {});
    expect(c.months).toEqual(["2025-09", "2025-12", "2026-03"]);
    expect(c.houshu).toBe(false);
    // 印のない賞与を払った月（4つ以上なら、印の付け忘れを知らせる）
    expect(unmarkedBonusMonths(2026, others)).toEqual({ months: ["2026-05"], names: ["決算賞与"] });
  });

  test("給与規定で年4回以上と決めているときは、3回でも「報酬として扱う」にできる。4回でも「扱わない」にできる（年ごとに残す）", () => {
    expect(houshuClassificationOf(2026, guide.slice(0, 3), { 2026: true }).houshu).toBe(true);
    expect(houshuClassificationOf(2026, guide, { 2026: false }).houshu).toBe(false);
    expect(houshuClassificationOf(2027, guide, { 2026: true }).override).toBeNull();
    expect(parseHoushuOverrides('{"2026":true,"2027":false,"x":true,"2028":"yes"}')).toEqual({ 2026: true, 2027: false });
    expect(parseHoushuOverrides("{こわれた")).toEqual({});
    expect(stringifyHoushuOverrides({ 2027: false, 2026: true })).toBe('{"2026":true,"2027":false}');
    expect(stringifyHoushuOverrides({})).toBeNull();
  });

  test("賞与ごとの扱い：9月〜翌年8月に払う、印を付けた賞与だけが報酬。7月・8月に払う賞与は、次の定時決定の標準報酬月額を使うまでは前の扱い", () => {
    // 2026年9月・12月に払う第2・第3四半期賞与は、2026年の定時決定（9月〜翌年8月）の扱い → 報酬
    expect(bonusHoushuStatus({ payment_date: "2026-09-25", shaho_houshu: 1 }, guide, {})).toMatchObject({ marked: true, teijiYear: 2026, houshu: true });
    expect(bonusHoushuStatus({ payment_date: "2027-08-25", shaho_houshu: 1 }, guide, {}).houshu).toBe(true);
    // 2026年8月に払う賞与は、2025年の定時決定の期間（7月1日前の1年間に印を付けた賞与を払っていない）→ まだ賞与
    expect(bonusHoushuStatus({ payment_date: "2026-08-25", shaho_houshu: 1 }, guide, {})).toMatchObject({ teijiYear: 2025, houshu: false });
    // 印のない賞与（夏季・冬季・決算賞与など）は、いつ払っても賞与
    expect(bonusHoushuStatus({ payment_date: "2026-12-10", shaho_houshu: 0 }, guide, {}).houshu).toBe(false);
  });
});

describe("1人ずつの額（7月1日前の1年間に受けた額 ÷ 12）", () => {
  test("ガイドブックのケース⑦：120,000＋380,000＋150,000＋250,000 ＝ 900,000円 ÷ 12 ＝ 75,000円。備考は「賞与9.12.3.6月　75,000円」", () => {
    const a = houshuAmountFor("S032", 2026, guide, guideResults);
    expect(a).toEqual({ total: 900000, inKind: 0, monthly: 75000, monthlyInKind: 0, months: [9, 12, 3, 6] });
    expect(houshuRemark(a.months, a.monthly)).toBe("賞与9.12.3.6月　75,000円");
    expect(houshuRemark([], 75000)).toBe("賞与に係る報酬　75,000円");
    expect(houshuRemark([9], 0)).toBe("");
  });

  test("12で割った額は1円未満を切り捨てる。賞与を受けていない月は書かない。現物の分も分けて足す", () => {
    const results: HoushuResult[] = [
      { bonus_setting_id: 2, staff_id: "S040", total_earnings: 500000, in_kind: 20000 },
      { bonus_setting_id: 3, staff_id: "S040", total_earnings: 500005, in_kind: 0 },
    ];
    expect(houshuAmountFor("S040", 2026, guide, results)).toEqual({ total: 1000005, inKind: 20000, monthly: 83333, monthlyInKind: 1666, months: [12, 3] });
    expect(houshuAmountFor("S999", 2026, guide, results)).toEqual(NO_HOUSHU);
  });

  test("画面で直した額（規定が変わったばかりの年など）。給与を払っていない月には足さない", () => {
    const auto = houshuAmountFor("S032", 2026, guide, guideResults);
    expect(houshuMonthlyOf(auto, null)).toEqual({ monthly: 75000, monthlyInKind: 0 });
    expect(houshuMonthlyOf(auto, 60000.7)).toEqual({ monthly: 60000, monthlyInKind: 0 });
    const months = [{ month: 4, days: 31, amount: 270000, partialJoin: false }, { month: 5, days: null, amount: null, partialJoin: false }];
    expect(withHoushu(months, { monthly: 75000, monthlyInKind: 0 })).toEqual([
      { month: 4, days: 31, amount: 345000, inKind: 0, partialJoin: false },
      { month: 5, days: null, amount: null, partialJoin: false },
    ]);
  });
});

describe("算定基礎届（ガイドブックのケース⑦と同じになる）", () => {
  const office = shahoOfficeValues({
    prefecture: "東京都", symbol: "57-ケマ", number: "8505", zip: "168-8505", address: "東京都杉並区高井戸3-5-24",
    name: "株式会社健保産業", owner: "健保 一郎", phone: "03-2345-6789",
  }).values;
  const salaryMonths = [4, 5, 6].map((month, i) => ({ month, days: [31, 30, 31][i], amount: 270000, partialJoin: false }));

  test("4〜6月の 270,000円に 75,000円を足して平均 345,000円 → 標準報酬月額 340,000円", () => {
    const add = houshuMonthlyOf(houshuAmountFor("S032", 2026, guide, guideResults), null);
    const result = decideTeiji(withHoushu(salaryMonths, add), "general", 260000, Master.getInsuranceMaster(2026, 9).HYOJUN_TABLE);
    expect([result.total, result.average, result.standard]).toEqual([1035000, 345000, 340000]);
  });

  test("届書：通貨 345,000円・総計 1,035,000円・平均額 345,000円、備考の「その他」に「賞与９．１２．３．６月　７５，０００円」", () => {
    const row = buildSanteiReportRow({
      staff: { id: "S032", name: "社会 公一", furigana: "シャカイ コウイチ", birthday: "1984-06-19", pension_num: "32", join_date: "2010-04-01" },
      year: 2026, previous: 260000, previousFrom: "2025-09",
      months: withHoushu(salaryMonths, { monthly: 75000, monthlyInKind: 0 }), kind: "general",
      ordinaryAverage: 345000, annualAverage: null, unfinalizedMonths: [], wageChange: null, retro: null,
      periods: { 4: { startStr: "2026-03-01", endStr: "2026-03-31" }, 5: { startStr: "2026-04-01", endStr: "2026-04-30" }, 6: { startStr: "2026-05-01", endStr: "2026-05-31" } },
      payRule: "末日締め翌月25日払い", insurerType: "kyokai", pensionRange: { min: 88000, max: 650000 }, remarks: null,
      houshu: { monthly: 75000, remark: houshuRemark([9, 12, 3, 6], 75000) },
    }, office);
    expect(row.months.map((m) => [m.days, m.currency, m.inKind, m.total])).toEqual([[31, 345000, 0, 345000], [30, 345000, 0, 345000], [31, 345000, 0, 345000]]);
    expect([row.sum, row.average, row.modifiedAverage]).toEqual([1035000, 345000, null]);
    expect(row.remarks).toBe("賞与９．１２．３．６月　７５，０００円");
    expect(row.values[row.values.length - 2]).toBe("賞与９．１２．３．６月　７５，０００円");
    expect(row.problems).toEqual([]);
    expect(row.notes.some((n) => n.includes("ケース⑦"))).toBe(true);
  });

  test("月額変更届：3か月の報酬に足した額を通貨に書き、備考欄に書く（年間平均の文と並べる）", () => {
    const row = buildGeppenReportRow({
      staff: { id: "S032", name: "社会 公一", furigana: "シャカイ コウイチ", birthday: "1984-06-19", pension_num: "32", join_date: "2010-04-01" },
      changeYear: 2026, changeMonth: 10, direction: "up", revisionFrom: "2027-01", previous: 340000, previousFrom: "2026-09",
      months: [10, 11, 12].map((month) => ({ year: 2026, month, days: 31, amount: 300000 + 75000 })),
      short: false, ordinaryAverage: 375000, annualAverage: null, retro: null, reason: null, autoReason: "基本給の変更", remarks: null,
      insurerType: "kyokai", pensionRange: { min: 88000, max: 650000 },
      houshu: { monthly: 75000, remark: houshuRemark([], 75000) },
    }, office);
    expect(row.months.map((m) => m.currency)).toEqual([375000, 375000, 375000]);
    expect(row.remarks).toBe("賞与に係る報酬　７５，０００円");
    expect(row.problems).toEqual([]);
  });
});

describe("随時改定（月変）・休業終了時改定で足す額", () => {
  // 2026年9月分から、定時決定で 340,000円（うち賞与に係る報酬 75,000円）
  const staff = {
    id: "S032",
    standard_remuneration_history: JSON.stringify([
      { from: "", amount: 260000, reason: "shutoku" },
      { from: "2026-09", amount: 340000, reason: "teiji", bonus: 75000 },
    ]),
  };

  test("7・8・9月以外の改定（2027年1月）は、計算し直さずに、いまの標準報酬月額を決めたときの額（75,000円）を足す", () => {
    expect(houshuForRevision(staff, 2027, 1, [], [], {})).toMatchObject({ source: "carry", monthly: 75000, months: [] });
    // その前の、入社したときの標準報酬月額には、賞与に係る報酬がない
    expect(houshuForRevision(staff, 2026, 6, [], [], {})).toMatchObject({ source: "carry", monthly: 0 });
  });

  test("7・8・9月の改定（2026年8月）は、その年の定時決定と同じく、7月1日前の1年間に受けた額 ÷ 12 で計算し直す", () => {
    expect(houshuForRevision(staff, 2026, 8, guide, guideResults, {})).toMatchObject({ source: "recalc", monthly: 75000, months: [9, 12, 3, 6] });
    // 報酬として扱わない年は 0
    expect(houshuForRevision(staff, 2026, 8, guide, guideResults, { 2026: false })).toMatchObject({ source: "recalc", monthly: 0 });
  });

  test("標準報酬月額の履歴に、うち賞与に係る報酬を残す（ないときは書かない）", () => {
    const history = parseRemunerationHistory(staff.standard_remuneration_history);
    expect(history).toEqual([
      { from: "", amount: 260000, reason: "shutoku" },
      { from: "2026-09", amount: 340000, reason: "teiji", bonus: 75000 },
    ]);
    expect(stringifyRemunerationHistory(history)).toBe(staff.standard_remuneration_history);
    expect(parseRemunerationHistory(JSON.stringify([{ from: "", amount: 260000, reason: "shutoku", bonus: -5 }]))).toEqual([{ from: "", amount: 260000, reason: "shutoku" }]);
  });

  test("資格取得届：最初の行に「うち賞与」（同じような人の賞与に係る報酬の平均）を入れた月給の人は、報酬月額の初めの値に足す", () => {
    const newcomer = {
      wage_type: "monthly", base_wage: 250000, commute_type: "monthly", commute_amount: 12000,
      standard_remuneration_history: JSON.stringify([{ from: "", amount: 340000, reason: "shutoku", bonus: 70000 }]),
    };
    expect(estimatedWageOf(newcomer)).toBe(332000);
  });
});

describe("賞与支払届・賞与不支給報告書", () => {
  const insured = { id: "S032", name: "社会 公一", furigana: "シャカイ コウイチ", birthday: "1984-06-19", pension_num: "32", standard_remuneration: 340000, join_date: "2010-04-01" };
  const pay = (o: Partial<BonusPayment> = {}): BonusPayment => ({ settingId: 5, name: "第2四半期賞与", paymentDate: "2026-09-25", staffId: "S032", totalEarnings: 120000, ...o });

  test("社会保険の報酬として扱った賞与は、賞与支払届に書かない（わけを出す）", () => {
    const { rows, skipped } = buildBonusReport([insured], [pay({ houshu: true })], []);
    expect(rows).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toContain("年4回以上払う賞与（第2四半期賞与）");
    // 同じ人に、同じ月に印のない賞与も払ったときは、その賞与だけを書く
    const both = buildBonusReport([insured], [pay({ houshu: true }), pay({ settingId: 6, name: "決算賞与", totalEarnings: 300000 })], []);
    expect(both.rows).toHaveLength(1);
    expect([both.rows[0].currency, both.rows[0].total]).toEqual([300000, 300000]);
    expect(both.skipped).toEqual([]);
  });

  test("賞与支払予定月に、報酬として扱った賞与だけを払ったときは、賞与を払っていない月（賞与不支給報告書を出す）", () => {
    const list = planMonthStatuses(2026, [9, 12], [insured], [pay({ houshu: true }), pay({ settingId: 6, name: "冬季賞与", paymentDate: "2026-12-10", totalEarnings: 400000 })], "2026-12-20");
    expect(list).toEqual([
      { month: 9, ym: "2026-09", status: "unpaid", bonuses: [] },
      { month: 12, ym: "2026-12", status: "paid", bonuses: ["冬季賞与"] },
    ]);
  });
});
