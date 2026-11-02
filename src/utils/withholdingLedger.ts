/**
 * 給与所得に対する源泉徴収簿
 *
 * 源泉徴収簿は法令で決まった帳簿ではなく、毎月の源泉徴収の記録がわかり、年末調整にも使えるものなら、
 * 自社の給与台帳などでもよい（国税庁「A2-2 給与所得・退職所得に対する源泉徴収簿の作成」
 * https://www.nta.go.jp/taxes/tetsuzuki/shinsei/annai/gensen/annai/1648_03.htm）。
 * Q では、国税庁の様式（「令和8年分 年末調整のしかた」の設例の源泉徴収簿）の欄に合わせて、確定した給与・賞与と年末調整から作る。
 *
 * ■ 給料・手当等・賞与等の欄（支払った月ごと）
 *   ・総支給金額：所得税がかかる支給額（非課税の通勤手当は入れない。年末調整の給与の総額と同じ）
 *   ・社会保険料等の控除額・社会保険料等控除後の給与等の金額・扶養親族等の数（確定したときの数）・算出税額
 *   ・年末調整による過不足税額：その年の年末調整を、その年12月の給与で精算したときに、12月の行に書く（還付は負の数。画面では ▲）
 *   ・差引徴収税額：算出税額 ＋ 年末調整による過不足税額
 *   ・賞与の税率：算出率の表の率（月額表で計算したとき・確かめられないときは書かない。incomeTax.ts の bonusTaxRateUsed）
 * ■ 年末調整の欄（①〜㉞）：年末調整の画面で保存した申告書と、確定した給与・賞与から計算し直す（源泉徴収票と同じ）
 *   ・前の勤め先の給与・税額・社会保険料は、①・③・⑫に足す（年末調整の給与の総額に入るため）
 *   ・Q は本年最後の給与の税額も計算してから年末調整をするので、㉘・㉙（本年最後の給与の税額などに充当する金額）は 0
 *   ・精算する給与が翌年1月なら、還付は㉜（翌年において還付する金額）、徴収は㉞（翌年に繰り越して徴収する金額）に書く
 * ■ 前年の年末調整に基づき繰り越した過不足税額：前年の年末調整を、この年の1月の給与で精算したとき
 */
import type { NenchoMaster } from "../constants/nencho";
import { calcNencho, type NenchoResult } from "./nencho";
import { buildNenchoInput, sumYearTotals, type NenchoDeclaration } from "./nenchoDeclaration";
import { bonusTaxRateUsed, toTaxColumn } from "./incomeTax";
import { staffAsOf } from "./staffHistory";

/** 確定した給与（salary_results の必要な列） */
export interface LedgerSalaryInput {
  target_year: number;
  target_month: number;
  taxable_amount: number;
  social_ins_total: number;
  applied_dependents: number | null;
  income_tax: number;
  year_end_adjustment: number;
}

/** 確定した賞与（bonus_results と、賞与の支給月・支給日） */
export interface LedgerBonusInput {
  target_year: number;
  target_month: number;
  payment_date: string | null;
  total_earnings: number;
  health_insurance: number;
  nursing_insurance: number;
  child_support: number;
  welfare_pension: number;
  emp_insurance: number;
  income_tax: number;
}

export interface LedgerSource {
  year: number;
  staff: any;
  /** 給与の支給日（給与規定グループの支給日。99 は末日。わからなければ null） */
  paymentDay: number | null;
  /** 確定した給与（その年の分と、前年12月の分。前年12月は、1月に払った賞与の税率を確かめるのに使う） */
  salaries: LedgerSalaryInput[];
  /** その年に支払った賞与 */
  bonuses: LedgerBonusInput[];
  /** 年末調整をした人の申告書と、精算する給与の年月（年末調整をしない人は null） */
  adjustment: { declaration: NenchoDeclaration; settleYear: number; settleMonth: number } | null;
  /** 前年の年末調整で、この年の1月の給与で精算する過不足額（＋還付／−徴収。なければ null） */
  previousYearDifference: number | null;
}

