/**
 * 給与所得の源泉徴収票（受給者交付用）の各欄の中身を作る（令和8年分から）
 *
 * ■ 年末調整をした人：保存した申告書の内容と、その年に確定した給与・賞与から年末調整の計算をし直して、その結果を書く
 *   ・支払金額：給与・賞与の総額（非課税の通勤手当を除く。前の勤め先の給与を通算したときは、それも含める）
 *   ・給与所得控除後の金額（調整控除後）・所得控除の額の合計額・源泉徴収税額（年調年税額）など
 * ■ 年末調整をしない人（年の途中で退職した人・乙欄の人など）：支払金額・源泉徴収税額（源泉徴収した税額の合計）・社会保険料等の金額
 *   ・甲欄の人で、年末調整の画面に扶養控除等申告書の内容を入れてあれば、その記載に応じて（源泉）控除対象配偶者・控除対象扶養親族等の
 *     人数と氏名・16歳未満の扶養親族・障害者の人数・配偶者の所得の見積額を書く（手引 ⑧⑩⑪⑫㉒㉓㉔。年の途中で退職した人にも書く）。
 *     年末調整をしないので、源泉控除対象配偶者（配偶者の見積額95万円以下）・源泉控除対象親族（控除対象扶養親族と、見積額100万円以下の
 *     特定親族）で数え、扶養親族の所得の線は11月30日以前に出された申告書の線（58万円）で読む（手引「4 用語の説明」。constants の withoutAdjustment）。
 *     本人の合計所得金額が900万円以下であることは、申告書を出した本人が確かめている前提にする。配偶者（特別）控除の額などは書かない
 *   ・入れていなければ空欄にして、画面に注意を出す
 *
 * 出典：国税庁「令和8年分 給与所得の源泉徴収票等の法定調書の作成と提出の手引」第2章 3 各欄の記載要領（記載例1〜4）
 *       https://www.nta.go.jp/publication/pamph/hotei/tebiki2026/index.htm
 *       区分（特定親族・住宅借入金等特別控除）・未成年者の生年月日などは constants/nencho/gensen2026.ts（PDF から自動生成）
 * 受給者に交付する源泉徴収票には、マイナンバー・法人番号は書かない（手引 ②・㉙）
 */
import type { NenchoMaster, WithholdingSlipMaster } from "../constants/nencho";
import { calcNencho, specificRelativeDeduction, type NenchoInput, type NenchoResult } from "./nencho";
import {
  ageAtYearEnd, buildNenchoInput, classifyDependent, dependentIncomeLimit,
  type DeclaredDependent, type DeclaredPerson, type DependentKind, type NenchoDeclaration, type YearTotals,
} from "./nenchoDeclaration";
import { toTaxColumn } from "./incomeTax";
import { formatWareki, toWareki, type Wareki } from "./wareki";

/** 控除対象配偶者・控除対象扶養親族等・16歳未満の扶養親族の欄に書く人 */
export interface SlipPerson {
  furigana: string;
  name: string;
  /** 生年月日（源泉徴収票には書かない。給与支払報告書の CSV で、マイナンバーを結び付けるのに使う） */
  birthday: string;
  /** 区分（居住者は "00"、特定親族は特定親族特別控除の額に応じた数字。16歳未満の扶養親族は、受給者交付用では居住者なら空） */
  code: string;
}

