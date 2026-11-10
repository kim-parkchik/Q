/**
 * 年末調整の計算に使う表・計算式の形
 * 実際のデータは nencho20XX.ts（国税庁「年末調整のしかた」の PDF から自動生成）
 */

/** 給与所得控除後の給与等の金額の区分：決まった金額か、「年調給与額 × rate% − minus」 */
export type EmploymentIncomeSegment =
  | { from: number; to: number; fixed: number }
  | { from: number; to: number; rate: number; minus: number };

/** 保険料の控除額の計算式：upTo 円までは「金額 ÷ divisor ＋ plus」（1円未満切り上げ）、最後の行を超えたら max */
export interface InsuranceFormula {
  brackets: { upTo: number; divisor: number; plus: number }[];
  max: number;
}

export interface NenchoMaster {
  year: number;
  /** 給与等の金額がこれを超える人は、年末調整をしない */
  salaryLimit: number;
  /** 年調給与額：from〜to の給与の総額は、from から step 円刻みの最低額に置き換える */
  rounding: { from: number; to: number; step: number };
  /** 給与所得控除後の給与等の金額（年調給与額の区分ごと） */
  employmentIncome: EmploymentIncomeSegment[];
  /** 所得金額調整控除：（給与等の金額 − threshold）× ratePercent%（1円未満切り上げ、最高 max） */
  incomeAdjustment: { threshold: number; ratePercent: number; max: number };
  /** 基礎控除額：合計所得金額が upTo 以下なら amount（最後の行を超えたら0） */
  basic: { upTo: number; amount: number }[];
  /** 配偶者控除・配偶者特別控除 */
  spouse: {
    /** 所得者の合計所得金額の区分（この金額以下）。最後を超えたら控除なし */
    ownerBands: number[];
    /** 配偶者の合計所得金額がこれ以下なら配偶者控除 */
    spouseIncomeLimit: number;
    /** 配偶者控除額（所得者の区分ごと） */
    normal: number[];
    /** 老人控除対象配偶者の配偶者控除額（所得者の区分ごと） */
    elderly: number[];
    /** 配偶者特別控除額（配偶者の合計所得金額が over 超 upTo 以下） */
    special: { over: number; upTo: number; amounts: number[] }[];
    /** 配偶者の合計所得金額がこれを超えたら配偶者特別控除なし */
    specialIncomeLimit: number;
  };
  /** 特定親族特別控除額（特定親族の合計所得金額が over 超 upTo 以下） */
  specificRelative: { over: number; upTo: number; amount: number }[];
  /** 扶養控除・障害者控除・寡婦控除・ひとり親控除・勤労学生控除の額 */
  deductions: {
    dependentGeneral: number;
    dependentSpecific: number;
    dependentElderlyOther: number;
    dependentElderlyLivingTogether: number;
    disabilityGeneral: number;
    disabilitySpecial: number;
    disabilitySpecialLivingTogether: number;
    widow: number;
    singleParent: number;
    workingStudent: number;
  };
  /** 生命保険料控除（new: 計算式Ⅰ / newYoung: 計算式Ⅱ（23歳未満の扶養親族がいるときの新生命保険料） / old: 計算式Ⅲ） */
  lifeInsurance: {
    new: InsuranceFormula;
    newYoung: InsuranceFormula;
    old: InsuranceFormula;
    /** 一般の生命保険料で、新旧の両方を合わせたときの上限（23歳未満の扶養親族がいるときは generalMaxYoung） */
    generalMax: number;
    generalMaxYoung: number;
    /** 個人年金保険料で、新旧の両方を合わせたときの上限 */
    pensionMax: number;
    /** 生命保険料控除の合計の上限 */
    totalMax: number;
  };
  /** 地震保険料控除 */
  earthquake: { earthquakeMax: number; totalMax: number; oldLongTerm: InsuranceFormula };
  /** 算出所得税額の速算表：課税給与所得金額が upTo 以下なら「× rate% − minus」 */
  taxRates: { upTo: number; rate: number; minus: number }[];
  /** 課税給与所得金額がこれを超える人は、年末調整をしない */
  taxableLimit: number;
  /** 課税給与所得金額の端数を切り捨てる単位 */
  taxableRoundTo: number;
  /**
   * 年調年税額 = 年調所得税額 × ratePercent%（roundTo 円未満切り捨て）
   * 令和8年分までは復興特別所得税を、令和9年分からは防衛特別所得税と復興特別所得税を含む額（どちらも102.1%。
   * 国税庁「源泉所得税の改正のあらまし」令和8年4月 8ページ）。名前の reconstruction は復興特別所得税から
   */
  reconstruction: { ratePercent: number; roundTo: number };
}

/**
 * 給与所得の源泉徴収票の記載に使う区分など（国税庁「給与所得の源泉徴収票等の法定調書の作成と提出の手引」第2章から自動生成）
 */
export interface WithholdingSlipMaster {
  year: number;
  /** 控除対象配偶者・控除対象扶養親族・16歳未満の扶養親族が居住者（国内に住所がある）ときの区分 */
  residentCode: string;
  /**
   * 年末調整をしない人の源泉徴収票（扶養控除等申告書の記載に応じて書く）に使う線（手引「4 用語の説明」）
   * ・源泉控除対象配偶者：受給者の合計所得金額が recipientIncomeLimit 以下で、配偶者の合計所得の見積額が spouseIncomeLimit 以下
   * ・同一生計配偶者・扶養親族の合計所得の線は currentIncomeLimit。ただしその年の earlierUntil（MM-DD）以前は earlierIncomeLimit
   *   （特定親族の下の線も同じ）
   * ・源泉控除対象親族：控除対象扶養親族と、合計所得の見積額が specificRelativeLimit 以下の特定親族
   */
  withoutAdjustment: {
    recipientIncomeLimit: number;
    spouseIncomeLimit: number;
    earlierUntil: string;
    earlierIncomeLimit: number;
    currentIncomeLimit: number;
    specificRelativeLimit: number;
  };
  /** 特定親族特別控除の額（特定親族の合計所得金額が over 超 upTo 以下）ごとの区分（居住者・非居住者） */
  specificRelativeCodes: { amount: number; over: number; upTo: number; resident: string; nonResident: string }[];
  /** 住宅借入金等特別控除区分（code は税務署提出用、label は受給者交付用・給与支払報告書の書き方） */
  housingLoanKinds: { code: string; label: string }[];
  /** 未成年者：この日以後に生まれた人 */
  minorBornOnOrAfter: string;
  /** 16歳未満の扶養親族：この日以後に生まれた人 */
  youngBornOnOrAfter: string;
  /** 年齢23歳未満の扶養親族を有する場合の生命保険料控除の特例を受けたときに、摘要欄に書く文 */
  lifeInsuranceYoungNote: string;
  /**
   * 国税庁の手引がまだ出ていない年分の「仮の書き方」のときだけ（constants/nencho/index.ts の getProvisionalSlipMaster）。
   * basedOn は元にした手引の年分、notes は源泉徴収票の画面に出す知らせ（印刷はしない）
   */
  provisional?: { basedOn: number; notes: string[] };
}