/** 給料・手当等・賞与等の1行 */
export interface LedgerRow {
  /** 月区分 */
  month: number;
  /** 支給日（日だけ。わからなければ null） */
  payDay: number | null;
  gross: number;
  social: number;
  afterSocial: number;
  /** 扶養親族等の数（わからなければ null） */
  dependents: number | null;
  /** 賞与の税率（%。書かないときは null） */
  rate: number | null;
  /** 算出税額 */
  tax: number;
  /** 年末調整による過不足税額（＋徴収／−還付） */
  adjustment: number;
  /** 差引徴収税額 */
  netTax: number;
}

export interface LedgerTotals { gross: number; social: number; afterSocial: number; tax: number; adjustment: number; netTax: number }

/** 扶養控除等の申告・各種控除額の1行（控除額は万円） */
export interface LedgerDependentLine { label: string; count: number; perPersonMan: number; totalMan: number }

/** 年末調整の欄（①〜㉞） */
export interface LedgerAdjustment {
  result: NenchoResult;
  /** ①③ 給料・手当等（前の勤め先の分を含む） */
  salaryAmount: number;
  salaryTax: number;
  /** ④⑥ 賞与等 */
  bonusAmount: number;
  bonusTax: number;
  /** ⑫ 社会保険料等控除額のうち給与等からの控除分（②＋⑤。前の勤め先の分を含む） */
  socialFromPay: number;
  /** ⑬ 申告による社会保険料の控除分 */
  socialDeclared: number;
  /** ⑬のうち国民年金保険料等の金額 */
  nationalPension: number;
  /** ⑭ 申告による小規模企業共済等掛金の控除分 */
  smallBusiness: number;
  /** 前の勤め先の分（①・③・⑫に足したもの。なければ null） */
  previousJob: { salary: number; withheldTax: number; socialInsurance: number } | null;
  /** 配偶者の合計所得金額（配偶者控除等申告書。いなければ null） */
  spouseTotalIncome: number | null;
  /** 旧長期損害保険料支払額 */
  oldLongTerm: number;
  /** ㉗ 差引超過額又は不足額（超過額なら excess） */
  differenceKind: "excess" | "shortage" | null;
  difference: number;
  /** ㉘ 本年最後の給与から徴収する税額に充当する金額・㉙ 未払給与に係る未徴収の税額に充当する金額（Q では 0） */
  appliedToLastPay: number;
  appliedToUnpaid: number;
  /** ㉚ 差引還付する金額・㉛ 本年中に還付する金額・㉜ 翌年において還付する金額 */
  refund: number;
  refundThisYear: number;
  refundNextYear: number;
  /** ㉝ 本年最後の給与から徴収する金額・㉞ 翌年に繰り越して徴収する金額 */
  collectThisYear: number;
  collectNextYear: number;
}

export interface WithholdingLedger {
  year: number;
  /** 甲欄・乙欄 */
  taxColumn: "kou" | "otsu";
  /** 給料・手当等（1〜12月の12行。払っていない月は null） */
  salaryRows: (LedgerRow | null)[];
  salaryTotal: LedgerTotals;
  /** 賞与等（支払った順） */
  bonusRows: LedgerRow[];
  bonusTotal: LedgerTotals;
  /** 扶養控除等の申告（年末調整をした人だけ。申告書の内容から） */
  dependentLines: LedgerDependentLine[] | null;
  /** 年末調整の欄（年末調整をした人だけ） */
  adjustment: LedgerAdjustment | null;
  /** 前年の年末調整に基づき繰り越した過不足税額（＋還付／−徴収）と、1月に精算した額・差引残高 */
  carryOver: { amount: number; settledInJanuary: number; balance: number } | null;
}

const n = (v: unknown) => Number(v) || 0;

