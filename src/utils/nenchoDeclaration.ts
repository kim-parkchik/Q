/**
 * 年末調整の申告書の内容（扶養控除等申告書・基礎控除申告書・配偶者控除等申告書・保険料控除申告書・住宅借入金等特別控除申告書）と、
 * 1年分の給与・賞与の集計から、年税額の計算（utils/nencho.ts）に渡す値を作る
 *
 * ■ 扶養親族・配偶者の区分は、その年の12月31日の現況で決める（年齢は、誕生日の前日に1つ上がる）
 *   ・扶養親族：合計所得金額が62万円以下（令和8年分。同一生計配偶者と同じ）の親族
 *     - 16歳未満：年少扶養親族（扶養控除はないが、障害者控除・所得金額調整控除・生命保険料控除の特例の判定には入る）
 *     - 19歳以上23歳未満：特定扶養親族
 *     - 70歳以上：老人扶養親族（本人・配偶者の直系尊属で同居していれば同居老親等）
 *     - それ以外の16歳以上：一般の控除対象扶養親族
 *   ・19歳以上23歳未満で、合計所得金額が62万円を超え123万円以下の親族は、特定親族（特定親族特別控除）
 *   ・配偶者：70歳以上なら老人控除対象配偶者。合計所得金額で配偶者控除か配偶者特別控除かが決まる（utils/nencho.ts）
 *   ・障害者控除は、本人・同一生計配偶者・扶養親族（年少も含む）ごと。同一生計配偶者・扶養親族が特別障害者で同居なら同居特別障害者
 * 出典：国税庁 タックスアンサー No.1180（扶養控除。令和8年分の所得要件は62万円以下）
 *       https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1180.htm
 *       「令和8年分 年末調整のしかた」の扶養控除額等の表（特定扶養親族は平成16年1月2日〜平成20年1月1日生など）
 */
import type { NenchoMaster } from "../constants/nencho";
import type { NenchoInput } from "./nencho";
import { toTaxColumn } from "./incomeTax";

export type DisabilityKind = "none" | "general" | "special";

export interface DeclaredPerson {
  name: string;
  /** フリガナ（源泉徴収票に書く。なくてもよい） */
  furigana?: string;
  /** 生年月日（YYYY-MM-DD） */
  birthday: string;
  /** その年の合計所得金額の見積額 */
  totalIncome: number;
  disability: DisabilityKind;
  /** 本人と同居している */
  livingTogether: boolean;
}

export interface DeclaredDependent extends DeclaredPerson {
  /** 続柄（子・父・母など。表示用） */
  relation: string;
  /** 本人または配偶者の直系尊属（父母・祖父母など）。老人扶養親族の同居老親等の判定に使う */
  linealAscendant: boolean;
}

export interface NenchoDeclaration {
  self: {
    disability: DisabilityKind;
    /** 寡婦（ひとり親とは同時に受けられない） */
    widow: boolean;
    singleParent: boolean;
    workingStudent: boolean;
    /** 給与所得以外の所得の合計（基礎控除申告書） */
    otherIncome: number;
  };
  spouse: DeclaredPerson | null;
  dependents: DeclaredDependent[];
  insurance: {
    lifeGeneralNew: number;
    lifeGeneralOld: number;
    lifeMedical: number;
    lifePensionNew: number;
    lifePensionOld: number;
    earthquake: number;
    oldLongTerm: number;
    /** 申告した社会保険料（国民年金・国民健康保険など、給与から引いていないもの） */
    socialInsurance: number;
    /** 申告した社会保険料のうち、国民年金保険料・国民年金基金の掛金（源泉徴収票の「国民年金保険料等の金額」） */
    nationalPension: number;
    /** 小規模企業共済等掛金（iDeCo など） */
    smallBusinessMutualAid: number;
  };
  /** 住宅借入金等特別控除申告書の控除額 */
  housingLoanCredit: number;
  /** 住宅借入金等特別控除の内訳（住宅の取得等ごと。源泉徴収票の「住宅借入金等特別控除の額の内訳」） */
  housingLoans: HousingLoan[];
  /** 前の勤め先の給与（その年に転職した人。前の勤め先の源泉徴収票の金額と、源泉徴収票の摘要欄に書く支払者・退職日） */
  previousJob: { salary: number; socialInsurance: number; withheldTax: number; payerName: string; payerAddress: string; retiredOn: string };
}