export interface WithholdingSlip {
  year: number;
  /** 年末調整をした（年末調整をした受給者だけが書く欄に、値が入る） */
  adjusted: boolean;
  /** 年末調整をしていないが、扶養控除等申告書の記載に応じて配偶者・扶養親族の欄を書いた */
  declared: boolean;
  recipient: { address: string; furigana: string; name: string };
  /** 種別 */
  kind: string;
  /** 支払金額 */
  payment: number;
  /** 給与所得控除後の金額（調整控除後） */
  employmentIncome: number | null;
  /** 所得控除の額の合計額 */
  deductionTotal: number | null;
  /** 源泉徴収税額 */
  withholdingTax: number;
  /** 控除対象配偶者の有無等（有・老人） */
  spouseMark: { has: boolean; elderly: boolean };
  /** 配偶者（特別）控除の額 */
  spouseDeduction: number | null;
  /** 控除対象扶養親族の数（配偶者を除く）。特定・老人（うち同居老親等）・その他・特定親族。0人は null */
  dependentCounts: { specific: number | null; elderly: number | null; elderlyTogether: number | null; other: number | null; specificRelative: number | null };
  /** 16歳未満扶養親族の数 */
  youngCount: number | null;
  /** 障害者の数（本人を除く）。特別障害者（うち同居）・その他 */
  disabledCounts: { special: number | null; specialTogether: number | null; other: number | null };
  /** 特定親族特別控除の額 */
  specificRelativeDeduction: number | null;
  /** 社会保険料等の金額（うち小規模企業共済等掛金） */
  socialInsurance: number;
  smallBusinessMutualAid: number | null;
  lifeInsuranceDeduction: number | null;
  earthquakeDeduction: number | null;
  /** 住宅借入金等特別控除の額（年末調整で控除した額） */
  housingLoanCredit: number | null;
  /** 生命保険料の金額の内訳（支払った金額） */
  lifeInsurancePaid: { generalNew: number | null; generalOld: number | null; medical: number | null; pensionNew: number | null; pensionOld: number | null };
  /** 住宅借入金等特別控除の額の内訳（1回目・2回目。3回目以降は摘要欄） */
  housingLoan: {
    count: number | null;
    /** 住宅借入金等特別控除可能額（算出所得税額を超えて控除しきれないときだけ） */
    available: number | null;
    /** code は区分の番号（"01" など。給与支払報告書の CSV に書く） */
    entries: { residenceStart: Wareki | null; kindLabel: string; code: string; yearEndBalance: number | null }[];
  };
  /** （源泉・特別）控除対象配偶者 */
  spouse: SlipPerson | null;
  /** 配偶者の合計所得 */
  spouseTotalIncome: number | null;
  nationalPension: number | null;
  oldLongTerm: number | null;
  /** 基礎控除の額（年末調整をした人は、0円でも書く） */
  basicDeduction: number | null;
  incomeAdjustment: number | null;
  /** 控除対象扶養親族等（4人まで。5人目からは摘要欄） */
  dependents: SlipPerson[];
  /** 16歳未満の扶養親族（4人まで。5人目からは摘要欄） */
  youngDependents: SlipPerson[];
  /** 摘要 */
  remarks: string[];
  /** 給与支払報告書（eLTAX の CSV）の摘要。3つ目からの住宅借入金等の書き方だけが、源泉徴収票と違う */
  reportRemarks: string[];
  /** 前の勤め先（前の勤め先の給与を通算して年末調整したときだけ。給与支払報告書の CSV では「他の支払者」の欄にも書く） */
  previousJob: { address: string; name: string; salary: number; withheldTax: number; socialInsurance: number; retiredOn: Wareki | null } | null;
  marks: {
    minor: boolean; otsu: boolean;
    selfSpecialDisabled: boolean; selfDisabled: boolean;
    widow: boolean; singleParent: boolean; workingStudent: boolean;
  };
  /** 中途就・退職（同じ年に就職と退職の両方なら、退職だけに印をつけて退職日を書き、摘要に「中途就」） */
  joinRetire: { joined: boolean; retired: boolean; date: Wareki | null };
  birthday: Wareki | null;
  payer: { address: string; name: string; phone: string };
  /** 画面にだけ出す注意（印刷しない） */
  warnings: string[];
}

