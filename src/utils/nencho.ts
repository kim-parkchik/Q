/**
 * 年末調整：1年間の給与・賞与の税額（年調年税額）を計算し、源泉徴収した税額との過不足を求める
 *
 * 手順（国税庁「年末調整のしかた」の「年税額の計算」・「電子計算機等による年末調整」のとおり）
 *   1. 給与の総額を年調給与額に直し、給与所得控除後の給与等の金額を求める
 *   2. 所得金額調整控除（給与の総額が850万円超で、23歳未満の扶養親族・特別障害者がいる人）を引く
 *   3. 所得控除（社会保険料・小規模企業共済等掛金・生命保険料・地震保険料・配偶者（特別）・特定親族特別・
 *      扶養・障害者等・基礎）を引いて、課税給与所得金額（1,000円未満切り捨て）を求める
 *   4. 速算表で算出所得税額を求め、住宅借入金等特別控除額（算出所得税額まで）を引いて年調所得税額にする
 *   5. 年調所得税額 × 102.1%（100円未満切り捨て）が年調年税額。源泉徴収した税額との差が過不足額
 * 表・計算式は constants/nencho/（国税庁の PDF から自動生成）。
 *
 * ここでは、申告書の内容は「人数」「金額」として受け取る（扶養親族の年齢や所得から区分を決めるのは画面の役目）。
 */
import type { InsuranceFormula, NenchoMaster } from "../constants/nencho";

export interface NenchoInput {
  /** 1年間に支払った給与・賞与の総額（課税されるもの。非課税の通勤手当は含めない） */
  salaryTotal: number;
  /** その給与・賞与から源泉徴収した税額の合計 */
  withheldTax: number;
  /** 給与・賞与から差し引いた社会保険料等 */
  socialInsuranceFromPay: number;
  /** 保険料控除申告書で申告した社会保険料（国民年金・国民健康保険など） */
  socialInsuranceDeclared: number;
  /** 小規模企業共済等掛金（iDeCo など） */
  smallBusinessMutualAid: number;
  /** 支払った生命保険料（新・旧は平成24年1月1日以後・以前の契約） */
  lifeInsurance: { generalNew: number; generalOld: number; medical: number; pensionNew: number; pensionOld: number };
  /** 支払った地震保険料・旧長期損害保険料 */
  earthquake: { earthquake: number; oldLongTerm: number };
  /** 住宅借入金等特別控除申告書の控除額 */
  housingLoanCredit: number;
  /** 給与所得以外の所得の合計（基礎控除・配偶者控除の区分を決める合計所得金額に足す） */
  otherIncome: number;
  /** 所得金額調整控除の対象（本人・同一生計配偶者・扶養親族が特別障害者、または23歳未満の扶養親族がいる） */
  incomeAdjustmentEligible: boolean;
  /** 23歳未満の扶養親族がいる（生命保険料控除の特例） */
  hasDependentUnder23: boolean;
  /** 配偶者控除・配偶者特別控除を受ける配偶者（いなければ null） */
  spouse: { totalIncome: number; elderly: boolean } | null;
  /** 控除対象扶養親族の人数 */
  dependents: { general: number; specific: number; elderlyLivingTogether: number; elderlyOther: number };
  /** 特定親族ごとの合計所得金額 */
  specificRelativeIncomes: number[];
  /** 障害者の人数（本人・同一生計配偶者・扶養親族の合計） */
  disability: { general: number; special: number; specialLivingTogether: number };
  widow: boolean;
  singleParent: boolean;
  workingStudent: boolean;
}

export interface NenchoResult {
  /** 年末調整の対象か（給与の総額・課税給与所得金額が上限を超えると対象外） */
  eligible: boolean;
  /** 対象外の理由 */
  ineligibleReason: string | null;
  /** 年調給与額 */
  roundedSalary: number;
  /** 給与所得控除後の給与等の金額 */
  employmentIncome: number;
  /** 所得金額調整控除額 */
  incomeAdjustment: number;
  /** 給与所得控除後の給与等の金額（調整控除後） */
  employmentIncomeAdjusted: number;
  /** 合計所得金額（調整控除後の給与所得 ＋ 給与所得以外の所得） */
  totalIncome: number;
  deductions: {
    socialInsurance: number;
    smallBusinessMutualAid: number;
    lifeInsurance: number;
    earthquake: number;
    spouse: number;
    spouseSpecial: number;
    specificRelative: number;
    /** 扶養控除・障害者控除・寡婦控除・ひとり親控除・勤労学生控除の合計 */
    dependentsAndOthers: number;
    basic: number;
    total: number;
  };
  /** 課税給与所得金額（1,000円未満切り捨て） */
  taxableIncome: number;
  /** 算出所得税額 */
  calculatedTax: number;
  /** 住宅借入金等特別控除額（算出所得税額まで） */
  housingLoanCredit: number;
  /** 年調所得税額 */
  annualIncomeTax: number;
  /** 年調年税額（復興特別所得税を含む） */
  annualTax: number;
  withheldTax: number;
  /** 過不足額（＋なら超過額＝本人に還付、−なら不足額＝本人から徴収） */
  difference: number;
}