export interface HousingLoan {
  /** 居住開始年月日（YYYY-MM-DD） */
  residenceStart: string;
  /** 住宅借入金等特別控除区分（税務署提出用の数字。constants/nencho の housingLoanKinds） */
  kindCode: string;
  /** 住宅借入金等年末残高 */
  yearEndBalance: number;
}

export const emptyDeclaration = (): NenchoDeclaration => ({
  self: { disability: "none", widow: false, singleParent: false, workingStudent: false, otherIncome: 0 },
  spouse: null,
  dependents: [],
  insurance: {
    lifeGeneralNew: 0, lifeGeneralOld: 0, lifeMedical: 0, lifePensionNew: 0, lifePensionOld: 0,
    earthquake: 0, oldLongTerm: 0, socialInsurance: 0, nationalPension: 0, smallBusinessMutualAid: 0,
  },
  housingLoanCredit: 0,
  housingLoans: [],
  previousJob: { salary: 0, socialInsurance: 0, withheldTax: 0, payerName: "", payerAddress: "", retiredOn: "" },
});

/** 保存した申告書（JSON）を読む。足りない項目は空の値で埋める */
export const parseDeclaration = (json: unknown): NenchoDeclaration => {
  const base = emptyDeclaration();
  if (typeof json !== "string" || !json.trim()) return base;
  try {
    const d = JSON.parse(json);
    return {
      self: { ...base.self, ...(d?.self ?? {}) },
      spouse: d?.spouse ?? null,
      dependents: Array.isArray(d?.dependents) ? d.dependents : [],
      insurance: { ...base.insurance, ...(d?.insurance ?? {}) },
      housingLoanCredit: Number(d?.housingLoanCredit) || 0,
      housingLoans: Array.isArray(d?.housingLoans) ? d.housingLoans : [],
      previousJob: { ...base.previousJob, ...(d?.previousJob ?? {}) },
    };
  } catch {
    return base;
  }
};

/**
 * その年の12月31日の年齢（誕生日の前日に年齢が上がるので、1月1日生まれは12月31日に1つ上がる）
 * 生年月日がなければ null
 */
export const ageAtYearEnd = (birthday: string, year: number): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthday || "");
  if (!m) return null;
  const [by, bm, bd] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return year - by + (bm === 1 && bd === 1 ? 1 : 0);
};

/** 扶養親族の区分 */
export type DependentKind =
  | "young"            // 年少扶養親族（16歳未満）
  | "general"          // 一般の控除対象扶養親族
  | "specific"         // 特定扶養親族（19歳以上23歳未満）
  | "elderlyTogether"  // 老人扶養親族（同居老親等）
  | "elderlyOther"     // 老人扶養親族（同居老親等以外）
  | "specificRelative" // 特定親族（特定親族特別控除）
  | "none";            // 所得が多いなどで対象外

export const DEPENDENT_KIND_LABELS: Record<DependentKind, string> = {
  young: "年少扶養親族（扶養控除なし）",
  general: "一般の控除対象扶養親族",
  specific: "特定扶養親族",
  elderlyTogether: "老人扶養親族（同居老親等）",
  elderlyOther: "老人扶養親族（同居老親等以外）",
  specificRelative: "特定親族（特定親族特別控除）",
  none: "対象外（合計所得金額が多い）",
};

/**
 * 扶養親族などの合計所得金額の上限（令和8年分は62万円）
 * 扶養親族と同一生計配偶者の所得要件は同じなので、配偶者控除の表の上限を使う
 */
export const dependentIncomeLimit = (m: NenchoMaster) => m.spouse.spouseIncomeLimit;

/** 特定親族の合計所得金額の上限（特定親族特別控除の表の最後の行） */
const specificRelativeLimit = (m: NenchoMaster) => m.specificRelative[m.specificRelative.length - 1].upTo;

/**
 * @param limits 扶養親族の合計所得の線と、特定親族の上の線（年末調整をしない人の源泉徴収票では、手引の別の線を使う。utils/withholdingSlip.ts）
 */
export const classifyDependent = (
  d: DeclaredDependent, year: number, m: NenchoMaster,
  limits: { income: number; specificRelative: number } = { income: dependentIncomeLimit(m), specificRelative: specificRelativeLimit(m) },
): DependentKind => classifyDependentByLimits(d, year, limits);

/**
 * 扶養親族の区分を、その年の12月31日の年齢と、所得の線で決める
 * （年末調整の表がない年分の、年末調整をしない人の源泉徴収票でも使う。utils/withholdingSlip.ts の classifySourceDependent）
 */