export interface SlipSource {
  year: number;
  staff: {
    name?: string | null; furigana?: string | null; address?: string | null; birthday?: string | null;
    join_date?: string | null; retirement_date?: string | null; tax_column?: unknown;
  };
  company: { name?: string | null; address?: string | null; phone?: string | null };
  /** その年に確定した給与・賞与の合計（Q の分） */
  totals: YearTotals;
  /** 年末調整の申告書（年末調整をしない人は null） */
  declaration: NenchoDeclaration | null;
  /** 年末調整をしない人が出した扶養控除等申告書（年末調整の画面で入れたもの。配偶者・扶養親族の欄を、その記載に応じて書く） */
  sourceDeclaration?: NenchoDeclaration | null;
}

const orNull = (n: number) => (n > 0 ? n : null);
const yen = (n: number) => `${n.toLocaleString()}円`;
const pad2 = (n: number) => String(n).padStart(2, "0");
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const inYear = (date: string | null | undefined, year: number) => !!date && date >= `${year}-01-01` && date <= `${year}-12-31`;

/** 特定親族特別控除の額から、源泉徴収票の区分（居住者）を出す */
export const specificRelativeCode = (deduction: number, gm: WithholdingSlipMaster): string =>
  gm.specificRelativeCodes.find((c) => c.amount === deduction)?.resident ?? "";

/** 年末調整をしない人の特定親族の区分（合計所得の見積額による。表のいちばん上の行の「62万円超」は、11月30日以前の線で読む） */
export const specificRelativeCodeByIncome = (income: number, gm: WithholdingSlipMaster): string =>
  gm.specificRelativeCodes
    .map((c, i) => (i === 0 ? { ...c, over: gm.withoutAdjustment.earlierIncomeLimit } : c))
    .find((c) => income > c.over && income <= c.upTo)?.resident ?? "";

/** 年末調整をしない人の扶養親族の分け方（扶養控除等申告書の記載に応じて。源泉控除対象親族かどうか） */
export const classifySourceDependent = (d: DeclaredDependent, year: number, nm: NenchoMaster, gm: WithholdingSlipMaster): DependentKind =>
  classifyDependent(d, year, nm, { income: gm.withoutAdjustment.earlierIncomeLimit, specificRelative: gm.withoutAdjustment.specificRelativeLimit });

/** 住宅借入金等特別控除区分の、受給者交付用の書き方（住（特）など） */
export const housingLoanKindLabel = (code: string, gm: WithholdingSlipMaster): string =>
  gm.housingLoanKinds.find((k) => k.code === code)?.label ?? "";

/** 住宅借入金等特別控除区分の説明（入力画面の選択肢に使う。手引 ⑲ の表の言葉） */
export const housingLoanKindDescription = (label: string): string => {
  const head = label.startsWith("認") ? "認定住宅等" : label.startsWith("震") ? "震災再取得等" : "一般の住宅";
  const tail = label.endsWith("（特特特）") ? "特例特別特例取得"
    : label.endsWith("（特特）") ? "特別特定取得・特例取得・特別特例取得"
    : label.endsWith("（特）") ? "特定取得"
    : label.endsWith("（特家）") ? (label.startsWith("認") ? "特例認定住宅等" : "特例居住用家屋")
    : "上記以外（増改築等を含む）";
  return `${label}：${head}・${tail}`;
};

const person = (p: DeclaredPerson, code: string): SlipPerson => ({ furigana: str(p.furigana), name: str(p.name), birthday: str(p.birthday), code });

/** 障害者の数（本人を除く）を数える */
const disabilityCounter = () => {
  const counts = { special: 0, specialTogether: 0, other: 0 };
  const add = (x: DeclaredPerson) => {
    if (x.disability === "special") {
      counts.special++;
      if (x.livingTogether) counts.specialTogether++;
    }
    if (x.disability === "general") counts.other++;
  };
  return { counts, add };
};

/**
 * 控除対象扶養親族等・16歳未満の扶養親族の人数と欄、障害者の人数を書く（申告書に入れた順）
 * @param relativeCodeOf 特定親族の区分（書かない特定親族は null）
 */