const floorTo = (n: number, unit: number) => Math.floor(n / unit) * unit;
const nonNeg = (n: number) => Math.max(0, Math.floor(Number(n) || 0));

/** 年調給与額（220万円以上660万円未満は、4,000円刻みの最低額に置き換える） */
export const roundedSalaryOf = (salary: number, m: NenchoMaster): number => {
  const { from, to, step } = m.rounding;
  return salary >= from && salary <= to ? salary - ((salary - from) % step) : salary;
};

/** 給与所得控除後の給与等の金額（1円未満切り捨て） */
export const employmentIncomeOf = (salary: number, m: NenchoMaster): number => {
  const a = roundedSalaryOf(nonNeg(salary), m);
  const seg = m.employmentIncome.find((s) => a >= s.from && a <= s.to);
  if (!seg) return 0;
  return "fixed" in seg ? seg.fixed : Math.max(0, Math.floor((a * seg.rate) / 100) - seg.minus);
};

/** 保険料の控除額（計算式に当てはめる。1円未満切り上げ） */
export const insuranceDeduction = (paid: number, f: InsuranceFormula): number => {
  const amount = nonNeg(paid);
  const bracket = f.brackets.find((b) => amount <= b.upTo);
  if (!bracket) return f.max;
  return Math.ceil(amount / bracket.divisor) + bracket.plus;
};

/** 生命保険料控除額（一般・介護医療・個人年金それぞれを求めて合計し、上限まで） */
export const lifeInsuranceDeduction = (p: NenchoInput["lifeInsurance"], hasDependentUnder23: boolean, m: NenchoMaster): number => {
  const L = m.lifeInsurance;
  // 新旧の両方を払ったときは「新＋旧（上限あり）」も計算し、①②③のうち最も大きい金額
  const combine = (newAmount: number, oldAmount: number, cap: number) =>
    Math.max(newAmount, oldAmount, newAmount > 0 && oldAmount > 0 ? Math.min(newAmount + oldAmount, cap) : 0);
  const general = combine(
    insuranceDeduction(p.generalNew, hasDependentUnder23 ? L.newYoung : L.new),
    insuranceDeduction(p.generalOld, L.old),
    hasDependentUnder23 ? L.generalMaxYoung : L.generalMax,
  );
  const medical = insuranceDeduction(p.medical, L.new);
  const pension = combine(insuranceDeduction(p.pensionNew, L.new), insuranceDeduction(p.pensionOld, L.old), L.pensionMax);
  return Math.min(general + medical + pension, L.totalMax);
};

/** 地震保険料控除額 */
export const earthquakeDeduction = (p: NenchoInput["earthquake"], m: NenchoMaster): number => {
  const E = m.earthquake;
  return Math.min(Math.min(nonNeg(p.earthquake), E.earthquakeMax) + insuranceDeduction(p.oldLongTerm, E.oldLongTerm), E.totalMax);
};

/** 所得者の合計所得金額の区分（配偶者控除の表の列。範囲外は -1） */
const ownerBandOf = (totalIncome: number, m: NenchoMaster) => m.spouse.ownerBands.findIndex((b) => totalIncome <= b);

/** 配偶者控除額・配偶者特別控除額 */
export const spouseDeductions = (spouse: NenchoInput["spouse"], ownerTotalIncome: number, m: NenchoMaster) => {
  const band = ownerBandOf(ownerTotalIncome, m);
  if (!spouse || band < 0) return { spouse: 0, spouseSpecial: 0 };
  const income = nonNeg(spouse.totalIncome);
  if (income <= m.spouse.spouseIncomeLimit) {
    return { spouse: (spouse.elderly ? m.spouse.elderly : m.spouse.normal)[band], spouseSpecial: 0 };
  }
  const row = m.spouse.special.find((r) => income > r.over && income <= r.upTo);
  return { spouse: 0, spouseSpecial: row ? row.amounts[band] : 0 };
};

/** 特定親族特別控除額（特定親族ごとの合計） */
export const specificRelativeDeduction = (incomes: number[], m: NenchoMaster): number =>
  incomes.reduce((sum, income) => sum + (m.specificRelative.find((r) => income > r.over && income <= r.upTo)?.amount ?? 0), 0);