export const classifyDependentByLimits = (
  d: DeclaredDependent, year: number, limits: { income: number; specificRelative: number },
): DependentKind => {
  const age = ageAtYearEnd(d.birthday, year);
  if (age === null) return "none";
  const income = Math.max(0, Number(d.totalIncome) || 0);
  if (income > limits.income) {
    return age >= 19 && age < 23 && income <= limits.specificRelative ? "specificRelative" : "none";
  }
  if (age < 16) return "young";
  if (age >= 19 && age < 23) return "specific";
  if (age >= 70) return d.linealAscendant && d.livingTogether ? "elderlyTogether" : "elderlyOther";
  return "general";
};

/** 1年分の給与・賞与の集計（確定したもの） */
export interface YearTotals {
  /** 給与・賞与の総額（課税されるもの。非課税の通勤手当は除く） */
  salary: number;
  /** 給与・賞与から差し引いた社会保険料等 */
  socialInsurance: number;
  /** 給与・賞与から源泉徴収した税額 */
  withheldTax: number;
  /** 給与を確定した月（支払った月） */
  salaryMonths: number[];
  /** 確定した賞与の数 */
  bonusCount: number;
}

/**
 * 確定した給与（salary_results）と賞与（bonus_results）を合計する
 * 給与は課税対象額（非課税の通勤手当を除いた額）、賞与は総支給額（すべて課税）
 */
export const sumYearTotals = (
  salaries: { target_month: number; taxable_amount: number; social_ins_total: number; income_tax: number }[],
  bonuses: { total_earnings: number; health_insurance: number; nursing_insurance: number; child_support: number; welfare_pension: number; emp_insurance: number; income_tax: number }[],
): YearTotals => {
  const n = (v: unknown) => Number(v) || 0;
  return {
    salary: salaries.reduce((s, r) => s + n(r.taxable_amount), 0) + bonuses.reduce((s, r) => s + n(r.total_earnings), 0),
    socialInsurance: salaries.reduce((s, r) => s + n(r.social_ins_total), 0)
      + bonuses.reduce((s, r) => s + n(r.health_insurance) + n(r.nursing_insurance) + n(r.child_support) + n(r.welfare_pension) + n(r.emp_insurance), 0),
    withheldTax: salaries.reduce((s, r) => s + n(r.income_tax), 0) + bonuses.reduce((s, r) => s + n(r.income_tax), 0),
    salaryMonths: salaries.map((r) => Number(r.target_month)).sort((a, b) => a - b),
    bonusCount: bonuses.length,
  };
};

/** 申告書の内容と1年分の集計から、年税額の計算に渡す値を作る */
export const buildNenchoInput = (decl: NenchoDeclaration, totals: YearTotals, year: number, m: NenchoMaster): NenchoInput => {
  const dependents = { general: 0, specific: 0, elderlyLivingTogether: 0, elderlyOther: 0 };
  const disability = { general: 0, special: 0, specialLivingTogether: 0 };
  const specificRelativeIncomes: number[] = [];
  let hasDependentUnder23 = false;
  let hasSpecialDisability = decl.self.disability === "special";

  const addDisability = (p: DeclaredPerson, canLiveTogether: boolean) => {
    if (p.disability === "general") disability.general++;
    if (p.disability === "special") {
      hasSpecialDisability = true;
      if (canLiveTogether && p.livingTogether) disability.specialLivingTogether++;
      else disability.special++;
    }
  };

  // 本人
  addDisability({ name: "", birthday: "", totalIncome: 0, livingTogether: false, disability: decl.self.disability }, false);

  // 配偶者（障害者控除は、合計所得金額が上限以下の同一生計配偶者だけ）
  let spouse: NenchoInput["spouse"] = null;
  if (decl.spouse) {
    const age = ageAtYearEnd(decl.spouse.birthday, year);
    const income = Math.max(0, Number(decl.spouse.totalIncome) || 0);
    spouse = { totalIncome: income, elderly: age !== null && age >= 70 };
    if (income <= dependentIncomeLimit(m)) addDisability(decl.spouse, true);
  }

  // 扶養親族・特定親族
  for (const d of decl.dependents) {
    const kind = classifyDependent(d, year, m);
    if (kind === "none") continue;
    if (kind === "specificRelative") {
      specificRelativeIncomes.push(Math.max(0, Number(d.totalIncome) || 0));
      continue;
    }
    if (kind === "general") dependents.general++;
    if (kind === "specific") dependents.specific++;
    if (kind === "elderlyTogether") dependents.elderlyLivingTogether++;
    if (kind === "elderlyOther") dependents.elderlyOther++;
    const age = ageAtYearEnd(d.birthday, year);
    if (age !== null && age < 23) hasDependentUnder23 = true;
    addDisability(d, true);
  }

  const p = decl.previousJob;
  return {
    salaryTotal: totals.salary + (Number(p.salary) || 0),
    withheldTax: totals.withheldTax + (Number(p.withheldTax) || 0),
    socialInsuranceFromPay: totals.socialInsurance + (Number(p.socialInsurance) || 0),
    socialInsuranceDeclared: decl.insurance.socialInsurance,
    smallBusinessMutualAid: decl.insurance.smallBusinessMutualAid,
    lifeInsurance: {
      generalNew: decl.insurance.lifeGeneralNew, generalOld: decl.insurance.lifeGeneralOld, medical: decl.insurance.lifeMedical,
      pensionNew: decl.insurance.lifePensionNew, pensionOld: decl.insurance.lifePensionOld,
    },
    earthquake: { earthquake: decl.insurance.earthquake, oldLongTerm: decl.insurance.oldLongTerm },
    housingLoanCredit: decl.housingLoanCredit,
    otherIncome: decl.self.otherIncome,
    // 所得金額調整控除：本人・同一生計配偶者・扶養親族が特別障害者、または23歳未満の扶養親族がいる
    incomeAdjustmentEligible: hasDependentUnder23 || hasSpecialDisability,
    hasDependentUnder23,
    spouse,
    dependents,
    specificRelativeIncomes,
    disability,
    widow: decl.self.widow,
    singleParent: decl.self.singleParent,
    workingStudent: decl.self.workingStudent,
  };
};