const fillDependents = (
  slip: WithholdingSlip, deps: DeclaredDependent[], gm: WithholdingSlipMaster,
  kindOf: (d: DeclaredDependent) => DependentKind,
  relativeCodeOf: (d: DeclaredDependent) => string | null,
  disabled: ReturnType<typeof disabilityCounter>,
  overflow: string[],
) => {
  const counts = { specific: 0, elderly: 0, elderlyTogether: 0, other: 0, specificRelative: 0, young: 0 };
  const listed: SlipPerson[] = [];
  const young: SlipPerson[] = [];
  for (const dep of deps) {
    const kind = kindOf(dep);
    if (kind === "none") continue;
    if (kind === "specificRelative") {
      const code = relativeCodeOf(dep);
      if (code === null) continue;
      counts.specificRelative++;
      listed.push(person(dep, code));
      continue;
    }
    disabled.add(dep);
    if (kind === "young") {
      counts.young++;
      young.push(person(dep, "")); // 受給者交付用：国内に住所がある人は区分を書かない
      continue;
    }
    if (kind === "specific") counts.specific++;
    if (kind === "general") counts.other++;
    if (kind === "elderlyTogether" || kind === "elderlyOther") counts.elderly++;
    if (kind === "elderlyTogether") counts.elderlyTogether++;
    listed.push(person(dep, gm.residentCode));
  }
  slip.dependentCounts = {
    specific: orNull(counts.specific), elderly: orNull(counts.elderly), elderlyTogether: orNull(counts.elderlyTogether),
    other: orNull(counts.other), specificRelative: orNull(counts.specificRelative),
  };
  slip.youngCount = orNull(counts.young);
  const d = disabled.counts;
  slip.disabledCounts = { special: orNull(d.special), specialTogether: orNull(d.specialTogether), other: orNull(d.other) };
  slip.dependents = listed.slice(0, 4);
  slip.youngDependents = young.slice(0, 4);
  // 5人目からは摘要欄に（1）（2）…を付けて書く。16歳未満は「（年少）」、特定親族は区分の数字を後ろに付ける
  let n = 0;
  for (const x of listed.slice(4)) overflow.push(`(${++n})${x.name}${x.code !== gm.residentCode ? ` ${x.code}` : ""}`);
  for (const x of young.slice(4)) overflow.push(`(${++n})${x.name}（年少）`);
};