/** 基礎控除額 */
export const basicDeduction = (totalIncome: number, m: NenchoMaster): number =>
  m.basic.find((b) => totalIncome <= b.upTo)?.amount ?? 0;

/** 算出所得税額 */
export const calculatedTaxOf = (taxable: number, m: NenchoMaster): number => {
  const row = m.taxRates.find((r) => taxable <= r.upTo);
  return row ? Math.max(0, (taxable * row.rate) / 100 - row.minus) : 0;
};

/** 年末調整の計算 */
export const calcNencho = (input: NenchoInput, m: NenchoMaster): NenchoResult => {
  const salary = nonNeg(input.salaryTotal);
  const roundedSalary = roundedSalaryOf(salary, m);
  const employmentIncome = employmentIncomeOf(salary, m);

  // 所得金額調整控除：（給与の総額 − 850万円）× 10%（1円未満切り上げ、最高15万円）
  const A = m.incomeAdjustment;
  const incomeAdjustment = input.incomeAdjustmentEligible && salary > A.threshold
    ? Math.min(Math.ceil(((salary - A.threshold) * A.ratePercent) / 100), A.max)
    : 0;
  const employmentIncomeAdjusted = Math.max(0, employmentIncome - incomeAdjustment);
  const totalIncome = employmentIncomeAdjusted + nonNeg(input.otherIncome);

  const D = m.deductions;
  const { spouse, spouseSpecial } = spouseDeductions(input.spouse, totalIncome, m);
  const dependentsAndOthers =
    D.dependentGeneral * nonNeg(input.dependents.general)
    + D.dependentSpecific * nonNeg(input.dependents.specific)
    + D.dependentElderlyLivingTogether * nonNeg(input.dependents.elderlyLivingTogether)
    + D.dependentElderlyOther * nonNeg(input.dependents.elderlyOther)
    + D.disabilityGeneral * nonNeg(input.disability.general)
    + D.disabilitySpecial * nonNeg(input.disability.special)
    + D.disabilitySpecialLivingTogether * nonNeg(input.disability.specialLivingTogether)
    + (input.widow ? D.widow : 0)
    + (input.singleParent ? D.singleParent : 0)
    + (input.workingStudent ? D.workingStudent : 0);
  const deductions = {
    socialInsurance: nonNeg(input.socialInsuranceFromPay) + nonNeg(input.socialInsuranceDeclared),
    smallBusinessMutualAid: nonNeg(input.smallBusinessMutualAid),
    lifeInsurance: lifeInsuranceDeduction(input.lifeInsurance, input.hasDependentUnder23, m),
    earthquake: earthquakeDeduction(input.earthquake, m),
    spouse,
    spouseSpecial,
    specificRelative: specificRelativeDeduction(input.specificRelativeIncomes, m),
    dependentsAndOthers,
    basic: basicDeduction(totalIncome, m),
    total: 0,
  };
  deductions.total = deductions.socialInsurance + deductions.smallBusinessMutualAid + deductions.lifeInsurance
    + deductions.earthquake + deductions.spouse + deductions.spouseSpecial + deductions.specificRelative
    + deductions.dependentsAndOthers + deductions.basic;

  const taxableIncome = floorTo(Math.max(0, employmentIncomeAdjusted - deductions.total), m.taxableRoundTo);
  const calculatedTax = calculatedTaxOf(taxableIncome, m);
  const housingLoanCredit = Math.min(nonNeg(input.housingLoanCredit), calculatedTax);
  const annualIncomeTax = calculatedTax - housingLoanCredit;
  // 年調所得税額 × 102.1%（小数の誤差を避けるため、率を10倍の整数にして計算する）
  const rate10 = Math.round(m.reconstruction.ratePercent * 10);
  const annualTax = floorTo(Math.floor((annualIncomeTax * rate10) / 1000), m.reconstruction.roundTo);
  const withheldTax = nonNeg(input.withheldTax);

  const ineligibleReason = salary > m.salaryLimit
    ? `給与の総額が${m.salaryLimit.toLocaleString()}円を超えるため、年末調整の対象になりません（本人が確定申告します）`
    : taxableIncome > m.taxableLimit
      ? `課税給与所得金額が${m.taxableLimit.toLocaleString()}円を超えるため、年末調整の対象になりません（本人が確定申告します）`
      : null;

  return {
    eligible: ineligibleReason === null,
    ineligibleReason,
    roundedSalary, employmentIncome, incomeAdjustment, employmentIncomeAdjusted, totalIncome,
    deductions, taxableIncome, calculatedTax, housingLoanCredit, annualIncomeTax, annualTax, withheldTax,
    difference: withheldTax - annualTax,
  };
};