/** 給与の支給日（日）。99（末日）や、その月にない日は月末にする */
export const payDayOf = (year: number, month: number, paymentDay: number | null): number | null => {
  if (!paymentDay || paymentDay <= 0) return null;
  const last = new Date(year, month, 0).getDate();
  return Math.min(paymentDay, last);
};

const sumRows = (rows: LedgerRow[]): LedgerTotals => ({
  gross: rows.reduce((s, r) => s + r.gross, 0),
  social: rows.reduce((s, r) => s + r.social, 0),
  afterSocial: rows.reduce((s, r) => s + r.afterSocial, 0),
  tax: rows.reduce((s, r) => s + r.tax, 0),
  adjustment: rows.reduce((s, r) => s + r.adjustment, 0),
  netTax: rows.reduce((s, r) => s + r.netTax, 0),
});

const bonusSocialOf = (b: LedgerBonusInput) =>
  n(b.health_insurance) + n(b.nursing_insurance) + n(b.child_support) + n(b.welfare_pension) + n(b.emp_insurance);

/** 源泉徴収簿を作る（年末調整の欄は、年末調整の表がある年分だけ） */
export const buildWithholdingLedger = (src: LedgerSource, m: NenchoMaster | null): WithholdingLedger => {
  const { year } = src;
  const taxColumn = toTaxColumn(src.staff?.tax_column);
  const thisYear = src.salaries.filter((r) => n(r.target_year) === year);
  const salaryOf = (y: number, mo: number) => src.salaries.find((r) => n(r.target_year) === y && n(r.target_month) === mo) ?? null;

  // 年末調整をその年12月の給与で精算したときだけ、12月の行に過不足税額を書く（1月の行の過不足額は前年の年末調整の分）
  const settlesInDecember = !!src.adjustment && src.adjustment.settleYear === year && src.adjustment.settleMonth === 12;

  const salaryRows: (LedgerRow | null)[] = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const r = salaryOf(year, month);
    if (!r) return null;
    const gross = n(r.taxable_amount);
    const social = n(r.social_ins_total);
    const tax = n(r.income_tax);
    const adjustment = month === 12 && settlesInDecember ? -n(r.year_end_adjustment) : 0;
    return {
      month,
      payDay: payDayOf(year, month, src.paymentDay),
      gross, social, afterSocial: gross - social,
      dependents: r.applied_dependents === null || r.applied_dependents === undefined ? null : n(r.applied_dependents),
      rate: null,
      tax, adjustment, netTax: tax + adjustment,
    };
  });

  const bonusRows: LedgerRow[] = [...src.bonuses]
    .sort((a, b) => (a.payment_date ?? "").localeCompare(b.payment_date ?? "") || n(a.target_month) - n(b.target_month))
    .map((b) => {
      const gross = n(b.total_earnings);
      const social = bonusSocialOf(b);
      const tax = n(b.income_tax);
      // 税率は、賞与の画面と同じく、支給月の前月の給与（社会保険料等控除後）と扶養親族等の数から求めて確かめる
      const month = n(b.target_month);
      const prev = month === 1 ? salaryOf(year - 1, 12) : salaryOf(year, month - 1);
      const prevAfterSocial = prev ? n(prev.taxable_amount) - n(prev.social_ins_total) : 0;
      const dependents = prev && prev.applied_dependents !== null && prev.applied_dependents !== undefined
        ? n(prev.applied_dependents)
        : (src.staff ? n(staffAsOf(src.staff, year, month).dependents) : null);
      const day = /^\d{4}-\d{2}-(\d{2})$/.exec(b.payment_date ?? "");
      return {
        month,
        payDay: day ? Number(day[1]) : null,
        gross, social, afterSocial: gross - social,
        dependents,
        rate: bonusTaxRateUsed(gross - social, prevAfterSocial, dependents ?? 0, year, taxColumn, tax),
        tax, adjustment: 0, netTax: tax,
      };
    });

  const salaryTotal = sumRows(salaryRows.filter((r): r is LedgerRow => r !== null));
  const bonusTotal = sumRows(bonusRows);

  // 年末調整の欄
  let adjustment: LedgerAdjustment | null = null;
  let dependentLines: LedgerDependentLine[] | null = null;
  if (src.adjustment && m) {
    const decl = src.adjustment.declaration;
    const totals = sumYearTotals(thisYear, src.bonuses);
    const input = buildNenchoInput(decl, totals, year, m);
    const result = calcNencho(input, m);
    const pj = decl.previousJob;
    const hasPrevious = n(pj.salary) > 0 || n(pj.withheldTax) > 0 || n(pj.socialInsurance) > 0;
    const d = result.difference;
    const nextYear = !(src.adjustment.settleYear === year && src.adjustment.settleMonth === 12);
    adjustment = {
      result,
      salaryAmount: salaryTotal.gross + n(pj.salary),
      salaryTax: salaryTotal.tax + n(pj.withheldTax),
      bonusAmount: bonusTotal.gross,
      bonusTax: bonusTotal.tax,
      socialFromPay: n(input.socialInsuranceFromPay),
      socialDeclared: n(input.socialInsuranceDeclared),
      nationalPension: n(decl.insurance.nationalPension),
      smallBusiness: n(input.smallBusinessMutualAid),
      previousJob: hasPrevious ? { salary: n(pj.salary), withheldTax: n(pj.withheldTax), socialInsurance: n(pj.socialInsurance) } : null,
      spouseTotalIncome: decl.spouse ? n(decl.spouse.totalIncome) : null,
      oldLongTerm: n(decl.insurance.oldLongTerm),
      differenceKind: d > 0 ? "excess" : d < 0 ? "shortage" : null,
      difference: Math.abs(d),
      appliedToLastPay: 0,
      appliedToUnpaid: 0,
      refund: Math.max(0, d),
      refundThisYear: d > 0 && !nextYear ? d : 0,
      refundNextYear: d > 0 && nextYear ? d : 0,
      collectThisYear: d < 0 && !nextYear ? -d : 0,
      collectNextYear: d < 0 && nextYear ? -d : 0,
    };

    // 扶養控除等の申告・各種控除額（控除額は「年末調整のしかた」の扶養控除額等の表から。⑲の内訳）
    const D = m.deductions;
    const man = (yen: number) => yen / 10000;
    const line = (label: string, count: number, yen: number): LedgerDependentLine =>
      ({ label, count, perPersonMan: man(yen), totalMan: man(yen) * count });
    dependentLines = [
      line("一般の控除対象扶養親族", input.dependents.general, D.dependentGeneral),
      line("特定扶養親族", input.dependents.specific, D.dependentSpecific),
      line("老人扶養親族（同居老親等）", input.dependents.elderlyLivingTogether, D.dependentElderlyLivingTogether),
      line("老人扶養親族（その他）", input.dependents.elderlyOther, D.dependentElderlyOther),
      line("一般の障害者", input.disability.general, D.disabilityGeneral),
      line("特別障害者", input.disability.special, D.disabilitySpecial),
      line("同居特別障害者", input.disability.specialLivingTogether, D.disabilitySpecialLivingTogether),
      line("寡婦", input.widow ? 1 : 0, D.widow),
      line("ひとり親", input.singleParent ? 1 : 0, D.singleParent),
      line("勤労学生", input.workingStudent ? 1 : 0, D.workingStudent),
    ];
  }

  // 前年の年末調整に基づき繰り越した過不足税額（この年の1月の給与で精算したもの）
  let carryOver: WithholdingLedger["carryOver"] = null;
  const january = salaryOf(year, 1);
  const settledInJanuary = january ? n(january.year_end_adjustment) : 0;
  if (src.previousYearDifference !== null || settledInJanuary !== 0) {
    const amount = src.previousYearDifference ?? settledInJanuary;
    carryOver = { amount, settledInJanuary, balance: amount - settledInJanuary };
  }

  return { year, taxColumn, salaryRows, salaryTotal, bonusRows, bonusTotal, dependentLines, adjustment, carryOver };
};