/** 源泉徴収票の各欄を作る */
export const buildWithholdingSlip = (src: SlipSource, nm: NenchoMaster, gm: WithholdingSlipMaster): WithholdingSlip => {
  const { year, staff, company, totals } = src;
  const warnings: string[] = [];
  /** 摘要（5人目からの扶養親族等は、ほかのことより前に書く） */
  const overflow: string[] = [];
  const remarks: string[] = [];
  const reportRemarks: string[] = [];
  /** 摘要に書く（給与支払報告書の CSV で書き方が違うものは、reportText に） */
  const note = (text: string, reportText = text) => {
    remarks.push(text);
    reportRemarks.push(reportText);
  };

  // 年末調整をし直す（年末調整の対象外になる人は、年末調整をしない人として書く）
  let decl = src.declaration;
  let input: NenchoInput | null = null;
  let result: NenchoResult | null = null;
  /** 年末調整をしない人の扶養控除等申告書（年末調整の対象外になった人は、年末調整の申告書を使う） */
  let sourceDecl = src.sourceDeclaration ?? null;
  if (decl) {
    input = buildNenchoInput(decl, totals, year, nm);
    result = calcNencho(input, nm);
    if (!result.eligible) {
      warnings.push(`${result.ineligibleReason}。年末調整をしない人として作ります。`);
      sourceDecl = decl;
      decl = null;
      result = null;
    }
  }
  const column = toTaxColumn(staff.tax_column);
  const otsu = column === "otsu";

  // 中途就・退職
  const joined = inYear(staff.join_date, year);
  const retired = inYear(staff.retirement_date, year);
  const joinRetire = {
    joined: joined && !retired,
    retired,
    date: toWareki(retired ? staff.retirement_date : joined ? staff.join_date : null),
  };

  const slip: WithholdingSlip = {
    year,
    adjusted: !!result,
    declared: false,
    recipient: { address: str(staff.address), furigana: str(staff.furigana), name: str(staff.name) },
    kind: totals.bonusCount > 0 ? "給与・賞与" : "給与",
    payment: totals.salary,
    employmentIncome: null,
    deductionTotal: null,
    withholdingTax: totals.withheldTax,
    spouseMark: { has: false, elderly: false },
    spouseDeduction: null,
    dependentCounts: { specific: null, elderly: null, elderlyTogether: null, other: null, specificRelative: null },
    youngCount: null,
    disabledCounts: { special: null, specialTogether: null, other: null },
    specificRelativeDeduction: null,
    socialInsurance: totals.socialInsurance,
    smallBusinessMutualAid: null,
    lifeInsuranceDeduction: null,
    earthquakeDeduction: null,
    housingLoanCredit: null,
    lifeInsurancePaid: { generalNew: null, generalOld: null, medical: null, pensionNew: null, pensionOld: null },
    housingLoan: { count: null, available: null, entries: [] },
    spouse: null,
    spouseTotalIncome: null,
    nationalPension: null,
    oldLongTerm: null,
    basicDeduction: null,
    incomeAdjustment: null,
    dependents: [],
    youngDependents: [],
    remarks,
    reportRemarks,
    previousJob: null,
    marks: {
      // 未成年者：手引に書かれた生年月日以後に生まれた人
      minor: !!staff.birthday && staff.birthday >= gm.minorBornOnOrAfter,
      otsu,
      selfSpecialDisabled: false, selfDisabled: false, widow: false, singleParent: false, workingStudent: false,
    },
    joinRetire,
    birthday: toWareki(staff.birthday),
    payer: { address: str(company.address), name: str(company.name), phone: str(company.phone) },
    warnings,
  };

  if (decl && input && result) {
    const d = result.deductions;
    const p = decl.previousJob;
    slip.payment = totals.salary + (Number(p.salary) || 0);
    slip.employmentIncome = result.employmentIncomeAdjusted;
    slip.deductionTotal = d.total;
    slip.withholdingTax = result.annualTax;
    slip.spouseDeduction = orNull(d.spouse + d.spouseSpecial);
    slip.specificRelativeDeduction = orNull(d.specificRelative);
    slip.socialInsurance = d.socialInsurance + d.smallBusinessMutualAid;
    slip.smallBusinessMutualAid = orNull(d.smallBusinessMutualAid);
    slip.lifeInsuranceDeduction = orNull(d.lifeInsurance);
    slip.earthquakeDeduction = orNull(d.earthquake);
    slip.housingLoanCredit = orNull(result.housingLoanCredit);
    slip.basicDeduction = d.basic;
    slip.incomeAdjustment = orNull(result.incomeAdjustment);
    slip.nationalPension = orNull(decl.insurance.nationalPension);
    slip.oldLongTerm = d.earthquake > 0 ? orNull(decl.insurance.oldLongTerm) : null;
    if (d.lifeInsurance > 0) {
      const i = decl.insurance;
      slip.lifeInsurancePaid = {
        generalNew: orNull(i.lifeGeneralNew), generalOld: orNull(i.lifeGeneralOld), medical: orNull(i.lifeMedical),
        pensionNew: orNull(i.lifePensionNew), pensionOld: orNull(i.lifePensionOld),
      };
    }
    slip.marks.selfSpecialDisabled = decl.self.disability === "special";
    slip.marks.selfDisabled = decl.self.disability === "general";
    slip.marks.widow = decl.self.widow;
    slip.marks.singleParent = decl.self.singleParent;
    slip.marks.workingStudent = decl.self.workingStudent;

    // 配偶者：配偶者控除・配偶者特別控除を受けたら、控除対象配偶者の欄に書く
    const limit = dependentIncomeLimit(nm);
    const disabled = disabilityCounter();
    const countDisability = disabled.add;
    if (decl.spouse) {
      const s = decl.spouse;
      const sameLivelihood = (Number(s.totalIncome) || 0) <= limit; // 同一生計配偶者
      if (d.spouse + d.spouseSpecial > 0) {
        slip.spouse = person(s, gm.residentCode);
        slip.spouseTotalIncome = Math.max(0, Number(s.totalIncome) || 0);
        slip.spouseMark = { has: d.spouse > 0, elderly: d.spouse > 0 && (ageAtYearEnd(s.birthday, year) ?? 0) >= 70 };
      } else if (sameLivelihood && s.disability !== "none") {
        // 控除対象配偶者ではない同一生計配偶者が障害者（所得金額調整控除の要件になる特別障害者も、同じ書き方）
        note(`${str(s.name)}（同配）`);
      }
      if (sameLivelihood) countDisability(s);
    }

    // 扶養親族・特定親族（申告書に入れた順。特定親族は、特定親族特別控除を受けた人だけ）
    fillDependents(slip, decl.dependents, gm, (dep) => classifyDependent(dep, year, nm), (dep) => {
      const amount = specificRelativeDeduction([Math.max(0, Number(dep.totalIncome) || 0)], nm);
      return amount > 0 ? specificRelativeCode(amount, gm) : null;
    }, disabled, overflow);

    // 生命保険料控除の特例（23歳未満の扶養親族がいて、新生命保険料を払った）
    if (d.lifeInsurance > 0 && decl.insurance.lifeGeneralNew > 0 && input.hasDependentUnder23) {
      note(gm.lifeInsuranceYoungNote);
    }

    // 住宅借入金等特別控除の内訳
    const declared = Math.max(0, Number(decl.housingLoanCredit) || 0);
    if (declared > 0) {
      const loans = decl.housingLoans;
      slip.housingLoan.count = orNull(loans.length);
      slip.housingLoan.available = declared > result.housingLoanCredit ? declared : null;
      // 年末残高は、2つ以上の控除を受けるときに書く
      const many = loans.length >= 2;
      slip.housingLoan.entries = loans.slice(0, 2).map((h) => ({
        residenceStart: toWareki(h.residenceStart),
        kindLabel: housingLoanKindLabel(h.kindCode, gm),
        code: str(h.kindCode),
        yearEndBalance: many ? orNull(Number(h.yearEndBalance) || 0) : null,
      }));
      // 給与支払報告書の CSV では「住借区分（何回目）××」「住借控除居住年月日（何回目）××年××月××日」「住借額（何回目）×××円」
      // （地方税共同機構「給与支払報告書CSVレイアウト仕様書（総務省通知形式）」項番86 摘要。年は和暦）
      loans.slice(2).forEach((h, i) => {
        const w = toWareki(h.residenceStart);
        const n = `（${i + 3}回目）`;
        note(
          `居住開始年月日 ${formatWareki(h.residenceStart)} 住宅借入金等特別控除区分 ${housingLoanKindLabel(h.kindCode, gm)} 住宅借入金等年末残高 ${yen(Number(h.yearEndBalance) || 0)}`,
          `住借区分${n}${str(h.kindCode)} 住借控除居住年月日${n}${w ? `${pad2(w.year)}年${pad2(w.month)}月${pad2(w.day)}日` : ""} 住借額${n}${Number(h.yearEndBalance) || 0}円`,
        );
      });
      if (loans.length === 0) warnings.push("住宅借入金等特別控除の内訳（居住開始年月日・区分）が入っていません。年末調整の画面で入れてください。");
    }

    // 前の勤め先の給与を通算した
    if ((Number(p.salary) || 0) > 0) {
      const retiredOn = formatWareki(p.retiredOn);
      slip.previousJob = {
        address: str(p.payerAddress), name: str(p.payerName), salary: Number(p.salary) || 0,
        withheldTax: Number(p.withheldTax) || 0, socialInsurance: Number(p.socialInsurance) || 0, retiredOn: toWareki(p.retiredOn),
      };
      note([
        str(p.payerAddress), str(p.payerName), retiredOn ? `${retiredOn}退職` : "",
        `支払金額 ${yen(Number(p.salary) || 0)}`, `源泉徴収税額 ${yen(Number(p.withheldTax) || 0)}`, `社会保険料 ${yen(Number(p.socialInsurance) || 0)}`,
      ].filter(Boolean).join(" "));
      if (!str(p.payerName) || !retiredOn) warnings.push("前の勤め先の名称・所在地・退職日が入っていません（摘要欄に書きます）。年末調整の画面で入れてください。");
    }
  } else if (otsu) {
    warnings.push("乙欄の人です。年末調整をしないので、支払金額・源泉徴収税額・社会保険料等の金額だけを書きます（「従たる給与についての扶養控除等申告書」の人数の欄は、必要なら手で書き足してください）。");
  } else if (column === "hei") {
    // 「乙欄」の欄に丙欄の人も○を付けるのかは、国税庁の手引に書かれていないので付けない
    warnings.push("丙欄（日雇賃金）の人です。年末調整をしないので、支払金額・源泉徴収税額・社会保険料等の金額だけを書きます。「乙欄」の欄には○を付けていません。");
  } else if (sourceDecl) {
    // 年末調整をしない人：扶養控除等申告書の記載に応じて書く（源泉控除対象配偶者・源泉控除対象親族）
    const w = gm.withoutAdjustment;
    slip.declared = true;
    const disabled = disabilityCounter();
    const s = sourceDecl.spouse;
    if (s) {
      const income = Math.max(0, Number(s.totalIncome) || 0);
      if (income <= w.spouseIncomeLimit) {
        slip.spouse = person(s, gm.residentCode);
        slip.spouseTotalIncome = income; // ㉓ 源泉控除対象配偶者の「所得の見積額」
        slip.spouseMark = { has: true, elderly: (ageAtYearEnd(s.birthday, year) ?? 0) >= 70 };
      }
      if (income <= w.earlierIncomeLimit) disabled.add(s); // 同一生計配偶者
    }
    fillDependents(slip, sourceDecl.dependents, gm, (dep) => classifySourceDependent(dep, year, nm, gm),
      (dep) => specificRelativeCodeByIncome(Math.max(0, Number(dep.totalIncome) || 0), gm) || null, disabled, overflow);
    slip.marks.selfSpecialDisabled = sourceDecl.self.disability === "special";
    slip.marks.selfDisabled = sourceDecl.self.disability === "general";
    slip.marks.widow = sourceDecl.self.widow;
    slip.marks.singleParent = sourceDecl.self.singleParent;
    slip.marks.workingStudent = sourceDecl.self.workingStudent;
    warnings.push("年末調整をしていないので、配偶者・扶養親族の欄は、扶養控除等申告書の記載に応じて書きます（配偶者（特別）控除の額など、年末調整をした人だけが書く欄は空欄）。");
  } else {
    warnings.push("年末調整をしていないので、支払金額・源泉徴収税額・社会保険料等の金額だけを書きます。控除対象配偶者・扶養親族の欄は、年末調整の画面で扶養控除等申告書の内容を入れると書けます。");
  }

  // 同じ年に就職と退職の両方
  if (joined && retired) note("中途就");

  slip.remarks = [...overflow, ...remarks];
  slip.reportRemarks = [...overflow, ...reportRemarks];
  return slip;
};