/** 入力の誤り（寡婦とひとり親の両方・生年月日がない人）。なければ空 */
export const validateDeclaration = (decl: NenchoDeclaration): string[] => {
  const errors: string[] = [];
  if (decl.self.widow && decl.self.singleParent) errors.push("寡婦控除とひとり親控除は、どちらか一方だけです");
  if (decl.spouse && ageAtYearEnd(decl.spouse.birthday, 2000) === null) errors.push("配偶者の生年月日を入れてください");
  decl.dependents.forEach((d, i) => {
    if (!d.birthday) errors.push(`扶養親族${i + 1}人目（${d.name || "名前なし"}）の生年月日を入れてください`);
  });
  if (decl.insurance.nationalPension > decl.insurance.socialInsurance) {
    errors.push("国民年金保険料等の金額は、社会保険料（申告分）のうちの金額です。社会保険料（申告分）以下にしてください");
  }
  decl.housingLoans.forEach((h, i) => {
    if (!h.residenceStart || !h.kindCode) errors.push(`住宅借入金等特別控除の${i + 1}つ目の居住開始年月日と区分を入れてください`);
  });
  return errors;
};

/**
 * 年末調整の対象かどうか（対象でなければ理由）
 * ・乙欄・丙欄の人（扶養控除等申告書を出していない）はしない（所得税法190条）
 * ・年の途中で退職した人は、原則としてしない（12月中に退職した人は、その年最後の給与を支払った後なら対象）
 * 出典：国税庁「令和8年分 年末調整のしかた」（年末調整の対象となる人）
 */
export const nenchoExclusion = (staff: { tax_column?: unknown; retirement_date?: string | null }, year: number): string | null => {
  const column = toTaxColumn(staff.tax_column);
  if (column === "otsu") return "乙欄の人は年末調整をしません（本人が確定申告します）";
  if (column === "hei") return "丙欄（日雇賃金）の人は年末調整をしません（扶養控除等申告書を出していないため）";
  if (staff.retirement_date && staff.retirement_date < `${year}-12-01`) return "年の途中で退職した人は、年末調整をしません（本人が確定申告します）";
  return null;
};

/**
 * 過不足額の精算の状況
 * ・done: 精算する給与を確定済みで、過不足額が載っている
 * ・redo: 精算する給与を確定済みだが、載っている過不足額が違う（給与明細を開き直して確定し直す）
 * ・pending: 精算する給与をまだ確定していない
 * @param settledAmount 精算する給与の確定結果に載っている過不足額（まだ確定していなければ null）
 */
export type SettlementStatus = "done" | "redo" | "pending";

export const settlementStatusOf = (difference: number, settledAmount: number | null): SettlementStatus =>
  settledAmount === null ? "pending" : settledAmount === difference ? "done" : "redo";
